import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import workflowGuard from "./index.ts";

function createHarness() {
	const hooks: Record<string, any> = {};
	const tools: Record<string, any> = {};
	const pi = {
		on(name: string, fn: any) {
			hooks[name] = fn;
		},
		registerTool(tool: any) {
			tools[tool.name] = tool;
		},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	} as any;
	workflowGuard(pi);
	const ctx = {
		cwd: process.cwd(),
		sessionManager: { getSessionFile: () => "/tmp/workflow-guard-test.jsonl" },
	};
	return { hooks, tools, ctx };
}

test("light hotfix PR path blocks deep context mining", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "/create-pr hotfix/foo 생성해줘", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /deep session\/context mining/);
	assert.match(start.systemPrompt, /current diff, recent commits/);
	assert.match(start.systemPrompt, /auto_commit action=quick/);
	assert.match(start.systemPrompt, /Product judgment discipline/);

	const readBlock = await hooks.tool_call({ toolName: "read", input: { path: "/repo/.context/work/foo/context.md" } }, ctx);
	assert.equal(readBlock?.block, true);
	assert.match(readBlock.reason, /deep context read/);

	const bashBlock = await hooks.tool_call({ toolName: "bash", input: { command: "rg membership .context/work/foo" } }, ctx);
	assert.equal(bashBlock?.block, true);
	assert.match(bashBlock.reason, /deep context mining/);

	const normalRead = await hooks.tool_call({ toolName: "read", input: { path: "/repo/package.json" } }, ctx);
	assert.equal(normalRead, undefined);
});

test("investigation prompts lock scope and require expansion handoff", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "/to-production 하다가 Pi가 터진 로그 확인해봐", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=investigate/);
	assert.match(start.systemPrompt, /Investigation scope lock/);
	assert.match(start.systemPrompt, /Scope expansion gate/);
	assert.match(start.systemPrompt, /No-result handoff/);
	assert.match(start.systemPrompt, /Search\/history fan-out discipline/);
	assert.match(start.systemPrompt, /anchored narrow lookup/);
	assert.match(start.systemPrompt, /broad repo\/all-history\/all-branch search is a soft fallback/);
	assert.match(start.systemPrompt, /Silence breaker/);
	assert.match(start.systemPrompt, /Progress heartbeat/);
	assert.match(start.systemPrompt, /quick lookup\/triage/);
	assert.match(start.systemPrompt, /at least every 3 minutes/);
	assert.match(start.systemPrompt, /crash\/log → worktree progress/);
	assert.match(start.systemPrompt, /FAST RESPONSE PACE/);
	assert.match(start.systemPrompt, /30-second decision budget/);
	assert.match(start.systemPrompt, /Tool exploration discipline/);

	const result = await hooks.tool_result({
		toolName: "mcp",
		content: [{ type: "text", text: "issue detail" }],
		details: {},
	}, ctx);
	assert.equal(result.details.workflowGuard.fastPaceRequired, true);
	assert.match(result.content.at(-1).text, /30-second decision budget/);
	assert.match(result.content.at(-1).text, /next narrow tool call/);
	assert.match(result.content.at(-1).text, /progress\/strategy-reset/);
});

test("workflow weight controls fast response pace budget", async () => {
	const { hooks, ctx } = createHarness();
	const standard = await hooks.before_agent_start({ prompt: "결제 플로우 수정해줘", systemPrompt: "base" }, ctx);
	assert.match(standard.systemPrompt, /intent=implement · weight=standard/);
	assert.match(standard.systemPrompt, /60-second decision budget/);
	assert.match(standard.systemPrompt, /Long-running session control/);
	assert.match(standard.systemPrompt, /Commit-complete stop-line/);

	const full = await hooks.before_agent_start({ prompt: "full report로 전체 검증해줘", systemPrompt: "base" }, ctx);
	assert.match(full.systemPrompt, /weight=full/);
	assert.match(full.systemPrompt, /120-second decision budget/);
	assert.match(full.systemPrompt, /60 minutes ask whether to continue/);

	const status = await hooks.before_agent_start({ prompt: "[dependency-bootstrap] READY — frontend 준비 완료", systemPrompt: "base" }, ctx);
	assert.doesNotMatch(status.systemPrompt, /FAST RESPONSE PACE/);
});


test("standard validation loop and commit stop-line are annotated", async () => {
	const { hooks, ctx } = createHarness();
	await hooks.before_agent_start({ prompt: "결제 플로우 수정해줘", systemPrompt: "base" }, ctx);

	const firstTypecheckFailure = await hooks.tool_result({
		toolName: "bash",
		input: { command: "cd frontend/apps/admin && pnpm type-check" },
		content: [{ type: "text", text: "Command exited with code 1" }],
		details: { code: 1 },
	}, ctx);
	assert.equal(firstTypecheckFailure.details.workflowGuard.validationLoopGate, false);

	const secondTypecheckFailure = await hooks.tool_result({
		toolName: "bash",
		input: { command: "cd frontend/apps/admin && pnpm type-check" },
		content: [{ type: "text", text: "Command exited with code 1" }],
		details: { code: 1 },
	}, ctx);
	assert.equal(secondTypecheckFailure.details.workflowGuard.validationLoopGate, true);
	assert.match(secondTypecheckFailure.content.at(-1).text, /Same validation family failed 2 times/);
	assert.match(secondTypecheckFailure.content.at(-1).text, /Stop silent retrying/);

	const commitResult = await hooks.tool_result({
		toolName: "auto_commit",
		content: [{ type: "text", text: "auto-commit apply 완료" }],
		details: { completion: "committed", commits: [{ hash: "abc123", message: "fix: test" }] },
	}, ctx);
	assert.equal(commitResult.details.workflowGuard.commitCompleteStopLine, true);
	assert.match(commitResult.content.at(-1).text, /Commit save point created/);
});

test("workflow drag prompts enter audit path", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "판단실수 때문에 스트레스야. 지난 작업 플로우가 늘어진 지점들을 뒤져봐", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=audit/);
	assert.match(start.systemPrompt, /HARD AUDIT PATH/);
	assert.match(start.systemPrompt, /friction → response evidence → current state → remaining gap/);
});

test("status-only bootstrap messages do not resume prior work", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "[dependency-bootstrap] READY — product: backend 준비 완료", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=status_note/);
	assert.match(start.systemPrompt, /HARD STATUS NOTE PATH/);
	assert.match(start.systemPrompt, /not a user task directive/);
	assert.match(start.systemPrompt, /Do not resume older implementation/);

	const readBlock = await hooks.tool_call({ toolName: "read", input: { path: "/repo/package.json" } }, ctx);
	assert.equal(readBlock?.block, true);
	assert.match(readBlock.reason, /status note/);

	const bashBlock = await hooks.tool_call({ toolName: "bash", input: { command: "git status --short" } }, ctx);
	assert.equal(bashBlock?.block, true);
	assert.match(bashBlock.reason, /must not trigger old implementation/);
});

test("worktree cwd binding messages are status notes", async () => {
	const { hooks, ctx } = createHarness();
	const prompt = [
		"## Worktree cwd binding",
		"",
		"활성 worktree: 푸크린",
		"절대경로: /Users/changheelee/pilee-workspaces/product/푸크린",
	].join("\n");
	const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=status_note/);
	assert.match(start.systemPrompt, /worktree cwd binding/);

	const editBlock = await hooks.tool_call({ toolName: "edit", input: { path: "/repo/file.ts" } }, ctx);
	assert.equal(editBlock?.block, true);
	assert.match(editBlock.reason, /Status\/readiness\/context-binding notes/);
});

test("short continuation cues continue latest non-status intent", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "계속해", systemPrompt: "base\n\n[Current Conversation Contract]\n- Latest user intent: pi-vcc와 workflow-guard E2E를 확인한다." }, ctx);

	assert.match(start.systemPrompt, /continuation=latest-intent/);
	assert.match(start.systemPrompt, /CONTINUATION CUE PATH/);
	assert.match(start.systemPrompt, /latest non-status user intent/);
	assert.match(start.systemPrompt, /Do not continue from dependency\/bootstrap READY/);
	assert.match(start.systemPrompt, /Do not answer with an options\/menu question/);
	assert.match(start.systemPrompt, /run one next narrow verification/);
	assert.doesNotMatch(start.systemPrompt, /HARD STATUS NOTE PATH/);
});

test("push status questions stay read-only instead of commit-push terminal path", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "push 상태 확인해줘", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=investigate/);
	assert.match(start.systemPrompt, /HARD PATH/);
	assert.doesNotMatch(start.systemPrompt, /HARD LIGHT PUSH TERMINAL PATH/);
});

test("light commit-push prompt uses push terminal path", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "작은 문구만 수정하고 커밋푸시해줘", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=hotfix · weight=light/);
	assert.match(start.systemPrompt, /HARD LIGHT PUSH TERMINAL PATH/);
	assert.match(start.systemPrompt, /Final response after successful push/);
	assert.doesNotMatch(start.systemPrompt, /Slice commit-or-explain guard/);

	const commitCommand = await hooks.tool_call({ toolName: "bash", input: { command: "git add a && git commit -m 'fix: test' && git push" } }, ctx);
	assert.equal(commitCommand, undefined);
});

test("standard framed work injects commit-or-explain guard", async () => {
	const root = await mkdtemp(join(tmpdir(), "workflow-guard-slice-"));
	execFileSync("git", ["init", "-b", "main", root]);
	await mkdir(join(root, ".pi"), { recursive: true });
	await writeFile(join(root, ".pi", "work-context.json"), JSON.stringify({
		schemaVersion: 1,
		identity: {
			id: "worktree:test",
			type: "worktree",
			root,
			cwd: root,
			displayName: "repo",
			contextPath: join(root, ".pi", "work-context.json"),
			tasksPath: join(root, ".pi", "work-tasks.json"),
		},
		updatedAt: "2026-05-27T00:00:00.000Z",
		source: "frame",
		mode: "full",
		goal: "스팟 리뷰 답글 개선",
		currentSlice: { id: "S3", title: "API/schema/codegen", scope: ["backend", "frontend"], acceptance: ["검증 통과"], status: "completed" },
		slices: [],
		mustKeep: [],
		mustNot: [],
		openQuestions: [],
		verifyFocus: [],
		lastKnownState: {},
		refs: {},
	}, null, 2));
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "남은 작업 구현해줘", systemPrompt: "base" }, { ...ctx, cwd: root });

	assert.match(start.systemPrompt, /Slice commit-or-explain guard/);
	assert.match(start.systemPrompt, /Pending migration execution, UI capture, or final verify-report is a ship-readiness caveat/);
	assert.match(start.systemPrompt, /Before a final response with dirty diff: either commit the verified slice/);
	assert.match(start.systemPrompt, /auto_commit must still use explicit JSON plans/);
});

test("light task stops tools after successful push", async () => {
	const { hooks, ctx } = createHarness();
	await hooks.before_agent_start({ prompt: "작은 문구만 수정하고 커밋푸시해줘", systemPrompt: "base" }, ctx);

	const result = await hooks.tool_result({
		toolName: "bash",
		input: { command: "git push" },
		content: [{ type: "text", text: "To https://github.com/example/repo.git" }],
		details: { code: 0 },
	}, ctx);

	assert.equal(result.details.workflowGuard.terminalActionRequired, true);
	assert.match(result.content.at(-1).text, /Light task reached successful push/);

	const statusBlock = await hooks.tool_call({ toolName: "bash", input: { command: "git status --short --branch && git log --oneline -3" } }, ctx);
	assert.equal(statusBlock?.block, true);
	assert.match(statusBlock.reason, /light task already reached successful push/);

	const workContextBlock = await hooks.tool_call({ toolName: "work_context", input: { action: "checkpoint" } }, ctx);
	assert.equal(workContextBlock?.block, true);
});

test("explicit PR light path can continue after push", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "/create-pr hotfix/foo 생성해줘", systemPrompt: "base" }, ctx);
	assert.match(start.systemPrompt, /intent=hotfix · weight=light/);
	assert.doesNotMatch(start.systemPrompt, /HARD LIGHT PUSH TERMINAL PATH/);

	const result = await hooks.tool_result({
		toolName: "bash",
		input: { command: "git push" },
		content: [{ type: "text", text: "To https://github.com/example/repo.git" }],
		details: { code: 0 },
	}, ctx);
	assert.equal(result, undefined);

	const prCommand = await hooks.tool_call({ toolName: "bash", input: { command: "gh pr view --json url" } }, ctx);
	assert.equal(prCommand, undefined);
});

test("auto_commit push skipped result requires immediate push follow-up", async () => {
	const { hooks } = createHarness();
	const result = await hooks.tool_result({
		toolName: "auto_commit",
		content: [{ type: "text", text: "auto-commit apply 완료\npush: skipped" }],
		details: { pushed: false, commits: [{ hash: "abc123", message: "fix: test" }] },
	});

	assert.equal(result.details.workflowGuard.nextActionRequired, true);
	assert.match(result.content.at(-1).text, /git push/);
});

test("auto_commit committed_not_pushed result requires immediate push follow-up", async () => {
	const { hooks } = createHarness();
	const result = await hooks.tool_result({
		toolName: "auto_commit",
		content: [{ type: "text", text: "status: committed_not_pushed\npush: failed" }],
		details: {
			completion: "committed_not_pushed",
			push: { status: "failed" },
			commits: [{ hash: "abc123", message: "fix: test" }],
		},
	});

	assert.equal(result.details.workflowGuard.nextActionRequired, true);
	assert.match(result.content.at(-1).text, /push is not complete: failed/);
});

test("validation wrapper fan-out commands emit soft nudge instead of blocking", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "스팟 리뷰 답글 기능 남은 작업 구현해줘", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /Validation command fan-out discipline is a soft nudge\/checklist/);
	assert.match(start.systemPrompt, /Do not assume `pnpm <script> -- <path>` narrows/);

	const wrapperCommand = "cd frontend && pnpm -F web test -- domain/travel/subdomain/spot/SpotReviewAdminReply.test.tsx";
	const webTestCall = await hooks.tool_call({
		toolName: "bash",
		input: { command: wrapperCommand },
	}, ctx);
	assert.equal(webTestCall, undefined);

	const webTestResult = await hooks.tool_result({
		toolName: "bash",
		input: { command: wrapperCommand },
		content: [{ type: "text", text: "1 test passed" }],
		details: { code: 0 },
	}, ctx);
	assert.equal(webTestResult.details.workflowGuard.validationWrapperFanoutNudge, true);
	assert.match(webTestResult.content.at(-1).text, /validationWrapperFanoutNudge/);
	assert.match(webTestResult.content.at(-1).text, /hard block이 아니라 soft nudge/);
	assert.match(webTestResult.content.at(-1).text, /pnpm vitest run/);

	const migrationLintCall = await hooks.tool_call({
		toolName: "bash",
		input: { command: "cd backend && pnpm lint:migration-algorithm -- apps/trip/migrations/20260527042440-add-display-author-type.js" },
	}, ctx);
	assert.equal(migrationLintCall, undefined);

	const flagOnlyWrapper = await hooks.tool_call({
		toolName: "bash",
		input: { command: "cd frontend && pnpm -F web test -- --reporter=verbose" },
	}, ctx);
	assert.equal(flagOnlyWrapper, undefined);

	const directVitest = await hooks.tool_result({
		toolName: "bash",
		input: { command: "cd frontend/apps/web && pnpm vitest run domain/travel/subdomain/spot/SpotReviewAdminReply.test.tsx" },
		content: [{ type: "text", text: "1 test passed" }],
		details: { code: 0 },
	}, ctx);
	assert.equal(directVitest.details.workflowGuard.validationWrapperFanoutNudge, false);
});

test("package resolve failures gate broad wildcard workspace bootstrap", async () => {
	const { hooks, ctx } = createHarness();
	await hooks.before_agent_start({ prompt: "스팟 리뷰 답글 기능 남은 작업 구현해줘", systemPrompt: "base" }, ctx);

	const firstFailure = await hooks.tool_result({
		toolName: "bash",
		input: { command: "cd frontend/apps/web && pnpm vitest run domain/foo.test.tsx" },
		content: [{ type: "text", text: 'Error: Failed to resolve entry for package "@creatrip/utils".' }],
		details: { code: 1 },
	}, ctx);
	assert.equal(firstFailure.details.workflowGuard.validationBootstrapScopeGate, true);
	assert.match(firstFailure.content.at(-1).text, /narrowRecoveryOnly/);
	assert.match(firstFailure.content.at(-1).text, /@creatrip\/utils/);

	const broadBuildBlock = await hooks.tool_call({
		toolName: "bash",
		input: { command: "cd frontend && pnpm turbo build --filter='@creatrip*'" },
	}, ctx);
	assert.equal(broadBuildBlock?.block, true);
	assert.match(broadBuildBlock.reason, /broad workspace bootstrap\/build/);
	assert.match(broadBuildBlock.reason, /WORKFLOW_GUARD_ALLOW_BROAD_BOOTSTRAP=1/);

	const secondFailure = await hooks.tool_result({
		toolName: "bash",
		input: { command: "cd frontend/apps/web && pnpm vitest run domain/foo.test.tsx" },
		content: [{ type: "text", text: 'Error: Failed to resolve entry for package "@creatrip/bridge".' }],
		details: { code: 1 },
	}, ctx);
	assert.match(secondFailure.content.at(-1).text, /scopeGateRequired/);
	assert.match(secondFailure.content.at(-1).text, /Second package\/module resolve failure/);
});
