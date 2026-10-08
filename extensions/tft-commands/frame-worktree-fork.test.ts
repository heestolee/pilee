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
	assert.match(prompt, /source panel은 보존된 채/);
	assert.match(prompt, /새 작업 panel에서 forked worktree exact session이 활성화됐다/);
	assert.match(prompt, /\.pi\/frame\.json/);
	assert.match(prompt, /frame의 첫 ready 구현 slice부터 바로 이어서 작업한다/);
	assert.match(prompt, /의존 slice만 보류하고 승인된 독립 slice는 진행/);
	assert.match(prompt, /구현 중 추가 결정은 현재 대화에서 처리/);
	assert.match(prompt, /질문 전에 decision_queue에 stable ID/);
	assert.match(prompt, /침묵·취소·모호한 답은 승인이 아니며 명시 답변을 기다린다/);
	assert.match(prompt, /같은 ID로 decisions\[\]·큐·implementation_plan\/slice 의존성·verify 조건·linked Task·work_context refresh/);
	assert.match(prompt, /다른 미결정과 다른 task blocker는 보존/);
	assert.match(prompt, /Studio update\/finish·창 재오픈은 하지 않는다/);
	assert.match(prompt, /명시 \/decide·웹뷰 비교 요청 경로는 유지/);
	assert.doesNotMatch(prompt, /\/wt switch/);
});

test("/frame Step 9 routes fork selection to command-context bridge, not worktree_fork tool", () => {
	assert.match(source, /name: FRAME_FORK_TOOL_NAME/);
	assert.match(source, /rememberFrameCommandContext\(ctx, args, cwd, frameIdentity\)/);
	assert.match(source, /runWorktreeForkFromCommandContext/);
	assert.match(source, /authorizationConsumerId: workspaceAuthorizationConsumerId\(FRAME_FORK_TOOL_NAME, toolCallId\)/);
	assert.match(source, /afterSwitchFollowUp/);
	assert.match(source, /result\.status !== "activated" && result\.status !== "switched"/);
	assert.match(frameSkill, /`frame_worktree_fork` tool/);
	assert.match(frameSkill, /`worktree_fork` tool이나 사용자 slash `\/wt fork`를 호출하지 말고/);
	assert.match(frameSkill, /source panel 보존용 composed workflow runner/);
});
