import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { loadCodexFastModeState, loadFastConfiguration, saveCodexFastModeState, saveFastConfiguration } from "./state.ts";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "codex-fast-"));
	const previousDir = process.env.PI_CODING_AGENT_DIR;
	const previousState = process.env.PILEE_CODEX_FAST_STATE_FILE;
	const agent = join(root, "agent");
	const cwd = join(root, "project");
	process.env.PI_CODING_AGENT_DIR = agent;
	process.env.PILEE_CODEX_FAST_STATE_FILE = join(agent, "state", "codex-fast-mode.json");
	return {
		cwd,
		global: join(agent, "settings.json"),
		project: join(cwd, ".pi", "settings.json"),
		legacy: process.env.PILEE_CODEX_FAST_STATE_FILE,
		write(path: string, value: unknown) {
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, JSON.stringify(value));
		},
		close() {
			if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousDir;
			if (previousState === undefined) delete process.env.PILEE_CODEX_FAST_STATE_FILE;
			else process.env.PILEE_CODEX_FAST_STATE_FILE = previousState;
			rmSync(root, { recursive: true, force: true });
		},
	};
}

test("legacy-only loading retains enabled/priority without writing or migrating", () => {
	const f = fixture();
	try {
		f.write(f.legacy, { enabled: true, priority: false, unrelated: "keep" });
		const before = readFileSync(f.legacy, "utf8");
		assert.deepEqual(loadFastConfiguration(f.cwd), { mode: "fast", priority: false, legacyOnly: true, source: "legacy", settingsPath: f.global });
		assert.equal(readFileSync(f.legacy, "utf8"), before);
		assert.deepEqual(readdirSync(dirname(f.legacy)), ["codex-fast-mode.json"]);
		saveCodexFastModeState({ enabled: false, priority: true });
		assert.deepEqual(loadCodexFastModeState(), { enabled: false, priority: true });
		assert.equal(JSON.parse(readFileSync(f.legacy, "utf8")).unrelated, "keep");
	} finally { f.close(); }
});

test("explicit project mode/enabled overrides global and legacy, including off", () => {
	const f = fixture();
	try {
		f.write(f.legacy, { enabled: true, priority: true });
		f.write(f.global, { "pi-codex-fast": { mode: "fast" } });
		for (const settings of [{ mode: "off", enabled: true }, { enabled: false }, { mode: "ultrafast" }]) {
			f.write(f.project, { "pi-codex-fast": settings });
			const before = readFileSync(f.project, "utf8");
			assert.equal(loadFastConfiguration(f.cwd).mode, settings.mode === "ultrafast" ? "ultrafast" : "off");
			assert.equal(loadFastConfiguration(f.cwd).settingsPath, f.project);
			assert.equal(readFileSync(f.project, "utf8"), before);
		}
		f.write(f.project, { theme: "keep" });
		assert.equal(loadFastConfiguration(f.cwd).mode, "fast");
		f.write(f.global, { "pi-codex-fast": { enabled: false } });
		assert.equal(loadFastConfiguration(f.cwd).mode, "off");
	} finally { f.close(); }
});

test("mode persistence merges the effective scope atomically and preserves unrelated keys", () => {
	const f = fixture();
	try {
		f.write(f.global, { theme: "untouched", "pi-codex-fast": { mode: "fast" } });
		f.write(f.project, { custom: { keep: 1 }, "pi-codex-fast": { mode: "off", extra: "keep" } });
		const globalBefore = readFileSync(f.global, "utf8");
		const state = loadFastConfiguration(f.cwd);
		saveFastConfiguration({ ...state, mode: "fast", priority: false });
		assert.deepEqual(JSON.parse(readFileSync(f.project, "utf8")), {
			custom: { keep: 1 }, "pi-codex-fast": { mode: "fast", enabled: true, priority: false, legacyOnly: false, extra: "keep" },
		});
		assert.equal(loadFastConfiguration(f.cwd).priority, false);
		assert.equal(readFileSync(f.global, "utf8"), globalBefore);
		assert.deepEqual(readdirSync(dirname(f.project)), ["settings.json"]);
		writeFileSync(f.project, "{broken");
		assert.throws(() => saveFastConfiguration(state));
		assert.throws(() => loadFastConfiguration(f.cwd));
		assert.equal(readFileSync(f.project, "utf8"), "{broken");
	} finally { f.close(); }
});
