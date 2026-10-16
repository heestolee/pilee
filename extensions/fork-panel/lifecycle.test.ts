import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "fork-lifecycle-"));
process.env.HOME = root;
process.env.TERM_PROGRAM = "test-host";
const { default: registerFork } = await import("./index.ts");
const handoffDir = join(root, ".pi/agent/fork-panel");
const snapshotPath = join(handoffDir, "fixture.json");
const readSnapshot = () => JSON.parse(readFileSync(snapshotPath, "utf8"));

function fixture(signals: EventEmitter) {
	const hooks = new Map<string, Function[]>();
	const commands = new Map<string, any>();
	const messages: string[] = [];
	const sessionFile = join(root, "session.jsonl");
	const entries = [{ type: "session", id: "fixture-session", cwd: root }, { type: "message", message: { role: "assistant", content: [{ type: "text", text: "진행 중인 작업" }] } }];
	writeFileSync(sessionFile, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
	const ctx = { cwd: root, hasUI: true, sessionManager: { getEntries: () => entries, getSessionFile: () => sessionFile },
		ui: { notify() {}, custom: async () => null } };
	registerFork({ on: (name: string, fn: Function) => { hooks.set(name, [...hooks.get(name) ?? [], fn]); },
		registerCommand: (name: string, command: any) => commands.set(name, command), registerShortcut() {},
		sendUserMessage: (text: string) => messages.push(text), exec: async () => { throw new Error("host/process calls forbidden"); } } as any, signals as any);
	return { commands, ctx, messages, emit: async (name: string, event = {}) => { for (const fn of hooks.get(name) ?? []) await fn(event, ctx); } };
}

test("runtime replacements preserve child snapshots without final handoffs and own exact signal listeners", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	t.mock.method(process, "kill", () => true);
	const signals = new EventEmitter();
	const foreign = () => {};
	for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) signals.on(signal, foreign);
	process.env.PI_FORK_ID = "fixture";
	process.env.PI_FORK_PANEL_LABEL = "P2";
	process.env.PI_FORK_PARENT = "parent.jsonl";
	mkdirSync(handoffDir, { recursive: true });
	try {
		let child = fixture(signals);
		writeFileSync(join(handoffDir, "recent.json"), JSON.stringify({ fixture: { forkId: "fixture", panelLabel: "P2", sessionFile: join(root, "session.jsonl"), cwd: root, label: "fixture", createdAt: Date.now() } }));
		assert.equal(signals.listenerCount("SIGTERM"), 1, "factory alone must not add resources");
		await child.emit("session_start", { reason: "startup" });
		for (const reason of ["reload", "new", "resume", "fork"]) {
			await child.emit("agent_end");
			await child.emit("session_shutdown", { reason });
			await child.emit("session_shutdown", { reason });
			assert.equal(readSnapshot().finishedAt, undefined);
			assert.equal(readSnapshot().panelLabel, "P2");
			assert.equal(signals.listenerCount("SIGTERM"), 1);
			delete process.env.PI_FORK_ID;
			const parent = fixture(signals);
			await parent.commands.get("panels").handler("", parent.ctx);
			assert.equal(existsSync(join(handoffDir, "inbox")), false, "live child must not become fallback handoff");
			assert.equal(JSON.parse(readFileSync(join(handoffDir, "recent.json"), "utf8")).fixture.closedAt, undefined);
			process.env.PI_FORK_ID = "fixture";
			child = fixture(signals);
			await child.emit("session_start", { reason });
			for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) assert.equal(signals.listenerCount(signal), 2);
		}
		await child.emit("session_shutdown", { reason: "quit" });
		assert.ok(readSnapshot().finishedAt);
		for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) assert.deepEqual(signals.listeners(signal), [foreign]);
		delete process.env.PI_FORK_ID;
		const parent = fixture(signals);
		await parent.commands.get("panels").handler("", parent.ctx);
		assert.equal(readdirSync(join(handoffDir, "inbox")).length, 1, "true quit is consumed by the existing parent fallback");
		assert.ok(JSON.parse(readFileSync(join(handoffDir, "recent.json"), "utf8")).fixture.closedAt);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("signals finalize once and repanel markers suppress handoff without touching a real process", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	mkdirSync(root, { recursive: true });
	mkdirSync(handoffDir, { recursive: true });
	process.env.PI_FORK_ID = "fixture";
	process.env.PI_FORK_PANEL_LABEL = "P2";
	const signals = new EventEmitter();
	let exits = 0;
	(signals as any).exit = () => { exits++; };
	try {
		const child = fixture(signals);
		await child.emit("session_start");
		signals.emit("SIGTERM");
		const final = readFileSync(snapshotPath, "utf8");
		signals.emit("SIGHUP");
		assert.equal(readFileSync(snapshotPath, "utf8"), final);
		assert.ok(readSnapshot().finishedAt);
		await child.emit("session_shutdown", { reason: "quit" });
		assert.equal(signals.listenerCount("SIGTERM"), 0);
		const moved = fixture(signals);
		await moved.emit("session_start");
		writeFileSync(join(handoffDir, `fixture-repanel-${process.pid}.json`), JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
		signals.emit("SIGTERM");
		assert.equal(readSnapshot().finishedAt, undefined, "repanel must not finalize the snapshot");
		assert.equal(exits, 1);
		await moved.emit("session_shutdown", { reason: "quit" });
	} finally { delete process.env.PI_FORK_ID; rmSync(root, { recursive: true, force: true }); }
});

test("done keeps explicit handoff, inject and no-handoff semantics with a fake process exit", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
	let exits = 0;
	t.mock.method(process, "exit", (() => { exits++; }) as any);
	process.env.PI_FORK_ID = "fixture";
	process.env.PI_FORK_PANEL_LABEL = "P2";
	try {
		for (const args of ["--last", "--no-handoff", "--last --inject"]) {
			mkdirSync(handoffDir, { recursive: true });
			rmSync(join(handoffDir, "inbox"), { recursive: true, force: true });
			writeFileSync(join(handoffDir, "recent.json"), JSON.stringify({ fixture: { forkId: "fixture", sessionFile: join(root, "session.jsonl"), cwd: root, createdAt: Date.now() } }));
			const signals = new EventEmitter();
			const child = fixture(signals);
			await child.emit("session_start");
			await child.commands.get("done").handler(args, child.ctx);
			assert.ok(JSON.parse(readFileSync(join(handoffDir, "recent.json"), "utf8")).fixture.closedAt);
			assert.equal(existsSync(snapshotPath), false);
			signals.emit("SIGTERM");
			assert.equal(existsSync(snapshotPath), false, "done must not create a duplicate final snapshot");
			if (args.includes("--no-handoff")) assert.equal(existsSync(join(handoffDir, "inbox")), false);
			else {
				const inbox = readdirSync(join(handoffDir, "inbox"));
				assert.equal(inbox.length, 1);
				const item = JSON.parse(readFileSync(join(handoffDir, "inbox", inbox[0]), "utf8"));
				assert.equal(item.source, "done");
				assert.equal(item.delivery, args.includes("--inject") ? "inject" : "inbox");
			}
			await child.emit("session_shutdown", { reason: "quit" });
			assert.equal(signals.listenerCount("SIGTERM"), 0);
			t.mock.timers.tick(100);
		}
		assert.equal(exits, 3);
	} finally { delete process.env.PI_FORK_ID; rmSync(root, { recursive: true, force: true }); }
});
