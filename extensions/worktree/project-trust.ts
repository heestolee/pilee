import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	isWorkspaceActionAuthorized,
	type WorkspaceActivationContract,
} from "../utils/workspace-activation-contract.ts";

export const CREATED_WORKTREE_PROJECT_TRUST_ENV = "PI_CREATED_WORKTREE_PROJECT_TRUST_FILE";
const CREATED_WORKTREE_PROJECT_TRUST_VERSION = 1;
const CREATED_WORKTREE_PROJECT_TRUST_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CREATED_WORKTREE_PROJECT_TRUST_ROOT = join(getAgentDir(), "workspace-project-trust");
const CREATED_WORKTREE_PROJECT_TRUST_LOCK = Symbol.for("pilee.created-worktree-project-trust-lock");

type CreatedWorktreeProjectTrustLockState = {
	tail: Promise<void>;
};

type CreatedWorktreeProjectTrustDescriptor = {
	version: typeof CREATED_WORKTREE_PROJECT_TRUST_VERSION;
	id: string;
	cwd: string;
	sessionFile: string;
	activationId: string;
	workspaceAction: "create-worktree";
	authorization: {
		eventId: string;
		consumerId: string;
		source: string;
		sourceId: string;
	};
	createdAt: string;
	expiresAt: string;
};

export type ProjectTrustDecision =
	| { trusted: "yes"; remember: true }
	| { trusted: "undecided" };

function safeRealpath(path: string): string {
	try { return realpathSync.native(path); } catch { return resolve(path); }
}

function samePath(left: string, right: string): boolean {
	return safeRealpath(left) === safeRealpath(right);
}

function isDirectChild(path: string, root: string): boolean {
	return dirname(safeRealpath(path)) === safeRealpath(root);
}

function readDescriptor(path: string): CreatedWorktreeProjectTrustDescriptor | null {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as Partial<CreatedWorktreeProjectTrustDescriptor>;
		if (
			value.version !== CREATED_WORKTREE_PROJECT_TRUST_VERSION
			|| typeof value.id !== "string"
			|| typeof value.cwd !== "string"
			|| typeof value.sessionFile !== "string"
			|| typeof value.activationId !== "string"
			|| value.workspaceAction !== "create-worktree"
			|| typeof value.createdAt !== "string"
			|| typeof value.expiresAt !== "string"
			|| typeof value.authorization?.eventId !== "string"
			|| typeof value.authorization?.consumerId !== "string"
			|| typeof value.authorization?.source !== "string"
			|| typeof value.authorization?.sourceId !== "string"
		) return null;
		return value as CreatedWorktreeProjectTrustDescriptor;
	} catch {
		return null;
	}
}

function pruneExpiredDescriptors(root: string, now: number): void {
	if (!existsSync(root)) return;
	for (const name of readdirSync(root)) {
		if (!name.endsWith(".json")) continue;
		const path = join(root, name);
		const descriptor = readDescriptor(path);
		if (!descriptor || Date.parse(descriptor.expiresAt) <= now) rmSync(path, { force: true });
	}
}

function authorizationEvidence(contract: WorkspaceActivationContract): CreatedWorktreeProjectTrustDescriptor["authorization"] {
	if (contract.workspaceAction !== "create-worktree" || !isWorkspaceActionAuthorized(contract.authorization, "create-worktree")) {
		throw new Error("create-worktree authorization이 없는 activation contract입니다.");
	}
	const proof = contract.authorization.proof;
	const event = proof
		? contract.authorization.events.find((candidate) => candidate.id === proof.eventId)
		: [...contract.authorization.events].reverse().find((candidate) =>
			candidate.action === "create-worktree" && candidate.decision === "allow",
		);
	if (!event?.id || event.decision !== "allow") {
		throw new Error("create-worktree authorization evidence가 없습니다.");
	}
	if (
		proof
		&& (
			proof.action !== "create-worktree"
			|| event.consumedBy !== proof.consumerId
			|| !event.consumedAt
		)
	) {
		throw new Error("consumed create-worktree authorization evidence가 일치하지 않습니다.");
	}
	return {
		eventId: event.id,
		consumerId: proof?.consumerId ?? `activation-contract:${contract.id}`,
		source: event.source,
		sourceId: event.sourceId,
	};
}

export function prepareCreatedWorktreeProjectTrust(input: {
	contract: WorkspaceActivationContract;
	cwd: string;
	sessionFile: string;
	root?: string;
	now?: number;
}): { path: string; descriptor: CreatedWorktreeProjectTrustDescriptor } {
	if (!existsSync(input.cwd)) throw new Error(`created worktree cwd가 없습니다: ${input.cwd}`);
	if (!existsSync(input.sessionFile)) throw new Error(`created worktree session file이 없습니다: ${input.sessionFile}`);
	const now = input.now ?? Date.now();
	const root = input.root ?? DEFAULT_CREATED_WORKTREE_PROJECT_TRUST_ROOT;
	mkdirSync(root, { recursive: true, mode: 0o700 });
	pruneExpiredDescriptors(root, now);
	const id = randomUUID();
	const descriptor: CreatedWorktreeProjectTrustDescriptor = {
		version: CREATED_WORKTREE_PROJECT_TRUST_VERSION,
		id,
		cwd: safeRealpath(input.cwd),
		sessionFile: safeRealpath(input.sessionFile),
		activationId: input.contract.id,
		workspaceAction: "create-worktree",
		authorization: authorizationEvidence(input.contract),
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + CREATED_WORKTREE_PROJECT_TRUST_TTL_MS).toISOString(),
	};
	const path = join(root, `${id}.json`);
	const temporary = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, path);
	return { path, descriptor };
}

export function removeCreatedWorktreeProjectTrust(path: string | undefined): void {
	if (path) rmSync(path, { force: true });
}

export function consumeCreatedWorktreeProjectTrust(
	cwd: string,
	env: Record<string, string | undefined> = process.env,
	options: { root?: string; now?: number } = {},
): ProjectTrustDecision {
	const path = env[CREATED_WORKTREE_PROJECT_TRUST_ENV]?.trim();
	if (!path) return { trusted: "undecided" };
	const root = options.root ?? DEFAULT_CREATED_WORKTREE_PROJECT_TRUST_ROOT;
	if (!existsSync(path) || !isDirectChild(path, root)) return { trusted: "undecided" };

	const descriptor = readDescriptor(path);
	const now = options.now ?? Date.now();
	const valid = Boolean(
		descriptor
		&& Date.parse(descriptor.expiresAt) > now
		&& samePath(descriptor.cwd, cwd)
		&& existsSync(descriptor.sessionFile)
		&& descriptor.workspaceAction === "create-worktree"
		&& descriptor.authorization.eventId
		&& descriptor.authorization.consumerId
	);
	removeCreatedWorktreeProjectTrust(path);
	return valid
		? { trusted: "yes", remember: true }
		: { trusted: "undecided" };
}

function createdWorktreeProjectTrustLockState(): CreatedWorktreeProjectTrustLockState {
	const host = globalThis as typeof globalThis & Record<symbol, CreatedWorktreeProjectTrustLockState | undefined>;
	return host[CREATED_WORKTREE_PROJECT_TRUST_LOCK]
		??= { tail: Promise.resolve() };
}

async function withCreatedWorktreeProjectTrustLock<T>(run: () => Promise<T>): Promise<T> {
	const state = createdWorktreeProjectTrustLockState();
	const predecessor = state.tail;
	let release!: () => void;
	state.tail = new Promise<void>((resolve) => { release = resolve; });
	await predecessor;
	try {
		return await run();
	} finally {
		release();
	}
}

export async function withCreatedWorktreeProjectTrust<T>(input: {
	contract: WorkspaceActivationContract;
	cwd: string;
	sessionFile: string;
	root?: string;
	run: () => Promise<T>;
}): Promise<T> {
	if (input.contract.workspaceAction !== "create-worktree") return input.run();
	return withCreatedWorktreeProjectTrustLock(async () => {
		const prepared = prepareCreatedWorktreeProjectTrust(input);
		const previous = process.env[CREATED_WORKTREE_PROJECT_TRUST_ENV];
		process.env[CREATED_WORKTREE_PROJECT_TRUST_ENV] = prepared.path;
		try {
			return await input.run();
		} finally {
			if (process.env[CREATED_WORKTREE_PROJECT_TRUST_ENV] === prepared.path) {
				if (previous === undefined) delete process.env[CREATED_WORKTREE_PROJECT_TRUST_ENV];
				else process.env[CREATED_WORKTREE_PROJECT_TRUST_ENV] = previous;
			}
			removeCreatedWorktreeProjectTrust(prepared.path);
		}
	});
}

export function registerCreatedWorktreeProjectTrust(pi: ExtensionAPI): void {
	const trustCapablePi = pi as unknown as {
		on(
			event: "project_trust",
			handler: (event: { cwd: string }) => ProjectTrustDecision | Promise<ProjectTrustDecision>,
		): void;
	};
	trustCapablePi.on("project_trust", (event) => consumeCreatedWorktreeProjectTrust(event.cwd));
}
