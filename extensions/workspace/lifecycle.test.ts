import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { listSnapshots } from "./store.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-lifecycle-")));
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = root;
process.env.TERM_PROGRAM = "test-host";
const { default: registerWorkspace } = await import("./index.ts");
const environment = { platform: "darwin", termProgram: "ghostty", stdinTTY: true, stdoutTTY: true };
const hour = 3_600_000;
const workspaceDir = join(root, "workspaces");
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
const autos = () => listSnapshots(workspaceDir).filter((item) => item.source === "auto");
after(() => rmSync(root, { recursive: true, force: true }));

type CaptureResult = { code: number; stdout: string; stderr: string; killed: boolean };

function fixture(id: string, holdCapture = false) {
	const sessionFile = join(root, `${id}.jsonl`);
	writeFileSync(sessionFile, JSON.stringify({ type: "session", version: 3, id, cwd: root }) + "\n");
	const hooks = new Map<string, Function>();
	const output: CaptureResult = { code: 0, stdout: `WINDOW\tw\twindow\nTAB\tt\t1\ttrue\ttab\nTERM\tp\t1\t${id}\t${root}`, stderr: "", killed: false };
	let stale = false;
	let captures = 0;
	let staleAccesses = 0;
	let pending: ((result: CaptureResult) => void) | undefined;
	const guard = <T>(value: T) => { if (stale) { staleAccesses++; throw new Error("ctx is stale"); } return value; };
	const ctx = { mode: "tui", hasUI: true, cwd: root,
		sessionManager: { getSessionFile: () => guard(sessionFile), getSessionName: () => guard(id), getCwd: () => guard(root) },
		ui: { setTitle: () => { guard(undefined); }, notify: () => {} },
	} as unknown as ExtensionCommandContext;
	registerWorkspace({
		on: (name, handler) => { hooks.set(name, handler); }, registerCommand: () => {}, sendMessage: () => {},
		exec: async (_command, args) => {
			if (args[1].includes("repeat with targetWindow in windows")) return { ...output, stdout: "w\tp" };
			captures++;
			assert.equal(stale, false, "old API must not capture after its runtime was replaced");
			if (holdCapture) return new Promise<CaptureResult>((resolve) => { pending = resolve; });
			return output;
		},
	} as ExtensionAPI, environment);
	return {
		emit: (name: string, event = {}) => hooks.get(name)!(event, ctx),
		makeStale: () => { stale = true; },
		finish: () => pending!(output),
		get captures() { return captures; },
		get staleAccesses() { return staleAccesses; },
	};
}

test("same-cwd runtime replacements own fresh hourly timers and never mix old API with new ctx", async (t) => {
	const slot = Date.UTC(2026, 0, 1, 1);
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: slot - hour / 2 });
	let old = fixture("initial");
	await old.emit("session_start", { reason: "startup" });
	t.mock.timers.tick(hour / 2); await flush();
	assert.equal(old.captures, 1);
	for (const reason of ["reload", "new", "resume", "fork"]) {
		await old.emit("session_shutdown", { reason });
		await old.emit("session_shutdown", { reason });
		old.makeStale();
		const oldCaptures = old.captures;
		const fresh = fixture(reason);
		await fresh.emit("session_start", { reason });
		t.mock.timers.tick(hour); await flush();
		assert.equal(fresh.captures, 1, `${reason} must schedule its own next hourly slot`);
		t.mock.timers.tick(hour); await flush();
		assert.equal(fresh.captures, 2);
		assert.equal(old.captures, oldCaptures, `${reason} must stop the replaced runtime's timer`);
		assert.equal(old.staleAccesses, 0, `${reason} must not touch the replaced runtime's stale ctx`);
		old = fresh;
	}
	await old.emit("session_shutdown", { reason: "quit" });
	const saved = autos();
	assert.equal(saved.length, 9, "one complete snapshot per claimed hour across replaced runtimes");
	const latest = JSON.parse(readFileSync(saved[0].path, "utf8"));
	assert.equal(latest.tabs[0].terminals[0].sessionFile, join(root, "fork.jsonl"));
	assert.equal(existsSync(join(workspaceDir, "snapshots", "autosave.json")), false);
	const stoppedCaptures = old.captures;
	t.mock.timers.tick(3 * hour); await flush();
	assert.equal(old.captures, stoppedCaptures);
});

test("autosave capture arriving after shutdown cannot persist a stale snapshot", async (t) => {
	const slot = Date.UTC(2026, 0, 3, 1);
	t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: slot - hour / 2 });
	const before = autos().map((item) => item.hash);
	const f = fixture("inflight", true);
	await f.emit("session_start", { reason: "startup" });
	t.mock.timers.tick(hour / 2); await flush();
	assert.equal(f.captures, 1);
	await f.emit("session_shutdown", { reason: "reload" });
	f.makeStale();
	f.finish(); await flush();
	assert.deepEqual(autos().map((item) => item.hash), before);
	assert.equal(f.staleAccesses, 0);
});
