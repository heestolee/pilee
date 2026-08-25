import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	createWorkspaceActivationContract,
	explicitWorkspaceAuthorization,
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
				assert.equal(readWorkspacePanelActivation(prepared.path)?.status, "ready", "READY must be durable before continuation dispatch");
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

test("panel open failure and READY timeout stay BLOCKED without current-panel fallback", async () => {
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

		let closedTerminal = "";
		let removedFork = "";
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
			closePanel: async (_pi, terminalId) => { closedTerminal = terminalId; return { closed: true }; },
			removePanelRecord: (forkId) => { removedFork = forkId; },
			sleep: async () => {},
		});
		assert.equal(timeout.status, "blocked");
		assert.match(timeout.reason, /READY handshake timeout/);
		assert.equal(closedTerminal, "term-timeout");
		assert.equal(removedFork, "fork-timeout");
		assert.equal(switchCalled, false);
		assert.equal(existsSync(join(timeoutRoot, "panel-ready-timeout.json")), false);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("new panel contract records the placement TUI as authorization provenance", async () => {
	const built = await buildNewPanelActivationContract({
		id: "placement-contract",
		ctx: { hasUI: true, ui: { select: async () => "새 탭" } } as any,
		workspaceAction: "create-worktree",
		contextMode: "clean",
		authorizationSource: "command",
		authorizationSourceId: "/wt new",
	});
	assert.equal(built?.activationTarget, "new-panel");
	assert.equal(built?.placement, "tab");
	assert.equal(built?.authorization.events[0]?.sourceId, "/wt new");
});
