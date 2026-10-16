import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { ExtensionRunner, type Extension, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import codexFastMode, { applyCodexFastPayload, applyFastConfiguration, isFastSupportedModel, SUPPORTED_CODEX_PROVIDER, SUPPORTED_MODEL_IDS } from "./index.ts";
import { isRecord, loadFastConfiguration, type FastConfiguration } from "./state.ts";
import { isCodexFastModeEnabled, shouldUseCodexFastBadge } from "../custom-style/footer-state.ts";

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "codex-fast-command-"));
	const previousDir = process.env.PI_CODING_AGENT_DIR;
	const previousState = process.env.PILEE_CODEX_FAST_STATE_FILE;
	process.env.PI_CODING_AGENT_DIR = join(root, "agent");
	process.env.PILEE_CODEX_FAST_STATE_FILE = join(root, "legacy.json");
	const cwd = join(root, "project");
	return {
		cwd, global: join(root, "agent", "settings.json"), project: join(cwd, ".pi", "settings.json"), legacy: join(root, "legacy.json"),
		write(path: string, data: unknown) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(data)); },
		close() {
			if (previousDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
			else process.env.PI_CODING_AGENT_DIR = previousDir;
			if (previousState === undefined) delete process.env.PILEE_CODEX_FAST_STATE_FILE;
			else process.env.PILEE_CODEX_FAST_STATE_FILE = previousState;
			rmSync(root, { recursive: true, force: true });
		},
	};
}

function harness(cwd: string, flagValues: Record<string, boolean> = {}) {
	const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
	const flags = new Map<string, Parameters<ExtensionAPI["registerFlag"]>[1]>();
	const handlers: Extension["handlers"] = new Map();
	const api: Pick<ExtensionAPI, "registerCommand" | "registerFlag" | "getFlag" | "on"> = {
		registerCommand(name, value) { assert.equal(commands.has(name), false); commands.set(name, value); },
		registerFlag(name, value) { assert.equal(flags.has(name), false); flags.set(name, value); },
		getFlag(name) { return flagValues[name] ?? false; },
		on(name, handler) {
			const values = handlers.get(name) ?? [];
			const wrapped = (...args: unknown[]) => Reflect.apply(handler, undefined, args);
			values.push(wrapped); handlers.set(name, values);
			return () => { handlers.set(name, values.filter((value) => value !== wrapped)); };
		},
	};
	// Only the external Pi boundary is partial; any provider override or other
	// unplanned API use fails immediately rather than silently doing nothing.
	codexFastMode(new Proxy(api as ExtensionAPI, { get(target, key) {
		if (!(key in target)) throw new Error(`Unexpected Pi API: ${String(key)}`);
		return Reflect.get(target, key);
	} }));
	const notifications: string[] = [];
	const statuses = new Map<string, string | undefined>();
	const ctx = {
		cwd, mode: "tui", model: { provider: "openai-codex", id: "gpt-5.5" }, hasUI: true,
		ui: { notify(message: string) { notifications.push(message); }, setStatus(key: string, value: string | undefined) { statuses.set(key, value); } },
	};
	return {
		commands, flags, handlers, ctx, notifications, statuses,
		async emit(name: string, data: Record<string, unknown> = {}) {
			let result: unknown;
			for (const handler of handlers.get(name) ?? []) result = await handler({ type: name, ...data }, ctx as ExtensionContext);
			return result;
		},
		async command(args: string, name = "codex-fast") { await commands.get(name)!.handler(args, ctx as ExtensionCommandContext); },
		async request(payload: object = {}) {
			const errors: unknown[] = [];
			const receiver = {
				extensions: [{ path: "fast", handlers }],
				createContext: () => ctx,
				emitError: (error: unknown) => errors.push(error),
			};
			const result = await Reflect.apply(ExtensionRunner.prototype.emitBeforeProviderRequest, receiver, [payload]);
			assert.deepEqual(errors, []);
			assert.ok(isRecord(result));
			return result;
		},
	};
}

test("legacy payload helper keeps low verbosity and optional priority on only 5.4/5.5", () => {
	for (const id of SUPPORTED_MODEL_IDS) {
		assert.equal(isFastSupportedModel(id), true);
		const payload = { text: { format: "plain" }, metadata: "keep", service_tier: "default" };
		assert.deepEqual(applyCodexFastPayload(payload, { provider: SUPPORTED_CODEX_PROVIDER, id }, { enabled: true, priority: false }), {
			text: { format: "plain", verbosity: "low" }, metadata: "keep", service_tier: "default",
		});
		assert.deepEqual(applyCodexFastPayload({}, { provider: SUPPORTED_CODEX_PROVIDER, id }, { enabled: true, priority: true }), {
			text: { verbosity: "low" }, service_tier: "priority",
		});
		assert.equal(applyCodexFastPayload(payload, { provider: SUPPORTED_CODEX_PROVIDER, id }, { enabled: false, priority: true }), payload);
	}
	for (const id of [undefined, "gpt-5.5-preview", "gpt-6.1-sol"]) assert.equal(isFastSupportedModel(id), false);
	const payload = { text: {} };
	assert.equal(applyCodexFastPayload(payload, { provider: "openai", id: "gpt-5.5" }, { enabled: true, priority: true }), payload);
	assert.equal(applyCodexFastPayload("raw", { provider: SUPPORTED_CODEX_PROVIDER, id: "gpt-5.5" }, { enabled: true, priority: true }), "raw");
});

test("one owner registers both commands and flags without overriding the provider", () => {
	const h = harness("/fixture");
	assert.deepEqual([...h.commands.keys()], ["codex-fast", "codex-ultrafast"]);
	assert.deepEqual([...h.flags.keys()], ["fast", "ultrafast"]);
	assert.deepEqual([...h.handlers.keys()], ["session_start", "model_select", "before_provider_request", "session_shutdown"]);
	assert.deepEqual(h.commands.get("codex-fast")!.getArgumentCompletions!("priority-o"), [
		{ value: "priority-on", label: "priority-on" }, { value: "priority-off", label: "priority-off" },
	]);
	assert.equal(h.commands.get("codex-fast")!.getArgumentCompletions!("bogus"), null);
});

test("bare commands toggle fast/ultrafast and status/help/startup never migrate settings", async () => {
	const f = fixture();
	try {
		f.write(f.legacy, { enabled: false, priority: false });
		const before = readFileSync(f.legacy, "utf8");
		const h = harness(f.cwd);
		await h.emit("session_start"); await h.command("status"); await h.command("bogus");
		await h.command("bogus", "codex-ultrafast");
		assert.equal(existsSync(f.global), false);
		assert.match(h.notifications.join("\n"), /OFF · 비활성/);
		assert.match(h.notifications.join("\n"), /사용법/);
		await h.command(""); assert.equal(loadFastConfiguration(f.cwd).mode, "fast");
		assert.equal((await h.emit("before_provider_request", { payload: {} }) as { service_tier: string }).service_tier, "priority");
		await h.command(""); assert.equal(loadFastConfiguration(f.cwd).mode, "off");
		await h.command("", "codex-ultrafast"); assert.equal(loadFastConfiguration(f.cwd).mode, "ultrafast");
		await h.command("", "codex-ultrafast"); assert.equal(loadFastConfiguration(f.cwd).mode, "off");
		assert.equal(readFileSync(f.legacy, "utf8"), before);
	} finally { f.close(); }
});

test("legacy on/off and priority-on/off remain independent, including across reload", async () => {
	const f = fixture();
	try {
		const h = harness(f.cwd);
		await h.emit("session_start");
		await h.command("priority-on");
		assert.equal(loadFastConfiguration(f.cwd).mode, "off");
		await h.command("on");
		assert.deepEqual(await h.emit("before_provider_request", { payload: { text: { format: "keep" } } }), {
			text: { format: "keep", verbosity: "low" }, service_tier: "priority",
		});
		await h.command("priority-off");
		assert.equal(loadFastConfiguration(f.cwd).mode, "fast");
		await h.emit("session_start");
		assert.deepEqual(await h.emit("before_provider_request", { payload: { service_tier: "upstream" } }), {
			text: { verbosity: "low" }, service_tier: "upstream",
		});
		h.ctx.model.id = "gpt-5.6-sol";
		await h.command("priority-on");
		assert.equal(await h.emit("before_provider_request", { payload: {} }), undefined);
		await h.command("off"); assert.equal(loadFastConfiguration(f.cwd).priority, true);
	} finally { f.close(); }
});

test("explicit off beats legacy enabled; unsupported selected model stays inactive despite spoofed payload", async () => {
	const f = fixture();
	try {
		f.write(f.legacy, { enabled: true, priority: true });
		f.write(f.global, { "pi-codex-fast": { mode: "off" } });
		const h = harness(f.cwd);
		await h.emit("session_start");
		assert.equal(await h.emit("before_provider_request", { payload: {} }), undefined);
		await h.command("");
		for (const id of ["gpt-6.1-sol", "gpt-6.1-astra", "gpt-5.5-preview"]) {
			h.ctx.model.id = id;
			await h.emit("model_select", { model: h.ctx.model, source: "set" });
			assert.match(h.statuses.get("fast-priority")!, /Fast · 비활성/);
			await h.command("status"); assert.match(h.notifications.at(-1)!, /비활성/);
			const payload = { model: "gpt-5.5", service_tier: "default", text: { verbosity: "high" }, priority: true };
			assert.equal(await h.emit("before_provider_request", { payload }), undefined);
			assert.equal(payload.service_tier, "default"); assert.equal(payload.text.verbosity, "high");
		}
		h.ctx.model.id = "gpt-5.5"; await h.emit("model_select", { model: h.ctx.model, source: "set" });
		assert.match(h.statuses.get("fast-priority")!, /Fast · 활성/);
	} finally { f.close(); }
});

test("exact original Fast and Ultrafast model matrix keeps unrelated payload fields intact", () => {
	const config: FastConfiguration = { mode: "fast", priority: true, legacyOnly: false, source: "settings", settingsPath: "/unused" };
	const payload = Object.freeze({ input: [{ role: "user", content: "keep" }], text: Object.freeze({ format: "keep" }), metadata: { trace: 1 } });
	for (const id of ["gpt-5.4", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-6-astra"]) {
		const result = applyFastConfiguration(payload, { provider: "openai-codex", id }, config);
		assert.deepEqual(result, { ...payload, text: id === "gpt-5.4" || id === "gpt-5.5" ? { format: "keep", verbosity: "low" } : payload.text, service_tier: "priority" });
	}
	for (const model of [{ provider: "openai", id: "gpt-5.5" }, { provider: "openai-codex", id: "gpt-6.1-sol" }, {}]) {
		assert.equal(applyFastConfiguration(payload, model, config), payload);
	}
	const ultra = { ...config, mode: "ultrafast" as const };
	assert.deepEqual(applyFastConfiguration(payload, { provider: "openai", id: "gpt-5.6-sol" }, ultra), { ...payload, service_tier: "ultrafast" });
	for (const provider of ["openai-codex", "unknown"]) assert.equal(applyFastConfiguration(payload, { provider, id: "gpt-5.6-sol" }, ultra), payload);
	assert.equal(applyFastConfiguration(payload, { provider: "openai", id: "gpt-6.1-sol" }, ultra), payload);
	for (const value of [null, "raw", []]) assert.equal(applyFastConfiguration(value, { provider: "openai", id: "gpt-5.6-sol" }, ultra), value);
});

test("startup flags are transient, ultrafast wins both flags, and headless operation works", async () => {
	const f = fixture();
	try {
		const cases: Record<string, boolean>[] = [{ fast: true }, { ultrafast: true }, { fast: true, ultrafast: true }];
		for (const flags of cases) {
			const h = harness(f.cwd, flags); h.ctx.hasUI = false;
			if (flags.ultrafast) h.ctx.model = { provider: "openai", id: "gpt-5.6-sol" };
			await h.emit("session_start");
			assert.equal(existsSync(f.global), false);
			const payload = await h.emit("before_provider_request", { payload: {} }) as { service_tier: string };
			assert.equal(payload.service_tier, flags.ultrafast ? "ultrafast" : "priority");
			assert.equal(h.notifications.length, 0);
		}
	} finally { f.close(); }
});

test("first Ultrafast selection retains Fast defaults but explicit priority-off survives startup flags", async () => {
	const f = fixture();
	try {
		const h = harness(f.cwd); await h.emit("session_start");
		await h.command("", "codex-ultrafast"); await h.command("");
		assert.equal((await h.emit("before_provider_request", { payload: {} }) as { service_tier: string }).service_tier, "priority");
		await h.command("priority-off");
		const before = readFileSync(f.global, "utf8");
		const withFlag = harness(f.cwd, { fast: true }); await withFlag.emit("session_start");
		assert.deepEqual(await withFlag.emit("before_provider_request", { payload: {} }), { text: { verbosity: "low" } });
		assert.equal(readFileSync(f.global, "utf8"), before);
		// Also cover the legacy-only canonical scope, not just the full Fast list.
		f.write(f.global, { "pi-codex-fast": { mode: "off", legacyOnly: true, priority: false } });
		const legacyFlag = harness(f.cwd, { fast: true }); await legacyFlag.emit("session_start");
		assert.deepEqual(await legacyFlag.emit("before_provider_request", { payload: {} }), { text: { verbosity: "low" } });
	} finally { f.close(); }
});

test("queued repeated toggles persist the final mode and preserve fresh unrelated settings", async () => {
	const f = fixture();
	try {
		f.write(f.global, { theme: "keep", "pi-codex-fast": { mode: "off", custom: "keep" } });
		const h = harness(f.cwd); await h.emit("session_start");
		await Promise.all(Array.from({ length: 20 }, () => h.command("")));
		assert.equal(loadFastConfiguration(f.cwd).mode, "off");
		const latest = JSON.parse(readFileSync(f.global, "utf8")); latest.newSetting = "keep"; f.write(f.global, latest);
		await h.command("");
		const revision = loadFastConfiguration(f.cwd).revision;
		assert.equal(typeof revision, "string");
		assert.deepEqual(JSON.parse(readFileSync(f.global, "utf8")), {
			theme: "keep", newSetting: "keep", "pi-codex-fast": { mode: "fast", enabled: true, priority: true, legacyOnly: false, custom: "keep", revision },
		});
		assert.deepEqual(readdirSync(dirname(f.global)), ["settings.json"]);
	} finally { f.close(); }
});

test("priority-off survives bare mode toggles and project commands persist in project scope", async () => {
	const f = fixture();
	try {
		const h = harness(f.cwd); await h.emit("session_start");
		await h.command("priority-off"); await h.command("");
		assert.equal(loadFastConfiguration(f.cwd).priority, false);
		assert.deepEqual(await h.emit("before_provider_request", { payload: {} }), { text: { verbosity: "low" } });
		await h.command(""); await h.command("");
		assert.equal(loadFastConfiguration(f.cwd).priority, false);
		f.write(f.project, { "pi-codex-fast": { mode: "off" }, theme: "project" });
		const globalBefore = readFileSync(f.global, "utf8");
		await h.emit("session_start"); h.ctx.hasUI = false; await h.command("");
		assert.equal(loadFastConfiguration(f.cwd).mode, "fast");
		assert.equal(readFileSync(f.global, "utf8"), globalBefore);
		assert.equal(JSON.parse(readFileSync(f.project, "utf8")).theme, "project");
		await h.emit("session_start");
		assert.equal((await h.emit("before_provider_request", { payload: {} }) as { service_tier: string }).service_tier, "priority");
	} finally { f.close(); }
});

test("malformed settings fail closed and failed persistence cannot activate Fast", async () => {
	const f = fixture();
	try {
		f.write(f.legacy, { enabled: true, priority: true }); f.write(f.global, {}); writeFileSync(f.global, "{broken");
		const h = harness(f.cwd); await h.emit("session_start");
		assert.equal(await h.emit("before_provider_request", { payload: {} }), undefined);
		assert.match(h.statuses.get("fast-priority")!, /비활성/);
		assert.match(h.notifications.at(-1)!, /설정 처리 실패/);
		assert.equal(readFileSync(f.global, "utf8"), "{broken");
		f.write(f.global, { "pi-codex-fast": { mode: "off" } }); await h.emit("session_start");
		writeFileSync(f.global, "{broken"); await h.command("");
		assert.equal(await h.emit("before_provider_request", { payload: {} }), undefined);
		f.write(f.global, { "pi-codex-fast": { mode: "off" } }); await h.command("");
		assert.equal(loadFastConfiguration(f.cwd).mode, "fast");
	} finally { f.close(); }
});

test("current host event runner composes payload hooks before and after Fast without any provider call", async () => {
	const f = fixture();
	try {
		f.write(f.global, { "pi-codex-fast": { mode: "fast" } });
		const h = harness(f.cwd); await h.emit("session_start");
		const errors: unknown[] = [];
		const handlers = h.handlers.get("before_provider_request")!;
		const receiver = {
			extensions: [
				{ path: "before", handlers: new Map([["before_provider_request", [(event: { payload: object }) => ({ ...event.payload, upstream: "keep" })]]]) },
				{ path: "fast", handlers: new Map([["before_provider_request", handlers]]) },
				{ path: "after", handlers: new Map([["before_provider_request", [(event: { payload: object }) => ({ ...event.payload, downstream: "keep" })]]]) },
			],
			createContext: () => h.ctx,
			emitError: (error: unknown) => errors.push(error),
		};
		const result = await Reflect.apply(ExtensionRunner.prototype.emitBeforeProviderRequest, receiver, [{ input: "original" }]);
		assert.deepEqual(result, { input: "original", upstream: "keep", text: { verbosity: "low" }, service_tier: "priority", downstream: "keep" });
		assert.deepEqual(errors, []);
	} finally { f.close(); }
});

function badge(h: ReturnType<typeof harness>): boolean {
	return shouldUseCodexFastBadge(h.ctx.model.provider, isCodexFastModeEnabled(h.ctx.cwd), h.ctx.model.id, h.ctx.cwd);
}

test("two instances honor the other panel's OFF and priority-off before requests and later commands", async () => {
	const f = fixture();
	const a = harness(f.cwd), b = harness(f.cwd);
	try {
		f.write(f.global, { "pi-codex-fast": { mode: "fast", priority: true } });
		await b.emit("session_start"); await a.emit("session_start");
		assert.deepEqual(await a.request({ input: "keep" }), { input: "keep", text: { verbosity: "low" }, service_tier: "priority" });
		await b.command("off");
		assert.deepEqual(await a.request({ input: "keep" }), { input: "keep" });
		await a.command("status"); assert.match(a.notifications.at(-1)!, /OFF · 비활성/);
		assert.equal(badge(a), false);
		await a.command("on"); await b.command("priority-off");
		assert.equal(loadFastConfiguration(f.cwd).mode, "fast");
		assert.deepEqual(await a.request({ service_tier: "upstream" }), { service_tier: "upstream", text: { verbosity: "low" } });
		for (const action of ["on", "", ""]) {
			await a.command(action);
			assert.equal(loadFastConfiguration(f.cwd).priority, false);
			assert.deepEqual(await a.request({}), loadFastConfiguration(f.cwd).mode === "off" ? {} : { text: { verbosity: "low" } });
		}
		a.ctx.model.id = "gpt-5.6-sol";
		assert.deepEqual(await a.request({ input: "keep" }), { input: "keep" });
		assert.match(a.statuses.get("fast-priority")!, /Fast · 비활성; priority: OFF/);
		assert.equal(badge(a), false);
	} finally { await a.emit("session_shutdown"); await b.emit("session_shutdown"); f.close(); }
});

test("two instances re-read project precedence without writing the global setting", async () => {
	const f = fixture();
	const a = harness(f.cwd), b = harness(f.cwd);
	try {
		f.write(f.global, { "pi-codex-fast": { mode: "fast", priority: true } });
		f.write(f.project, { theme: "keep", "pi-codex-fast": { mode: "off", priority: true } });
		const globalBefore = readFileSync(f.global, "utf8");
		await b.emit("session_start"); await a.emit("session_start");
		assert.deepEqual(await a.request({}), {});
		await b.command("on");
		assert.equal((await a.request({})).service_tier, "priority");
		await b.command("priority-off");
		assert.deepEqual(await a.request({}), { text: { verbosity: "low" } });
		await a.command("on"); assert.equal(loadFastConfiguration(f.cwd).priority, false);
		await b.command("off"); assert.deepEqual(await a.request({}), {});
		assert.equal(readFileSync(f.global, "utf8"), globalBefore);
		assert.equal(JSON.parse(readFileSync(f.project, "utf8")).theme, "keep");
	} finally { await a.emit("session_shutdown"); await b.emit("session_shutdown"); f.close(); }
});

test("CLI choices stay transient across unrelated writes but a same-mode explicit OFF supersedes them", async () => {
	const f = fixture();
	try {
		for (const mode of ["fast", "ultrafast"] as const) {
			f.write(f.global, { theme: "before", "pi-codex-fast": { mode: "off", priority: true } });
			const before = readFileSync(f.global, "utf8");
			const b = harness(f.cwd), a = harness(f.cwd, { [mode]: true });
			if (mode === "ultrafast") a.ctx.model = { provider: "openai", id: "gpt-5.6-sol" };
			try {
				await b.emit("session_start"); await a.emit("session_start");
				assert.equal(readFileSync(f.global, "utf8"), before);
				const expectedTier = mode === "fast" ? "priority" : "ultrafast";
				assert.equal((await a.request({})).service_tier, expectedTier);
				assert.equal(badge(a), true); assert.match(a.statuses.get("fast-priority")!, / · 활성/);
				f.write(f.global, { theme: "after", unrelated: 1, "pi-codex-fast": { mode: "off", priority: true, extra: "keep" } });
				assert.equal((await a.request({})).service_tier, expectedTier);
				assert.equal(badge(a), true);
				await b.command("off");
				assert.equal(typeof loadFastConfiguration(f.cwd).revision, "string");
				assert.deepEqual(await a.request({ input: "keep" }), { input: "keep" });
				await a.command("status"); assert.match(a.notifications.at(-1)!, /OFF · 비활성/);
				assert.equal(badge(a), false);
				await a.emit("session_start");
				assert.deepEqual(await a.request({}), {}); assert.equal(badge(a), false);
				assert.equal(JSON.parse(readFileSync(f.global, "utf8")).unrelated, 1);
			} finally { await a.emit("session_shutdown"); await b.emit("session_shutdown"); }
		}
	} finally { f.close(); }
});

test("another panel's priority-off cancels stale CLI choices and later on/toggle never restores priority", async () => {
	const f = fixture();
	try {
		for (const mode of ["fast", "ultrafast"] as const) {
			f.write(f.global, { "pi-codex-fast": { mode: "off", priority: true } });
			const b = harness(f.cwd), a = harness(f.cwd, { [mode]: true });
			if (mode === "ultrafast") a.ctx.model = { provider: "openai", id: "gpt-5.6-sol" };
			try {
				await b.emit("session_start"); await a.emit("session_start");
				assert.equal(badge(a), true);
				await b.command("priority-off");
				assert.deepEqual(await a.request({}), {}); assert.equal(badge(a), false);
				a.ctx.model = { provider: "openai-codex", id: "gpt-5.6-sol" };
				for (const action of ["on", "", ""]) {
					await a.command(action);
					assert.equal(loadFastConfiguration(f.cwd).priority, false);
					assert.deepEqual(await a.request({}), {}); assert.equal(badge(a), false);
				}
			} finally { await a.emit("session_shutdown"); await b.emit("session_shutdown"); }
		}
	} finally { f.close(); }
});

test("priority-only commands do not persist CLI modes and malformed settings invalidate transient choices", async () => {
	const f = fixture();
	try {
		for (const mode of ["fast", "ultrafast"] as const) {
			f.write(f.global, { "pi-codex-fast": { mode: "off", priority: true } });
			const h = harness(f.cwd, { [mode]: true });
			if (mode === "ultrafast") h.ctx.model = { provider: "openai", id: "gpt-5.6-sol" };
			try {
				await h.emit("session_start");
				assert.equal((await h.request({})).service_tier, mode === "fast" ? "priority" : "ultrafast");
				writeFileSync(f.global, "{broken");
				assert.deepEqual(await h.request({ input: "keep" }), { input: "keep" });
				assert.match(h.statuses.get("fast-priority")!, /비활성/); assert.equal(badge(h), false);
				f.write(f.global, { "pi-codex-fast": { mode: "off", priority: true } });
				assert.deepEqual(await h.request({}), {}); assert.equal(badge(h), false);
				const fresh = harness(f.cwd, { [mode]: true });
				try {
					await fresh.emit("session_start");
					for (const action of ["priority-on", "priority-off"]) {
						await fresh.command(action);
						assert.equal(loadFastConfiguration(f.cwd).mode, "off");
						assert.equal(loadFastConfiguration(f.cwd).priority, action === "priority-on");
					}
				} finally { await fresh.emit("session_shutdown"); }
			} finally { await h.emit("session_shutdown"); }
		}
	} finally { f.close(); }
});

test("effective footer state survives separate module loads and old-runtime cleanup but not owner shutdown", async () => {
	const f = fixture();
	const old = harness(f.cwd, { fast: true }), active = harness(f.cwd, { ultrafast: true });
	try {
		f.write(f.global, { "pi-codex-fast": { mode: "off", priority: true } });
		await old.emit("session_start");
		const separate = await import(new URL("./state.ts?footer-copy", import.meta.url).href);
		assert.equal(separate.loadEffectiveFastConfiguration(f.cwd).mode, "fast");
		active.ctx.model = { provider: "openai", id: "gpt-5.6-sol" };
		await active.emit("session_start"); await old.emit("session_shutdown"); await old.emit("session_shutdown");
		assert.equal(separate.loadEffectiveFastConfiguration(f.cwd).mode, "ultrafast");
		assert.equal(badge(active), true); assert.equal((await active.request({})).service_tier, "ultrafast");
		active.ctx.model = { provider: "openai-codex", id: "gpt-6.1-sol" };
		assert.deepEqual(await active.request({}), {}); assert.equal(badge(active), false);
		assert.match(active.statuses.get("fast-priority")!, /Ultrafast · 비활성/);
		await active.emit("session_shutdown");
		assert.equal(separate.loadEffectiveFastConfiguration(f.cwd).mode, "off");
		const reloaded = harness(f.cwd);
		try { await reloaded.emit("session_start"); assert.equal(badge(reloaded), false); assert.deepEqual(await reloaded.request({}), {}); }
		finally { await reloaded.emit("session_shutdown"); }
	} finally { await active.emit("session_shutdown"); await old.emit("session_shutdown"); f.close(); }
});
