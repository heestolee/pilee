import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import tasksExtension from "../tasks/index.ts";
import { gateWorkContext, refreshWorkContext } from "../utils/work-context.ts";

function fixture(t: { after: (fn: () => void) => void }) {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pilee-decision-sync-")));
	execFileSync("git", ["init", "--quiet"], { cwd });
	mkdirSync(join(cwd, ".pi"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const frame = {
		goal: "구현 중 결정 동기화",
		decision_queue: [
			{ id: "DEC-1", taskId: "1", title: "저장 방식", riskRef: "RISK-1" },
			{ id: "DEC-2", taskId: "2", title: "공개 범위" },
		],
		decisions: [] as Array<{ id: string; taskId?: string; selected?: string; decidedAt?: number }>,
		risk_register: [{ id: "RISK-1", risk: "저장 비용", needs_decision: true }],
		implementation_plan: { slices: [
			{ id: "STORE", goal: "저장 구현", blockedBy: ["DEC-1"], expectedFiles: ["src/store.ts"] },
			{ id: "SHARED", goal: "공개 저장 구현", blockedBy: ["DEC-1", "2"] },
			{ id: "READY", goal: "독립 구현", blockedBy: [] },
		] },
	};
	const saveFrame = () => writeFileSync(join(cwd, ".pi", "frame.json"), JSON.stringify(frame));
	saveFrame();
	return { cwd, frame, saveFrame };
}

test("pending 결정을 갱신하면 해당 slice만 보류한다", (t) => {
	// given: 기존 수동 질문과 legacy taskId가 있는 카드에 새 결정이 추가됐다.
	const { cwd, frame, saveFrame } = fixture(t);
	refreshWorkContext(cwd, undefined, { openQuestions: [
		{ id: "1", owner: "user", text: "이전 질문", blocks: ["READY"] },
		{ id: "OPS", owner: "external", text: "실행 권한 대기", blocks: ["SHARED"] },
	] });
	// 선택이나 답변 없이 제안만 적힌 기록은 해제 근거가 아니다.
	frame.decisions.push({ id: "DEC-1" });
	saveFrame();

	// when
	const card = refreshWorkContext(cwd);

	// then
	assert.deepEqual(card.openQuestions.map((q) => q.id), ["DEC-1", "DEC-2", "OPS"]);
	assert.deepEqual(card.openQuestions[0].blocks, ["STORE", "SHARED"]);
	assert.deepEqual(card.openQuestions[1].blocks, ["SHARED"]);
	assert.equal(gateWorkContext({ ...card, currentSlice: card.slices[0] }).level, "block");
	assert.equal(gateWorkContext({ ...card, currentSlice: card.slices[2] }).level, "pass");
	assert.deepEqual(refreshWorkContext(cwd).openQuestions, card.openQuestions, "미응답 상태에서 refresh는 결정을 해결하지 않는다");
	assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".pi", "frame.json"), "utf8")).decision_queue, frame.decision_queue);
});

test("명시 선택이 canonical과 Task에 기록되면 해당 의존성만 해제한다", async (t) => {
	// given: 사용자 답변 해석/Frame 저장은 에이전트의 책임이며 여기서는 저장 이후 경계를 검증한다.
	const { cwd, frame, saveFrame } = fixture(t);
	const previousLabel = process.env.PI_FORK_PANEL_LABEL;
	process.env.PI_FORK_PANEL_LABEL = "P0";
	t.after(() => {
		if (previousLabel === undefined) delete process.env.PI_FORK_PANEL_LABEL;
		else process.env.PI_FORK_PANEL_LABEL = previousLabel;
	});
	const before = refreshWorkContext(cwd);
	refreshWorkContext(cwd, undefined, { openQuestions: [...before.openQuestions,
		{ id: "OPS", owner: "external", text: "실행 권한 대기", blocks: ["SHARED"] },
	] });
	writeFileSync(join(cwd, ".pi", "work-tasks.json"), JSON.stringify({ nextId: 5, tasks: [
		{ id: "1", subject: "저장 방식", status: "pending", kind: "decision", blocks: ["4"], blockedBy: [], metadata: {} },
		{ id: "2", subject: "공개 범위", status: "pending", kind: "decision", blocks: ["4"], blockedBy: [], metadata: {} },
		{ id: "3", subject: "실행 권한", status: "pending", kind: "blocked", blocks: ["4"], blockedBy: [], metadata: {} },
		{ id: "4", subject: "공개 저장 구현", status: "pending", kind: "slice", blocks: [], blockedBy: ["1", "2", "3"], metadata: {} },
	] }));
	const tools = new Map<string, any>();
	tasksExtension({ registerTool(tool: any) { tools.set(tool.name, tool); }, registerCommand() {}, registerShortcut() {}, on() {} } as any);
	const ctx = { cwd, sessionManager: { getSessionFile: () => join(cwd, "session.jsonl") } };

	// when: 명시 답변 후 기존 저장/TaskUpdate/refresh 순서를 수행한다.
	frame.decisions.push({ id: "DEC-1", taskId: "1", selected: "기존 구조 재사용", decidedAt: 1 });
	frame.decision_queue = frame.decision_queue.filter((q) => q.id !== "DEC-1");
	frame.risk_register[0].needs_decision = false;
	frame.implementation_plan.slices.forEach((slice) => { slice.blockedBy = slice.blockedBy.filter((id) => id !== "DEC-1"); });
	saveFrame();
	await tools.get("TaskUpdate").execute("resolve", { taskId: "1", status: "completed", metadata: { decisionId: "DEC-1", selected: "기존 구조 재사용", decidedAt: 1 } }, undefined, undefined, ctx);
	const card = refreshWorkContext(cwd);
	const linkedTask = await tools.get("TaskGet").execute("get", { taskId: "4" }, undefined, undefined, ctx);

	// then
	assert.deepEqual(card.openQuestions.map((q) => q.id), ["DEC-2", "OPS"]);
	assert.equal(gateWorkContext({ ...card, currentSlice: card.slices[0] }).level, "pass");
	assert.equal(gateWorkContext({ ...card, currentSlice: card.slices[1] }).level, "block");
	assert.equal(gateWorkContext({ ...card, currentSlice: card.slices[2] }).level, "pass");
	assert.match(linkedTask.content[0].text, /Blocked by \(open\): 2, 3/);
	assert.deepEqual(linkedTask.details.task.blockedBy, ["1", "2", "3"], "다른 task blocker와 의존성 이력을 지우지 않는다");
	const stored = JSON.parse(readFileSync(join(cwd, ".pi", "work-context.json"), "utf8"));
	assert.deepEqual(stored.openQuestions, card.openQuestions);
});

test("기존 카드에 질문이 있어도 뒤에 추가된 결정의 차단 정보를 잃지 않는다", (t) => {
	// given
	const { cwd, frame, saveFrame } = fixture(t);
	refreshWorkContext(cwd);
	for (let n = 3; n <= 10; n++) frame.decision_queue.push({ id: `DEC-${n}`, taskId: String(n), title: `결정 ${n}` });
	frame.implementation_plan.slices[2].blockedBy = ["DEC-10"];
	saveFrame();

	// when
	const card = refreshWorkContext(cwd);

	// then
	assert.equal(card.openQuestions.length, 10);
	assert.match(gateWorkContext({ ...card, currentSlice: card.slices[2] }).reasons.join("\n"), /DEC-10/);
});

test("리스크에서 파생된 차단과 기존 수동 연결을 갱신 뒤에도 보존한다", (t) => {
	const { cwd, frame, saveFrame } = fixture(t);
	frame.decision_queue = [];
	frame.implementation_plan.slices[0].blockedBy = ["RISK-1"];
	saveFrame();
	refreshWorkContext(cwd, undefined, { openQuestions: [
		{ id: "RISK-1", owner: "user", text: "이전 리스크", blocks: ["SHARED"] },
	] });
	const card = refreshWorkContext(cwd);
	assert.deepEqual(new Set(card.openQuestions[0].blocks), new Set(["STORE", "SHARED"]));
	assert.equal(gateWorkContext({ ...card, currentSlice: card.slices[0] }).level, "block");
	assert.equal(gateWorkContext({ ...card, currentSlice: card.slices[1] }).level, "block");
	assert.equal(gateWorkContext({ ...card, currentSlice: card.slices[2] }).level, "pass");
});

test("pending 차단 중에도 결정 기록은 저장할 수 있지만 제품 변경은 계속 막는다", (t) => {
	const { cwd } = fixture(t);
	const card = refreshWorkContext(cwd);
	for (const path of [".pi/frame.json", ".pi/frame.json.tmp", ".pi/frame.md", ".pi/frame.md.tmp", ".pi/work-context.json", ".pi/work-tasks.json", ".pi/decisions/decision.md"]) {
		assert.equal(gateWorkContext(card, { action: "mutate", paths: [join(cwd, path)], requireSlice: true }).level, "pass", path);
	}
	for (const paths of [["src/store.ts"], [".pi/code.ts"], [".pi/frame.json", "src/store.ts"], []]) {
		assert.equal(gateWorkContext(card, { action: "mutate", paths, requireSlice: true }).level, "block");
	}
	assert.equal(gateWorkContext(card, { action: "commit", paths: [".pi/frame.json"] }).level, "block");
	assert.equal(gateWorkContext(card).level, "block");
	assert.deepEqual(refreshWorkContext(cwd).openQuestions, card.openQuestions, "기록 허용 자체가 결정을 해제하지 않는다");
});

test("실제 workflow guard도 pending 기록 저장과 답변 후 구현 재개를 허용한다", async (t) => {
	const { cwd, frame, saveFrame } = fixture(t);
	const previousHome = process.env.HOME;
	const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
	process.env.HOME = cwd;
	process.env.PI_CODING_AGENT_DIR = join(cwd, ".agent");
	t.after(() => {
		if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
	});
	const { createJiti } = await import("@mariozechner/jiti");
	const { default: guard } = await createJiti(import.meta.url, { moduleCache: false }).import<any>("../workflow-guard/index.ts");
	const hooks = new Map<string, any>();
	guard({
		on(name: string, callback: any) { hooks.set(name, callback); }, registerTool() {},
		getThinkingLevel: () => "high", setThinkingLevel() {}, appendEntry() {},
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	}, { trustedInternalPullRequestRepositories: [] });
	const ctx = { cwd, sessionManager: { getSessionFile: () => join(cwd, "session.jsonl"), getLeafId: () => "answer", getEntries: () => [], getBranch: () => [] } };
	await hooks.get("before_agent_start")({ prompt: "선택 A로 다중 파일 기능을 구현해줘", systemPrompt: "base" }, ctx);
	// Project-relative inputs exercise the gate rather than its absolute temporary-file exemption.
	const attempt = (toolName: string, path: string) => hooks.get("tool_call")({ toolName, input: { path } }, ctx);
	for (const toolName of ["edit", "write"]) {
		assert.equal((await attempt(toolName, "src/store.ts"))?.block, true);
		assert.equal((await attempt(toolName, ".pi/frame.json.tmp"))?.block, undefined);
		assert.equal((await attempt(toolName, ".pi/frame.json"))?.block, undefined);
	}
	frame.decisions.push({ id: "DEC-1", taskId: "1", selected: "기존 구조 재사용", decidedAt: 1 });
	frame.decision_queue = frame.decision_queue.filter((q) => q.id !== "DEC-1");
	frame.risk_register[0].needs_decision = false;
	saveFrame();
	assert.equal((await attempt("edit", "src/store.ts"))?.block, undefined);
	assert.deepEqual(refreshWorkContext(cwd).openQuestions.map((q) => q.id), ["DEC-2"]);
});

test("Frame 없는 카드의 수동 질문은 refresh로 삭제하지 않는다", (t) => {
	// given
	const { cwd } = fixture(t);
	rmSync(join(cwd, ".pi", "frame.json"));
	const before = refreshWorkContext(cwd, undefined, { openQuestions: [{ id: "ADHOC", owner: "user", text: "즉석 결정", blocks: ["S1"] }] });

	// when
	const after = refreshWorkContext(cwd);

	// then
	assert.deepEqual(after.openQuestions, before.openQuestions);
});
