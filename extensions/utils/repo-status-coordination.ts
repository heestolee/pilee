import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface RepoStatusCommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

interface RepoStatusCacheRecord extends RepoStatusCommandResult {
	version: 1;
	cwd: string;
	updatedAt: number;
}

interface RepoStatusLeaseRecord {
	version: 1;
	cwd: string;
	token: string;
	pid: number;
	updatedAt: number;
}

interface RepoStatusPauseRecord {
	version: 1;
	cwd: string;
	token: string;
	pid: number;
	reason: string;
	updatedAt: number;
	expiresAt: number;
}

export interface RepoStatusLease {
	token: string;
	cwd: string;
	release(): Promise<void>;
}

export const REPO_STATUS_CACHE_MAX_AGE_MS = 45_000;
export const REPO_STATUS_LEASE_TTL_MS = 30_000;
export const REPO_STATUS_PAUSE_TTL_MS = 120_000;

function stateRoot(): string {
	return process.env.PILEE_REPO_STATUS_STATE_DIR ?? join(homedir(), ".pi", "agent", "state", "repo-status");
}

async function canonicalCwd(cwd: string): Promise<string> {
	try {
		return await realpath(cwd);
	} catch {
		return resolve(cwd);
	}
}

function keyForCwd(cwd: string): string {
	return createHash("sha1").update(cwd).digest("hex");
}

async function pathsForCwd(cwd: string) {
	const canonical = await canonicalCwd(cwd);
	const root = stateRoot();
	const key = keyForCwd(canonical);
	return {
		canonical,
		root,
		cachePath: join(root, `${key}.json`),
		leaseDir: join(root, `${key}.lease`),
		leaseOwnerPath: join(root, `${key}.lease`, "owner.json"),
		pauseDir: join(root, `${key}.pause`),
	};
}

async function readJson<T>(path: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as T;
	} catch {
		return null;
	}
}

function isResultRecord(value: unknown): value is RepoStatusCacheRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as Partial<RepoStatusCacheRecord>;
	return (
		record.version === 1 &&
		typeof record.cwd === "string" &&
		typeof record.updatedAt === "number" &&
		typeof record.code === "number" &&
		typeof record.stdout === "string" &&
		typeof record.stderr === "string"
	);
}

function isLeaseRecord(value: unknown): value is RepoStatusLeaseRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as Partial<RepoStatusLeaseRecord>;
	return (
		record.version === 1 &&
		typeof record.cwd === "string" &&
		typeof record.token === "string" &&
		typeof record.pid === "number" &&
		typeof record.updatedAt === "number"
	);
}

function isPauseRecord(value: unknown): value is RepoStatusPauseRecord {
	if (!value || typeof value !== "object") return false;
	const record = value as Partial<RepoStatusPauseRecord>;
	return (
		record.version === 1 &&
		typeof record.cwd === "string" &&
		typeof record.token === "string" &&
		typeof record.pid === "number" &&
		typeof record.reason === "string" &&
		typeof record.updatedAt === "number" &&
		typeof record.expiresAt === "number"
	);
}

export async function readRepoStatusCache(
	cwd: string,
	maxAgeMs = REPO_STATUS_CACHE_MAX_AGE_MS,
	now = Date.now(),
): Promise<RepoStatusCommandResult | null> {
	const paths = await pathsForCwd(cwd);
	const record = await readJson<unknown>(paths.cachePath);
	if (!isResultRecord(record)) return null;
	if (record.cwd !== paths.canonical) return null;
	if (now - record.updatedAt > maxAgeMs) return null;
	return { code: record.code, stdout: record.stdout, stderr: record.stderr };
}

export async function writeRepoStatusCache(
	cwd: string,
	result: RepoStatusCommandResult,
	now = Date.now(),
): Promise<void> {
	const paths = await pathsForCwd(cwd);
	await mkdir(paths.root, { recursive: true });
	const record: RepoStatusCacheRecord = {
		version: 1,
		cwd: paths.canonical,
		updatedAt: now,
		code: result.code,
		stdout: result.stdout,
		stderr: result.stderr,
	};
	await writeFile(paths.cachePath, `${JSON.stringify(record)}\n`, "utf8");
}

async function releaseLease(leaseDir: string, ownerPath: string, token: string): Promise<void> {
	const owner = await readJson<unknown>(ownerPath);
	if (isLeaseRecord(owner) && owner.token !== token) return;
	await rm(leaseDir, { recursive: true, force: true });
}

async function tryCreateLease(cwd: string, now: number): Promise<RepoStatusLease | null> {
	const paths = await pathsForCwd(cwd);
	const token = randomUUID();
	await mkdir(paths.root, { recursive: true });
	try {
		await mkdir(paths.leaseDir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return null;
		throw error;
	}
	const owner: RepoStatusLeaseRecord = {
		version: 1,
		cwd: paths.canonical,
		token,
		pid: process.pid,
		updatedAt: now,
	};
	await writeFile(paths.leaseOwnerPath, `${JSON.stringify(owner)}\n`, "utf8");
	return {
		token,
		cwd: paths.canonical,
		release: () => releaseLease(paths.leaseDir, paths.leaseOwnerPath, token),
	};
}

export async function isRepoStatusPaused(cwd: string, now = Date.now()): Promise<boolean> {
	const paths = await pathsForCwd(cwd);
	let entries: string[];
	try {
		entries = await readdir(paths.pauseDir);
	} catch {
		return false;
	}

	let paused = false;
	await Promise.all(entries.map(async (entry) => {
		const path = join(paths.pauseDir, entry);
		const record = await readJson<unknown>(path);
		if (!isPauseRecord(record) || record.cwd !== paths.canonical || record.expiresAt <= now) {
			await rm(path, { force: true });
			return;
		}
		paused = true;
	}));
	return paused;
}

export async function withRepoStatusPaused<T>(
	cwd: string,
	callback: () => Promise<T>,
	options: { reason?: string; ttlMs?: number } = {},
): Promise<T> {
	const paths = await pathsForCwd(cwd);
	const token = randomUUID();
	const now = Date.now();
	const ttlMs = options.ttlMs ?? REPO_STATUS_PAUSE_TTL_MS;
	await mkdir(paths.pauseDir, { recursive: true });
	const pausePath = join(paths.pauseDir, `${token}.json`);
	const record: RepoStatusPauseRecord = {
		version: 1,
		cwd: paths.canonical,
		token,
		pid: process.pid,
		reason: options.reason ?? "git-mutation",
		updatedAt: now,
		expiresAt: now + ttlMs,
	};
	await writeFile(pausePath, `${JSON.stringify(record)}\n`, "utf8");
	try {
		return await callback();
	} finally {
		await rm(pausePath, { force: true });
	}
}

export async function acquireRepoStatusLease(
	cwd: string,
	leaseTtlMs = REPO_STATUS_LEASE_TTL_MS,
	now = Date.now(),
): Promise<RepoStatusLease | null> {
	const lease = await tryCreateLease(cwd, now);
	if (lease) return lease;

	const paths = await pathsForCwd(cwd);
	const owner = await readJson<unknown>(paths.leaseOwnerPath);
	const stale = !isLeaseRecord(owner) || owner.cwd !== paths.canonical || now - owner.updatedAt > leaseTtlMs;
	if (!stale) return null;

	await rm(paths.leaseDir, { recursive: true, force: true });
	return await tryCreateLease(cwd, now);
}

export async function waitForRepoStatusCache(
	cwd: string,
	options: { timeoutMs?: number; intervalMs?: number; maxAgeMs?: number } = {},
): Promise<RepoStatusCommandResult | null> {
	const timeoutMs = options.timeoutMs ?? 800;
	const intervalMs = options.intervalMs ?? 80;
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		const cached = await readRepoStatusCache(cwd, options.maxAgeMs);
		if (cached) return cached;
		await new Promise((resolve) => setTimeout(resolve, intervalMs));
	}
	return null;
}
