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
	let thinkingLevel = "high";
	const pi = {
		on(name: string, fn: any) {
			hooks[name] = fn;
		},
		registerTool(tool: any) {
			tools[tool.name] = tool;
		},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
		getThinkingLevel: () => thinkingLevel,
	} as any;
	workflowGuard(pi);
	const ctx = {
		cwd: process.cwd(),
		sessionManager: { getSessionFile: () => "/tmp/workflow-guard-test.jsonl" },
	};
	return { hooks, tools, ctx, setThinkingLevel: (level: string) => { thinkingLevel = level; } };
}

test("ultra enables proactive delegation without bypassing safety gates", async () => {
	const { hooks, ctx, setThinkingLevel } = createHarness();
	setThinkingLevel("ultra");
	const start = await hooks.before_agent_start({ prompt: "결제 플로우 수정해줘", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /ULTRA PROACTIVE DELEGATION MODE/);
	assert.match(start.systemPrompt, /explicit user request before spawning sub-agents no longer applies/);
	assert.match(start.systemPrompt, /parallel work would materially improve speed or quality/);
	assert.match(start.systemPrompt, /Existing read-only, mutation, side-effect, and light-path safety gates still apply/);
	assert.doesNotMatch(start.systemPrompt, /worker\/subagent orchestration is opt-in/);
	assert.equal(start.message.details.ultraMode, true);

	const lightStart = await hooks.before_agent_start({ prompt: "작은 문구만 수정해줘", systemPrompt: "base" }, ctx);
	const subagentBlock = await hooks.tool_call({ toolName: "subagent", input: { command: "subagent run worker -- 문구 수정" } }, ctx);
	assert.match(lightStart.systemPrompt, /ULTRA PROACTIVE DELEGATION MODE/);
	assert.equal(subagentBlock?.block, true);
	assert.match(subagentBlock.reason, /subagent fan-out/);
});

test("non-ultra keeps explicit-request worker discipline", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "결제 플로우 수정해줘", systemPrompt: "base" }, ctx);

	assert.doesNotMatch(start.systemPrompt, /ULTRA PROACTIVE DELEGATION MODE/);
	assert.match(start.systemPrompt, /worker\/subagent orchestration is opt-in/);
	assert.equal(start.message.details.ultraMode, false);
});

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

test("pasted mutating SQL review stays read-only and injects DB evidence reminder", async () => {
	const { hooks, ctx } = createHarness();
	const prompt = [
		"START TRANSACTION;",
		"UPDATE reserve SET reserve_date = DATE_ADD(NOW(), INTERVAL 2 HOUR) WHERE reserve_code = '260507bwjuc0';",
		"COMMIT;",
		"이거 그대로 하면 verify-report 테스트 상태로 복구되는 거 맞아?",
	].join("\n");
	const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=investigate/);
	assert.match(start.systemPrompt, /sqlReview=detected/);
	assert.match(start.systemPrompt, /SQL REVIEW SOFT GATE/);
	assert.match(start.systemPrompt, /read-only DB SELECT/);
	assert.match(start.systemPrompt, /do not answer with speculative 가능성 language/);
	assert.doesNotMatch(start.systemPrompt, /intent=implement/);
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

test("evidence collection plus explicit improvement is implementation, not read-only investigation", async () => {
	const { hooks, ctx } = createHarness();
	const prompt = "이번주 대화 세션 다 뒤져보고 사례 수집하고 추상화해서 개선해. 작업해봐";
	const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=implement · weight=standard/);
	assert.doesNotMatch(start.systemPrompt, /intent=investigate/);
	assert.doesNotMatch(start.systemPrompt, /HARD PATH: this turn is read-only/);

	const writeCall = await hooks.tool_call({ toolName: "write", input: { path: join(process.cwd(), "tmp-workflow-guard-smoke.txt") } }, ctx);
	assert.equal(writeCall, undefined);
});

test("workflow friction with explicit patch request stays implementation while preserving audit signal", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "판단실수 때문에 스트레스야. 지난 작업 플로우가 늘어진 지점들을 뒤져보고 workflow guard에 반영해", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=implement · weight=standard/);
	assert.match(start.systemPrompt, /audit=required/);
	assert.match(start.systemPrompt, /WORKFLOW FRICTION IMPLEMENTATION PATH/);
	assert.doesNotMatch(start.systemPrompt, /HARD AUDIT PATH/);
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

test("follow-up correction prompts request mutation even when phrased as checking or capability", async () => {
	const { hooks, ctx } = createHarness();
	const prompt = "와이어프레임에 보면 방문 일시 정렬이 어디있는지 확인해봐. 니가 구현한건 위에 있잖아. 아래쪽에 있게는 못해?";
	const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=implement · weight=standard/);
	assert.match(start.systemPrompt, /followup=correction/);
	assert.match(start.systemPrompt, /FOLLOW-UP CORRECTION PATH/);
	assert.doesNotMatch(start.systemPrompt, /HARD PATH: this turn is read-only/);

	const editCall = await hooks.tool_call({ toolName: "edit", input: { path: join(process.cwd(), "follow-up-correction.ts") } }, ctx);
	assert.equal(editCall, undefined);
});

test("mixed implementation plus side question stays implementation and nudges subagent investigation", async () => {
	const { hooks, ctx } = createHarness();
	const prompt = "width 100으로 줄이자. 상태 칸에 오는 뱃지는 종류가 어떻게 돼?";
	const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=implement · weight=standard/);
	assert.match(start.systemPrompt, /mixed=implement\+investigate/);
	assert.match(start.systemPrompt, /parallel=investigation-subagent/);
	assert.match(start.systemPrompt, /MIXED REQUEST PATH/);
	assert.match(start.systemPrompt, /Main agent owns the clear implementation path first/);
	assert.match(start.systemPrompt, /Delegate the independent investigation\/answer question to a subagent/);
	assert.doesNotMatch(start.systemPrompt, /HARD PATH: this turn is read-only/);

	const editCall = await hooks.tool_call({ toolName: "edit", input: { path: join(process.cwd(), "mixed-request-width.ts") } }, ctx);
	assert.equal(editCall, undefined);
});

test("dimension-change discussion questions stay read-only", async () => {
	for (const prompt of ["왜 width를 줄이는 게 좋아?", "width를 100으로 줄이면 어때?"]) {
		const { hooks, ctx } = createHarness();
		const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

		assert.match(start.systemPrompt, /intent=(?:investigate|answer) · weight=none/);
		assert.match(start.systemPrompt, /mutation=not-requested/);
		assert.match(start.systemPrompt, /HARD PATH: this turn is read-only/);
		assert.doesNotMatch(start.systemPrompt, /mixed=implement\+investigate/);

		const editBlock = await hooks.tool_call({ toolName: "edit", input: { path: join(process.cwd(), "dimension-question.ts") } }, ctx);
		assert.equal(editBlock?.block, true);
	}
});

test("workflow guard complaint prompts enter audit path instead of unknown", async () => {
	const prompts = [
		"워크플로우 가드 이새끼 아직도 지랄인데?",
		"아니 개선됐다매. 왜 아직도 이래?",
	];

	for (const prompt of prompts) {
		const { hooks, ctx } = createHarness();
		const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

		assert.match(start.systemPrompt, /intent=audit/);
		assert.match(start.systemPrompt, /audit=required/);
		assert.match(start.systemPrompt, /HARD AUDIT PATH/);
		assert.match(start.systemPrompt, /mutation=not-requested/);

		const writeBlock = await hooks.tool_call({ toolName: "write", input: { path: join(process.cwd(), "workflow-guard-complaint.txt") } }, ctx);
		assert.equal(writeBlock?.block, true);
	}
});

test("adopt action replaces stale read-only guard state", async () => {
	const { hooks, tools, ctx } = createHarness();
	await hooks.before_agent_start({ prompt: "현재 위치만 확인해봐", systemPrompt: "base" }, ctx);

	const blockedEdit = await hooks.tool_call({ toolName: "edit", input: { path: join(process.cwd(), "blocked-before-adopt.ts") } }, ctx);
	assert.equal(blockedEdit?.block, true);

	const adoptResult = await tools.workflow_guard.execute(
		"tool-call-id",
		{ action: "adopt", prompt: "위치가 틀렸으니 아래쪽으로 옮겨줘", reason: "follow-up correction was misclassified as read-only" },
		undefined,
		undefined,
		ctx,
	);
	assert.match(adoptResult.content.at(0).text, /Adopted workflow guard: intent=implement/);

	const allowedEdit = await hooks.tool_call({ toolName: "edit", input: { path: join(process.cwd(), "allowed-after-adopt.ts") } }, ctx);
	assert.equal(allowedEdit, undefined);
});

test("push status questions stay read-only instead of commit-push terminal path", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "push 상태 확인해줘", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=investigate/);
	assert.match(start.systemPrompt, /mutation=not-requested/);
	assert.match(start.systemPrompt, /HARD PATH/);
	assert.doesNotMatch(start.systemPrompt, /HARD LIGHT PUSH TERMINAL PATH/);

	const commitBlock = await hooks.tool_call({ toolName: "bash", input: { command: "git commit -m 'fix: should-block'" } }, ctx);
	assert.equal(commitBlock?.block, true);
});

test("commit and apply noun contexts stay read-only", async () => {
	const prompts = [
		"어제 workflow-guard 커밋 diff랑 현재 injected guard 비교해서 실제 반영 여부 분석해줘",
		"b866db7 커밋 반영 여부 확인해줘",
		"커밋 로그랑 반영 상태만 봐줘",
	];

	for (const prompt of prompts) {
		const { hooks, ctx } = createHarness();
		const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

		assert.match(start.systemPrompt, /intent=investigate/);
		assert.match(start.systemPrompt, /weight=none/);
		assert.match(start.systemPrompt, /mutation=not-requested/);
		assert.match(start.systemPrompt, /HARD PATH: this turn is read-only/);
		assert.doesNotMatch(start.systemPrompt, /intent=ship/);
		assert.doesNotMatch(start.systemPrompt, /intent=implement/);
		assert.doesNotMatch(start.systemPrompt, /Commit-complete stop-line/);

		const writeBlock = await hooks.tool_call({ toolName: "write", input: { path: join(process.cwd(), "workflow-guard-should-block.txt") } }, ctx);
		assert.equal(writeBlock?.block, true);
	}
});

test("commit and apply directives still request mutation", async () => {
	const apply = createHarness();
	const applyStart = await apply.hooks.before_agent_start({ prompt: "workflow guard에 반영해", systemPrompt: "base" }, apply.ctx);
	assert.match(applyStart.systemPrompt, /intent=implement · weight=standard/);
	assert.doesNotMatch(applyStart.systemPrompt, /mutation=not-requested/);
	const writeCall = await apply.hooks.tool_call({ toolName: "write", input: { path: join(process.cwd(), "workflow-guard-allow.txt") } }, apply.ctx);
	assert.equal(writeCall, undefined);

	const commit = createHarness();
	const commitStart = await commit.hooks.before_agent_start({ prompt: "변경사항 커밋해줘", systemPrompt: "base" }, commit.ctx);
	assert.match(commitStart.systemPrompt, /intent=ship · weight=light/);
	assert.match(commitStart.systemPrompt, /HARD LIGHT PATH/);
	assert.doesNotMatch(commitStart.systemPrompt, /mutation=not-requested/);
	const commitCall = await commit.hooks.tool_call({ toolName: "bash", input: { command: "git commit -m 'fix: smoke'" } }, commit.ctx);
	assert.equal(commitCall, undefined);
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
