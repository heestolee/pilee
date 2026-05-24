import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

test("worktree tools do not expose switch-command fallback", () => {
	assert.doesNotMatch(source, /대체 전환 명령/);
	assert.doesNotMatch(source, /에디터에 준비했습니다/);
	assert.doesNotMatch(source, /prefillSwitchCommand/);
	assert.doesNotMatch(source, /switchCommand/);
});

test("worktree tools block before creation when neither switch nor same-panel relaunch is available", () => {
	assert.match(source, /planWorktreeActivation\(pi, ctx\)/);
	assert.match(source, /noToolSwitchBlockedText\("worktree_create", activationPlan\.reason\)/);
	assert.match(source, /noToolSwitchBlockedText\("worktree_fork", activationPlan\.reason\)/);
	assert.match(source, /noWorktreeCreated: true/);
	assert.match(source, /Ghostty 현재 패널 재실행/);
	assert.match(source, /절대경로\/cd 작업 우회/);
});

test("worktree tools can replace the current Ghostty panel without slash-command fallback", () => {
	assert.match(source, /buildReplaceCurrentWorktreePanelScript/);
	assert.match(source, /current-panel-relaunch/);
	assert.match(source, /ctx\.shutdown\(\)/);
	assert.doesNotMatch(source, /setEditorText\([^)]*\/wt switch/);
});

test("worktree creation tools clean up their own worktree and branch when activation fails", () => {
	assert.match(source, /function cleanupCreatedWorktree/);
	assert.match(source, /\["worktree", "remove", "--force", worktreePath\]/);
	assert.match(source, /\["branch", "-D", branchName\]/);
	assert.match(source, /cleanupCreatedWorktree\(pi, repoRoot, worktreePath, branchName\)/);
	assert.match(source, /cleanupSummary\(cleanup\)/);
});
