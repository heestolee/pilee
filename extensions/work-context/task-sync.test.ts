import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Check } from "typebox/value";
import tasksExtension from "../tasks/index.ts";
import workContextExtension from "./index.ts";
import { gateWorkContext } from "../utils/work-context.ts";

function fixture(t: { after: (fn: () => void) => void }) {
	const cwd = realpathSync(mkdtempSync(join(tmpdir(), "pilee-task-sync-")));
	const previousPanel = process.env.PI_FORK_PANEL_LABEL;
	process.env.PI_FORK_PANEL_LABEL = "P0";
	execFileSync("git", ["init", "--quiet"], { cwd });
	t.after(() => {
		if (previousPanel === undefined) delete process.env.PI_FORK_PANEL_LABEL;
		else process.env.PI_FORK_PANEL_LABEL = previousPanel;
		rmSync(cwd, { recursive: true, force: true });
	});
	const tools = new Map<string, any>();
	const hooks = new Map<string, Array<(event: any, ctx: any) => unknown>>();
	const pi = {
		registerTool(tool: any) { tools.set(tool.name, tool); },
		registerCommand() {},
		registerShortcut() {},
		on(name: string, handler: any) { hooks.set(name, [...(hooks.get(name) ?? []), handler]); },
	};
	tasksExtension(pi as any);
	workContextExtension(pi as any);
	const ctx: any = { cwd, hasUI: false, sessionManager: { getSessionFile: () => join(cwd, `${process.env.PI_FORK_PANEL_LABEL}.jsonl`) } };
	const emit = async (event: any) => { for (const hook of hooks.get("tool_result") ?? []) await hook(event, ctx); };
	const invoke = async (name: string, input: any) => {
		const tool = tools.get(name);
		assert.equal(Check(tool.parameters, input), true, `${name} input must satisfy the actual tool schema`);
		const result = await tool.execute("test-call", input, undefined, undefined, ctx);
		await emit({ toolName: name, input, ...result, isError: false });
		return result;
	};
	ctx.executeTool = async (name: string, input: any) => {
		try { return { result: await invoke(name, input), isError: false }; }
		catch (error) { return { result: { content: [{ type: "text", text: String(error) }], details: {} }, isError: true }; }
	};
	const slice = { id: "S1", title: "도구 입력 개선", scope: ["src/a.ts"], acceptance: ["실제 동작 유지"], status: "in_progress" };
	const bind = () => invoke("work_context", { action: "set_slice", slice, syncTask: true, taskArea: "도구" });
	const card = async () => (await invoke("work_context", { action: "status" })).details.card;
	const task = async (taskId = "1") => (await invoke("TaskGet", { taskId })).details.task;
	return { cwd, ctx, invoke, emit, bind, card, task, slice };
}

test("슬라이스 한 번 입력으로 Task를 만들고 양쪽의 공유 필드를 갱신한다", async (t) => {
	const f = fixture(t);
	await f.bind();
	assert.equal((await f.card()).currentSlice.taskId, "1");
	assert.equal((await f.task()).status, "in_progress");
	assert.equal((await f.task()).area, "도구");
	await f.invoke("TaskUpdate", { taskId: "1", subject: "변경된 제목", status: "blocked", acceptance: ["새 계약"], scope: ["src/b.ts"] });
	const blocked = await f.card();
	assert.deepEqual(blocked.currentSlice, { ...f.slice, taskId: "1", title: "변경된 제목", status: "blocked", acceptance: ["새 계약"], scope: ["src/b.ts"] });
	assert.equal(gateWorkContext(blocked).level, "block");
	await f.invoke("work_context", { action: "set_slice", slice: { ...f.slice, title: "다시 진행", scope: ["src/c.ts"] } });
	assert.equal((await f.task()).subject, "다시 진행");
	assert.equal((await f.task()).status, "in_progress");
	assert.deepEqual((await f.task()).metadata.workContextScope, ["src/c.ts"]);
	await f.invoke("work_context", { action: "set_slice", sliceId: "S1", slice: { status: "pending" } });
	assert.equal((await f.task()).status, "pending");
	assert.equal((await f.task()).subject, "다시 진행");
	assert.deepEqual((await f.task()).metadata.workContextScope, ["src/c.ts"]);
	await f.bind();
	assert.equal((await f.invoke("TaskList", {})).details.active, 1, "같은 슬라이스를 다시 연결해도 Task를 중복 생성하지 않는다");
});

test("커밋·푸시 영수증은 양쪽에 표시되지만 작업 완료를 의미하지 않는다", async (t) => {
	const f = fixture(t);
	await f.bind();
	const details = {
		completion: "committed_and_pushed",
		commits: [{ hash: "abcdef123456", paths: ["src/a.ts"] }],
		push: { status: "done", remote: "origin", branch: "feature/example" },
	};
	await f.emit({ toolName: "auto_commit", details, isError: false });
	assert.equal((await f.task()).git.push.status, "done");
	assert.equal((await f.task()).status, "in_progress");
	const result = await f.invoke("work_context", { action: "status" });
	assert.equal(result.details.card.currentSlice.status, "in_progress");
	assert.match(result.content[0].text, /abcdef123456.*push=done/);
	for (const event of [
		{ toolName: "auto_commit", details: { ...details, commits: [{ hash: "deadbeef1234", paths: ["src/a.ts"] }] }, isError: true },
		{ toolName: "auto_commit", details: { ...details, commits: [{ hash: "deadbeef1234", paths: ["docs/other.md"] }] }, isError: false },
	]) await f.emit(event);
	assert.equal((await f.task()).git.commits[0].hash, "abcdef123456");
	await f.emit({ toolName: "auto_commit", isError: false, details: { ...details, completion: "committed_not_pushed", push: { status: "failed" } } });
	assert.equal((await f.card()).lastKnownState.git.push.status, "failed");
	assert.equal((await f.task()).status, "in_progress");
});

test("수동 슬라이스는 유지하고 frame은 Task 변경으로 덮어쓰지 않는다", async (t) => {
	const f = fixture(t);
	mkdirSync(join(f.cwd, ".pi"), { recursive: true });
	const frame = JSON.stringify({ goal: "원래 목표", implementation_plan: { slices: [{ id: "S1", goal: "원래 계획", expectedFiles: ["src/a.ts"] }] } });
	writeFileSync(join(f.cwd, ".pi/frame.json"), frame);
	await f.invoke("work_context", { action: "set_slice", slice: f.slice });
	assert.equal((await f.invoke("TaskList", {})).content[0].text, "No tasks.");
	await f.bind();
	await f.invoke("TaskUpdate", { taskId: "1", subject: "진행 중 구체화", status: "completed" });
	assert.equal((await f.card()).currentSlice.title, "진행 중 구체화");
	assert.equal((await f.card()).currentSlice.status, "completed");
	assert.equal(readFileSync(join(f.cwd, ".pi/frame.json"), "utf8"), frame);
});

test("연결 실패는 새 슬라이스를 저장하지 않고 Task의 다른 연결을 빼앗지 않는다", async (t) => {
	const f = fixture(t);
	await f.bind();
	await assert.rejects(f.invoke("work_context", { action: "set_slice", slice: { ...f.slice, id: "S2" }, taskId: "1" }), /already linked/);
	assert.equal((await f.card()).currentSlice.id, "S1");
	f.ctx.executeTool = async () => ({ isError: true, result: { content: [{ type: "text", text: "blocked" }], details: {} } });
	await assert.rejects(f.invoke("work_context", { action: "set_slice", slice: { ...f.slice, id: "S2" }, syncTask: true }), /Task 동기화 실패/);
	assert.equal((await f.card()).currentSlice.id, "S1");
	assert.equal((await f.invoke("TaskList", {})).details.active, 1);
});

test("보류하거나 없어진 연결 Task를 완료로 간주하지 않는다", async (t) => {
	const f = fixture(t);
	await f.bind();
	await f.invoke("TaskUpdate", { taskId: "1", status: "deprioritized", dispositionReason: "범위 제외" });
	assert.equal((await f.card()).currentSlice.status, "blocked");
	const p = join(f.cwd, ".pi/work-tasks.json");
	writeFileSync(p, JSON.stringify({ nextId: 2, tasks: [] }));
	assert.equal(gateWorkContext(await f.card()).level, "block");
});

test("자식 패널의 연결과 변경은 부모 Task·WCC를 덮어쓰지 않는다", async (t) => {
	const f = fixture(t);
	await f.bind();
	const parentTask = readFileSync(join(f.cwd, ".pi/work-tasks.json"), "utf8");
	const parentCard = readFileSync(join(f.cwd, ".pi/work-context.json"), "utf8");
	process.env.PI_FORK_PANEL_LABEL = "P1";
	const child = await f.invoke("work_context", { action: "set_slice", slice: { ...f.slice, id: "CHILD", title: "자식 작업" }, syncTask: true });
	t.after(() => rmSync(join(child.details.card.identity.contextPath, ".."), { recursive: true, force: true }));
	assert.notEqual(child.details.card.identity.tasksPath, join(f.cwd, ".pi/work-tasks.json"));
	assert.equal(existsSync(child.details.card.identity.tasksPath), true);
	await f.invoke("TaskUpdate", { taskId: child.details.taskId, subject: "자식만 변경" });
	assert.equal((await f.card()).currentSlice.title, "자식만 변경");
	assert.equal(readFileSync(join(f.cwd, ".pi/work-tasks.json"), "utf8"), parentTask);
	assert.equal(readFileSync(join(f.cwd, ".pi/work-context.json"), "utf8"), parentCard);
});
