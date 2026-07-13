import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ultraMode, {
	isUltraSupportedModel,
	loadUltraModeState,
	resolveUltraMode,
	ULTRA_MODEL_IDS,
	ULTRA_PROVIDER,
} from "./index.ts";

test("Ultra support is limited to openai-codex Sol and Terra", () => {
	for (const id of ULTRA_MODEL_IDS) {
		assert.equal(isUltraSupportedModel({ provider: ULTRA_PROVIDER, id }), true);
		assert.equal(resolveUltraMode({ provider: ULTRA_PROVIDER, id }, { enabled: true }), true);
	}
	assert.equal(isUltraSupportedModel({ provider: ULTRA_PROVIDER, id: "gpt-5.6-luna" }), false);
	assert.equal(isUltraSupportedModel({ provider: "openai", id: "gpt-5.6-sol" }), false);
	assert.equal(resolveUltraMode({ provider: ULTRA_PROVIDER, id: "gpt-5.6-sol" }, { enabled: false }), false);
});

test("command persists pilee-owned state and normalizes supported models to Max", async () => {
	const root = await mkdtemp(join(tmpdir(), "ultra-mode-state-"));
	process.env.PILEE_ULTRA_MODE_STATE_FILE = join(root, "state.json");
	try {
		const commands = new Map<string, any>();
		const thinkingLevels: string[] = [];
		ultraMode({
			registerCommand(name: string, command: any) {
				commands.set(name, command);
			},
			setThinkingLevel(level: string) {
				thinkingLevels.push(level);
			},
		} as any);

		const command = commands.get("ultra");
		assert.ok(command);
		assert.deepEqual(command.getArgumentCompletions("st"), [{ value: "status", label: "status" }]);
		assert.equal(command.getArgumentCompletions("unknown"), null);

		const notifications: string[] = [];
		const ctx = {
			hasUI: true,
			model: { provider: ULTRA_PROVIDER, id: "gpt-5.6-sol" },
			ui: { notify: (message: string) => notifications.push(message) },
		};

		assert.deepEqual(loadUltraModeState(), { enabled: false });
		await command.handler("on", ctx);
		assert.deepEqual(JSON.parse(await readFile(process.env.PILEE_ULTRA_MODE_STATE_FILE, "utf8")), { enabled: true });
		assert.deepEqual(thinkingLevels, ["max"]);
		await command.handler("status", ctx);
		await command.handler("off", ctx);
		assert.deepEqual(JSON.parse(await readFile(process.env.PILEE_ULTRA_MODE_STATE_FILE, "utf8")), { enabled: false });
		await command.handler("bogus", ctx);

		assert.match(notifications.join("\n"), /pilee Ultra를 켰습니다/);
		assert.match(notifications.join("\n"), /API reasoning은 Max/);
		assert.match(notifications.join("\n"), /pilee Ultra: ON/);
		assert.match(notifications.join("\n"), /pilee Ultra를 껐습니다/);
		assert.match(notifications.join("\n"), /사용법: \/ultra/);
	} finally {
		delete process.env.PILEE_ULTRA_MODE_STATE_FILE;
	}
});

test("unsupported models keep the stored preference without changing thinking level", async () => {
	const root = await mkdtemp(join(tmpdir(), "ultra-mode-unsupported-"));
	process.env.PILEE_ULTRA_MODE_STATE_FILE = join(root, "state.json");
	try {
		const commands = new Map<string, any>();
		const thinkingLevels: string[] = [];
		ultraMode({
			registerCommand(name: string, command: any) { commands.set(name, command); },
			setThinkingLevel(level: string) { thinkingLevels.push(level); },
		} as any);
		const notifications: string[] = [];
		await commands.get("ultra").handler("on", {
			hasUI: true,
			model: { provider: ULTRA_PROVIDER, id: "gpt-5.6-luna" },
			ui: { notify: (message: string) => notifications.push(message) },
		});

		assert.deepEqual(loadUltraModeState(), { enabled: true });
		assert.deepEqual(thinkingLevels, []);
		assert.match(notifications.join("\n"), /현재 모델은 미지원/);
	} finally {
		delete process.env.PILEE_ULTRA_MODE_STATE_FILE;
	}
});
