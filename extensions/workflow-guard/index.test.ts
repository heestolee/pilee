import assert from "node:assert/strict";
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
	assert.match(start.systemPrompt, /Progress heartbeat/);
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
});

test("workflow weight controls fast response pace budget", async () => {
	const { hooks, ctx } = createHarness();
	const standard = await hooks.before_agent_start({ prompt: "결제 플로우 수정해줘", systemPrompt: "base" }, ctx);
	assert.match(standard.systemPrompt, /intent=implement · weight=standard/);
	assert.match(standard.systemPrompt, /60-second decision budget/);

	const full = await hooks.before_agent_start({ prompt: "full report로 전체 검증해줘", systemPrompt: "base" }, ctx);
	assert.match(full.systemPrompt, /weight=full/);
	assert.match(full.systemPrompt, /120-second decision budget/);

	const status = await hooks.before_agent_start({ prompt: "[dependency-bootstrap] READY — frontend 준비 완료", systemPrompt: "base" }, ctx);
	assert.doesNotMatch(status.systemPrompt, /FAST RESPONSE PACE/);
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
	assert.doesNotMatch(start.systemPrompt, /Soft slice commit rhythm/);

	const commitCommand = await hooks.tool_call({ toolName: "bash", input: { command: "git add a && git commit -m 'fix: test' && git push" } }, ctx);
	assert.equal(commitCommand, undefined);
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
