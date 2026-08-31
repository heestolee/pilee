import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

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
const commandFork = between("async function handleFork", "export async function runWorktreeForkFromCommandContext");

test("/wt new offers current-panel while /wt fork preserves the source panel", () => {
	assert.ok(commandNew.indexOf("chooseNewPanelPlacement") < commandNew.indexOf('pi.exec("git", ["fetch"'));
	assert.match(commandNew, /includeCurrentPanel: true/);
	assert.match(commandNew, /selectedLocation === "here"/);
	assert.match(commandNew, /trySwitchSessionToWorktree/);
	assert.match(commandNew, /activateWorkspaceInNewPanel/);
	assert.match(commandNew, /cleanupCreatedSessionFile/);
	assert.match(commandNew, /cleanupCreatedWorktree/);

	assert.ok(commandFork.indexOf("buildNewPanelActivationContract") < commandFork.indexOf('pi.exec("git", ["fetch"'));
	assert.match(commandFork, /activateWorkspaceInNewPanel/);
	assert.doesNotMatch(commandFork, /switchSessionToWorktree/);
	assert.doesNotMatch(commandFork, /trySwitchSessionToWorktree/);
	assert.match(commandFork, /cleanupCreatedSessionFile/);
	assert.match(commandFork, /cleanupCreatedWorktree/);
});

test("/wt new supports --here without asking for a new panel", () => {
	assert.match(source, /here: boolean/);
	assert.match(source, /t === "--here" \|\| t === "--current-panel"/);
	assert.match(commandNew, /parsed\.here \? "here"/);
	assert.match(commandNew, /workspaceAction: "create-worktree"/);
	assert.match(commandNew, /activationTarget: "current-panel"/);
});

test("/wt new allows a clean target before source session provenance exists", () => {
	assert.match(commandNew, /const sourceSessionFile = sourceSessionCandidate && existsSync\(sourceSessionCandidate\) \? sourceSessionCandidate : undefined/);
	assert.match(commandNew, /if \(requestedFullContext && !sourceSessionFile\)/);
	assert.doesNotMatch(commandNew, /if \(!sourceSessionFile \|\| !existsSync\(sourceSessionFile\)\)/);
	assert.match(commandNew, /sourceSessionFile,/);
	assert.match(commandFork, /source Pi session provenance가 없어 \/wt fork/);
});

test("/wt fork keeps full transcript lineage and refuses an empty fallback session", () => {
	assert.match(commandFork, /fullContext: useFullContext/);
	assert.match(commandFork, /fullContextFailure\(useFullContext, session\)/);
	assert.match(source, /SessionManager\.forkFrom\(source\.file, worktreePath\)/);
	assert.match(source, /createEmptySessionFile\(worktreePath, source\.file\)/);
	assert.match(source, /parentSession,/);
});

test("/wt switch remains the explicit current-panel activation path", () => {
	assert.match(source, /currentPanelSwitchContract\(ctx, "command", "\/wt switch"\)/);
	assert.match(source, /resolveWorkspaceActivationAuthorization/);
	assert.match(source, /switchSessionToWorktree\(ctx, resolved\.sessionFile/);
});

test("target READY is recorded for both new-panel and current-panel creation", () => {
	assert.match(source, /registerWorkspacePanelActivationReceiver\(pi\)/);
	assert.match(source, /activationContract\?\.activationTarget === "current-panel"/);
	assert.match(source, /WORKSPACE_ACTIVATION_READY_ENTRY_TYPE/);
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
