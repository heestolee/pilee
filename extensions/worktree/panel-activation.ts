import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import {
	chooseNewPanelPlacement,
	closeExactSessionPanel,
	openExactSessionInNewPanel,
	removeExactSessionPanelRecord,
	type ExactSessionPanelOpenRequest,
	type ExactSessionPanelOpenResult,
} from "../fork-panel/index.ts";
import {
	createWorkspaceActivationContract,
	explicitWorkspaceAuthorization,
	type NewPanelPlacement,
	type WorkspaceActivationContract,
	type WorkspaceAction,
	type WorkspaceAuthorizationSource,
	type WorkspaceContextMode,
	type WorkspaceContinuation,
} from "../utils/workspace-activation-contract.ts";

export const WORKSPACE_ACTIVATION_ENV = "PI_WORKSPACE_ACTIVATION_FILE";
const WORKSPACE_ACTIVATION_VERSION = 1;
const DEFAULT_ACTIVATION_ROOT = join(getAgentDir(), "workspace-activations");
const DEFAULT_READY_TIMEOUT_MS = 20_000;
const POLL_INTERVAL_MS = 80;
const LOCK_RETRY_MS = 10;
const LOCK_TIMEOUT_MS = 1_000;
const STALE_LOCK_MS = 5_000;

export type WorkspacePanelActivationStatus =
	| "prepared"
	| "panel-opened"
	| "ready"
	| "continuing"
	| "continued"
	| "cancelling"
	| "cancelled"
	| "failed";

interface WorkspacePanelActivationClaim {
	kind: "continuation" | "cancellation";
	ownerId: string;
	pid: number;
	claimedAt: string;
}

interface WorkspacePanelActivationCleanup {
	terminalClosed: boolean;
	recordRemoved: boolean;
	descriptorPreserved: boolean;
	attemptedAt: string;
	reason?: string;
}

export interface WorkspacePanelActivationDescriptor {
	version: typeof WORKSPACE_ACTIVATION_VERSION;
	id: string;
	status: WorkspacePanelActivationStatus;
	contract: WorkspaceActivationContract;
	expected: {
		cwd: string;
		sessionFile: string;
		sourceSessionFile: string;
	};
	panel?: {
		placement: NewPanelPlacement;
		terminalId: string;
		forkId: string;
		panelLabel: string;
	};
	observed?: {
		cwd: string;
		sessionFile: string;
		pid: number;
	};
	createdAt: string;
	readyAt?: string;
	continuingAt?: string;
	continuedAt?: string;
	cancellingAt?: string;
	cancelledAt?: string;
	failedAt?: string;
	continuationClaim?: WorkspacePanelActivationClaim;
	cancellationClaim?: WorkspacePanelActivationClaim;
	cleanup?: WorkspacePanelActivationCleanup;
	error?: string;
}

export type WorkspacePanelActivationResult =
	| {
		status: "activated";
		contract: WorkspaceActivationContract;
		placement: NewPanelPlacement;
		terminalId: string;
		forkId: string;
		panelLabel: string;
		readyAt: string;
		continuationDispatched: boolean;
	}
	| {
		status: "blocked" | "failed";
		reason: string;
		contract: WorkspaceActivationContract;
		placement: NewPanelPlacement;
		terminalId?: string;
		forkId?: string;
		panelLabel?: string;
		descriptorPath?: string;
		safeToDeleteTarget: boolean;
		cleanup?: WorkspacePanelActivationCleanup;
	};

interface ActivateWorkspacePanelInput {
	contract: WorkspaceActivationContract;
	cwd: string;
	sessionFile: string;
	sourceSessionFile: string;
	title: string;
	timeoutMs?: number;
	activationRoot?: string;
}

interface ActivationDependencies {
	openPanel?: (pi: ExtensionAPI, request: ExactSessionPanelOpenRequest) => Promise<ExactSessionPanelOpenResult>;
	closePanel?: typeof closeExactSessionPanel;
	removePanelRecord?: typeof removeExactSessionPanelRecord;
	sleep?: (ms: number) => Promise<void>;
}

function safeRealpath(path: string): string {
	try { return realpathSync.native(path); } catch { return path; }
}

function samePath(left: string, right: string): boolean {
	return safeRealpath(left) === safeRealpath(right);
}

function activationFilePath(id: string, root = DEFAULT_ACTIVATION_ROOT): string {
	const safeId = id.replace(/[^A-Za-z0-9._-]/g, "-");
	return join(root, `${safeId}.json`);
}

function writeDescriptor(path: string, descriptor: WorkspacePanelActivationDescriptor): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, "utf8");
	renameSync(temporary, path);
}

export function readWorkspacePanelActivation(path: string): WorkspacePanelActivationDescriptor | null {
	try {
		if (!existsSync(path)) return null;
		const value = JSON.parse(readFileSync(path, "utf8")) as WorkspacePanelActivationDescriptor;
		if (value.version !== WORKSPACE_ACTIVATION_VERSION || !value.id || !value.expected || !value.contract) return null;
		return value;
	} catch {
		return null;
	}
}

function errorCode(error: unknown): string | undefined {
	return typeof error === "object" && error !== null && "code" in error
		? String((error as { code?: unknown }).code)
		: undefined;
}

async function acquireDescriptorLock(path: string): Promise<() => void> {
	const lockPath = `${path}.lock`;
	const deadline = Date.now() + LOCK_TIMEOUT_MS;
	while (true) {
		try {
			mkdirSync(lockPath);
			writeFileSync(join(lockPath, "owner.json"), `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`, "utf8");
			return () => rmSync(lockPath, { recursive: true, force: true });
		} catch (error) {
			if (errorCode(error) !== "EEXIST") throw error;
			try {
				if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
					rmSync(lockPath, { recursive: true, force: true });
					continue;
				}
			} catch (statError) {
				if (errorCode(statError) === "ENOENT") continue;
				throw statError;
			}
			if (Date.now() >= deadline) throw new Error(`workspace activation lock timeout: ${lockPath}`);
			await new Promise<void>((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
		}
	}
}

interface DescriptorMutationResult {
	descriptor: WorkspacePanelActivationDescriptor;
	changed: boolean;
}

async function mutateDescriptor(
	path: string,
	mutate: (current: WorkspacePanelActivationDescriptor) => WorkspacePanelActivationDescriptor | null,
): Promise<DescriptorMutationResult> {
	const release = await acquireDescriptorLock(path);
	try {
		const current = readWorkspacePanelActivation(path);
		if (!current) throw new Error(`workspace activation descriptor를 읽지 못했습니다: ${path}`);
		const next = mutate(current);
		if (!next) return { descriptor: current, changed: false };
		writeDescriptor(path, next);
		return { descriptor: next, changed: true };
	} finally {
		release();
	}
}

async function transitionDescriptor(input: {
	path: string;
	from: WorkspacePanelActivationStatus[];
	to: WorkspacePanelActivationStatus;
	patch?: Partial<WorkspacePanelActivationDescriptor>;
	ownerId?: string;
	ownerKind?: WorkspacePanelActivationClaim["kind"];
}): Promise<DescriptorMutationResult> {
	return mutateDescriptor(input.path, (current) => {
		if (!input.from.includes(current.status)) return null;
		if (input.ownerId && input.ownerKind === "continuation" && current.continuationClaim?.ownerId !== input.ownerId) return null;
		if (input.ownerId && input.ownerKind === "cancellation" && current.cancellationClaim?.ownerId !== input.ownerId) return null;
		return { ...current, ...input.patch, status: input.to };
	});
}

export function prepareWorkspacePanelActivation(
	input: ActivateWorkspacePanelInput,
): { path: string; descriptor: WorkspacePanelActivationDescriptor } {
	if (input.contract.activationTarget !== "new-panel" || !input.contract.placement) {
		throw new Error("panel activation에는 new-panel contract와 placement가 필요합니다.");
	}
	if (!existsSync(input.sessionFile)) throw new Error(`target session file이 없습니다: ${input.sessionFile}`);
	if (!existsSync(input.sourceSessionFile)) throw new Error(`source session file이 없습니다: ${input.sourceSessionFile}`);
	const createdAt = new Date().toISOString();
	const descriptor: WorkspacePanelActivationDescriptor = {
		version: WORKSPACE_ACTIVATION_VERSION,
		id: input.contract.id,
		status: "prepared",
		contract: input.contract,
		expected: {
			cwd: safeRealpath(input.cwd),
			sessionFile: safeRealpath(input.sessionFile),
			sourceSessionFile: safeRealpath(input.sourceSessionFile),
		},
		createdAt,
	};
	const path = activationFilePath(input.contract.id, input.activationRoot);
	writeDescriptor(path, descriptor);
	return { path, descriptor };
}

async function receiverFailure(path: string, error: string): Promise<WorkspacePanelActivationDescriptor | null> {
	try {
		const failed = await transitionDescriptor({
			path,
			from: ["prepared", "panel-opened"],
			to: "failed",
			patch: { error, failedAt: new Date().toISOString() },
		});
		return failed.descriptor;
	} catch {
		return readWorkspacePanelActivation(path);
	}
}

export async function receiveWorkspacePanelActivation(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	env: Record<string, string | undefined> = process.env,
): Promise<WorkspacePanelActivationDescriptor | null> {
	const path = env[WORKSPACE_ACTIVATION_ENV]?.trim();
	if (!path) return null;
	const descriptor = readWorkspacePanelActivation(path);
	if (!descriptor || ["failed", "continuing", "continued", "cancelling", "cancelled"].includes(descriptor.status)) return descriptor;

	let observedSessionFile = "";
	let observedCwd = "";
	try {
		observedSessionFile = ctx.sessionManager.getSessionFile?.() ?? "";
		observedCwd = ctx.sessionManager.getCwd?.() ?? ctx.cwd;
	} catch (error) {
		return receiverFailure(path, `target session context를 읽지 못했습니다: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!observedSessionFile || !samePath(observedSessionFile, descriptor.expected.sessionFile)) {
		return receiverFailure(path, `exact session mismatch: expected ${descriptor.expected.sessionFile}, observed ${observedSessionFile || "(missing)"}`);
	}
	if (!observedCwd || !samePath(observedCwd, descriptor.expected.cwd)) {
		return receiverFailure(path, `exact cwd mismatch: expected ${descriptor.expected.cwd}, observed ${observedCwd || "(missing)"}`);
	}

	const readyAt = new Date().toISOString();
	let readyResult: DescriptorMutationResult;
	try {
		readyResult = await transitionDescriptor({
			path,
			from: ["prepared", "panel-opened"],
			to: "ready",
			patch: {
				observed: { cwd: safeRealpath(observedCwd), sessionFile: safeRealpath(observedSessionFile), pid: process.pid },
				readyAt,
				error: undefined,
			},
		});
	} catch (error) {
		return receiverFailure(path, `READY claim failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	const ready = readyResult.descriptor;
	if (readyResult.changed) {
		try {
			ctx.sessionManager.appendCustomEntry?.("workspace-activation-ready", {
				activationId: ready.id,
				workspaceAction: ready.contract.workspaceAction,
				activationTarget: ready.contract.activationTarget,
				placement: ready.contract.placement,
				sourceSessionFile: ready.expected.sourceSessionFile,
				readyAt,
			});
		} catch {
			// READY ack is already durable in the descriptor; session provenance is best-effort.
		}
	}
	if (ready.status !== "ready" || !ready.contract.continuation) return ready;

	const ownerId = `continuation-${process.pid}-${randomUUID()}`;
	const continuingAt = new Date().toISOString();
	let continuingResult: DescriptorMutationResult;
	try {
		continuingResult = await transitionDescriptor({
			path,
			from: ["ready"],
			to: "continuing",
			patch: {
				continuingAt,
				continuationClaim: { kind: "continuation", ownerId, pid: process.pid, claimedAt: continuingAt },
			},
		});
	} catch (error) {
		return receiverFailure(path, `continuation claim failed: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!continuingResult.changed) return continuingResult.descriptor;

	try {
		const continuation = continuingResult.descriptor.contract.continuation!;
		await Promise.resolve(pi.sendMessage({
			customType: continuation.customType,
			content: continuation.content,
			display: continuation.display ?? false,
			details: {
				...continuation.details,
				workspaceActivationId: continuingResult.descriptor.id,
				workspaceAction: continuingResult.descriptor.contract.workspaceAction,
				activationTarget: continuingResult.descriptor.contract.activationTarget,
				placement: continuingResult.descriptor.contract.placement,
			},
		}, { deliverAs: "followUp", triggerTurn: true }));
		const continued = await transitionDescriptor({
			path,
			from: ["continuing"],
			to: "continued",
			ownerId,
			ownerKind: "continuation",
			patch: { continuedAt: new Date().toISOString() },
		});
		return continued.descriptor;
	} catch (error) {
		const message = `continuation dispatch failed: ${error instanceof Error ? error.message : String(error)}`;
		try {
			const failed = await transitionDescriptor({
				path,
				from: ["continuing"],
				to: "failed",
				ownerId,
				ownerKind: "continuation",
				patch: { error: message, failedAt: new Date().toISOString() },
			});
			return failed.descriptor;
		} catch {
			return readWorkspacePanelActivation(path);
		}
	}
}

export function registerWorkspacePanelActivationReceiver(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		await receiveWorkspacePanelActivation(pi, ctx);
	});
}

function reachedExpectedStatus(
	descriptor: WorkspacePanelActivationDescriptor | null,
	expectedStatus: "ready" | "continued",
): descriptor is WorkspacePanelActivationDescriptor {
	return Boolean(descriptor && (
		descriptor.status === expectedStatus
		|| (expectedStatus === "ready" && descriptor.status === "continued")
	));
}

async function waitForWorkspacePanelActivation(
	path: string,
	expectedStatus: "ready" | "continued",
	timeoutMs: number,
	sleep: (ms: number) => Promise<void>,
): Promise<WorkspacePanelActivationDescriptor | null> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		const current = readWorkspacePanelActivation(path);
		if (!current || ["failed", "cancelled"].includes(current.status)) return current;
		if (reachedExpectedStatus(current, expectedStatus)) return current;
		await sleep(POLL_INTERVAL_MS);
	}
	return readWorkspacePanelActivation(path);
}

function activatedResult(
	input: ActivateWorkspacePanelInput,
	placement: NewPanelPlacement,
	opened: Extract<ExactSessionPanelOpenResult, { status: "opened" }>,
	final: WorkspacePanelActivationDescriptor,
): WorkspacePanelActivationResult {
	return {
		status: "activated",
		contract: input.contract,
		placement,
		terminalId: opened.terminalId,
		forkId: opened.forkId,
		panelLabel: opened.panelLabel,
		readyAt: final.readyAt ?? new Date().toISOString(),
		continuationDispatched: final.status === "continued",
	};
}

export async function activateWorkspaceInNewPanel(
	pi: ExtensionAPI,
	_ctx: ExtensionContext | ExtensionCommandContext,
	input: ActivateWorkspacePanelInput,
	dependencies: ActivationDependencies = {},
): Promise<WorkspacePanelActivationResult> {
	const placement = input.contract.placement;
	if (input.contract.activationTarget !== "new-panel" || !placement) {
		throw new Error("activateWorkspaceInNewPanel은 new-panel contract만 받습니다.");
	}
	const prepared = prepareWorkspacePanelActivation(input);
	const openPanel = dependencies.openPanel ?? openExactSessionInNewPanel;
	const closePanel = dependencies.closePanel ?? closeExactSessionPanel;
	const removePanelRecord = dependencies.removePanelRecord ?? removeExactSessionPanelRecord;
	const sleep = dependencies.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

	const opened = await openPanel(pi, {
		activationId: input.contract.id,
		placement,
		cwd: input.cwd,
		sessionFile: input.sessionFile,
		sourceSessionFile: input.sourceSessionFile,
		title: input.title,
		env: { [WORKSPACE_ACTIVATION_ENV]: prepared.path },
	});
	if (opened.status !== "opened") {
		rmSync(prepared.path, { force: true });
		rmSync(`${prepared.path}.lock`, { recursive: true, force: true });
		return {
			status: opened.status,
			reason: opened.reason,
			contract: input.contract,
			placement,
			safeToDeleteTarget: true,
		};
	}

	try {
		await mutateDescriptor(prepared.path, (current) => ({
			...current,
			status: current.status === "prepared" ? "panel-opened" : current.status,
			panel: { placement, terminalId: opened.terminalId, forkId: opened.forkId, panelLabel: opened.panelLabel },
		}));
	} catch (error) {
		return {
			status: "blocked",
			reason: `panel activation descriptor update failed: ${error instanceof Error ? error.message : String(error)}`,
			contract: input.contract,
			placement,
			terminalId: opened.terminalId,
			forkId: opened.forkId,
			panelLabel: opened.panelLabel,
			descriptorPath: prepared.path,
			safeToDeleteTarget: false,
		};
	}

	const expectedStatus = input.contract.continuation ? "continued" : "ready";
	const timeoutMs = input.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
	const final = await waitForWorkspacePanelActivation(prepared.path, expectedStatus, timeoutMs, sleep);
	if (reachedExpectedStatus(final, expectedStatus)) {
		rmSync(prepared.path, { force: true });
		return activatedResult(input, placement, opened, final);
	}

	const cancellationOwnerId = `cancellation-${process.pid}-${randomUUID()}`;
	const cancellingAt = new Date().toISOString();
	let cancellation: DescriptorMutationResult;
	try {
		cancellation = await transitionDescriptor({
			path: prepared.path,
			from: ["prepared", "panel-opened", "ready", "failed"],
			to: "cancelling",
			patch: {
				cancellingAt,
				cancellationClaim: { kind: "cancellation", ownerId: cancellationOwnerId, pid: process.pid, claimedAt: cancellingAt },
			},
		});
	} catch (error) {
		return {
			status: final?.status === "failed" ? "failed" : "blocked",
			reason: `target cancellation claim failed; artifacts preserved: ${error instanceof Error ? error.message : String(error)}`,
			contract: input.contract,
			placement,
			terminalId: opened.terminalId,
			forkId: opened.forkId,
			panelLabel: opened.panelLabel,
			descriptorPath: prepared.path,
			safeToDeleteTarget: false,
		};
	}

	if (!cancellation.changed) {
		const current = cancellation.descriptor;
		if (reachedExpectedStatus(current, expectedStatus)) {
			rmSync(prepared.path, { force: true });
			return activatedResult(input, placement, opened, current);
		}
		return {
			status: current.status === "failed" ? "failed" : "blocked",
			reason: `target activation is ${current.status}; parent cancellation을 claim하지 못해 child-owned artifacts를 보존합니다.`,
			contract: input.contract,
			placement,
			terminalId: opened.terminalId,
			forkId: opened.forkId,
			panelLabel: opened.panelLabel,
			descriptorPath: prepared.path,
			safeToDeleteTarget: false,
		};
	}

	const reason = final?.status === "failed"
		? final.error ?? "target activation failed"
		: `target READY handshake timeout (${timeoutMs}ms)`;
	const closed = await closePanel(pi, opened.terminalId);
	if (!closed.closed) {
		const cleanup: WorkspacePanelActivationCleanup = {
			terminalClosed: false,
			recordRemoved: false,
			descriptorPreserved: true,
			attemptedAt: new Date().toISOString(),
			reason: closed.reason,
		};
		try {
			await transitionDescriptor({
				path: prepared.path,
				from: ["cancelling"],
				to: "cancelling",
				ownerId: cancellationOwnerId,
				ownerKind: "cancellation",
				patch: { cleanup, error: reason },
			});
		} catch {
			// Preserve the original descriptor and panel record even when recording cleanup fails.
		}
		return {
			status: final?.status === "failed" ? "failed" : "blocked",
			reason: `${reason}; terminal close가 확인되지 않아 target artifacts를 보존합니다.`,
			contract: input.contract,
			placement,
			terminalId: opened.terminalId,
			forkId: opened.forkId,
			panelLabel: opened.panelLabel,
			descriptorPath: prepared.path,
			safeToDeleteTarget: false,
			cleanup,
		};
	}

	let recordRemoved = false;
	let recordRemovalReason: string | undefined;
	try {
		removePanelRecord(opened.forkId);
		recordRemoved = true;
	} catch (error) {
		recordRemovalReason = error instanceof Error ? error.message : String(error);
	}
	const cleanup: WorkspacePanelActivationCleanup = {
		terminalClosed: true,
		recordRemoved,
		descriptorPreserved: true,
		attemptedAt: new Date().toISOString(),
		reason: recordRemovalReason,
	};
	try {
		await transitionDescriptor({
			path: prepared.path,
			from: ["cancelling"],
			to: "cancelled",
			ownerId: cancellationOwnerId,
			ownerKind: "cancellation",
			patch: { cancelledAt: new Date().toISOString(), cleanup, error: reason },
		});
	} catch {
		// Terminal close is the deletion safety boundary; keep the descriptor for recovery if finalization fails.
	}
	return {
		status: final?.status === "failed" ? "failed" : "blocked",
		reason,
		contract: input.contract,
		placement,
		terminalId: opened.terminalId,
		forkId: opened.forkId,
		panelLabel: opened.panelLabel,
		descriptorPath: prepared.path,
		safeToDeleteTarget: true,
		cleanup,
	};
}

export async function buildNewPanelActivationContract(input: {
	id: string;
	ctx: ExtensionContext | ExtensionCommandContext;
	workspaceAction: WorkspaceAction;
	contextMode: WorkspaceContextMode;
	authorizationSource: WorkspaceAuthorizationSource;
	authorizationSourceId: string;
	continuation?: WorkspaceContinuation;
	placementTitle?: string;
}): Promise<WorkspaceActivationContract | null> {
	const placement = await chooseNewPanelPlacement(input.ctx, input.placementTitle);
	if (!placement) return null;
	return createWorkspaceActivationContract({
		id: input.id,
		workspaceAction: input.workspaceAction,
		activationTarget: "new-panel",
		placement,
		contextMode: input.contextMode,
		continuation: input.continuation,
		authorization: explicitWorkspaceAuthorization({
			source: input.authorizationSource,
			sourceId: input.authorizationSourceId,
			action: input.workspaceAction,
			decision: "allow",
			activationTarget: "new-panel",
			placement,
		}),
	});
}
