import assert from "node:assert/strict";
import test from "node:test";
import registerNotify from "./index.ts";

function fixture() {
	const hooks = new Map<string, Function>();
	const commands = new Map<string, any>();
	const notices: string[] = [];
	const widgets: string[] = [];
	const ctx = { hasUI: true, ui: { notify() {}, setWidget(_id: string, widget: any) {
		if (widget) widgets.push(widget(null, { fg: (_: string, text: string) => text }).render(120).join("\n"));
	} } };
	registerNotify({ on: (name: string, handler: Function) => hooks.set(name, handler),
		registerCommand: (name: string, command: any) => commands.set(name, command), getSessionName: () => "fixture" } as any,
		(_pi, _title, text) => { notices.push(text); });
	const emit = (name: string, event = {}) => hooks.get(name)!(event, ctx);
	const end = (text: string, stopReason = "stop") => emit("agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text }], stopReason }] });
	return { emit, end, notices, widgets, commands, ctx };
}

test("notification waits through retry, queued continuation and recovery until final settlement", async () => {
	const f = fixture();
	await f.emit("session_start");
	for (const text of ["retry failed", "queued work", "recovered final summary"]) {
		await f.emit("agent_start");
		await f.end(text, text === "retry failed" ? "error" : "stop");
		assert.deepEqual(f.notices, []);
	}
	await f.emit("agent_before_settle", { outcome: "completed" });
	assert.deepEqual(f.notices, []);
	await f.emit("agent_settled", { aborted: false });
	assert.deepEqual(f.notices, ["작업 완료 — recovered final summary"]);
	assert.match(f.widgets.at(-1)!, /작업 완료.*recovered final summary/);
	await f.emit("agent_settled", { aborted: false });
	assert.equal(f.notices.length, 1);
});

test("abort and final error are not announced as success; session replacement drops cached runs", async () => {
	const f = fixture();
	await f.emit("agent_start");
	await f.end("partial result");
	await f.emit("agent_settled", { aborted: true });
	assert.match(f.notices.at(-1)!, /^작업 중단/);
	await f.emit("agent_start");
	await f.end("provider failure", "error");
	await f.emit("agent_before_settle", { outcome: "error" });
	await f.emit("agent_settled", { aborted: false });
	assert.match(f.notices.at(-1)!, /^작업 실패/);
	assert.match(f.widgets.at(-1)!, /작업 실패/);
	await f.emit("agent_start");
	await f.end("old runtime");
	await f.emit("session_shutdown", { reason: "reload" });
	await f.emit("session_start");
	await f.emit("agent_settled", { aborted: false });
	assert.equal(f.notices.length, 2);
});

test("notify off/on/test controls are preserved without spawning a notifier", async () => {
	const f = fixture();
	await f.commands.get("notify").handler("off", f.ctx);
	await f.emit("agent_start");
	await f.end("disabled");
	await f.emit("agent_settled", { aborted: false });
	assert.equal(f.notices.length, 0);
	await f.commands.get("notify").handler("test", f.ctx);
	assert.match(f.notices.at(-1)!, /알림 테스트/);
	await f.emit("agent_start");
	await f.end("enabled");
	await f.emit("agent_settled", { aborted: false });
	assert.match(f.notices.at(-1)!, /^작업 완료 — enabled$/);
});
