import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildFrameForkContinuationPrompt, buildFrameWorktreeForkArgs } from "./frame-worktree-fork.ts";
import type { FrameIdentity } from "./frame-identity.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(__dirname, "index.ts"), "utf8");
const frameSkill = readFileSync(join(__dirname, "..", "..", "skills", "frame", "SKILL.md"), "utf8");

const identity: FrameIdentity = {
	mode: "planning-ticket",
	key: "planning:ticket:COM-2469",
	displayTitle: "Planning · COM-2469",
	storageDir: "/tmp/frame-planning/planning-ticket-COM-2469",
	cwd: "/Users/example",
	reason: "test",
	ticket: "COM-2469",
	sessionFile: "/tmp/session.jsonl",
};

test("frame_worktree_fork builds real /wt fork args with frame ticket and full context by default", () => {
	const args = buildFrameWorktreeForkArgs({ repo: "product", note: "frame fork start" }, identity);
	assert.equal(args, '--repo "product" --ticket "COM-2469" --note "frame fork start" --full-context');
});

test("frame_worktree_fork supports explicit name, hotfix, and minimal context", () => {
	const args = buildFrameWorktreeForkArgs({ name: "왕콘치", repo: "product", ticket: "COM-9999", hotfix: true, minimalContext: true }, identity);
	assert.equal(args, '"왕콘치" --repo "product" --ticket "COM-9999" --hotfix --minimal-context');
	assert.doesNotMatch(args, /--full-context/);
});

test("frame fork continuation prompt starts implementation in forked session without switch fallback", () => {
	const prompt = buildFrameForkContinuationPrompt(identity);
	assert.match(prompt, /forked worktree session으로 전환됐다/);
	assert.match(prompt, /\.pi\/frame\.json/);
	assert.match(prompt, /frame의 첫 구현 slice부터 바로 이어서 작업한다/);
	assert.doesNotMatch(prompt, /\/wt switch/);
});

test("/frame Step 9 routes fork selection to command-context bridge, not worktree_fork tool", () => {
	assert.match(source, /name: FRAME_FORK_TOOL_NAME/);
	assert.match(source, /rememberFrameCommandContext\(ctx, args, cwd, frameIdentity\)/);
	assert.match(source, /runWorktreeForkFromCommandContext/);
	assert.match(source, /afterSwitchFollowUp/);
	assert.match(frameSkill, /`frame_worktree_fork` tool/);
	assert.match(frameSkill, /`worktree_fork` tool을 호출하지 말고/);
});
