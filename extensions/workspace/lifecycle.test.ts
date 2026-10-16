import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const root = mkdtempSync(join(tmpdir(), "workspace-lifecycle-"));
process.env.PI_CODING_AGENT_DIR = root;
process.env.HOME = root;
process.env.TERM_PROGRAM = "ghostty";
const { default: registerWorkspace } = await import("./index.ts");
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

function fixture(id: string, exec?: () => Promise<any>) {
	const sessionFile = join(root, `${id}.jsonl`);
	writeFileSync(sessionFile, JSON.stringify({ type: "session", version: 3, id, cwd: root }) + "\n");
	const hooks = new Map<string, Function>();
	let stale = false;
	let calls = 0;
	let staleAccesses = 0;
	const manager = { getSessionFile() { if (stale) { staleAccesses++; throw new Error("ctx is stale"); } return sessionFile; }, getSessionName: () => id, getCwd: () => root };
	const ctx = { cwd: root, sessionManager: manager, ui: {} };
	registerWorkspace({ on: (name: string, fn: Function) => hooks.set(name, fn), registerCommand() {}, exec: async () => {
		calls++;
		assert.equal(stale, false, "old API must not be called with fresh ctx");
		return exec ? exec() : { code: 0, stdout: `WINDOW\tw\twindow\nTAB\tt\t1\ttrue\ttab\nTERM\tp\t1\t${id}\t${root}`, stderr: "" };
	} } as any);
	return { emit: (name: string, event = {}) => hooks.get(name)!(event, ctx), makeStale: () => { stale = true; }, get calls() { return calls; }, get staleAccesses() { return staleAccesses; } };
}

test("same-cwd runtime replacements own fresh timers and never mix old API with new ctx", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 1_000_000 });
	try {
		let old = fixture("initial");
		await old.emit("session_start", { reason: "startup" });
		t.mock.timers.tick(60_000);
		await flush();
		assert.equal(old.calls, 1);
		for (const reason of ["reload", "new", "resume", "fork"]) {
			await old.emit("session_shutdown", { reason });
			await old.emit("session_shutdown", { reason });
			old.makeStale();
			const calls = old.calls;
			const fresh = fixture(reason);
			await fresh.emit("session_start", { reason });
			t.mock.timers.tick(60_000);
			await flush();
			assert.equal(fresh.calls, 1, `${reason} must schedule a fresh initial timer`);
			t.mock.timers.tick(3_600_000);
			await flush();
			assert.equal(fresh.calls, 2);
			assert.equal(old.calls, calls);
			assert.equal(old.staleAccesses, 0);
			old = fresh;
		}
		await old.emit("session_shutdown", { reason: "quit" });
		const snapshot = JSON.parse(readFileSync(join(root, "workspaces/snapshots/autosave.json"), "utf8"));
		assert.equal(snapshot.tabs[0].terminals[0].sessionTitle, "fork");
		const archives = readdirSync(join(root, "workspaces/snapshots")).filter((file) => /^autosave-\d{8}T\d{6}\.json$/.test(file));
		assert.ok(archives.length > 0, "runtime ownership must preserve versioned snapshots");
		const state = JSON.parse(readFileSync(join(root, "workspaces/autosave-state.json"), "utf8"));
		assert.equal(state.leader.pid, process.pid);
		assert.equal(state.saved, false, "unchanged periodic autosaves remain hash-rate-limited");
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("autosave response arriving after shutdown cannot persist a stale snapshot", async (t) => {
	t.mock.timers.enable({ apis: ["Date", "setTimeout", "setInterval"], now: 10_000_000 });
	try {
		// The module's registry root is fixed; recreate only its isolated fixture root.
		mkdirSync(root, { recursive: true });
		let finish!: (result: any) => void;
		const f = fixture("inflight", () => new Promise((resolve) => { finish = resolve; }));
		await f.emit("session_start");
		t.mock.timers.tick(60_000);
		await flush();
		assert.equal(f.calls, 1);
		await f.emit("session_shutdown", { reason: "reload" });
		f.makeStale();
		finish({ code: 0, stdout: `WINDOW\tw\twindow\nTAB\tt\t1\ttrue\ttab\nTERM\tp\t1\tinflight\t${root}` });
		await flush();
		assert.equal(existsSync(join(root, "workspaces/snapshots/autosave.json")), false);
		assert.equal(f.staleAccesses, 0);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
