import assert from "node:assert/strict";
import test from "node:test";
import registerQueued from "./index.ts";

function fixture() {
	const hooks = new Map<string, Function>();
	const notices: string[] = [];
	let stale = false;
	let staleAccesses = 0;
	const ctx = { get hasUI() { if (stale) { staleAccesses++; throw new Error("ctx is stale"); } return true; },
		isIdle: () => false, hasPendingMessages: () => true,
		ui: { notify: (text: string) => notices.push(text), setWidget() {} } };
	registerQueued({ on: (name: string, fn: Function) => hooks.set(name, fn) } as any);
	return { emit: (name: string, event = {}) => hooks.get(name)!(event, ctx), notices, makeStale: () => { stale = true; }, get staleAccesses() { return staleAccesses; } };
}

test("watchdog reads current toolName and command/path, survives replacement and stops on settlement", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1_000_000 });
	const f = fixture();
	await f.emit("session_start");
	await f.emit("agent_start");
	await f.emit("tool_execution_start", { toolName: "bash", args: { command: "pnpm install --frozen-lockfile" } });
	t.mock.timers.tick(300_000);
	assert.match(f.notices.at(-1)!, /bash — pnpm install --frozen-lockfile/);
	assert.match(f.notices.at(-1)!, /패키지 설치 중/);
	await f.emit("agent_end");
	t.mock.timers.tick(300_000);
	assert.equal(f.notices.length, 2, "agent_end must not stop watchdog during recovery");
	await f.emit("agent_settled");
	t.mock.timers.tick(300_000);
	assert.equal(f.notices.length, 2);
	for (const reason of ["reload", "new", "resume", "fork"]) {
		await f.emit("session_shutdown", { reason });
		await f.emit("session_shutdown", { reason });
		await f.emit("session_start", { reason });
		await f.emit("agent_start");
		await f.emit("tool_execution_start", { toolName: "read", args: { path: "/fixture/target.ts" } });
		t.mock.timers.tick(300_000);
		assert.match(f.notices.at(-1)!, /read — \/fixture\/target.ts/);
	}
	await f.emit("agent_end");
	await f.emit("session_shutdown", { reason: "reload" });
	f.makeStale();
	t.mock.timers.tick(600_000);
	assert.equal(f.staleAccesses, 0, "disposed delayed sync and intervals must not read old ctx");
});

test("idle watchdog contains stale hasUI failures", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1_000_000 });
	const f = fixture();
	await f.emit("session_start");
	await f.emit("agent_start");
	f.makeStale();
	assert.doesNotThrow(() => t.mock.timers.tick(600_000));
	assert.equal(f.staleAccesses, 1);
	await f.emit("session_shutdown", { reason: "reload" });
});
