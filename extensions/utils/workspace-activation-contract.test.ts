import assert from "node:assert/strict";
import test from "node:test";
import {
	createWorkspaceActivationContract,
	deriveWorkspaceAuthorization,
	explicitWorkspaceAuthorization,
	isWorkspaceActionAuthorized,
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
	assert.equal(authorization.events[0], selection);
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
