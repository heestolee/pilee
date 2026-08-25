import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

export type WorkspacePanelActivationStatus = "prepared" | "panel-opened" | "ready" | "continued" | "failed";

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
	continuedAt?: string;
	failedAt?: string;
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
		cleanup?: { terminalClosed: boolean; recordRemoved: boolean; reason?: string };
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
	const temporary = `${path}.${process.pid}.tmp`;
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

function patchDescriptor(
	path: string,
	patch: Partial<WorkspacePanelActivationDescriptor>,
	status?: WorkspacePanelActivationStatus,
): WorkspacePanelActivationDescriptor {
	const current = readWorkspacePanelActivation(path);
	if (!current) throw new Error(`workspace activation descriptor를 읽지 못했습니다: ${path}`);
	const next = { ...current, ...patch, status: status ?? current.status };
	writeDescriptor(path, next);
	return next;
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

function receiverFailure(path: string, error: string): WorkspacePanelActivationDescriptor | null {
	try {
		return patchDescriptor(path, { error, failedAt: new Date().toISOString() }, "failed");
	} catch {
		return null;
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
	if (!descriptor || descriptor.status === "failed" || descriptor.status === "continued") return descriptor;

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
	const ready = patchDescriptor(path, {
		observed: { cwd: safeRealpath(observedCwd), sessionFile: safeRealpath(observedSessionFile), pid: process.pid },
		readyAt,
		error: undefined,
	}, "ready");
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

	if (!ready.contract.continuation) return ready;
	try {
		const continuation = ready.contract.continuation;
		await Promise.resolve(pi.sendMessage({
			customType: continuation.customType,
			content: continuation.content,
			display: continuation.display ?? false,
			details: {
				...continuation.details,
				workspaceActivationId: ready.id,
				workspaceAction: ready.contract.workspaceAction,
				activationTarget: ready.contract.activationTarget,
				placement: ready.contract.placement,
			},
		}, { deliverAs: "followUp", triggerTurn: true }));
		return patchDescriptor(path, { continuedAt: new Date().toISOString() }, "continued");
	} catch (error) {
		return receiverFailure(path, `continuation dispatch failed: ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function registerWorkspacePanelActivationReceiver(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		await receiveWorkspacePanelActivation(pi, ctx);
	});
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
		if (!current || current.status === "failed") return current;
		if (current.status === expectedStatus || (expectedStatus === "ready" && current.status === "continued")) return current;
		await sleep(POLL_INTERVAL_MS);
	}
	return readWorkspacePanelActivation(path);
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
		return { status: opened.status, reason: opened.reason, contract: input.contract, placement };
	}

	const afterOpen = readWorkspacePanelActivation(prepared.path);
	if (afterOpen) {
		patchDescriptor(prepared.path, {
			panel: { placement, terminalId: opened.terminalId, forkId: opened.forkId, panelLabel: opened.panelLabel },
		}, afterOpen.status === "prepared" ? "panel-opened" : undefined);
	}
	const expectedStatus = input.contract.continuation ? "continued" : "ready";
	const final = await waitForWorkspacePanelActivation(
		prepared.path,
		expectedStatus,
		input.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
		sleep,
	);
	if (final && (final.status === expectedStatus || (expectedStatus === "ready" && final.status === "continued"))) {
		rmSync(prepared.path, { force: true });
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

	const closed = await closePanel(pi, opened.terminalId);
	removePanelRecord(opened.forkId);
	rmSync(prepared.path, { force: true });
	const reason = final?.status === "failed"
		? final.error ?? "target activation failed"
		: `target READY handshake timeout (${input.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS}ms)`;
	return {
		status: final?.status === "failed" ? "failed" : "blocked",
		reason,
		contract: input.contract,
		placement,
		terminalId: opened.terminalId,
		forkId: opened.forkId,
		panelLabel: opened.panelLabel,
		cleanup: { terminalClosed: closed.closed, recordRemoved: true, reason: closed.reason },
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
