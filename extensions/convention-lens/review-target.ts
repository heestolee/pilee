import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { captureUnifiedDiff } from "../pr-review/evidence.ts";
import type { ConventionLensReviewTarget, ConventionLensRunBaseline } from "./types.ts";

interface ExecResult {
	stdout: string;
	stderr: string;
	code: number;
}

export interface ConventionLensExec {
	exec(command: string, args: string[], options: { cwd: string; timeout?: number }): Promise<ExecResult>;
}

async function git(pi: ConventionLensExec, cwd: string, args: string[], allowCodeOne = false): Promise<string> {
	const result = await pi.exec("git", args, { cwd, timeout: 20_000 });
	if (result.code !== 0 && !(allowCodeOne && result.code === 1)) {
		throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
	}
	return result.stdout;
}

function lines(value: string): string[] {
	return value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

async function currentHead(pi: ConventionLensExec, cwd: string): Promise<string> {
	return (await git(pi, cwd, ["rev-parse", "HEAD"])).trim();
}

async function changedPaths(pi: ConventionLensExec, cwd: string, baseHead: string): Promise<string[]> {
	const tracked = lines(await git(pi, cwd, ["diff", "--name-only", baseHead, "--"]));
	const untracked = lines(await git(pi, cwd, ["ls-files", "--others", "--exclude-standard"]));
	return [...new Set([...tracked, ...untracked])].sort();
}

function hashPath(cwd: string, path: string): string {
	const absolute = resolve(cwd, path);
	if (!existsSync(absolute)) return "deleted";
	const stat = statSync(absolute);
	if (!stat.isFile()) return `non-file:${stat.mode}`;
	return createHash("sha256").update(readFileSync(absolute)).digest("hex");
}

async function pathHashes(pi: ConventionLensExec, cwd: string, baseHead: string): Promise<Record<string, string>> {
	return Object.fromEntries((await changedPaths(pi, cwd, baseHead)).map((path) => [path, hashPath(cwd, path)]));
}

async function workingDiffFingerprint(pi: ConventionLensExec, cwd: string, head: string): Promise<string | undefined> {
	const paths = await changedPaths(pi, cwd, head);
	if (!paths.length) return undefined;
	return createHash("sha256").update(JSON.stringify(await pathHashes(pi, cwd, head))).digest("hex");
}

export async function captureConventionLensBaseline(
	pi: ConventionLensExec,
	cwd: string,
	now = Date.now(),
): Promise<ConventionLensRunBaseline> {
	const head = await currentHead(pi, cwd);
	return {
		startHead: head,
		startDiffFingerprint: await workingDiffFingerprint(pi, cwd, head),
		fileHashes: await pathHashes(pi, cwd, head),
		startedAt: now,
	};
}

async function isTracked(pi: ConventionLensExec, cwd: string, path: string): Promise<boolean> {
	const result = await pi.exec("git", ["ls-files", "--error-unmatch", "--", path], { cwd, timeout: 10_000 });
	return result.code === 0;
}

async function collectDiff(
	pi: ConventionLensExec,
	cwd: string,
	baseHead: string,
	paths: string[],
): Promise<string> {
	const tracked: string[] = [];
	const untracked: string[] = [];
	for (const path of paths) {
		if (await isTracked(pi, cwd, path)) tracked.push(path);
		else if (existsSync(resolve(cwd, path))) untracked.push(path);
	}
	const parts: string[] = [];
	if (tracked.length) {
		const diff = await git(pi, cwd, ["diff", "--no-ext-diff", "--no-color", baseHead, "--", ...tracked]);
		if (diff.trim()) parts.push(diff.trimEnd());
	}
	for (const path of untracked) {
		const diff = await git(pi, cwd, ["diff", "--no-index", "--no-color", "--", "/dev/null", path], true);
		if (diff.trim()) parts.push(diff.trimEnd());
	}
	return parts.length ? `${parts.join("\n")}\n` : "";
}

async function hasWorkingChanges(pi: ConventionLensExec, cwd: string): Promise<boolean> {
	return Boolean((await git(pi, cwd, ["status", "--porcelain"])).trim());
}

export async function selectConventionLensReviewTarget(
	pi: ConventionLensExec,
	cwd: string,
	baseline: ConventionLensRunBaseline,
	options: { includePaths?: string[] } = {},
): Promise<ConventionLensReviewTarget | undefined> {
	const head = await currentHead(pi, cwd);
	const currentPaths = await changedPaths(pi, cwd, baseline.startHead);
	const include = options.includePaths?.length ? new Set(options.includePaths) : undefined;
	const touched = currentPaths.filter((path) => {
		if (include && !include.has(path)) return false;
		return baseline.fileHashes[path] !== hashPath(cwd, path);
	});
	if (!touched.length) return undefined;
	const diff = await collectDiff(pi, cwd, baseline.startHead, touched);
	if (!diff.trim()) return undefined;
	const bundle = captureUnifiedDiff(diff, {
		kind: "convention-lens",
		baseHead: baseline.startHead,
		currentHead: head,
		paths: touched,
	});
	const headChanged = head !== baseline.startHead;
	const dirty = await hasWorkingChanges(pi, cwd);
	const kind = headChanged && dirty ? "combined-run-diff" : headChanged ? "same-run-commits" : "working-diff";
	return {
		kind,
		baseHead: baseline.startHead,
		currentHead: head,
		paths: touched,
		diff,
		fingerprint: bundle.sourceSha256,
		bundle,
	};
}

export const __test = { changedPaths, collectDiff, hashPath, lines };
