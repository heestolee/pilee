import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import workflowGuard from "./index.ts";

function createHarness(options: { cwd?: string; originUrl?: string; trustedInternalPullRequestRepositories?: string[] } = {}) {
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
		exec: async (command: string, args: string[]) => {
			if (command === "git" && args.join(" ") === "config --get remote.origin.url" && options.originUrl) {
				return { code: 0, stdout: `${options.originUrl}\n`, stderr: "" };
			}
			return { code: 0, stdout: "", stderr: "" };
		},
		getThinkingLevel: () => thinkingLevel,
	} as any;
	workflowGuard(pi, {
		trustedInternalPullRequestRepositories: options.trustedInternalPullRequestRepositories ?? [],
	});
	const ctx = {
		cwd: options.cwd ?? process.cwd(),
		model: { provider: "openai-codex", id: "gpt-5.6-sol" },
		sessionManager: { getSessionFile: () => "/tmp/workflow-guard-test.jsonl" },
	};
	return { hooks, tools, ctx, setThinkingLevel: (level: string) => { thinkingLevel = level; } };
}

test("native ultra enables proactive delegation without bypassing safety gates", async () => {
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

test("non-ultra thinking keeps explicit-request worker discipline", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "결제 플로우 수정해줘", systemPrompt: "base" }, ctx);

	assert.doesNotMatch(start.systemPrompt, /ULTRA PROACTIVE DELEGATION MODE/);
	assert.match(start.systemPrompt, /worker\/subagent orchestration is opt-in/);
	assert.match(start.systemPrompt, /work graph shows real ownership benefit/);
	assert.match(start.systemPrompt, /may justify one worker or read-only fan-out/);
	assert.match(start.systemPrompt, /never authorizes overlapping parallel writers/);
	assert.equal(start.message.details.ultraMode, false);
});

test("external Issue and PR creation requires CONTRIBUTING review plus separate final approval", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "upstream에 이슈와 PR 만들어줘", systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /EXTERNAL ISSUE\/PR PUBLISH GATE/);
	assert.match(start.systemPrompt, /CONTRIBUTING\.md/);
	assert.match(start.systemPrompt, /initial request.*is not final approval/i);
	assert.match(start.message.details.state.summary, /externalPublish=approval-gated/);

	const issueBlock = await hooks.tool_call({ toolName: "bash", input: { command: "gh issue create --title test --body body" } }, ctx);
	assert.equal(issueBlock?.block, true);
	assert.match(issueBlock.reason, /CONTRIBUTING review and final user approval/);

	const prBlock = await hooks.tool_call({ toolName: "bash", input: { command: "WORKFLOW_GUARD_CONTRIBUTING_CHECKED=1 gh pr create --title test --body body" } }, ctx);
	assert.equal(prBlock?.block, true);

	const apiBlock = await hooks.tool_call({ toolName: "bash", input: { command: "gh api --method POST repos/acme/repo/issues -f title=test" } }, ctx);
	assert.equal(apiBlock?.block, true);

	const approved = await hooks.tool_call({
		toolName: "bash",
		input: {
			command: "WORKFLOW_GUARD_CONTRIBUTING_CHECKED=1 WORKFLOW_GUARD_EXTERNAL_PUBLISH_APPROVED=1 gh issue create --title test --body body",
		},
	}, ctx);
	assert.equal(approved, undefined);
});

test("trusted internal PR repositories bypass only the upstream PR publish gate", async () => {
	const root = await mkdtemp(join(tmpdir(), "workflow-guard-internal-pr-"));
	try {
		const { hooks, ctx } = createHarness({
			cwd: root,
			originUrl: "https://github.com/creatrip/product.git",
			trustedInternalPullRequestRepositories: ["creatrip/product"],
		});
		const start = await hooks.before_agent_start({ prompt: "/create-pr production", systemPrompt: "base" }, ctx);

		assert.match(start.message.details.state.summary, /externalPublish=internal-trusted/);
		assert.doesNotMatch(start.systemPrompt, /EXTERNAL ISSUE\/PR PUBLISH GATE/);

		const internalPr = await hooks.tool_call({
			toolName: "bash",
			input: { command: "gh pr create --repo creatrip/product --base production --title test --body body" },
		}, ctx);
		assert.equal(internalPr, undefined);

		const internalPrWithGlobalRepo = await hooks.tool_call({
			toolName: "bash",
			input: { command: "gh -R creatrip/product pr create --base production --title test --body body" },
		}, ctx);
		assert.equal(internalPrWithGlobalRepo, undefined);

		const internalIssue = await hooks.tool_call({
			toolName: "bash",
			input: { command: "gh issue create --repo creatrip/product --title test --body body" },
		}, ctx);
		assert.equal(internalIssue?.block, true);

		const externalPr = await hooks.tool_call({
			toolName: "bash",
			input: { command: "gh pr create --repo upstream/project --title test --body body" },
		}, ctx);
		assert.equal(externalPr?.block, true);

		const dynamicRepository = await hooks.tool_call({
			toolName: "bash",
			input: { command: "gh -R \"$TARGET_REPOSITORY\" pr create --title test --body body" },
		}, ctx);
		assert.equal(dynamicRepository?.block, true);

		const mixedPublish = await hooks.tool_call({
			toolName: "bash",
			input: {
				command: "gh pr create --repo creatrip/product --title test --body body && gh issue create --repo creatrip/product --title issue --body body",
			},
		}, ctx);
		assert.equal(mixedPublish?.block, true);

		const externalPrompt = createHarness({
			cwd: root,
			originUrl: "https://github.com/creatrip/product.git",
			trustedInternalPullRequestRepositories: ["creatrip/product"],
		});
		const externalStart = await externalPrompt.hooks.before_agent_start({
			prompt: "/create-pr --repo upstream/project",
			systemPrompt: "base",
		}, externalPrompt.ctx);
		assert.match(externalStart.systemPrompt, /EXTERNAL ISSUE\/PR PUBLISH GATE/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("project-local profiles cannot self-declare a trusted PR repository", async () => {
	const root = await mkdtemp(join(tmpdir(), "workflow-guard-project-profile-"));
	try {
		await mkdir(join(root, ".pi", "profiles"), { recursive: true });
		await writeFile(join(root, ".pi", "profiles", "workflow-guard.json"), JSON.stringify({
			workflowGuard: {
				trustedInternalPullRequestRepositories: ["untrusted/project"],
			},
		}));
		const { hooks, ctx } = createHarness({ cwd: root, originUrl: "https://github.com/untrusted/project.git" });
		const start = await hooks.before_agent_start({ prompt: "/create-pr", systemPrompt: "base" }, ctx);
		assert.match(start.systemPrompt, /EXTERNAL ISSUE\/PR PUBLISH GATE/);

		const blocked = await hooks.tool_call({
			toolName: "bash",
			input: { command: "gh pr create --repo untrusted/project --title test --body body" },
		}, ctx);
		assert.equal(blocked?.block, true);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
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
	assert.doesNotMatch(start.systemPrompt, /READ-ONLY DEFAULT/);

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
	assert.doesNotMatch(start.systemPrompt, /LARGE WORK ROUTING/);

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
	assert.doesNotMatch(start.systemPrompt, /READ-ONLY DEFAULT/);

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
	assert.doesNotMatch(start.systemPrompt, /READ-ONLY DEFAULT/);

	const editCall = await hooks.tool_call({ toolName: "edit", input: { path: join(process.cwd(), "mixed-request-width.ts") } }, ctx);
	assert.equal(editCall, undefined);
});

test("large-work routing selects specialists by expected output and capability", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({
		prompt: "여기 표에서 에러메시지가 모호해 보이는 예시 5개만 찾아봐",
		systemPrompt: "base",
	}, ctx);

	assert.match(start.systemPrompt, /intent=investigate · weight=none/);
	assert.match(start.systemPrompt, /LARGE WORK ROUTING \(soft default\)/);
	assert.match(start.systemPrompt, /input fan-out, complexity, uncertainty, runtime, and verification axes/);
	assert.match(start.systemPrompt, /expected output and required tools/);
	for (const role of ["finder", "searcher", "planner", "worker", "reviewer", "challenger", "verifier", "browser", "bootstrapper"]) {
		assert.match(start.systemPrompt, new RegExp(`\\b${role}\\b`));
	}
	assert.match(start.systemPrompt, /single owner for coherent work, batch for independent shards, chain for dependent stages/);
	assert.match(start.systemPrompt, /Sequential work may still be delegated to one owner/);
	assert.match(start.systemPrompt, /parallel mutation requires disjoint scope\/worktrees and an integration owner/);
	assert.match(start.systemPrompt, /source-native locator only when the child has the required capability/);
	assert.match(start.systemPrompt, /bounded, redacted temporary shards with stable IDs and provenance/);
	assert.match(start.systemPrompt, /do not create raw\/full external-system artifacts by default/);
	assert.match(start.systemPrompt, /goal, exclusions, source scope, expected output, evidence, and report schema/);
	assert.match(start.systemPrompt, /basis, status, and coverage for every shard/);
	assert.match(start.systemPrompt, /Partial failure stays an explicit GAP/);
});

test("structural signals checkpoint once while light fan-out stays blocked until adopt", async () => {
	const { hooks, tools, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "작은 결과 문구만 수정해줘", systemPrompt: "base" }, ctx);
	assert.match(start.systemPrompt, /intent=hotfix · weight=light/);

	const digestResult = await hooks.tool_result({
		toolName: "mcp",
		content: [{ type: "text", text: "작은 MCP 결과" }],
		details: { mcpDigest: true, responseId: "mcp_test" },
	}, ctx);
	assert.equal(digestResult.details.workflowGuard.largeWorkRoutingSuggested, false);

	const signalResult = await hooks.tool_result({
		toolName: "read",
		content: [{ type: "text", text: "partial output" }],
		details: { truncation: { truncated: true } },
	}, ctx);
	assert.equal(signalResult.details.workflowGuard.largeWorkRoutingSuggested, true);
	assert.match(signalResult.content.at(-1).text, /largeWorkRoutingSuggested: true/);
	assert.match(signalResult.content.at(-1).text, /Re-evaluate the owner by expected output and tool capability/);
	assert.match(signalResult.content.at(-1).text, /workflow_guard action=adopt/);
	assert.match(signalResult.content.at(-1).text, /Do not ask the user to re-authorize/);

	const repeatedSignal = await hooks.tool_result({
		toolName: "read",
		content: [{ type: "text", text: "partial output" }],
		details: { truncation: { truncated: true } },
	}, ctx);
	assert.equal(repeatedSignal.details.workflowGuard.largeWorkRoutingSuggested, false);

	for (const command of [
		"subagent run worker -- 큰 변환 작업 수행",
		"subagent batch --agent finder --task 조사",
		"subagent chain --agent finder --task 조사",
		"run worker -- 큰 변환 작업 수행",
		"batch --agent finder --task 조사",
		"chain --agent finder --task 조사",
	]) {
		const blockedAfterSignal = await hooks.tool_call({ toolName: "subagent", input: { command } }, ctx);
		assert.equal(blockedAfterSignal?.block, true, command);
	}
	const allowedContinue = await hooks.tool_call({
		toolName: "subagent",
		input: { command: "continue 22 -- 기존 작업 계속" },
	}, ctx);
	assert.equal(allowedContinue, undefined);

	const adoptResult = await tools.workflow_guard.execute(
		"tool-call-id",
		{ action: "adopt", prompt: "여러 파일 변환 작업을 구현해줘", reason: "structural signal proved the light classification stale" },
		undefined,
		undefined,
		ctx,
	);
	assert.match(adoptResult.content.at(0).text, /Adopted workflow guard: intent=implement · weight=standard/);
	assert.equal(adoptResult.details.state.largeWorkObserved, true);
	assert.equal(adoptResult.details.state.largeWorkBasis, "read:truncated");

	const signalAfterAdopt = await hooks.tool_result({
		toolName: "read",
		content: [{ type: "text", text: "partial output" }],
		details: { truncation: { truncated: true } },
	}, ctx);
	assert.equal(signalAfterAdopt.details.workflowGuard.largeWorkRoutingSuggested, false);
	assert.doesNotMatch(signalAfterAdopt.content.at(-1).text, /largeWorkRoutingSuggested: true/);

	const allowedAfterAdopt = await hooks.tool_call({
		toolName: "subagent",
		input: { command: "run worker -- 큰 변환 작업 수행" },
	}, ctx);
	assert.equal(allowedAfterAdopt, undefined);
});

test("large-work routing recognizes full-content and trusted truncation signals", async () => {
	const cases = [
		{ name: "full content locator", toolName: "get_mcp_content", content: "MCP full content", details: { mcpFullContent: true } },
		{ name: "successful read fixture text", toolName: "read", content: "Command exited with code 1", details: { truncation: { truncated: true } } },
		{ name: "nested bash truncation", toolName: "bash", content: "partial output", details: { truncation: { truncated: true } } },
		{ name: "nested grep truncation", toolName: "grep", content: "partial output", details: { truncation: { truncated: true } } },
		{ name: "nested find truncation", toolName: "find", content: "partial output", details: { truncation: { truncated: true } } },
		{ name: "nested ls truncation", toolName: "ls", content: "partial output", details: { truncation: { truncated: true } } },
		{ name: "legacy typed truncation", toolName: "read", content: "partial output", details: { truncated: true } },
	];

	for (const item of cases) {
		const { hooks, ctx } = createHarness();
		await hooks.before_agent_start({ prompt: "자료를 확인해줘", systemPrompt: "base" }, ctx);
		const result = await hooks.tool_result({
			toolName: item.toolName,
			content: [{ type: "text", text: item.content }],
			details: item.details,
		}, ctx);
		assert.equal(result.details.workflowGuard.largeWorkRoutingSuggested, true, item.name);
		assert.match(result.content.at(-1).text, /soft checkpoint/, item.name);
	}
});

test("large-work routing rejects text resemblance and untrusted metadata", async () => {
	const cases = [
		{ name: "negated text", toolName: "read", content: "This content is not truncated.", details: {} },
		{ name: "quoted guidance", toolName: "read", content: "문서 예시: Use offset/limit for large files.", details: {} },
		{ name: "user field names", toolName: "read", content: "사용자 데이터 필드 이름은 hasMore와 nextCursor입니다.", details: {} },
		{ name: "wrong full-content tool", toolName: "mcp", content: "spoofed", details: { mcpFullContent: true } },
		{ name: "wrong truncation tool", toolName: "mcp", content: "spoofed", details: { truncation: { truncated: true } } },
		{ name: "wrong truncation metadata type", toolName: "read", content: "spoofed", details: { truncated: "true", isTruncated: 1, truncation: { truncated: "true" } } },
		{ name: "removed synthetic pagination metadata", toolName: "mcp", content: "spoofed", details: { hasMore: true, nextCursor: { value: "cursor-2" }, nextPageToken: { value: 2 } } },
		{ name: "errored truncation", toolName: "read", content: "failed", details: { truncation: { truncated: true } }, isError: true },
		{ name: "failed truncation code", toolName: "bash", content: "failed", details: { code: 1, truncation: { truncated: true } } },
		{ name: "failed truncation exitCode", toolName: "grep", content: "failed", details: { exitCode: 1, truncation: { truncated: true } } },
		{ name: "failed truncation statusCode", toolName: "find", content: "failed", details: { statusCode: 1, truncation: { truncated: true } } },
	];

	for (const item of cases) {
		const { hooks, ctx } = createHarness();
		await hooks.before_agent_start({ prompt: "작은 문구만 수정해줘", systemPrompt: "base" }, ctx);
		const result = await hooks.tool_result({
			toolName: item.toolName,
			content: [{ type: "text", text: item.content }],
			details: item.details,
			isError: item.isError,
		}, ctx);
		assert.equal(result.details.workflowGuard.largeWorkRoutingSuggested, false, item.name);
		const blocked = await hooks.tool_call({
			toolName: "subagent",
			input: { command: "subagent run worker -- 작은 문구 수정" },
		}, ctx);
		assert.equal(blocked?.block, true, item.name);
	}
});

test("small sequential results stay on the main agent without routing escalation", async () => {
	const { hooks, ctx } = createHarness();
	const start = await hooks.before_agent_start({ prompt: "작은 문구만 수정해줘", systemPrompt: "base" }, ctx);
	assert.match(start.systemPrompt, /intent=hotfix · weight=light/);
	assert.match(start.systemPrompt, /Keep small or high-coordination work on the main agent/);

	const result = await hooks.tool_result({
		toolName: "read",
		content: [{ type: "text", text: "one short line" }],
		details: {},
	}, ctx);
	assert.equal(result.details.workflowGuard.largeWorkRoutingSuggested, false);

	const blocked = await hooks.tool_call({
		toolName: "subagent",
		input: { command: "subagent run worker -- 작은 문구 수정" },
	}, ctx);
	assert.equal(blocked?.block, true);
});

test("answer and investigation turns use soft read-only guidance", async () => {
	for (const prompt of ["왜 width를 줄이는 게 좋아?", "width를 100으로 줄이면 어때?"]) {
		const { hooks, ctx } = createHarness();
		const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

		assert.match(start.systemPrompt, /intent=(?:investigate|answer) · weight=none/);
		assert.match(start.systemPrompt, /mutation=not-requested/);
		assert.match(start.systemPrompt, /READ-ONLY DEFAULT/);
		assert.doesNotMatch(start.systemPrompt, /mixed=implement\+investigate/);

		const editCall = await hooks.tool_call({ toolName: "edit", input: { path: join(process.cwd(), "dimension-question.ts") } }, ctx);
		assert.equal(editCall, undefined);
		const writeCall = await hooks.tool_call({ toolName: "write", input: { path: join(process.cwd(), "dimension-question.md") } }, ctx);
		assert.equal(writeCall, undefined);
		const readOnlyBash = await hooks.tool_call({
			toolName: "bash",
			input: { command: "printf 'checking logs\n'; find ~/.pi/agent/logs -type f 2>/dev/null | tail -20" },
		}, ctx);
		assert.equal(readOnlyBash, undefined);
	}
});

test("Study Hard worker wrapper honors authoritative scoped artifact write", async () => {
	const artifactPath = join(process.cwd(), "study-hard-worker-result.json");
	const root = await mkdtemp(join(tmpdir(), "workflow-guard-study-hard-"));
	execFileSync("git", ["init", "-b", "main", root]);
	await mkdir(join(root, ".pi"), { recursive: true });
	await writeFile(join(root, ".pi", "work-context.json"), JSON.stringify({
		schemaVersion: 1,
		identity: {
			id: "worktree:study-hard-test",
			type: "worktree",
			root,
			cwd: root,
			displayName: "repo",
			contextPath: join(root, ".pi", "work-context.json"),
			tasksPath: join(root, ".pi", "work-tasks.json"),
		},
		updatedAt: "2026-07-21T00:00:00.000Z",
		source: "frame",
		mode: "full",
		goal: "제품 slice 구현",
		currentSlice: { id: "S1", title: "제품 코드", scope: ["src"], acceptance: ["검증 통과"], status: "in_progress" },
		slices: [],
		mustKeep: [],
		mustNot: [],
		openQuestions: [],
		verifyFocus: [],
		lastKnownState: {},
		refs: {},
	}, null, 2));
	const { hooks, ctx } = createHarness();
	const workerCtx = { ...ctx, cwd: root };
	const start = await hooks.before_agent_start({
		prompt: [
			"[HISTORY — REFERENCE ONLY]",
			"이전 workflow guard 오분류를 조사해라. 파일은 수정하지 마.",
			"",
			"[REQUEST — AUTHORITATIVE]",
			"Study Hard worker 결과를 생성하세요.",
			`workerResultPath: ${artifactPath}`,
			"statePath는 직접 수정하지 말고 workerResultPath에는 artifact JSON을 작성하세요.",
		].join("\n"),
		systemPrompt: "base",
	}, workerCtx);

	assert.match(start.systemPrompt, /intent=implement · weight=full/);
	assert.doesNotMatch(start.systemPrompt, /audit=required/);
	assert.doesNotMatch(start.systemPrompt, /mutation=not-requested/);
	assert.doesNotMatch(start.systemPrompt, /Compact work context for this turn/);
	const writeCall = await hooks.tool_call({ toolName: "write", input: { path: artifactPath } }, workerCtx);
	assert.equal(writeCall, undefined);

	const readOnly = createHarness();
	const readOnlyStart = await readOnly.hooks.before_agent_start({
		prompt: "state 파일은 수정하지 말고 원인만 조사해줘",
		systemPrompt: "base",
	}, readOnly.ctx);
	assert.match(readOnlyStart.systemPrompt, /intent=investigate · weight=none/);
	assert.match(readOnlyStart.systemPrompt, /mutation=not-requested/);
	const softWrite = await readOnly.hooks.tool_call({ toolName: "write", input: { path: artifactPath } }, readOnly.ctx);
	assert.equal(softWrite, undefined);
});

test("Study Hard worker envelope permits artifact writes when directive fields are far apart", async () => {
	const artifactPath = join(process.cwd(), "study-hard-worker-result.json");
	const { hooks, ctx } = createHarness();
	const prompt = [
		"Study Hard worker Q003 artifact 생성을 재시도해 주세요.",
		"이 문장은 실제 실패 재현처럼 출력 경로보다 앞에 긴 복구 설명을 둡니다. ".repeat(8),
		"statePath=/tmp/study-hard-state.json",
		"questionId=Q003",
		"orchestrationId=worker-test-123",
		`workerResultPath=${artifactPath}`,
		"scope=session; context=전체 자료; 제품 코드는 수정하지 마세요.",
	].join(" ");
	assert.ok(prompt.indexOf("workerResultPath") - prompt.indexOf("생성") > 180);

	const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=implement · weight=full/);
	assert.doesNotMatch(start.systemPrompt, /mutation=not-requested/);
	assert.doesNotMatch(start.systemPrompt, /Compact work context for this turn/);
	assert.equal(start.message.details.state.detachedArtifactTask, true);
	const writeCall = await hooks.tool_call({ toolName: "write", input: { path: artifactPath } }, ctx);
	assert.equal(writeCall, undefined);
});

test("Study Hard natural-language artifact request bypasses product work context", async () => {
	const artifactPath = join(tmpdir(), "frame-v2-test.json.worker-Q001.json");
	const { hooks, ctx } = createHarness();
	const prompt = [
		"Study Hard run frame-v2-test의 learner question Q001을 처리하세요.",
		`결과 artifact는 ${artifactPath} 입니다.`,
		"현재 구현 맥락을 사용해 답변과 노트 patch를 worker protocol에 맞춰 artifact로 작성하세요.",
		"canonical Study Hard state와 제품 코드는 수정하지 마세요.",
	].join(" ");

	const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);

	assert.match(start.systemPrompt, /intent=implement · weight=full/);
	assert.doesNotMatch(start.systemPrompt, /mutation=not-requested/);
	assert.equal(start.message.details.state.detachedArtifactTask, true);
	assert.doesNotMatch(start.systemPrompt, /Compact work context for this turn/);
	const writeCall = await hooks.tool_call({ toolName: "write", input: { path: artifactPath } }, ctx);
	assert.equal(writeCall, undefined);
});

test("Work Context only gates mutations inside its own repository", async () => {
	const root = await mkdtemp(join(homedir(), ".workflow-guard-owned-root-"));
	const externalRoot = await mkdtemp(join(homedir(), ".workflow-guard-external-root-"));
	try {
		execFileSync("git", ["init", "-b", "main", root]);
		await mkdir(join(root, ".pi"), { recursive: true });
		await writeFile(join(root, ".pi", "work-context.json"), JSON.stringify({
		schemaVersion: 1,
		identity: {
			id: "worktree:owned-root",
			type: "worktree",
			root,
			cwd: root,
			displayName: "owned-root",
			contextPath: join(root, ".pi", "work-context.json"),
			tasksPath: join(root, ".pi", "work-tasks.json"),
		},
		updatedAt: "2026-07-23T00:00:00.000Z",
		source: "frame",
		mode: "standard",
		goal: "현재 제품 slice",
		currentSlice: { id: "S1", title: "제품 코드", scope: ["src"], acceptance: ["검증"], status: "in_progress" },
		slices: [],
		mustKeep: [],
		mustNot: [],
		openQuestions: [],
		verifyFocus: [],
		lastKnownState: {},
		refs: {},
	}, null, 2));
		const { hooks, ctx } = createHarness();
		const worktreeCtx = { ...ctx, cwd: root };
		await hooks.before_agent_start({ prompt: "현재 제품 작업을 수정해줘", systemPrompt: "base" }, worktreeCtx);

		const sameRepoOutsideSlice = await hooks.tool_call({
			toolName: "edit",
			input: { path: join(root, "docs", "outside-slice.md") },
		}, worktreeCtx);
		assert.equal(sameRepoOutsideSlice?.block, true);
		assert.match(sameRepoOutsideSlice.reason, /Working Context Card gate failed/);

		const externalArtifact = await hooks.tool_call({
			toolName: "write",
			input: { path: join(externalRoot, "study-hard-worker-result.json") },
		}, worktreeCtx);
		assert.equal(externalArtifact, undefined);
	} finally {
		await Promise.all([
			rm(root, { recursive: true, force: true }),
			rm(externalRoot, { recursive: true, force: true }),
		]);
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

		const softWrite = await hooks.tool_call({ toolName: "write", input: { path: join(process.cwd(), "workflow-guard-complaint.txt") } }, ctx);
		assert.equal(softWrite, undefined);
	}
});

test("adopt action replaces stale classification while file mutation remains soft", async () => {
	const { hooks, tools, ctx } = createHarness();
	await hooks.before_agent_start({ prompt: "현재 위치만 확인해봐", systemPrompt: "base" }, ctx);

	const softEdit = await hooks.tool_call({ toolName: "edit", input: { path: join(process.cwd(), "allowed-before-adopt.ts") } }, ctx);
	assert.equal(softEdit, undefined);

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
	assert.match(start.systemPrompt, /READ-ONLY DEFAULT/);
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
		assert.match(start.systemPrompt, /READ-ONLY DEFAULT/);
		assert.doesNotMatch(start.systemPrompt, /intent=ship/);
		assert.doesNotMatch(start.systemPrompt, /intent=implement/);
		assert.doesNotMatch(start.systemPrompt, /Commit-complete stop-line/);

		const softWrite = await hooks.tool_call({ toolName: "write", input: { path: join(process.cwd(), "workflow-guard-soft-write.txt") } }, ctx);
		assert.equal(softWrite, undefined);
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
