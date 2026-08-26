import assert from "node:assert/strict";
import test from "node:test";
import {
	appendWorkspaceAuthorizationEvent,
	consumeWorkspaceAuthorization,
	createWorkspaceActivationContract,
	deriveWorkspaceAuthorization,
	explicitWorkspaceAuthorization,
	isWorkspaceActionAuthorized,
	restoreWorkspaceAuthorization,
	workspaceAuthorizationProofForConsumer,
	workspaceAuthorizationStateEntry,
	WORKSPACE_AUTHORIZATION_ENTRY_TYPE,
	type WorkspaceAuthorizationEvent,
} from "./workspace-activation-contract.ts";

test("branch-only intent authorizes in-place branch work but not worktree creation", () => {
	const authorization = deriveWorkspaceAuthorization("현재 workspace에서 새 브랜치 만들어서 작업해");
	assert.equal(isWorkspaceActionAuthorized(authorization, "branch-in-place"), true);
	assert.equal(isWorkspaceActionAuthorized(authorization, "create-worktree"), false);
});

test("negative worktree intent remains denied even when branch work is requested", () => {
	const authorization = deriveWorkspaceAuthorization("worktree 만들지 말고 현재 workspace에서 branch만 만들어");
	assert.equal(isWorkspaceActionAuthorized(authorization, "create-worktree"), false);
	assert.equal(authorization.deniedActions.includes("create-worktree"), true);
	assert.equal(isWorkspaceActionAuthorized(authorization, "branch-in-place"), true);
});

test("explicit worktree and switch requests authorize different activation actions", () => {
	const create = deriveWorkspaceAuthorization("현재 대화를 fork해서 새 worktree 만들어줘");
	const useExisting = deriveWorkspaceAuthorization("/wt switch product/review-pr-42");
	assert.equal(isWorkspaceActionAuthorized(create, "create-worktree"), true);
	assert.equal(isWorkspaceActionAuthorized(create, "use-existing-worktree"), false);
	assert.equal(isWorkspaceActionAuthorized(useExisting, "use-existing-worktree"), true);
	assert.equal(isWorkspaceActionAuthorized(useExisting, "create-worktree"), false);
});

test("structured TUI authorization survives a later neutral continuation cue", () => {
	const selection: WorkspaceAuthorizationEvent = {
		source: "tui",
		sourceId: "worktree-placement-choice",
		action: "create-worktree",
		decision: "allow",
		activationTarget: "new-panel",
		placement: "right",
	};
	const authorization = deriveWorkspaceAuthorization("계속해", [selection]);
	assert.equal(isWorkspaceActionAuthorized(authorization, "create-worktree"), true);
	assert.equal(authorization.events[0]?.source, selection.source);
	assert.equal(authorization.events[0]?.sourceId, selection.sourceId);
	assert.ok(authorization.events[0]?.id);
	assert.ok(authorization.events[0]?.expiresAt);
});

test("a later explicit denial overrides prior TUI authorization", () => {
	const selection: WorkspaceAuthorizationEvent = {
		source: "tui",
		sourceId: "worktree-placement-choice",
		action: "create-worktree",
		decision: "allow",
		activationTarget: "new-panel",
		placement: "right",
	};
	const authorization = deriveWorkspaceAuthorization("아니, worktree는 만들지 말고 브랜치만 만들어", [selection]);
	assert.equal(isWorkspaceActionAuthorized(authorization, "create-worktree"), false);
	assert.equal(authorization.deniedActions.includes("create-worktree"), true);
});

test("workspace authorization is one-use and a consumed proof preserves the exact event", () => {
	const now = Date.parse("2026-08-25T00:00:00.000Z");
	const authorization = explicitWorkspaceAuthorization({
		id: "auth-1",
		source: "tui",
		sourceId: "frame-studio:answer-1",
		action: "create-worktree",
		decision: "allow",
		activationTarget: "new-panel",
		createdAt: new Date(now).toISOString(),
	}, now);
	const consumed = consumeWorkspaceAuthorization(authorization, "create-worktree", "frame_worktree_fork:call-1", now + 1);
	assert.equal(isWorkspaceActionAuthorized(consumed.authorization, "create-worktree"), false);
	assert.equal(isWorkspaceActionAuthorized(consumed.proof!, "create-worktree"), true);
	assert.equal(consumed.event?.source, "tui");
	assert.equal(consumed.event?.sourceId, "frame-studio:answer-1");
	assert.equal(consumed.event?.consumedBy, "frame_worktree_fork:call-1");
	assert.equal(consumeWorkspaceAuthorization(consumed.authorization, "create-worktree", "worktree_fork:call-2", now + 2).proof, undefined);
});

test("session custom entry restores an unconsumed approval across compaction or session reload", () => {
	const now = Date.parse("2026-08-25T00:00:00.000Z");
	const authorization = explicitWorkspaceAuthorization({
		id: "auth-restore",
		source: "tui",
		sourceId: "worktree-placement-choice",
		action: "create-worktree",
		decision: "allow",
		activationTarget: "new-panel",
		placement: "right",
		createdAt: new Date(now).toISOString(),
	}, now);
	const restored = restoreWorkspaceAuthorization([
		{ type: "compaction", data: { summary: "tail retained" } },
		{ type: "custom", customType: WORKSPACE_AUTHORIZATION_ENTRY_TYPE, data: workspaceAuthorizationStateEntry(authorization, now) },
	], now + 1);
	assert.equal(isWorkspaceActionAuthorized(restored, "create-worktree"), true);
	assert.equal(restored.events[0]?.id, "auth-restore");
});

test("a consumed session event can rebuild only its matching consumer proof", () => {
	const now = Date.parse("2026-08-25T00:00:00.000Z");
	const initial = explicitWorkspaceAuthorization({
		id: "auth-consumer",
		source: "user-turn",
		sourceId: "turn-1",
		action: "create-worktree",
		decision: "allow",
		createdAt: new Date(now).toISOString(),
	}, now);
	const consumed = consumeWorkspaceAuthorization(initial, "create-worktree", "worktree_fork:call-1", now + 1);
	assert.equal(isWorkspaceActionAuthorized(workspaceAuthorizationProofForConsumer(consumed.authorization, "create-worktree", "worktree_fork:call-1", now + 2)!, "create-worktree"), true);
	assert.equal(workspaceAuthorizationProofForConsumer(consumed.authorization, "create-worktree", "worktree_fork:call-2", now + 2), null);
});

test("consumed proof cannot be restored after its authorization TTL expires", () => {
	const now = Date.parse("2026-08-25T00:00:00.000Z");
	const initial = explicitWorkspaceAuthorization({
		id: "auth-expiring",
		source: "tui",
		sourceId: "choice-expiring",
		action: "create-worktree",
		decision: "allow",
		createdAt: new Date(now).toISOString(),
		expiresAt: new Date(now + 10).toISOString(),
	}, now);
	const consumed = consumeWorkspaceAuthorization(initial, "create-worktree", "worktree_fork:call-expiring", now + 1);
	assert.ok(workspaceAuthorizationProofForConsumer(consumed.authorization, "create-worktree", "worktree_fork:call-expiring", now + 2));
	assert.equal(workspaceAuthorizationProofForConsumer(consumed.authorization, "create-worktree", "worktree_fork:call-expiring", now + 11), null);
});

test("new explicit deny invalidates an older consumed consumer proof", () => {
	const now = Date.parse("2026-08-25T00:00:00.000Z");
	const allow = explicitWorkspaceAuthorization({
		id: "consumed-allow",
		source: "tui",
		sourceId: "choice",
		action: "create-worktree",
		decision: "allow",
		createdAt: new Date(now).toISOString(),
	}, now);
	const consumed = consumeWorkspaceAuthorization(allow, "create-worktree", "frame_v2_worktree_fork:call-1", now + 1);
	const denied = appendWorkspaceAuthorizationEvent(consumed.authorization, {
		id: "later-deny",
		source: "user-turn",
		sourceId: "turn-2",
		action: "create-worktree",
		decision: "deny",
		createdAt: new Date(now + 2).toISOString(),
	}, now + 2);
	assert.equal(workspaceAuthorizationProofForConsumer(denied, "create-worktree", "frame_v2_worktree_fork:call-1", now + 3), null);
});

test("new explicit deny supersedes an older unconsumed allow in durable state", () => {
	const now = Date.parse("2026-08-25T00:00:00.000Z");
	const allow = explicitWorkspaceAuthorization({
		id: "allow",
		source: "tui",
		sourceId: "choice",
		action: "create-worktree",
		decision: "allow",
		createdAt: new Date(now).toISOString(),
	}, now);
	const denied = appendWorkspaceAuthorizationEvent(allow, {
		id: "deny",
		source: "user-turn",
		sourceId: "turn-2",
		action: "create-worktree",
		decision: "deny",
		createdAt: new Date(now + 1).toISOString(),
	}, now + 1);
	assert.equal(isWorkspaceActionAuthorized(denied, "create-worktree"), false);
	assert.equal(denied.deniedActions.includes("create-worktree"), true);
});

test("activation contract requires authorization and placement consistency", () => {
	const authorization = explicitWorkspaceAuthorization({
		source: "command",
		sourceId: "/wt fork",
		action: "create-worktree",
		decision: "allow",
		activationTarget: "new-panel",
		placement: "tab",
	});
	const contract = createWorkspaceActivationContract({
		id: "activation-1",
		workspaceAction: "create-worktree",
		activationTarget: "new-panel",
		placement: "tab",
		contextMode: "full",
		authorization,
		createdAt: "2026-08-25T00:00:00.000Z",
	});
	assert.equal(contract.placement, "tab");
	assert.equal(contract.contextMode, "full");
	assert.throws(
		() => createWorkspaceActivationContract({
			id: "activation-2",
			workspaceAction: "create-worktree",
			activationTarget: "current-panel",
			placement: "right",
			contextMode: "full",
			authorization,
		}),
		/current-panel activation/,
	);
});
