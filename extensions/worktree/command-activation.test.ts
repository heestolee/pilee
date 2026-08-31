import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCurrentPanelNewContinuation } from "./continuation.ts";

const worktreeDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(worktreeDir, "..", "..");
const source = readFileSync(join(worktreeDir, "index.ts"), "utf8");
const prReviewSource = readFileSync(join(worktreeDir, "pr-review.ts"), "utf8");
const gitWorkflowSkill = readFileSync(join(packageRoot, "skills", "git-workflow-and-versioning", "SKILL.md"), "utf8");
const parentGateKnowledge = readFileSync(join(packageRoot, "docs", "knowledge", "worktree-creation-parent-gate.md"), "utf8");

function between(start: string, end: string): string {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	assert.ok(startIndex >= 0 && endIndex > startIndex);
	return source.slice(startIndex, endIndex);
}

const commandNew = between("async function handleNew", "async function listOneRepo");
const commandFork = between("async function handleCommandFork", "async function handleWorkflowFork");
const workflowFork = between("async function handleWorkflowFork", "export async function runWorktreeForkFromCommandContext");

test("slash /wt new and /wt fork keep the original current-panel creation path", () => {
	for (const block of [commandNew, commandFork]) {
		assert.match(block, /switchSessionToWorktree/);
		assert.doesNotMatch(block, /chooseNewPanelPlacement|buildNewPanelActivationContract|activateWorkspaceInNewPanel/);
		assert.doesNotMatch(block, /source Pi session provenance가 없어/);
		assert.doesNotMatch(block, /cleanupCreatedWorktree|fullContextFailure/);
		assert.ok(block.indexOf('pi.exec("git", ["worktree", "add"') < block.indexOf("switchSessionToWorktree"));
	}
});

test("slash /wt new and /wt fork resume work only after switching sessions", () => {
	assert.match(commandNew, /currentPanelNewContinuation\(ctx/);
	assert.match(commandNew, /afterSwitchFollowUp: continuation/);
	assert.match(commandFork, /defaultCurrentPanelContinuation\("fork"/);
	assert.match(commandFork, /afterSwitchFollowUp: continuation/);
	assert.ok(commandNew.indexOf("switchSessionToWorktree") < commandNew.lastIndexOf("afterSwitchFollowUp"));
	assert.ok(commandFork.indexOf("switchSessionToWorktree") < commandFork.indexOf('return { status: "switched"'));
	assert.match(source, /recentUserPrompts\(source\.file, 3, 2_000\)/);
	assert.match(source, /buildCurrentPanelNewContinuation\(prompts, input\)/);
});

test("/wt new compact continuation carries the latest task but not the transition command", () => {
	const continuation = buildCurrentPanelNewContinuation(
		["결제 오류 원인을 계속 조사해줘", "/wt new"],
		{ name: "target", branch: "feature/target" },
	);
	assert.ok(continuation);
	assert.match(continuation.content, /결제 오류 원인을 계속 조사해줘/);
	assert.doesNotMatch(continuation.content, /\/wt new/);
	assert.equal(continuation.details.compact, true);
	assert.equal(buildCurrentPanelNewContinuation(["/wt new"], {}), undefined);
});

test("slash commands preserve context fallback instead of deleting a successfully created worktree", () => {
	assert.match(commandNew, /fullContext: useFullContext/);
	assert.match(commandFork, /fullContext: useFullContext/);
	assert.doesNotMatch(commandNew, /fullContextFailure|cleanupCreatedSessionFile|cleanupCreatedWorktree/);
	assert.doesNotMatch(commandFork, /fullContextFailure|cleanupCreatedSessionFile|cleanupCreatedWorktree/);
	assert.match(source, /SessionManager\.forkFrom\(source\.file, worktreePath\)/);
	assert.match(source, /createEmptySessionFile\(worktreePath, source\.file\)/);
	assert.match(source, /parentSession,/);
});

test("Frame and TFT command-context fork keep the separate new-panel workflow", () => {
	assert.match(workflowFork, /buildNewPanelActivationContract/);
	assert.match(workflowFork, /activateWorkspaceInNewPanel/);
	assert.match(workflowFork, /source Pi session provenance가 없어/);
	assert.match(workflowFork, /fullContextFailure/);
	assert.doesNotMatch(workflowFork, /switchSessionToWorktree/);
	assert.match(source, /return handleWorkflowFork\(pi, args, ctx, options\)/);
});

test("/wt switch remains the explicit existing-worktree current-panel activation path", () => {
	assert.match(source, /currentPanelSwitchContract\(ctx, "command", "\/wt switch"\)/);
	assert.match(source, /resolveWorkspaceActivationAuthorization/);
	assert.match(source, /switchSessionToWorktree\(ctx, resolved\.sessionFile/);
});

test("new-panel workflow receiver remains registered for tools and composed workflows", () => {
	assert.match(source, /registerWorkspacePanelActivationReceiver\(pi\)/);
});

test("explicit authorization uses the current P0/P1/P2 panel as source without a P0-only hard block", () => {
	assert.doesNotMatch(prReviewSource, /childPanelBlocked|부모 P0 세션에서 생성해야|requireParentPanel/);
	assert.match(gitWorkflowSkill, /explicit worktree authorization may create or fork.*`P0`, `P1`, or `P2`/);
	assert.match(gitWorkflowSkill, /current panel conversation is the source session/);
	assert.doesNotMatch(gitWorkflowSkill, /child panels.*must not create|parent \(`P0`\) runs `\/wt fork`/i);
	assert.match(parentGateKnowledge, /Fork child panel\(`P1`, `P2`, …\).*source가 될 수 있습니다/);
	assert.match(parentGateKnowledge, /handoff.*필수 의식 절차가 아닙니다/);
	assert.doesNotMatch(parentGateKnowledge, /P1.*must not create|P2.*must not create/i);
});
