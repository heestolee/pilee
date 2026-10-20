import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Check } from "typebox/value";
import workflowGuard from "./index.ts";
import { restoreWorkspaceAuthorization, workspaceAuthorizationProofForConsumer } from "../utils/workspace-activation-contract.ts";
import { buildNewPanelActivationContract } from "../worktree/panel-activation.ts";

let harnessSequence = 0;

function createHarness(options: { cwd?: string; originUrl?: string; trustedInternalPullRequestRepositories?: string[] } = {}) {
	const hooks: Record<string, any> = {};
	const tools: Record<string, any> = {};
	const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	let sessionFile = `/tmp/workflow-guard-test-${++harnessSequence}.jsonl`;
	let thinkingLevel = "high";
	const thinkingChanges: string[] = [];
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
		setThinkingLevel(level: string) {
			thinkingLevel = level;
			thinkingChanges.push(level);
		},
		appendEntry(customType: string, data: unknown) {
			entries.push({ type: "custom", customType, data });
		},
	} as any;
	workflowGuard(pi, {
		trustedInternalPullRequestRepositories: options.trustedInternalPullRequestRepositories ?? [],
	});
	const ctx = {
		cwd: options.cwd ?? process.cwd(),
		model: { provider: "openai-codex", id: "gpt-6-astra" },
		sessionManager: {
			getSessionFile: () => sessionFile,
			getLeafId: () => "leaf-1",
			getEntries: () => entries,
			getBranch: () => entries,
			appendCustomEntry(customType: string, data: unknown) { entries.push({ type: "custom", customType, data }); },
		},
	};
	return {
		hooks,
		tools,
		ctx,
		entries,
		thinkingChanges,
		getThinkingLevel: () => thinkingLevel,
		setThinkingLevel: (level: string) => { thinkingLevel = level; },
		setSessionFile: (file: string) => { sessionFile = file; },
	};
}

test("registered guard schema accepts structured assessment and keeps legacy calls valid", () => {
	const { tools } = createHarness();
	const schema = tools.workflow_guard.parameters;
	const assessment = { requestId: "original-user-request", intent: "investigate", weight: "none", authorization: { toolName: "worktree_fork", input: { repo: "repo", name: "review", hotfix: false } } };
	assert.equal(Check(schema, { action: "adopt", reason: "원 요청 근거", assessment }), true);
	assert.equal(Check(schema, { action: "adopt", prompt: "legacy request", reason: "legacy correction" }), true);
	assert.equal(Check(schema, { action: "classify", prompt: "preview only" }), true);
	assert.equal(Check(schema, { action: "adopt", assessment: { ...assessment, requestId: 42 } }), false);
	assert.equal(Check(schema, { action: "adopt", assessment: { ...assessment, intent: "status_note" } }), false);
});

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

test("astra xhigh escalates only high-risk turns to max and restores after settling", async () => {
	const triggers = [
		["이 작업은 max로 올려서 처리해줘", "explicit max request"],
		["서비스 아키텍처를 비교하고 트레이드오프를 결정해줘", "architecture decision"],
		["redesign the system architecture and compare the tradeoffs", "architecture decision"],
		["OAuth 인증과 권한 모델의 보안 취약점을 분석해줘", "security-sensitive reasoning"],
		["트랜잭션 race condition과 deadlock을 근본 수정해줘", "concurrency reasoning"],
		["간헐적으로 반복되는 503 장애의 근본 원인을 찾아줘", "difficult incident analysis"],
		["xhigh로 해결되지 않고 또 실패했어. 같은 문제를 다시 재시도해줘", "failed xhigh retry"],
	] as const;

	for (const [prompt, reason] of triggers) {
		const harness = createHarness();
		harness.setThinkingLevel("xhigh");
		const start = await harness.hooks.before_agent_start({ prompt, systemPrompt: "base" }, harness.ctx);

		assert.equal(harness.getThinkingLevel(), "max");
		assert.deepEqual(harness.thinkingChanges, ["max"]);
		assert.equal(start.message.details.adaptiveThinking.reason, reason);
		assert.match(start.systemPrompt, /ADAPTIVE THINKING: xhigh → max/);

		await harness.hooks.agent_settled({}, harness.ctx);
		assert.equal(harness.getThinkingLevel(), "xhigh");
		assert.deepEqual(harness.thinkingChanges, ["max", "xhigh"]);
	}
});

test("gpt-6.1-sol xhigh escalates high-risk turns to max and restores after settling", async () => {
	const harness = createHarness();
	harness.setThinkingLevel("xhigh");
	harness.ctx.model.id = "gpt-6.1-sol";
	const start = await harness.hooks.before_agent_start({
		prompt: "OAuth 인증과 권한 모델의 보안 취약점을 분석해줘",
		systemPrompt: "base",
	}, harness.ctx);

	assert.equal(harness.getThinkingLevel(), "max");
	assert.deepEqual(harness.thinkingChanges, ["max"]);
	assert.equal(start.message.details.adaptiveThinking.reason, "security-sensitive reasoning");

	await harness.hooks.agent_settled({}, harness.ctx);
	assert.equal(harness.getThinkingLevel(), "xhigh");
	assert.deepEqual(harness.thinkingChanges, ["max", "xhigh"]);
});

test("ordinary astra xhigh turns stay xhigh", async () => {
	const harness = createHarness();
	harness.setThinkingLevel("xhigh");
	const start = await harness.hooks.before_agent_start({ prompt: "검색 결과 카드 문구를 수정해줘", systemPrompt: "base" }, harness.ctx);

	assert.equal(harness.getThinkingLevel(), "xhigh");
	assert.deepEqual(harness.thinkingChanges, []);
	assert.equal(start.message.details.adaptiveThinking, undefined);
	assert.doesNotMatch(start.systemPrompt, /ADAPTIVE THINKING/);
});

test("trivial edits mentioning high-risk domains stay xhigh", async () => {
	const prompts = [
		"보안 관련 주석 오타 수정",
		"jwt 만료시간 주석 수정",
		"권한 정책 문서에 줄바꿈 하나 추가하고 링크 고쳐줘",
		"트랜잭션 단위 테스트 이름 수정해줘",
		"멱등키 상수 값을 3으로 수정",
		"deadlock 관련 TODO 주석 제거 검토",
		"refactor the variable name in the architecture doc",
		"아키텍처 문서 링크 바꿔줘",
		"간헐 timeout 장애 설명 주석의 오타만 수정해줘",
		"xhigh 실패 재시도 설명 문구만 수정해줘",
		"간헐 timeout 장애의 근본 원인을 분석하지 말고 주석 오타만 수정해줘",
		"간헐 timeout 장애의 근본 원인을 찾지 말고 주석 오타만 수정해줘",
		"간헐 timeout 장애의 근본 원인을 찾아보지 말고 주석 오타만 수정해줘",
		"OAuth 취약점의 근본 원인을 분석해보지 말고 주석 오타만 수정해줘",
		"OAuth 취약점의 근본 원인 분석 결과가 적힌 주석의 오타만 수정해줘",
		"do not analyze the intermittent timeout root cause; only fix the comment typo",
		"fix only the typo in the comment containing the security root cause analysis result",
	];

	for (const modelId of ["gpt-6-astra", "gpt-6.1-sol"]) {
		for (const prompt of prompts) {
			const harness = createHarness();
			harness.setThinkingLevel("xhigh");
			harness.ctx.model.id = modelId;
			const start = await harness.hooks.before_agent_start({ prompt, systemPrompt: "base" }, harness.ctx);
			assert.equal(harness.getThinkingLevel(), "xhigh", `${modelId}: ${prompt}`);
			assert.equal(start.message.details.adaptiveThinking, undefined, `${modelId}: ${prompt}`);
			assert.deepEqual(harness.thinkingChanges, [], `${modelId}: ${prompt}`);
		}
	}
});

test("explicit deep analysis overrides negated or secondary artifact edits", async () => {
	const prompts = [
		["간헐 timeout 장애의 근본 원인을 분석해줘. 주석 수정은 하지 마.", "difficult incident analysis"],
		["간헐 timeout 장애의 근본 원인을 분석하고 주석 오타도 수정해줘.", "difficult incident analysis"],
		["간헐 timeout 장애는 분석하지 말고 대신 재현해서 해결해줘. 주석 오타도 수정해줘.", "difficult incident analysis"],
		["xhigh로 해결되지 않고 또 실패했어. 같은 문제를 다시 재시도해줘. 주석 오타도 수정해줘.", "failed xhigh retry"],
	] as const;

	for (const modelId of ["gpt-6-astra", "gpt-6.1-sol"]) {
		for (const [prompt, reason] of prompts) {
			const harness = createHarness();
			harness.setThinkingLevel("xhigh");
			harness.ctx.model.id = modelId;
			const start = await harness.hooks.before_agent_start({ prompt, systemPrompt: "base" }, harness.ctx);
			assert.equal(harness.getThinkingLevel(), "max", `${modelId}: ${prompt}`);
			assert.equal(start.message.details.adaptiveThinking.reason, reason, `${modelId}: ${prompt}`);
			await harness.hooks.agent_settled({}, harness.ctx);
			assert.equal(harness.getThinkingLevel(), "xhigh", `${modelId}: ${prompt}`);
		}
	}
});

test("status notes and ineligible models never auto-escalate", async () => {
	const statusHarness = createHarness();
	statusHarness.setThinkingLevel("xhigh");
	const status = await statusHarness.hooks.before_agent_start({
		prompt: "[dependency-bootstrap] BLOCKED — OAuth 보안 모듈 준비 실패",
		systemPrompt: "base",
	}, statusHarness.ctx);
	assert.equal(statusHarness.getThinkingLevel(), "xhigh");
	assert.equal(status.message.details.adaptiveThinking, undefined);

	const ineligibleHarness = createHarness();
	ineligibleHarness.setThinkingLevel("xhigh");
	ineligibleHarness.ctx.model.id = "gpt-6-sol";
	const ineligible = await ineligibleHarness.hooks.before_agent_start({ prompt: "OAuth 보안 취약점을 분석해줘", systemPrompt: "base" }, ineligibleHarness.ctx);
	assert.equal(ineligibleHarness.getThinkingLevel(), "xhigh");
	assert.equal(ineligible.message.details.adaptiveThinking, undefined);
});

test("session shutdown restores an active automatic escalation", async () => {
	const harness = createHarness();
	harness.setThinkingLevel("xhigh");
	await harness.hooks.before_agent_start({ prompt: "서비스 아키텍처를 비교하고 결정해줘", systemPrompt: "base" }, harness.ctx);
	assert.equal(harness.getThinkingLevel(), "max");
	harness.setSessionFile("/tmp/workflow-guard-replacement-session.jsonl");

	await harness.hooks.session_shutdown({}, harness.ctx);
	assert.equal(harness.getThinkingLevel(), "xhigh");
	assert.deepEqual(harness.thinkingChanges, ["max", "xhigh"]);
});

test("automatic escalation state is isolated between extension instances", async () => {
	const autoHarness = createHarness();
	autoHarness.setThinkingLevel("xhigh");
	await autoHarness.hooks.before_agent_start({ prompt: "서비스 아키텍처를 비교하고 결정해줘", systemPrompt: "base" }, autoHarness.ctx);
	assert.equal(autoHarness.getThinkingLevel(), "max");

	const manualHarness = createHarness();
	manualHarness.setThinkingLevel("max");
	const manual = await manualHarness.hooks.before_agent_start({ prompt: "OAuth 보안 취약점을 분석해줘", systemPrompt: "base" }, manualHarness.ctx);
	assert.equal(manual.message.details.adaptiveThinking, undefined);
	await manualHarness.hooks.agent_settled({}, manualHarness.ctx);
	assert.equal(manualHarness.getThinkingLevel(), "max");

	await autoHarness.hooks.agent_settled({}, autoHarness.ctx);
	assert.equal(autoHarness.getThinkingLevel(), "xhigh");
});

test("manual max is preserved and never auto-restored", async () => {
	const harness = createHarness();
	harness.setThinkingLevel("max");
	const start = await harness.hooks.before_agent_start({ prompt: "OAuth 보안 취약점을 분석해줘", systemPrompt: "base" }, harness.ctx);

	assert.equal(start.message.details.adaptiveThinking, undefined);
	assert.deepEqual(harness.thinkingChanges, []);
	await harness.hooks.agent_settled({}, harness.ctx);
	assert.equal(harness.getThinkingLevel(), "max");
	assert.deepEqual(harness.thinkingChanges, []);
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
		const start = await hooks.before_agent_start({
			prompt: "/create-pr production\n\n런타임 dry 검증: guard 상태를 확인한다.",
			systemPrompt: "base",
		}, ctx);

		assert.match(start.message.details.state.summary, /intent=ship/);
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

test("branch-only and negative worktree intents cannot authorize semantic git worktree creation variants", async () => {
	const commands = [
		"git -C /repo worktree add /tmp/target feature/target",
		"GIT_OPTIONAL_LOCKS=0 git -C /repo worktree add /tmp/target feature/target",
		"env git -C /repo worktree add /tmp/target feature/target",
		"command git -C /repo worktree add /tmp/target feature/target",
		"/usr/bin/git -C /repo worktree add /tmp/target feature/target",
		"bash -lc 'GIT_OPTIONAL_LOCKS=0 /usr/bin/git -C /repo worktree add /tmp/target feature/target'",
		"echo preparing && env git --git-dir=/repo/.git --work-tree=/repo worktree add /tmp/target feature/target",
		"(git -C /repo worktree add /tmp/target feature/target)",
		"sudo git -C /repo worktree add /tmp/target feature/target",
		"if true; then git -C /repo worktree add /tmp/target feature/target; fi",
		"eval 'git -C /repo worktree add /tmp/target feature/target'",
		"sh -c '(git -C /repo worktree add /tmp/target feature/target)'",
		"{ git -C /repo worktree add /tmp/target feature/target; }",
		"FOO=${BAR}/tmp git -C /repo worktree add /tmp/target feature/target",
		"FOO=prefix${BAR}suffix git -C /repo worktree add /tmp/target feature/target",
		"FOO=${BAR:-value}/tmp git -C /repo worktree add /tmp/target feature/target",
	];
	for (const prompt of [
		"현재 workspace에서 새 브랜치 만들어서 작업해",
		"worktree 만들지 말고 현재 workspace에서 branch만 만들어",
	]) {
		const { hooks, ctx } = createHarness();
		const start = await hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx);
		assert.match(start.message.details.state.summary, /workspaceAllow=branch-in-place/);
		const blocked = await hooks.tool_call({ toolName: "worktree_create", input: { repo: "repo" } }, ctx);
		assert.equal(blocked?.block, true, prompt);
		assert.match(blocked.reason, /branch\/in-place 요청은 새 worktree 생성 권한이 아닙니다|명시적으로 거부됐습니다/);
		for (const command of commands) {
			const manual = await hooks.tool_call({ toolName: "bash", input: { command } }, ctx);
			assert.equal(manual?.block, true, `${prompt}: ${command}`);
			assert.match(manual.reason, /branch\/in-place 요청은 새 worktree 생성 권한이 아닙니다|명시적으로 거부됐습니다/);
		}
		assert.equal(await hooks.tool_call({ toolName: "bash", input: { command: "git -C /repo status --short" } }, ctx), undefined);
		assert.equal(await hooks.tool_call({ toolName: "bash", input: { command: "env /usr/bin/git -C /repo branch --show-current" } }, ctx), undefined);
	}
});

test("explicit worktree and switch intents authorize one matching action only", async () => {
	const create = createHarness();
	const createStart = await create.hooks.before_agent_start({ prompt: "현재 대화를 fork해서 새 worktree 만들어줘", systemPrompt: "base" }, create.ctx);
	assert.match(createStart.message.details.state.summary, /workspaceAllow=create-worktree/);
	assert.equal(await create.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "fork-1", input: { repo: "repo" } }, create.ctx), undefined);
	const reusedCreate = await create.hooks.tool_call({ toolName: "worktree_create", toolCallId: "create-2", input: { repo: "repo" } }, create.ctx);
	assert.equal(reusedCreate?.block, true);
	assert.match(reusedCreate.reason, /이미 사용했습니다/);

	for (const [index, command] of [
		"git -C /repo worktree add /tmp/target feature/target",
		"GIT_OPTIONAL_LOCKS=0 git -C /repo worktree add /tmp/target feature/target",
		"env git -C /repo worktree add /tmp/target feature/target",
		"command git -C /repo worktree add /tmp/target feature/target",
		"/usr/bin/git -C /repo worktree add /tmp/target feature/target",
	].entries()) {
		const direct = createHarness();
		await direct.hooks.before_agent_start({ prompt: "새 worktree 만들어줘", systemPrompt: "base" }, direct.ctx);
		assert.equal(await direct.hooks.tool_call({ toolName: "bash", toolCallId: `bash-${index}`, input: { command } }, direct.ctx), undefined, command);
		const reused = await direct.hooks.tool_call({ toolName: "bash", toolCallId: `bash-reuse-${index}`, input: { command } }, direct.ctx);
		assert.equal(reused?.block, true, command);
	}

	const useExisting = createHarness();
	const switchStart = await useExisting.hooks.before_agent_start({ prompt: "/wt switch repo/target", systemPrompt: "base" }, useExisting.ctx);
	assert.match(switchStart.message.details.state.summary, /workspaceAllow=use-existing-worktree/);
	assert.equal(await useExisting.hooks.tool_call({ toolName: "worktree_switch", toolCallId: "switch-1", input: { repo: "repo", name: "target" } }, useExisting.ctx), undefined);
	const reusedSwitch = await useExisting.hooks.tool_call({ toolName: "worktree_switch", toolCallId: "switch-2", input: { repo: "repo", name: "target" } }, useExisting.ctx);
	assert.equal(reusedSwitch?.block, true);
	const listOnly = await useExisting.hooks.tool_call({ toolName: "worktree_switch", toolCallId: "switch-list", input: { repo: "repo" } }, useExisting.ctx);
	assert.equal(listOnly, undefined, "listing worktrees must not require or consume switch authorization");
});

test("grouped and wrapped direct worktree commands consume exactly one authorization", async () => {
	const commands = [
		"(git -C /repo worktree add /tmp/target feature/target)",
		"sudo git -C /repo worktree add /tmp/target feature/target",
		"if true; then git -C /repo worktree add /tmp/target feature/target; fi",
		"eval 'git -C /repo worktree add /tmp/target feature/target'",
		"sh -c '(git -C /repo worktree add /tmp/target feature/target)'",
		"{ git -C /repo worktree add /tmp/target feature/target; }",
		"FOO=${BAR:-value}/tmp git -C /repo worktree add /tmp/target feature/target",
	];
	for (const [index, command] of commands.entries()) {
		const harness = createHarness();
		await harness.hooks.before_agent_start({ prompt: "새 worktree 만들어줘", systemPrompt: "base" }, harness.ctx);
		assert.equal(await harness.hooks.tool_call({
			toolName: "bash",
			toolCallId: `wrapped-${index}`,
			input: { command },
		}, harness.ctx), undefined, command);
		const reused = await harness.hooks.tool_call({
			toolName: "bash",
			toolCallId: `wrapped-reuse-${index}`,
			input: { command },
		}, harness.ctx);
		assert.equal(reused?.block, true, command);
		assert.match(reused.reason, /이미 사용했습니다/);
	}
});

test("one authorization cannot execute multiple worktree additions in one bash tool", async () => {
	const harness = createHarness();
	await harness.hooks.before_agent_start({ prompt: "새 worktree 만들어줘", systemPrompt: "base" }, harness.ctx);
	const multiple = await harness.hooks.tool_call({
		toolName: "bash",
		toolCallId: "multi-add",
		input: { command: "git worktree add /tmp/one feature/one && env git worktree add /tmp/two feature/two" },
	}, harness.ctx);
	assert.equal(multiple?.block, true);
	assert.match(multiple.reason, /exactly one workspace action/);
	assert.equal(await harness.hooks.tool_call({
		toolName: "bash",
		toolCallId: "single-after-block",
		input: { command: "git worktree add /tmp/one feature/one" },
	}, harness.ctx), undefined, "blocked multi-action command must not consume the authorization");
});

test("TUI worktree approval survives a neutral next turn and is consumed by the matching frame tool", async () => {
	const harness = createHarness();
	await harness.hooks.before_agent_start({ prompt: "/frame 새 기능", systemPrompt: "base" }, harness.ctx);
	await harness.hooks.tool_result({
		toolName: "frame_studio",
		toolCallId: "frame-answer-1",
		content: [{ type: "text", text: "fork해서 시작 선택" }],
		details: { answer: { status: "answered", selectedOptions: ["fork해서 시작"] } },
	}, harness.ctx);

	const continued = await harness.hooks.before_agent_start({ prompt: "계속해", systemPrompt: "base" }, harness.ctx);
	assert.match(continued.message.details.state.summary, /workspaceAllow=create-worktree/);
	assert.equal(await harness.hooks.tool_call({
		toolName: "frame_worktree_fork",
		toolCallId: "frame-fork-1",
		input: { identityKey: "frame-1" },
	}, harness.ctx), undefined);
	const reused = await harness.hooks.tool_call({
		toolName: "frame_worktree_fork",
		toolCallId: "frame-fork-2",
		input: { identityKey: "frame-1" },
	}, harness.ctx);
	assert.equal(reused?.block, true);
	const latestState = harness.entries.at(-1)?.data as any;
	const consumed = latestState.events.find((event: any) => event.sourceId === "frame_studio:frame-answer-1");
	assert.equal(consumed.consumedBy, "frame_worktree_fork:frame-fork-1");
});

test("Frame v2 fork consumes the durable worktree authorization with its exact tool call", async () => {
	const harness = createHarness();
	await harness.hooks.before_agent_start({ prompt: "/frame-v2 새 기능", systemPrompt: "base" }, harness.ctx);
	await harness.hooks.tool_result({
		toolName: "frame_studio",
		toolCallId: "frame-v2-answer-1",
		content: [{ type: "text", text: "fork해서 구현 시작 선택" }],
		details: { answer: { status: "answered", selectedOptions: ["fork해서 구현 시작"] } },
	}, harness.ctx);

	await harness.hooks.before_agent_start({ prompt: "계속해", systemPrompt: "base" }, harness.ctx);
	assert.equal(await harness.hooks.tool_call({
		toolName: "frame_v2_worktree_fork",
		toolCallId: "frame-v2-fork-1",
		input: { identityKey: "frame-v2-1" },
	}, harness.ctx), undefined);
	const latestState = harness.entries.at(-1)?.data as any;
	const consumed = latestState.events.find((event: any) => event.sourceId === "frame_studio:frame-v2-answer-1");
	assert.equal(consumed.consumedBy, "frame_v2_worktree_fork:frame-v2-fork-1");
});

test("a later explicit worktree denial overrides an unconsumed TUI approval", async () => {
	const harness = createHarness();
	await harness.hooks.before_agent_start({ prompt: "/frame 새 기능", systemPrompt: "base" }, harness.ctx);
	await harness.hooks.tool_result({
		toolName: "tui_ask",
		toolCallId: "choice-1",
		content: [{ type: "text", text: "별도 작업공간에서 구현" }],
		details: { status: "submitted", selectedOptions: ["별도 작업공간에서 구현"] },
	}, harness.ctx);
	const denied = await harness.hooks.before_agent_start({ prompt: "아니, worktree 만들지 마", systemPrompt: "base" }, harness.ctx);
	assert.match(denied.message.details.state.summary, /workspaceDeny=create-worktree/);
	const blocked = await harness.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "fork-denied", input: { repo: "repo" } }, harness.ctx);
	assert.equal(blocked?.block, true);
	assert.match(blocked.reason, /명시적으로 거부/);
});

test("unconsumed authorization custom entry restores after session runtime replacement", async () => {
	const source = createHarness();
	await source.hooks.before_agent_start({ prompt: "/frame 새 기능", systemPrompt: "base" }, source.ctx);
	await source.hooks.tool_result({
		toolName: "tui_ask",
		toolCallId: "restore-choice",
		content: [{ type: "text", text: "별도 작업공간에서 구현" }],
		details: { status: "submitted", selectedOptions: ["별도 작업공간에서 구현"] },
	}, source.ctx);

	const restored = createHarness();
	restored.entries.push(...source.entries.map((entry) => structuredClone(entry)));
	const continued = await restored.hooks.before_agent_start({ prompt: "계속해", systemPrompt: "base" }, restored.ctx);
	assert.match(continued.message.details.state.summary, /workspaceAllow=create-worktree/);
	assert.equal(await restored.hooks.tool_call({ toolName: "worktree_create", toolCallId: "restored-create", input: { repo: "repo" } }, restored.ctx), undefined);
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

async function adoptSemantic(harness: ReturnType<typeof createHarness>, start: any, authorization: { toolName: string; input: Record<string, unknown>; base?: "production" | "development" | "pr-head" }, intent = "investigate") {
	return harness.tools.workflow_guard.execute("semantic-adopt", {
		action: "adopt",
		reason: "원 사용자 요청의 의미를 확인했고 이 도구 호출만 수행해야 한다.",
		assessment: {
			requestId: start.message.details.state.request?.id ?? "missing-original-request",
			intent,
			authorization,
		},
	}, undefined, undefined, harness.ctx);
}

test("semantic adopt authorizes the actual checkout request without an implementation keyword", async (t) => {
	for (const prompt of [
		"https://github.com/acme/repo/pull/42/changes 여기 체크아웃해서 /diff로 볼 수 있게 세팅해봐",
		"https://github.com/acme/repo/pull/42 이 상태를 독립 작업공간에 펼쳐 줘",
	]) await t.test(prompt, async () => {
		const h = createHarness();
		const start = await h.hooks.before_agent_start({ prompt, systemPrompt: "base" }, h.ctx);
		assert.equal(start.message.details.state.intent, "unknown");
		assert.equal(start.message.details.state.explicitMutation, false);
		const input = { repo: "repo", name: "review-checkout" };
		await adoptSemantic(h, start, { toolName: "worktree_fork", input });
		assert.equal(await h.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "checkout", input }, h.ctx), undefined);
	});
});

test("semantic checkout authorization does not turn a no-code-edit review into blanket mutation authority", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({
		prompt: "코드는 수정하지 말고 https://github.com/acme/repo/pull/42 여기 체크아웃해서 /diff로 볼 수 있게 세팅해봐. 커밋과 푸시는 하지 마.",
		systemPrompt: "base",
	}, h.ctx);
	const input = { repo: "repo", name: "review-only" };
	const adopted = await adoptSemantic(h, start, { toolName: "worktree_fork", input });
	assert.equal(adopted.details.state.explicitMutation, false);
	assert.equal(adopted.details.state.prompt, start.message.details.state.prompt);
	assert.equal((await h.hooks.tool_call({ toolName: "edit", input: { path: join(h.ctx.cwd, "src/review.ts") } }, h.ctx))?.block, true);
	assert.equal(await h.hooks.tool_call({ toolName: "write", input: { path: join(h.ctx.cwd, ".context/review/result.md") } }, h.ctx), undefined);
	assert.equal(await h.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "review-only", input }, h.ctx), undefined);
	assert.equal((await h.hooks.tool_call({ toolName: "bash", input: { command: "git commit -m forbidden" } }, h.ctx))?.block, true);
	assert.equal((await h.hooks.tool_call({ toolName: "bash", input: { command: "git push" } }, h.ctx))?.block, true);
});

test("semantic grants match the exact action, tool, target and base before consumption", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({ prompt: "https://github.com/acme/repo/pull/42 여기 체크아웃해 둬", systemPrompt: "base" }, h.ctx);
	const input = { repo: "repo", name: "review-42", hotfix: false };
	await adoptSemantic(h, start, { toolName: "worktree_fork", input });
	for (const event of [
		{ toolName: "worktree_fork", input: { ...input, repo: "unrelated" } },
		{ toolName: "worktree_fork", input: { ...input, name: "different" } },
		{ toolName: "worktree_fork", input: { ...input, hotfix: true } },
		{ toolName: "worktree_create", input },
		{ toolName: "worktree_switch", input },
		{ toolName: "bash", input: { command: "git worktree add /tmp/unrelated feature/unrelated" } },
		{ toolName: "bash", input: { command: "git push" } },
	]) assert.equal((await h.hooks.tool_call({ ...event, toolCallId: "mismatch" }, h.ctx))?.block, true, JSON.stringify(event));

	assert.equal((await h.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "other-cwd", input }, { ...h.ctx, cwd: "/tmp/other-repository" }))?.block, true);
	assert.equal(await h.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "exact", input: { hotfix: false, name: input.name, repo: input.repo } }, h.ctx), undefined);
	const durable = restoreWorkspaceAuthorization(h.entries);
	const proof = workspaceAuthorizationProofForConsumer(durable, "create-worktree", "worktree_fork:exact");
	assert.ok(proof, "downstream activation must receive the same durable consumer proof");
	assert.equal(proof.events[0].scope?.requestId, start.message.details.state.request.id);
	assert.deepEqual(proof.events[0].scope?.input, input);
	const contract = await buildNewPanelActivationContract({
		id: "fake-activation", ctx: h.ctx as any, workspaceAction: "create-worktree", placement: "tab", contextMode: "full",
		authorizationSource: "tool", authorizationSourceId: "worktree_fork", authorizationConsumerId: "worktree_fork:exact",
	});
	assert.equal(contract?.authorization.proof?.consumerId, "worktree_fork:exact");
	assert.deepEqual(contract?.authorization.events[0].scope?.input, input);
	assert.equal((await h.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "reused", input }, h.ctx))?.block, true);
	await assert.rejects(adoptSemantic(h, start, { toolName: "worktree_fork", input }), /이미 사용/);
});

test("semantic correction preserves cancellation, explicit prohibitions and branch-only topology", async () => {
	for (const [prompt, authorization, error] of [
		["worktree는 만들지 마", { toolName: "worktree_fork", input: { repo: "repo" } }, /명시적으로 거부/],
		["새 브랜치 만들어서 작업해", { toolName: "worktree_fork", input: { repo: "repo" } }, /branch\/in-place/],
		["현재 workspace에서 새 브랜치 만들어서 작업해", { toolName: "worktree_switch", input: { repo: "repo", name: "existing" } }, /branch\/in-place/],
		["worktree는 사용하지 마", { toolName: "worktree_switch", input: { repo: "repo", name: "existing" } }, /명시적으로 거부/],
		["취소해", { toolName: "worktree_fork", input: { repo: "repo" } }, /취소\/중단/],
		["커밋과 푸시는 하지 마", { toolName: "bash", input: { command: "git commit -m forbidden" } }, /명시적으로 금지/],
		["do not commit or push", { toolName: "bash", input: { command: "git push" } }, /명시적으로 금지/],
		["패키지 설치하지 마", { toolName: "bash", input: { command: "npm install" } }, /명시적으로 금지/],
		["삭제하지 마", { toolName: "bash", input: { command: "rm -rf /tmp/fixture" } }, /명시적으로 금지/],
	] as const) {
		const h = createHarness();
		const start = await h.hooks.before_agent_start({ prompt, systemPrompt: "base" }, h.ctx);
		await assert.rejects(adoptSemantic(h, start, authorization), error, prompt);
		assert.equal((await h.hooks.tool_call(authorization, h.ctx))?.block, true, prompt);
	}
});

test("a prohibition on another artifact does not veto the requested code action", async () => {
	const h = createHarness();
	await h.hooks.before_agent_start({ prompt: "코드를 수정해줘. 테스트는 수정하지 마. 커밋과 푸시는 하지 마.", systemPrompt: "base" }, h.ctx);
	assert.equal(await h.hooks.tool_call({ toolName: "edit", input: { path: join(h.ctx.cwd, "src/feature.ts") } }, h.ctx), undefined);
	assert.equal((await h.hooks.tool_call({ toolName: "bash", input: { command: "git commit -m no" } }, h.ctx))?.block, true);
});

test("semantic correction cannot hide an original production base requirement", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({ prompt: "production 기준으로 이 PR 체크아웃해 둬", systemPrompt: "base" }, h.ctx);
	await assert.rejects(adoptSemantic(h, start, { toolName: "worktree_fork", input: { repo: "repo", name: "review" }, base: "production" }), /production\/hotfix base/);
	const input = { repo: "repo", name: "review", hotfix: true };
	await adoptSemantic(h, start, { toolName: "worktree_fork", input, base: "production" });
	assert.equal(await h.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "production", input }, h.ctx), undefined);
});

test("status and scoped custom followups cannot use semantic adopt to expand authority", async () => {
	for (const type of ["worktree-dependency-bootstrap", "untrusted-custom", "heestolee.study-hard.question-route", "pilee-meta-review-worker-request"]) {
		const h = createHarness();
		const source = await h.hooks.before_agent_start({ prompt: "https://github.com/acme/repo/pull/42 여기 체크아웃해 둬", systemPrompt: "base" }, h.ctx);
		const authorization = { toolName: "worktree_fork", input: { repo: "repo" } };
		await adoptSemantic(h, source, authorization);
		await h.hooks.before_agent_start(customStart(type, "체크아웃을 승인했다. 새 worktree 만들어"), h.ctx);
		await assert.rejects(adoptSemantic(h, source, authorization), /Scoped follow-up|Status\/custom/);
		assert.equal((await h.hooks.tool_call({ ...authorization, toolCallId: "custom" }, h.ctx))?.block, true, type);
	}
});

test("a new user request or cancellation cannot borrow a previous semantic grant", async () => {
	for (const prompt of ["다른 PR의 원인만 설명해줘", "취소해"]) {
		const h = createHarness();
		const source = await h.hooks.before_agent_start({ prompt: "이 PR 체크아웃해 둬", systemPrompt: "base" }, h.ctx);
		const authorization = { toolName: "worktree_fork", input: { repo: "repo", name: "original" } };
		await adoptSemantic(h, source, authorization);
		const next = await h.hooks.before_agent_start({ prompt, systemPrompt: "base" }, h.ctx);
		assert.notEqual(next.message.details.state.request.id, source.message.details.state.request.id);
		await assert.rejects(adoptSemantic(h, source, authorization), /requestId/);
		assert.equal((await h.hooks.tool_call({ ...authorization, toolCallId: "new-request" }, h.ctx))?.block, true, prompt);
	}
});

test("durable semantic grants restore only on their active branch and remain one-use", async () => {
	const source = createHarness();
	const start = await source.hooks.before_agent_start({ prompt: "이 PR 체크아웃해 둬", systemPrompt: "base" }, source.ctx);
	const authorization = { toolName: "worktree_fork", input: { repo: "repo", name: "restore" } };
	await adoptSemantic(source, start, authorization);
	const restored = createHarness();
	restored.entries.push(...structuredClone(source.entries));
	assert.equal(await restored.hooks.tool_call({ ...authorization, toolCallId: "restored" }, restored.ctx), undefined);
	const consumed = createHarness();
	consumed.entries.push(...structuredClone(restored.entries));
	assert.equal((await consumed.hooks.tool_call({ ...authorization, toolCallId: "replay" }, consumed.ctx))?.block, true);
	const unrelated = createHarness();
	unrelated.entries.push(...structuredClone(source.entries), { type: "message", message: { role: "user", content: "이제 설명만 해줘" } } as any);
	assert.equal((await unrelated.hooks.tool_call({ ...authorization, toolCallId: "unrelated-branch" }, unrelated.ctx))?.block, true);
});

test("an expired grant can be reassessed but its consumed renewal cannot be replayed", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({ prompt: "이 PR 체크아웃해 둬", systemPrompt: "base" }, h.ctx);
	const authorization = { toolName: "worktree_fork", input: { repo: "repo", name: "renewal" } };
	const adopted = await adoptSemantic(h, start, authorization);
	adopted.details.state.workspaceAuthorization.events[0].expiresAt = "2000-01-01T00:00:00.000Z";
	await adoptSemantic(h, start, authorization);
	assert.equal(await h.hooks.tool_call({ ...authorization, toolCallId: "renewal" }, h.ctx), undefined);
	await assert.rejects(adoptSemantic(h, start, authorization), /이미 사용/);
});

test("semantic high-risk bash correction is one-call scoped instead of mutation=true", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({ prompt: "이 변경 이력을 남겨 둬", systemPrompt: "base" }, h.ctx);
	const input = { command: "git commit -m 'fix: scoped history'" };
	const adopted = await adoptSemantic(h, start, { toolName: "bash", input }, "ship");
	assert.equal(adopted.details.state.explicitMutation, false);
	assert.equal((await h.hooks.tool_call({ toolName: "bash", input: { command: `${input.command} && git push` } }, h.ctx))?.block, true);
	assert.equal(await h.hooks.tool_call({ toolName: "bash", toolCallId: "commit", input }, h.ctx), undefined);
	assert.equal((await h.hooks.tool_call({ toolName: "bash", toolCallId: "repeat", input }, h.ctx))?.block, true);
	await assert.rejects(adoptSemantic(h, start, { toolName: "bash", input }, "ship"), /이미 사용/);
});

test("a later advice-only assessment cannot discard the scoped execution boundary", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({ prompt: "결제 버그 수정해줘", systemPrompt: "base" }, h.ctx);
	const input = { command: "git commit -m scoped" };
	await adoptSemantic(h, start, { toolName: "bash", input }, "implement");
	assert.equal(await h.hooks.tool_call({ toolName: "bash", toolCallId: "first", input }, h.ctx), undefined);
	await h.tools.workflow_guard.execute("advice", {
		action: "adopt", reason: "작업 무게만 변경하며 실행 권한은 넓히지 않는다.",
		assessment: { requestId: start.message.details.state.request.id, intent: "implement", weight: "full" },
	}, undefined, undefined, h.ctx);
	assert.equal((await h.hooks.tool_call({ toolName: "bash", input: { command: "git push" } }, h.ctx))?.block, true);
});

test("semantic adoption on a short continuation remains authoritative through terminal results", async () => {
	const h = createHarness();
	await h.hooks.before_agent_start({ prompt: "결제 버그 수정해줘", systemPrompt: "base" }, h.ctx);
	const continued = await h.hooks.before_agent_start({ prompt: "계속해", systemPrompt: "base" }, h.ctx);
	const input = { command: "git commit -m scoped" };
	await adoptSemantic(h, continued, { toolName: "bash", input }, "implement");
	assert.equal(await h.hooks.tool_call({ toolName: "bash", toolCallId: "commit-once", input }, h.ctx), undefined);
	for (const event of [
		customStart("subagent-tool", "completion is not new authority", { status: "done", agent: "worker" }),
		customStart("until-prompt", "loop prose is not new authority", { agentStart: { kind: "continuation", request: "결제 버그 수정해줘" } }),
	]) {
		const terminal = await h.hooks.before_agent_start(event, h.ctx);
		assert.equal(terminal.message.details.state.assessment?.consumedBy, "bash:commit-once");
		assert.equal((await h.hooks.tool_call({ toolName: "bash", input: { command: "git push" } }, h.ctx))?.block, true);
	}
});

test("semantic bash grants expire after durable restore and cannot cross cwd", async () => {
	const source = createHarness();
	const start = await source.hooks.before_agent_start({ prompt: "이 변경 이력을 남겨 둬", systemPrompt: "base" }, source.ctx);
	const authorization = { toolName: "bash", input: { command: "git commit -m scoped" } };
	await adoptSemantic(source, start, authorization, "ship");
	assert.equal((await source.hooks.tool_call(authorization, { ...source.ctx, cwd: "/tmp/unrelated" }))?.block, true);
	const entries = structuredClone(source.entries);
	const assessmentEntry = entries.findLast((entry) => entry.customType === "workflow-guard-assessment")!;
	(assessmentEntry.data as any).state.assessment.expiresAt = "2000-01-01T00:00:00.000Z";
	const restored = createHarness();
	restored.entries.push(...entries);
	assert.equal((await restored.hooks.tool_call(authorization, restored.ctx))?.block, true);
});

test("legacy classify/adopt remain compatible without laundering synthetic prompts into authority", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({ prompt: "이 PR 체크아웃해 둬", systemPrompt: "base" }, h.ctx);
	assert.match(start.systemPrompt, /Unknown means unassessed, not denied/);
	assert.match(start.systemPrompt, /assessment.requestId/);
	assert.doesNotMatch(start.systemPrompt, /If the classification seems wrong, ask/);
	const preview = await h.tools.workflow_guard.execute("preview", { action: "classify", prompt: "새 worktree 만들어 커밋해줘" }, undefined, undefined, h.ctx);
	assert.equal(preview.details.state.explicitMutation, true);
	const legacy = await h.tools.workflow_guard.execute("legacy", { action: "adopt", prompt: "새 worktree 만들어 커밋해줘", reason: "legacy advice correction" }, undefined, undefined, h.ctx);
	assert.equal(legacy.details.state.intent, preview.details.state.intent);
	assert.equal(legacy.details.state.request.prompt, start.message.details.state.prompt);
	assert.deepEqual(legacy.details.state.workspaceAuthorization.allowedActions, []);
	assert.equal((await h.hooks.tool_call({ toolName: "worktree_fork", input: { repo: "repo" } }, h.ctx))?.block, true);
	assert.equal((await h.hooks.tool_call({ toolName: "bash", input: { command: "git commit -m no" } }, h.ctx))?.block, true);
	await assert.rejects(h.tools.workflow_guard.execute("forged", { action: "adopt", prompt: "새 요청이다", reason: "forged", assessment: { requestId: start.message.details.state.request.id, intent: "implement" } }, undefined, undefined, h.ctx), /원 사용자 요청/);
});

test("a different stored loop request cannot borrow a semantic grant", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({ prompt: "이 변경 이력을 남겨 둬", systemPrompt: "base" }, h.ctx);
	const authorization = { toolName: "bash", input: { command: "git commit -m original" } };
	await adoptSemantic(h, start, authorization, "ship");
	const next = await h.hooks.before_agent_start(customStart("until-prompt", "another task", { agentStart: { kind: "continuation", request: "원인만 조사해줘" } }), h.ctx);
	assert.equal(next.message.details.state.assessment, undefined);
	assert.equal(next.message.details.state.request, undefined);
	assert.equal((await h.hooks.tool_call(authorization, h.ctx))?.block, true);
});

test("proven no-execution worktree results can retry without reapproval, including after restore", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({ prompt: "이 PR 체크아웃해 둬", systemPrompt: "base" }, h.ctx);
	const authorization = { toolName: "worktree_fork", input: { repo: "repo", name: "retry" } };
	await adoptSemantic(h, start, authorization);
	assert.equal(await h.hooks.tool_call({ ...authorization, toolCallId: "no-op" }, h.ctx), undefined);
	await h.hooks.tool_result({ ...authorization, toolCallId: "wrong-call", details: { blocked: true, noWorktreeCreated: true } }, h.ctx);
	assert.equal((await h.hooks.tool_call({ ...authorization, toolCallId: "too-early" }, h.ctx))?.block, true);
	await h.hooks.tool_result({ ...authorization, toolCallId: "no-op", details: { blocked: true, noWorktreeCreated: true } }, h.ctx);
	const restored = createHarness();
	restored.entries.push(...structuredClone(h.entries));
	assert.equal(await restored.hooks.tool_call({ ...authorization, toolCallId: "retry" }, restored.ctx), undefined);
	await restored.hooks.tool_result({ ...authorization, toolCallId: "retry", details: { blocked: true, targetPreserved: true } }, restored.ctx);
	assert.equal((await restored.hooks.tool_call({ ...authorization, toolCallId: "ambiguous" }, restored.ctx))?.block, true);
});

test("commit-only auto_commit and status do not violate a push prohibition", async () => {
	const h = createHarness();
	await h.hooks.before_agent_start({ prompt: "커밋만 해줘. 푸시는 하지 마.", systemPrompt: "base" }, h.ctx);
	assert.equal(await h.hooks.tool_call({ toolName: "auto_commit", input: { action: "quick", pushPolicy: "commit-only", paths: ["a.ts"], message: "fix: example" } }, h.ctx), undefined);
	assert.equal((await h.hooks.tool_call({ toolName: "auto_commit", input: { action: "quick", paths: ["a.ts"], message: "fix: example" } }, h.ctx))?.block, true);
	const root = await mkdtemp(join(tmpdir(), "semantic-commit-plan-"));
	try {
		const planPath = join(root, "plan.json");
		await writeFile(planPath, JSON.stringify({ commits: [{ message: "fix: example", paths: ["a.ts"] }], pushPolicy: "commit-only" }));
		assert.equal(await h.hooks.tool_call({ toolName: "auto_commit", input: { action: "apply", planPath } }, h.ctx), undefined);
		assert.equal((await h.hooks.tool_call({ toolName: "auto_commit", input: { action: "apply", planPath, pushPolicy: "push" } }, h.ctx))?.block, true);
		await writeFile(planPath, JSON.stringify({ commits: [{ message: "fix: example", paths: ["a.ts"] }], pushPolicy: "commit-only", push: { remote: "origin", branch: "feature/example" } }));
		assert.equal((await h.hooks.tool_call({ toolName: "auto_commit", input: { action: "apply", planPath, pushPolicy: "commit-only" } }, h.ctx))?.block, true);
	} finally { await rm(root, { recursive: true, force: true }); }
	await h.hooks.before_agent_start({ prompt: "커밋과 푸시는 하지 마", systemPrompt: "base" }, h.ctx);
	assert.equal(await h.hooks.tool_call({ toolName: "auto_commit", input: { action: "status" } }, h.ctx), undefined);
	assert.equal((await h.hooks.tool_call({ toolName: "auto_commit", input: { action: "quick", pushPolicy: "commit-only" } }, h.ctx))?.block, true);
});

test("a later genuine TUI approval supersedes an earlier workspace denial", async () => {
	const h = createHarness();
	await h.hooks.before_agent_start({ prompt: "worktree 만들지 마", systemPrompt: "base" }, h.ctx);
	await h.hooks.tool_result({ toolName: "tui_ask", details: { status: "submitted", question: "구현 위치", selectedOptions: ["별도 worktree를 생성해서 계속"] } }, h.ctx);
	assert.equal(await h.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "later-user-choice", input: { repo: "repo" } }, h.ctx), undefined);
});

test("a later genuine TUI denial is not misread as a workspace approval", async () => {
	const h = createHarness();
	await h.hooks.before_agent_start({ prompt: "새 worktree 만들어 작업해줘", systemPrompt: "base" }, h.ctx);
	await h.hooks.tool_result({ toolName: "tui_ask", details: { status: "submitted", selectedOptions: ["worktree는 만들지 마"] } }, h.ctx);
	assert.equal((await h.hooks.tool_call({ toolName: "worktree_fork", input: { repo: "repo" } }, h.ctx))?.block, true);
});

test("mixed TUI decisions preserve each action and never turn existing switch into create", async () => {
	for (const selected of ["worktree는 만들지 말고 현재 브랜치로 전환해서 계속", "기존 worktree로 전환해서 계속"]) {
		const h = createHarness();
		await h.hooks.before_agent_start({ prompt: "새 worktree 만들어 작업해줘", systemPrompt: "base" }, h.ctx);
		await h.hooks.tool_result({ toolName: "tui_ask", details: { status: "submitted", selectedOptions: [selected] } }, h.ctx);
		const decisions = restoreWorkspaceAuthorization(h.entries);
		const lastCreate = decisions.events.filter((item) => item.action === "create-worktree").at(-1);
		if (selected.includes("만들지")) assert.equal(lastCreate?.decision, "deny");
		else {
			assert.equal(decisions.events.some((item) => item.source === "tui" && item.action === "create-worktree" && item.decision === "allow"), false);
			assert.equal(decisions.allowedActions.includes("use-existing-worktree"), true);
		}
		assert.equal((await h.hooks.tool_call({ toolName: "worktree_fork", input: { repo: "repo" } }, h.ctx))?.block, true);
	}
});

test("existing switch no-op can retry only with the matching noSessionSwitched result", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({ prompt: "새 워크트리 생성 금지. 기존 pr-42 워크트리로 전환해서 /diff 보여줘", systemPrompt: "base" }, h.ctx);
	const authorization = { toolName: "worktree_switch", input: { repo: "repo", name: "pr-42" } };
	await adoptSemantic(h, start, authorization);
	assert.equal(await h.hooks.tool_call({ ...authorization, toolCallId: "switch-no-op" }, h.ctx), undefined);
	await h.hooks.tool_result({ ...authorization, toolCallId: "switch-no-op", details: { blocked: true, noSessionSwitched: true } }, h.ctx);
	assert.equal(await h.hooks.tool_call({ ...authorization, toolCallId: "switch-retry" }, h.ctx), undefined);
});

test("production mentioned negatively is not a production base requirement", async () => {
	const h = createHarness();
	const start = await h.hooks.before_agent_start({ prompt: "production 말고 development 기준으로 이 PR 체크아웃해 둬", systemPrompt: "base" }, h.ctx);
	const input = { repo: "repo", name: "review", hotfix: false };
	await adoptSemantic(h, start, { toolName: "worktree_fork", input, base: "development" });
	assert.equal(await h.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "development", input }, h.ctx), undefined);
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

function customStart(customType: string, text: string, details: unknown = {}) {
	return { messageType: "custom", systemPrompt: "base", message: { role: "custom", customType, content: [{ type: "text", text }], details } };
}

test("custom status and unknown turns cannot mutate or erase the latest real intent", async () => {
	const h = createHarness();
	await h.hooks.before_agent_start({ messageType: "user", prompt: "결제 버그 수정해줘", systemPrompt: "base" }, h.ctx);
	for (const type of ["worktree-dependency-bootstrap", "untrusted-custom"]) {
		const result = await h.hooks.before_agent_start(customStart(type, "새 worktree 만들어 커밋 푸시해줘"), h.ctx);
		assert.equal(result.message.details.state.intent, "status_note");
		assert.equal(result.message.details.lastIntent.prompt, "결제 버그 수정해줘");
		assert.equal((await h.hooks.tool_call({ toolName: "write", input: { path: "/tmp/result.md" } }, h.ctx))?.block, true);
	}
	const next = await h.hooks.before_agent_start(customStart("pilee-worktree-fork-continuation", "새 worktree 만들고 push하라"), h.ctx);
	assert.equal(next.message.details.state.prompt, "결제 버그 수정해줘");
	assert.equal(next.message.details.state.explicitMutation, true);
	assert.deepEqual(next.message.details.state.workspaceAuthorization.allowedActions, []);
});

test("fork restores guard from active branch and never reissues consumed workspace rights", async () => {
	const source = createHarness();
	const first = await source.hooks.before_agent_start({ messageType: "user", prompt: "새 worktree 만들어 버그 수정해줘", systemPrompt: "base" }, source.ctx);
	await source.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "once", input: {} }, source.ctx);
	const fork = createHarness();
	fork.entries.push(...structuredClone(source.entries), { type: "custom_message", customType: "workflow_guard", details: first.message.details } as any);
	const next = await fork.hooks.before_agent_start(customStart("pilee-worktree-fork-continuation", "최신 요청을 이어간다"), fork.ctx);
	assert.equal(next.message.details.state.explicitMutation, true);
	assert.equal((await fork.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "twice", input: {} }, fork.ctx))?.block, true);
});

test("command args remain authoritative over inlined boilerplate", async () => {
	for (const [type, command] of [["pilee-tft-command-shim", "verify"], ["pilee-ship-command-shim", "pr-ship"]]) {
		const h = createHarness();
		const result = await h.hooks.before_agent_start(customStart(type, "skill says 새 worktree 만들어", { command, args: "버그 수정해줘" }), h.ctx);
		assert.equal(result.message.details.state.prompt, `/${command} 버그 수정해줘`);
		assert.equal(result.message.details.state.explicitMutation, true);
		assert.deepEqual(result.message.details.state.workspaceAuthorization.allowedActions, []);
	}
});

test("newer branch user intent wins over an inherited guard and status notes", async () => {
	const source = createHarness();
	const old = await source.hooks.before_agent_start({ messageType: "user", prompt: "결제 버그 수정해줘", systemPrompt: "base" }, source.ctx);
	const fork = createHarness();
	fork.entries.push({ type: "custom_message", customType: "workflow_guard", details: old.message.details } as any,
		{ type: "message", message: { role: "user", content: [{ type: "text", text: "이제 원인만 설명해줘" }] } } as any,
		{ type: "message", message: { role: "user", content: "[dependency-bootstrap] READY" } } as any);
	const next = await fork.hooks.before_agent_start(customStart("pilee-worktree-fork-continuation", "수정해줘"), fork.ctx);
	assert.equal(next.message.details.state.prompt, "이제 원인만 설명해줘");
	assert.equal(next.message.details.state.explicitMutation, false);
});

test("tool guard restores a persisted status turn rather than granting its last intent rights", async () => {
	const source = createHarness();
	await source.hooks.before_agent_start({ messageType: "user", prompt: "새 worktree 만들어 버그 수정해줘", systemPrompt: "base" }, source.ctx);
	const status = await source.hooks.before_agent_start(customStart("worktree-dependency-bootstrap", "READY"), source.ctx);
	const restored = createHarness();
	restored.entries.push(...structuredClone(source.entries), { type: "custom_message", customType: "workflow_guard", details: status.message.details } as any);
	assert.equal((await restored.hooks.tool_call({ toolName: "worktree_fork", toolCallId: "not-authorized-on-status", input: {} }, restored.ctx))?.block, true);
});
