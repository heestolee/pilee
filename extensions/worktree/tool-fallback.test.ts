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

test("worktree tools block before creation when session switch API is unavailable", () => {
	assert.match(source, /noToolSwitchBlockedText\("worktree_create"\)/);
	assert.match(source, /noToolSwitchBlockedText\("worktree_fork"\)/);
	assert.match(source, /noWorktreeCreated: true/);
	assert.match(source, /절대경로\/cd 방식으로 계속 작업하면 사용자가 기대한 컨텍스트 fork가 아니므로 중단해야 합니다/);
});
