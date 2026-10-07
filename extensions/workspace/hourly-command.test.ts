import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { listSnapshots } from "./store.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-hourly-command-")));
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = root;
process.env.TERM_PROGRAM = "test-host";
const { default: registerWorkspace } = await import("./index.ts");
const environment = { platform: "darwin", termProgram: "ghostty", stdinTTY: true, stdoutTTY: true };
const hour = 3_600_000;
const slot = Date.UTC(2026, 0, 1, 1);
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };

test("lifecycle -> exact registry -> hourly capture -> FIFO, with manual preservation and no save after shutdown", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: slot - hour / 2 });
	const hooks = new Map<string, Function>();
	const file = join(root, "session.jsonl");
	writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: "fixture", cwd: root }) + "\n");
	let captureCount = 0;
	let pendingCapture: ((result: { code: number; stdout: string; stderr: string; killed: boolean }) => void) | undefined;
	let holdCapture = false;
	const output = { code: 0, stdout: `WINDOW\tw\twindow\nTAB\tt\t1\ttrue\ttab\nTERM\tp\t1\tvisible\t${root}`, stderr: "", killed: false };
	let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	const notices: string[] = [];
	const ctx = { mode: "tui", hasUI: true, cwd: root, sessionManager: { getSessionFile: () => file, getSessionName: () => "visible", getCwd: () => root },
		ui: { setTitle: (_title: string) => {}, notify: (message: string) => { notices.push(message); } },
	} as ExtensionCommandContext;
	registerWorkspace({
		on: (name, handler) => { hooks.set(name, handler); }, registerCommand: (_name, options) => { handler = options.handler; }, sendMessage: () => {},
		exec: async (_command, args) => {
			if (args[1].includes("repeat with targetWindow in windows")) return { ...output, stdout: "w\tp" };
			captureCount++;
			if (holdCapture) return new Promise((resolve) => { pendingCapture = resolve; });
			return output;
		},
	} as ExtensionAPI, environment);
	try {
		await hooks.get("session_start")!({ reason: "startup" }, ctx);
		t.mock.timers.tick(30_000); await flush();
		assert.equal(captureCount, 0);
		await handler('save "autosave manual"', ctx);
		const manual = listSnapshots(join(root, "workspaces"))[0];
		const manualBytes = readFileSync(manual.path);
		t.mock.timers.tick(hour / 2 - 30_000); await flush();
		assert.equal(listSnapshots(join(root, "workspaces")).filter((item) => item.source === "auto").length, 1);
		for (let n = 1; n <= 10; n++) { t.mock.timers.tick(hour); await flush(); }
		assert.equal(captureCount, 12);
		const autos = listSnapshots(join(root, "workspaces")).filter((item) => item.source === "auto");
		assert.equal(autos.length, 10);
		assert.deepEqual(autos.map((item) => item.updatedAt), Array.from({ length: 10 }, (_, n) => slot + (10 - n) * hour));
		assert.deepEqual(readFileSync(manual.path), manualBytes);
		assert.equal(existsSync(join(root, "workspaces", "snapshots", "autosave.json")), false);
		holdCapture = true;
		const lateManual = handler("save old-session", ctx);
		await flush();
		assert.ok(pendingCapture);
		await hooks.get("session_shutdown")!({ reason: "reload" }, ctx);
		await hooks.get("session_start")!({ reason: "reload" }, ctx);
		pendingCapture!(output); await lateManual;
		assert.equal(listSnapshots(join(root, "workspaces")).filter((item) => item.source === "manual").length, 1);
		t.mock.timers.tick(hour); await flush();
		assert.ok(pendingCapture);
		const statePath = join(root, "workspaces", "autosave-state.json");
		const stateBeforeReload = readFileSync(statePath);
		await hooks.get("session_shutdown")!({ reason: "reload" }, ctx);
		await hooks.get("session_start")!({ reason: "reload" }, ctx);
		pendingCapture!(output); await flush();
		assert.deepEqual(readFileSync(statePath), stateBeforeReload); // Old attempt cannot write through the new live registration.
		assert.deepEqual(listSnapshots(join(root, "workspaces")).filter((item) => item.source === "auto").map((item) => item.hash), autos.map((item) => item.hash));
		await hooks.get("session_shutdown")!({ reason: "quit" }, ctx);
		const stoppedCount = captureCount;
		t.mock.timers.tick(3 * hour); await flush();
		assert.equal(captureCount, stoppedCount);
		assert.ok(notices.some((message) => message.includes("저장 완료")));
	} finally { await hooks.get("session_shutdown")?.({ reason: "quit" }, ctx); }
});

test("headless registration and save/status commands never call the host or create snapshots", async (t) => {
	const hooks = new Map<string, Function>();
	let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	let calls = 0;
	const notices: string[] = [];
	const ctx = { mode: "rpc", hasUI: true, cwd: root, sessionManager: { getSessionFile: () => join(root, "rpc.jsonl") }, ui: { notify: (message: string) => { notices.push(message); } } } as ExtensionCommandContext;
	registerWorkspace({ on: (name, handler) => { hooks.set(name, handler); }, registerCommand: (_name, options) => { handler = options.handler; },
		sendMessage: () => {}, exec: async () => { calls++; throw new Error("must not call host"); },
	} as ExtensionAPI, environment);
	try {
		t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: slot - 1000 });
		const before = listSnapshots(join(root, "workspaces")).map((item) => item.hash);
		await hooks.get("session_start")!({ reason: "startup" }, ctx);
		await handler("save headless", ctx);
		await handler("status", ctx);
		t.mock.timers.tick(hour * 3); await flush();
		assert.equal(calls, 0);
		assert.deepEqual(listSnapshots(join(root, "workspaces")).map((item) => item.hash), before);
		assert.ok(notices.some((message) => message.includes("등록되지 않았습니다")));
	} finally { await hooks.get("session_shutdown")?.({ reason: "quit" }, ctx); rmSync(root, { recursive: true, force: true }); }
});
