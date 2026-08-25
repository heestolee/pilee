import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

function between(start: string, end: string): string {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	assert.ok(startIndex >= 0, `missing start marker: ${start}`);
	assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
	return source.slice(startIndex, endIndex);
}

const commandNew = between("async function handleNew", "async function listOneRepo");
const commandFork = between("async function handleFork", "export async function runWorktreeForkFromCommandContext");
const createTool = between('name: "worktree_create"', 'name: "worktree_switch"');
const switchTool = between('name: "worktree_switch"', 'name: "worktree_fork"');
const forkTool = source.slice(source.indexOf('name: "worktree_fork"'));

test("worktree tools do not expose switch-command or absolute-path fallback", () => {
	assert.doesNotMatch(source, /대체 전환 명령/);
	assert.doesNotMatch(source, /에디터에 준비했습니다/);
	assert.doesNotMatch(source, /prefillSwitchCommand/);
	assert.doesNotMatch(source, /switchCommand/);
	assert.doesNotMatch(source, /setEditorText\([^)]*\/wt switch/);
});

test("/wt new and /wt fork choose a new panel before creation and never switch the current panel", () => {
	for (const block of [commandNew, commandFork]) {
		assert.match(block, /buildNewPanelActivationContract/);
		assert.match(block, /activateWorkspaceInNewPanel/);
		assert.ok(block.indexOf("buildNewPanelActivationContract") < block.indexOf('pi.exec("git", ["fetch"'));
		assert.doesNotMatch(block, /switchSessionToWorktree/);
		assert.doesNotMatch(block, /trySwitchSessionToWorktree/);
	}
	assert.match(commandFork, /sourceSessionFile/);
	assert.match(commandFork, /fullContext: useFullContext/);
	assert.match(commandFork, /workspaceContinuationFromFollowUp/);
});

test("worktree_create and worktree_fork tools activate a sibling panel while switch stays current-panel", () => {
	for (const block of [createTool, forkTool]) {
		assert.match(block, /buildNewPanelActivationContract/);
		assert.match(block, /activateWorkspaceInNewPanel/);
		assert.match(block, /activationTarget: "new-panel"/);
		assert.doesNotMatch(block, /trySwitchSessionToWorktree/);
	}
	assert.match(switchTool, /currentPanelSwitchContract\("tool", "worktree_switch"\)/);
	assert.match(switchTool, /planWorktreeActivation/);
	assert.match(switchTool, /trySwitchSessionToWorktree/);
	assert.match(switchTool, /activationTarget: "current-panel"/);
});

test("target Pi receiver is registered before workflow continuation can start", () => {
	assert.match(source, /registerWorkspacePanelActivationReceiver\(pi\)/);
	assert.match(source, /새 panel.*READY\/continuation/);
	assert.doesNotMatch(source, /startPostCreateBootstrap/);
	assert.match(source, /A branch-only or general implementation request is not worktree authorization/);
	assert.match(source, /A branch-only request is not authorization/);
});

test("read-only PR review workspaces skip automatic dependency bootstrap", () => {
	assert.match(source, /existsSync\(join\(repoRoot, "\.pi", "pr-review\.json"\)\)/);
	assert.match(source, /return \{ repoRoot, state: "not-implementation" \}/);
});

test("creation failure cleans worktree, branch, and target session without current-panel fallback", () => {
	assert.match(source, /function cleanupCreatedWorktree/);
	assert.match(source, /function cleanupCreatedSessionFile/);
	assert.match(source, /\["worktree", "remove", "--force", worktreePath\]/);
	assert.match(source, /\["branch", "-D", branchName\]/);
	for (const block of [commandNew, commandFork, createTool, forkTool]) {
		assert.match(block, /cleanupCreatedSessionFile/);
		assert.match(block, /cleanupCreatedWorktree/);
		assert.doesNotMatch(block, /switchSessionToWorktree/);
	}
});

test("clean and full sessions preserve source lineage without mutating the source file", () => {
	assert.match(source, /createEmptySessionFile\(worktreePath, source\.file\)/);
	assert.match(source, /SessionManager\.forkFrom\(source\.file, worktreePath\)/);
	assert.match(source, /parentSession,/);
	assert.match(source, /function fullContextFailure/);
	for (const block of [commandNew, commandFork, forkTool]) {
		assert.match(block, /fullContextFailure/);
		assert.match(block, /cleanupCreatedSessionFile/);
		assert.match(block, /cleanupCreatedWorktree/);
	}
});
