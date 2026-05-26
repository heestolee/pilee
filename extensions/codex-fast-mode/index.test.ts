import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import codexFastMode, {
	applyCodexFastPayload,
	isFastSupportedModel,
	loadCodexFastModeState,
	SUPPORTED_CODEX_PROVIDER,
	SUPPORTED_MODEL_IDS,
} from "./index.ts";

test("payload wrapper always lowers verbosity for supported Codex models", () => {
	assert.deepEqual(
		applyCodexFastPayload(
			{ text: { format: "plain" }, metadata: "keep" },
			{ provider: SUPPORTED_CODEX_PROVIDER, id: "gpt-5.5" },
			{ enabled: true, priority: false },
		),
		{ text: { format: "plain", verbosity: "low" }, metadata: "keep" },
	);
});

test("payload wrapper injects priority service tier only when enabled", () => {
	assert.deepEqual(
		applyCodexFastPayload({ text: {} }, { provider: SUPPORTED_CODEX_PROVIDER, id: "gpt-5.4" }, { enabled: true, priority: true }),
		{ text: { verbosity: "low" }, service_tier: "priority" },
	);
	assert.deepEqual(
		applyCodexFastPayload({ text: {} }, { provider: SUPPORTED_CODEX_PROVIDER, id: "gpt-5.4" }, { enabled: true, priority: false }),
		{ text: { verbosity: "low" } },
	);
	assert.deepEqual(
		applyCodexFastPayload({ text: {} }, { provider: SUPPORTED_CODEX_PROVIDER, id: "gpt-5.4" }, { enabled: false, priority: false }),
		{ text: {} },
	);
});

test("payload wrapper ignores unsupported providers, models, and raw payloads", () => {
	const on = { enabled: true, priority: true };
	assert.equal(applyCodexFastPayload("raw", { provider: SUPPORTED_CODEX_PROVIDER, id: "gpt-5.5" }, on), "raw");
	assert.deepEqual(applyCodexFastPayload({ text: {} }, { provider: "openai", id: "gpt-5.5" }, on), { text: {} });
	assert.deepEqual(applyCodexFastPayload({ text: {} }, { provider: SUPPORTED_CODEX_PROVIDER, id: "gpt-5.3" }, on), { text: {} });
});

test("supported model list is limited to gpt-5.4 and gpt-5.5", () => {
	for (const modelId of SUPPORTED_MODEL_IDS) assert.equal(isFastSupportedModel(modelId), true);
	assert.equal(isFastSupportedModel("gpt-5.5-preview"), false);
	assert.equal(isFastSupportedModel(undefined), false);
});

test("command toggles the persisted state file and exposes status/help", async () => {
	const root = await mkdtemp(join(tmpdir(), "codex-fast-state-"));
	process.env.PILEE_CODEX_FAST_STATE_FILE = join(root, "state.json");
	try {
		assert.deepEqual(loadCodexFastModeState(), { enabled: false, priority: false });

		const commands = new Map<string, any>();
		const providers = new Map<string, any>();
		codexFastMode({
			registerCommand(name: string, command: any) {
				commands.set(name, command);
			},
			registerProvider(name: string, provider: any) {
				providers.set(name, provider);
			},
		} as any);

		assert.ok(providers.has(SUPPORTED_CODEX_PROVIDER));
		const command = commands.get("codex-fast");
		assert.ok(command);
		assert.deepEqual(command.getArgumentCompletions("st"), [{ value: "status", label: "status" }]);
		assert.deepEqual(command.getArgumentCompletions("priority-o"), [
			{ value: "priority-on", label: "priority-on" },
			{ value: "priority-off", label: "priority-off" },
		]);
		assert.equal(command.getArgumentCompletions("zzz"), null);

		const notifications: Array<[string, string]> = [];
		const ctx = { hasUI: true, ui: { notify: (message: string, level: string) => notifications.push([message, level]) } };

		await command.handler("status", ctx);
		await command.handler("bogus", ctx);
		await command.handler("on", ctx);
		assert.deepEqual(JSON.parse(await readFile(process.env.PILEE_CODEX_FAST_STATE_FILE, "utf8")), { enabled: true, priority: false });
		await command.handler("priority-on", ctx);
		assert.deepEqual(JSON.parse(await readFile(process.env.PILEE_CODEX_FAST_STATE_FILE, "utf8")), { enabled: true, priority: true });
		await command.handler("priority-off", ctx);
		assert.deepEqual(JSON.parse(await readFile(process.env.PILEE_CODEX_FAST_STATE_FILE, "utf8")), { enabled: true, priority: false });
		await command.handler("off", ctx);
		assert.deepEqual(JSON.parse(await readFile(process.env.PILEE_CODEX_FAST_STATE_FILE, "utf8")), { enabled: false, priority: false });

		assert.match(notifications.map(([message]) => message).join("\n"), /Codex Fast Mode: OFF/);
		assert.match(notifications.map(([message]) => message).join("\n"), /Usage: \/codex-fast/);
		assert.match(notifications.map(([message]) => message).join("\n"), /Codex Fast Mode enabled/);
		assert.match(notifications.map(([message]) => message).join("\n"), /Codex Fast Mode disabled/);
	} finally {
		delete process.env.PILEE_CODEX_FAST_STATE_FILE;
	}
});
