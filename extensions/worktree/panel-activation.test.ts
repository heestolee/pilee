import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	activateWorkspaceInNewPanel,
	buildNewPanelActivationContract,
	prepareWorkspacePanelActivation,
	readWorkspacePanelActivation,
	receiveWorkspacePanelActivation,
	WORKSPACE_ACTIVATION_ENV,
} from "./panel-activation.ts";
import {
	consumeWorkspaceAuthorization,
	createWorkspaceActivationContract,
	explicitWorkspaceAuthorization,
	workspaceAuthorizationStateEntry,
	WORKSPACE_AUTHORIZATION_ENTRY_TYPE,
	type WorkspaceContinuation,
} from "../utils/workspace-activation-contract.ts";

function writeSession(path: string, id: string, cwd: string, parentSession?: string, message?: string): void {
	writeFileSync(path, [
		JSON.stringify({ type: "session", version: 3, id, timestamp: "2026-08-25T00:00:00.000Z", cwd, parentSession }),
		message ? JSON.stringify({ type: "message", id: `${id}-m1`, parentId: null, timestamp: "2026-08-25T00:00:01.000Z", message: { role: "user", content: [{ type: "text", text: message }] } }) : undefined,
	].filter(Boolean).join("\n") + "\n", "utf8");
}

function contract(id: string, continuation?: WorkspaceContinuation) {
	return createWorkspaceActivationContract({
		id,
		workspaceAction: "create-worktree",
		activationTarget: "new-panel",
		placement: "right",
		contextMode: "full",
		continuation,
		authorization: explicitWorkspaceAuthorization({
			source: "command",
			sourceId: "/wt fork",
			action: "create-worktree",
			decision: "allow",
			activationTarget: "new-panel",
			placement: "right",
		}),
		createdAt: "2026-08-25T00:00:00.000Z",
	});
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pilee-panel-activation-"));
	const sourceSession = join(root, "source.jsonl");
	const targetSession = join(root, "target.jsonl");
	writeSession(sourceSession, "source", root, undefined, "원본 대화는 바뀌면 안 됩니다.");
	writeSession(targetSession, "target", root, sourceSession, "원본 대화는 바뀌면 안 됩니다.");
	return { root, sourceSession, targetSession, sourceBefore: readFileSync(sourceSession, "utf8") };
}

test("target receiver writes READY before dispatching continuation", async () => {
	const f = fixture();
	try {
		const activation = contract("receiver-ready-order", {
			workflow: "frame",
			customType: "frame-continuation",
			content: "첫 구현 slice를 시작한다.",
		});
		const prepared = prepareWorkspacePanelActivation({
			contract: activation,
			cwd: f.root,
			sessionFile: f.targetSession,
			sourceSessionFile: f.sourceSession,
			title: "Frame implementation",
			activationRoot: join(f.root, "activations"),
		});
		const messages: any[] = [];
		const entries: any[] = [];
		const pi = {
			sendMessage(message: any, options: any) {
				const descriptor = readWorkspacePanelActivation(prepared.path);
				assert.equal(descriptor?.status, "continuing", "continuation must be claimed before dispatch");
				assert.ok(descriptor?.readyAt, "READY must be durable before continuation dispatch");
				messages.push({ message, options });
			},
		} as any;
		const ctx = {
			cwd: f.root,
			sessionManager: {
				getSessionFile: () => f.targetSession,
				getCwd: () => f.root,
				appendCustomEntry(type: string, value: unknown) { entries.push({ type, value }); },
			},
		} as any;
		const received = await receiveWorkspacePanelActivation(pi, ctx, { [WORKSPACE_ACTIVATION_ENV]: prepared.path });
		assert.equal(received?.status, "continued");
		assert.equal(messages.length, 1);
		assert.equal(messages[0].options.triggerTurn, true);
		assert.equal(messages[0].message.customType, "frame-continuation");
		assert.equal(entries[0]?.type, "workspace-activation-ready");
		assert.equal(readFileSync(f.sourceSession, "utf8"), f.sourceBefore, "source session must stay immutable");
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("target receiver rejects a session mismatch without dispatching continuation", async () => {
	const f = fixture();
	try {
		const prepared = prepareWorkspacePanelActivation({
			contract: contract("receiver-session-mismatch", { workflow: "test", customType: "should-not-run", content: "do not run" }),
			cwd: f.root,
			sessionFile: f.targetSession,
			sourceSessionFile: f.sourceSession,
			title: "Mismatch",
			activationRoot: join(f.root, "activations"),
		});
		let sent = false;
		const received = await receiveWorkspacePanelActivation({ sendMessage() { sent = true; } } as any, {
			cwd: f.root,
			sessionManager: { getSessionFile: () => f.sourceSession, getCwd: () => f.root },
		} as any, { [WORKSPACE_ACTIVATION_ENV]: prepared.path });
		assert.equal(received?.status, "failed");
		assert.match(received?.error ?? "", /exact session mismatch/);
		assert.equal(sent, false);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("receiver recovers a stale descriptor lock before claiming READY", async () => {
	const f = fixture();
	try {
		const prepared = prepareWorkspacePanelActivation({
			contract: contract("stale-lock-recovery"),
			cwd: f.root,
			sessionFile: f.targetSession,
			sourceSessionFile: f.sourceSession,
			title: "Stale lock",
			activationRoot: join(f.root, "activations"),
		});
		const lockPath = `${prepared.path}.lock`;
		mkdirSync(lockPath);
		const stale = new Date(Date.now() - 10_000);
		utimesSync(lockPath, stale, stale);
		const received = await receiveWorkspacePanelActivation({} as any, {
			cwd: f.root,
			sessionManager: { getSessionFile: () => f.targetSession, getCwd: () => f.root, appendCustomEntry() {} },
		} as any, { [WORKSPACE_ACTIVATION_ENV]: prepared.path });
		assert.equal(received?.status, "ready");
		assert.equal(existsSync(lockPath), false);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("new panel activation waits for exact-session continuation and never switches current panel", async () => {
	const f = fixture();
	try {
		const activation = contract("panel-ready-continuation", {
			workflow: "pr-review",
			customType: "pr-review-ready",
			content: "Review Studio를 연다.",
		});
		let switchCalled = false;
		const parentCtx = { switchSession() { switchCalled = true; } } as any;
		const messages: any[] = [];
		const pi = { sendMessage(message: any) { messages.push(message); } } as any;
		const result = await activateWorkspaceInNewPanel(pi, parentCtx, {
			contract: activation,
			cwd: f.root,
			sessionFile: f.targetSession,
			sourceSessionFile: f.sourceSession,
			title: "PR review",
			activationRoot: join(f.root, "activations"),
		}, {
			openPanel: async (_hostPi, request) => {
				await receiveWorkspacePanelActivation(pi, {
					cwd: f.root,
					sessionManager: { getSessionFile: () => f.targetSession, getCwd: () => f.root, appendCustomEntry() {} },
				} as any, request.env);
				return { status: "opened", terminalId: "term-1", forkId: "fork-1", panelLabel: "P1" };
			},
		});
		assert.equal(result.status, "activated");
		if (result.status === "activated") {
			assert.equal(result.continuationDispatched, true);
			assert.equal(result.panelLabel, "P1");
		}
		assert.equal(messages.length, 1);
		assert.equal(switchCalled, false, "new-panel failure/success must never use current-panel switchSession");
		assert.equal(readFileSync(f.sourceSession, "utf8"), f.sourceBefore);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("panel open failure is safe to delete, but an unconfirmed terminal close preserves every recovery artifact", async () => {
	const f = fixture();
	try {
		let switchCalled = false;
		const ctx = { switchSession() { switchCalled = true; } } as any;
		const openFailure = await activateWorkspaceInNewPanel({} as any, ctx, {
			contract: contract("panel-open-failure"),
			cwd: f.root,
			sessionFile: f.targetSession,
			sourceSessionFile: f.sourceSession,
			title: "Open failure",
			activationRoot: join(f.root, "open-failure"),
		}, {
			openPanel: async () => ({ status: "failed", reason: "host refused split" }),
		});
		assert.equal(openFailure.status, "failed");
		if (openFailure.status !== "activated") assert.equal(openFailure.safeToDeleteTarget, true);

		let closedTerminal = "";
		let recordRemoved = false;
		const timeoutRoot = join(f.root, "timeout");
		const timeout = await activateWorkspaceInNewPanel({} as any, ctx, {
			contract: contract("panel-ready-timeout"),
			cwd: f.root,
			sessionFile: f.targetSession,
			sourceSessionFile: f.sourceSession,
			title: "Timeout",
			activationRoot: timeoutRoot,
			timeoutMs: 0,
		}, {
			openPanel: async () => ({ status: "opened", terminalId: "term-timeout", forkId: "fork-timeout", panelLabel: "P2" }),
			closePanel: async (_pi, terminalId) => { closedTerminal = terminalId; return { closed: false, reason: "terminal still alive" }; },
			removePanelRecord: () => { recordRemoved = true; },
			sleep: async () => {},
		});
		assert.equal(timeout.status, "blocked");
		assert.match(timeout.reason, /terminal close가 확인되지 않아/);
		assert.equal(closedTerminal, "term-timeout");
		assert.equal(recordRemoved, false);
		if (timeout.status !== "activated") {
			assert.equal(timeout.safeToDeleteTarget, false);
			assert.equal(timeout.cleanup?.terminalClosed, false);
			assert.equal(timeout.cleanup?.recordRemoved, false);
			assert.equal(timeout.descriptorPath, join(timeoutRoot, "panel-ready-timeout.json"));
		}
		assert.equal(switchCalled, false);
		const preserved = readWorkspacePanelActivation(join(timeoutRoot, "panel-ready-timeout.json"));
		assert.equal(preserved?.status, "cancelling");
		assert.equal(preserved?.cleanup?.descriptorPreserved, true);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("timeout cancellation claim wins before a receiver and prevents continuation dispatch", async () => {
	const f = fixture();
	try {
		const activationRoot = join(f.root, "timeout-wins");
		let activationEnv: Record<string, string | undefined> = {};
		let sent = 0;
		let receiverStatus = "";
		const pi = { sendMessage() { sent += 1; } } as any;
		const result = await activateWorkspaceInNewPanel(pi, {} as any, {
			contract: contract("timeout-wins", { workflow: "test", customType: "must-not-run", content: "do not run" }),
			cwd: f.root,
			sessionFile: f.targetSession,
			sourceSessionFile: f.sourceSession,
			title: "Timeout wins",
			activationRoot,
			timeoutMs: 0,
		}, {
			openPanel: async (_hostPi, request) => {
				activationEnv = request.env ?? {};
				return { status: "opened", terminalId: "term-timeout-wins", forkId: "fork-timeout-wins", panelLabel: "P1" };
			},
			closePanel: async () => {
				const received = await receiveWorkspacePanelActivation(pi, {
					cwd: f.root,
					sessionManager: { getSessionFile: () => f.targetSession, getCwd: () => f.root },
				} as any, activationEnv);
				receiverStatus = received?.status ?? "";
				return { closed: true };
			},
			removePanelRecord: () => {},
			sleep: async () => {},
		});
		assert.equal(result.status, "blocked");
		assert.equal(receiverStatus, "cancelling");
		assert.equal(sent, 0);
		if (result.status !== "activated") assert.equal(result.safeToDeleteTarget, true);
		assert.equal(readWorkspacePanelActivation(join(activationRoot, "timeout-wins.json"))?.status, "cancelled");
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("receiver continuation claim wins before timeout and parent preserves child-owned target", async () => {
	const f = fixture();
	try {
		let releaseDispatch!: () => void;
		let signalDispatchStarted!: () => void;
		const dispatchReleased = new Promise<void>((resolve) => { releaseDispatch = resolve; });
		const dispatchStarted = new Promise<void>((resolve) => { signalDispatchStarted = resolve; });
		let receiverPromise: Promise<unknown> | undefined;
		let closeCalled = false;
		let removeCalled = false;
		const pi = {
			sendMessage() {
				signalDispatchStarted();
				return dispatchReleased;
			},
		} as any;
		const result = await activateWorkspaceInNewPanel(pi, {} as any, {
			contract: contract("receiver-wins", { workflow: "test", customType: "run-once", content: "run" }),
			cwd: f.root,
			sessionFile: f.targetSession,
			sourceSessionFile: f.sourceSession,
			title: "Receiver wins",
			activationRoot: join(f.root, "receiver-wins"),
			timeoutMs: 0,
		}, {
			openPanel: async (_hostPi, request) => {
				receiverPromise = receiveWorkspacePanelActivation(pi, {
					cwd: f.root,
					sessionManager: { getSessionFile: () => f.targetSession, getCwd: () => f.root, appendCustomEntry() {} },
				} as any, request.env);
				await dispatchStarted;
				return { status: "opened", terminalId: "term-receiver-wins", forkId: "fork-receiver-wins", panelLabel: "P1" };
			},
			closePanel: async () => { closeCalled = true; return { closed: true }; },
			removePanelRecord: () => { removeCalled = true; },
			sleep: async () => {},
		});
		assert.equal(result.status, "blocked");
		if (result.status !== "activated") {
			assert.equal(result.safeToDeleteTarget, false);
			assert.match(result.reason, /continuing/);
		}
		assert.equal(closeCalled, false);
		assert.equal(removeCalled, false);
		releaseDispatch();
		await receiverPromise;
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("duplicate receivers cannot dispatch the same continuation twice", async () => {
	const f = fixture();
	try {
		const prepared = prepareWorkspacePanelActivation({
			contract: contract("duplicate-receiver", { workflow: "test", customType: "run-once", content: "run" }),
			cwd: f.root,
			sessionFile: f.targetSession,
			sourceSessionFile: f.sourceSession,
			title: "Duplicate receiver",
			activationRoot: join(f.root, "activations"),
		});
		let releaseDispatch!: () => void;
		let signalDispatchStarted!: () => void;
		const dispatchReleased = new Promise<void>((resolve) => { releaseDispatch = resolve; });
		const dispatchStarted = new Promise<void>((resolve) => { signalDispatchStarted = resolve; });
		let dispatchCount = 0;
		const pi = {
			sendMessage() {
				dispatchCount += 1;
				signalDispatchStarted();
				return dispatchReleased;
			},
		} as any;
		const ctx = {
			cwd: f.root,
			sessionManager: { getSessionFile: () => f.targetSession, getCwd: () => f.root, appendCustomEntry() {} },
		} as any;
		const first = receiveWorkspacePanelActivation(pi, ctx, { [WORKSPACE_ACTIVATION_ENV]: prepared.path });
		await dispatchStarted;
		const second = await receiveWorkspacePanelActivation(pi, ctx, { [WORKSPACE_ACTIVATION_ENV]: prepared.path });
		assert.equal(second?.status, "continuing");
		assert.equal(dispatchCount, 1);
		releaseDispatch();
		assert.equal((await first)?.status, "continued");
		assert.equal(dispatchCount, 1);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("new panel command contract records exact command and placement provenance", async () => {
	const entries: any[] = [];
	const built = await buildNewPanelActivationContract({
		id: "placement-contract",
		ctx: {
			hasUI: true,
			ui: { select: async () => "새 탭" },
			sessionManager: {
				getBranch: () => entries,
				appendCustomEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
			},
		} as any,
		workspaceAction: "create-worktree",
		contextMode: "clean",
		authorizationSource: "command",
		authorizationSourceId: "/wt new",
	});
	assert.equal(built?.activationTarget, "new-panel");
	assert.equal(built?.placement, "tab");
	assert.equal(built?.authorization.events[0]?.sourceId, "/wt new");
	assert.equal(built?.authorization.events[0]?.placement, "tab");
	assert.equal(built?.authorization.events[0]?.consumedBy, "command:/wt new:placement-contract");
	assert.equal(entries.at(-1)?.customType, WORKSPACE_AUTHORIZATION_ENTRY_TYPE);
});

test("new panel tool contract reuses the exact workflow-guard consumed event", async () => {
	const event = {
		id: "guard-auth-1",
		source: "tui" as const,
		sourceId: "frame_studio:answer-1",
		action: "create-worktree" as const,
		decision: "allow" as const,
		activationTarget: "new-panel" as const,
		createdAt: "2026-08-25T00:00:00.000Z",
		expiresAt: "2099-08-25T00:15:00.000Z",
	};
	const consumed = consumeWorkspaceAuthorization(
		explicitWorkspaceAuthorization(event),
		"create-worktree",
		"frame_worktree_fork:call-1",
	);
	const entries: any[] = [{
		type: "custom",
		customType: WORKSPACE_AUTHORIZATION_ENTRY_TYPE,
		data: workspaceAuthorizationStateEntry(consumed.authorization),
	}];
	const built = await buildNewPanelActivationContract({
		id: "tool-contract",
		ctx: {
			hasUI: true,
			ui: { select: async () => "오른쪽 분할 패널" },
			sessionManager: {
				getBranch: () => entries,
				appendCustomEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
			},
		} as any,
		workspaceAction: "create-worktree",
		contextMode: "full",
		authorizationSource: "tui",
		authorizationSourceId: "must-not-replace-actual-source",
		authorizationConsumerId: "frame_worktree_fork:call-1",
	});
	assert.equal(built?.authorization.events[0]?.id, "guard-auth-1");
	assert.equal(built?.authorization.events[0]?.source, "tui");
	assert.equal(built?.authorization.events[0]?.sourceId, "frame_studio:answer-1");
	assert.equal(built?.authorization.events[0]?.consumedBy, "frame_worktree_fork:call-1");
	assert.equal(built?.authorization.events[0]?.placement, "right");
	assert.equal(entries.at(-1)?.data.events[0].placement, "right");
});
