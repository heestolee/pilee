import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildCurrentPanelNewContinuation } from "./continuation.ts";
import { DEFAULT_AGENT_OPEN_TARGET, WORKSPACE_OPEN_TARGET_OPTIONS, chooseWorkspaceOpenTarget, workspaceOpenTargetForLabel, workspaceOpenTargetParameter } from "./open-target.ts";

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

test("slash /wt new keeps the original current-panel creation path", () => {
	assert.match(commandNew, /switchSessionToWorktree/);
	assert.doesNotMatch(commandNew, /chooseNewPanelPlacement|buildNewPanelActivationContract|activateWorkspaceInNewPanel/);
	assert.doesNotMatch(commandNew, /source Pi session provenance가 없어|cleanupCreatedWorktree|fullContextFailure/);
	assert.match(commandNew, /await createNamedWorktree\(/);
	assert.ok(commandNew.indexOf("await createNamedWorktree(") < commandNew.indexOf("switchSessionToWorktree"));
});

test("every worktree entry point shares exactly current, tab, and right targets", async () => {
	assert.deepEqual(WORKSPACE_OPEN_TARGET_OPTIONS, [
		{ target: "current", label: "현재 패널" },
		{ target: "tab", label: "새 탭" },
		{ target: "right", label: "오른쪽 패널" },
	]);
	assert.equal(workspaceOpenTargetForLabel("현재 패널"), "current");
	assert.equal(workspaceOpenTargetForLabel("새 탭"), "tab");
	assert.equal(workspaceOpenTargetForLabel("오른쪽 패널"), "right");
	assert.equal(workspaceOpenTargetForLabel(undefined), null);
	const seen: string[][] = [];
	const ctx = { hasUI: true, ui: { async select(_title: string, options: string[]) { seen.push(options); return "오른쪽 패널"; } } };
	assert.equal(await chooseWorkspaceOpenTarget(ctx, "어디에서 계속할까요?", null), "right");
	assert.deepEqual(seen[0], ["현재 패널", "새 탭", "오른쪽 패널"]);
	assert.equal(await chooseWorkspaceOpenTarget({ ...ctx, hasUI: false }, "t", "current"), "current");
	assert.equal(await chooseWorkspaceOpenTarget({ ...ctx, hasUI: false }, "t", null), null);
	// 사용자가 직접 입력한 slash 명령만 묻는다.
	assert.match(commandFork, /chooseWorkspaceOpenTarget\(ctx, /);
	assert.match(prReviewSource, /chooseWorkspaceOpenTarget\(ctx, `PR #/);
	assert.doesNotMatch(source + prReviewSource, /chooseNewPanelPlacement|placementTitle|PR_REVIEW_OPEN_TARGET_OPTIONS|COMMAND_FORK_OPEN_TARGET_OPTIONS/);
});

test("agent-opened worktrees never ask and default to the right panel", () => {
	assert.equal(DEFAULT_AGENT_OPEN_TARGET, "right");
	const schema = workspaceOpenTargetParameter as any;
	assert.deepEqual(schema.anyOf.map((option: any) => option.const), ["current", "tab", "right"]);
	assert.match(schema.description, /not from specific words/);
	assert.match(schema.description, /Never ask/);
	const resolver = between("async function resolveToolOpenTarget", "function currentPanelToolResult");
	assert.match(resolver, /input\.openTarget \?\? DEFAULT_AGENT_OPEN_TARGET/);
	assert.match(workflowFork, /options\.openTarget \?\? DEFAULT_AGENT_OPEN_TARGET/);
	for (const block of [resolver, workflowFork]) assert.doesNotMatch(block, /chooseWorkspaceOpenTarget|ui\.select/);
	assert.match(source, /openTarget: workspaceOpenTargetParameter/);
});

test("slash /wt fork switches immediately only for the current panel after shared creation", () => {
	assert.match(commandFork, /openTarget === "current"/);
	assert.match(commandFork, /activateCreatedWorktreeInCurrentPanel\(ctx, \{\s*timing: "now"/);
	assert.match(commandFork, /activateWorkspaceInNewPanel/);
	assert.match(commandFork, /timeoutPolicy: "preserve-pending"/);
	assert.match(commandFork, /activation\.status === "pending"/);
	assert.match(commandFork, /await createNamedWorktree\(/);
	assert.ok(commandFork.indexOf("await createNamedWorktree(") < commandFork.indexOf('if (openTarget === "current")'));
	assert.doesNotMatch(commandFork, /cleanupCreatedWorktree|fullContextFailure/);
});

test("slash /wt new and /wt fork resume work only after switching sessions", () => {
	assert.match(commandNew, /currentPanelNewContinuation\(ctx/);
	assert.match(commandNew, /afterSwitchFollowUp: continuation/);
	assert.match(commandFork, /followUp: defaultCurrentPanelContinuation\("fork"/);
	assert.ok(commandNew.indexOf("switchSessionToWorktree") < commandNew.lastIndexOf("afterSwitchFollowUp"));
	assert.ok(commandFork.indexOf("activateCreatedWorktreeInCurrentPanel") < commandFork.indexOf('return { status: "switched"'));
	const shared = between("async function activateCreatedWorktreeInCurrentPanel", "async function resolveToolOpenTarget");
	assert.match(shared, /afterSwitchFollowUp: input\.followUp/);
	assert.match(shared, /input\.timing === "now"[\s\S]*switchSessionToWorktree[\s\S]*requestSessionSwitchToWorktree/);
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

test("Frame and TFT fork run inside an agent turn, so the current panel switches only after the turn", () => {
	assert.match(workflowFork, /buildNewPanelActivationContract\(\{ \.\.\.contractInput, ctx, placement: openTarget \}\)/);
	assert.match(workflowFork, /currentPanelActivationContract\(ctx, contractInput\)/);
	assert.match(workflowFork, /openTarget === "current" && !hasRequestedSessionSwitchApi\(ctx\)/);
	assert.match(workflowFork, /timing: "after-turn"/);
	assert.match(workflowFork, /options\.afterSwitchFollowUp \?\? defaultCurrentPanelContinuation/);
	assert.match(workflowFork, /activateWorkspaceInNewPanel/);
	assert.match(workflowFork, /source Pi session provenance가 없어/);
	assert.match(workflowFork, /fullContextFailure/);
	assert.doesNotMatch(workflowFork, /switchSessionToWorktree|timing: "now"/);
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

test("all five fresh creation paths allocate once and use only the final successful identity", () => {
	const createTool = between('name: "worktree_create"', 'name: "worktree_switch"');
	const forkTool = source.slice(source.indexOf('name: "worktree_fork"'));
	for (const block of [commandNew, commandFork, workflowFork, createTool, forkTool]) {
		assert.equal((block.match(/await createNamedWorktree\(/g) ?? []).length, 1);
		assert.doesNotMatch(block, /pickName|\["worktree", "add"/);
		assert.ok(block.indexOf("await createNamedWorktree(") < block.indexOf("writeMeta(worktreePath"));
		assert.match(block, /sessionName: `\$\{name\} \(\$\{branchName\}\)`/);
	}
	for (const block of [workflowFork, createTool, forkTool]) {
		assert.ok(block.indexOf("await createNamedWorktree(") < block.indexOf("contract.continuation ="));
		assert.ok(block.indexOf("contract.continuation =") < block.indexOf("activateWorkspaceInNewPanel("));
	}
	assert.match(source, /namingScheme: "words"/);
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
