import assert from "node:assert/strict";
import test from "node:test";
import { generateSummary } from "./index.ts";

const entries = [{ type: "message", message: { role: "user", content: "한글 작업 맥락 ".repeat(80) } }];
const success = { stopReason: "stop", content: [{ type: "text", text: "- provider 경유 요약" }] };

test("summary uses configured provider registry rather than global completion/auth bypass", async () => {
	let calls = 0;
	const model = { id: "local", provider: "custom" };
	const registry = {
		getApiKeyAndHeaders() { throw new Error("registry stream owns request auth"); },
		streamSimple(actualModel: any, context: any, options: any) {
			calls++;
			assert.equal(actualModel, model);
			assert.match(context.messages[0].content[0].text, /한글 작업 맥락/);
			assert.equal(options.maxTokens, 600);
			assert.equal(options.reasoning, "minimal");
			assert.ok(options.signal instanceof AbortSignal);
			assert.equal(options.apiKey, undefined);
			return { result: async () => success };
		},
	};
	const result = await generateSummary(entries, { model, modelRegistry: registry } as any, async () => { throw new Error("global complete forbidden"); });
	assert.equal(result, "- provider 경유 요약");
	assert.equal(calls, 1);
});

test("summary preserves legacy resolved auth fallback and gracefully handles missing auth/errors", async () => {
	const model = { id: "local" };
	const registry = { getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "fixture-only", headers: { "x-fixture": "yes" } }) };
	let calls = 0;
	assert.equal(await generateSummary(entries, { model, modelRegistry: registry } as any, async (_model, _ctx, options) => {
		calls++;
		assert.equal(options?.apiKey, "fixture-only");
		assert.equal(options?.headers?.["x-fixture"], "yes");
		return success as any;
	}), "- provider 경유 요약");
	assert.equal(calls, 1);
	assert.equal(await generateSummary(entries, { model, modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: false }) } } as any, async () => { throw new Error("no auth must not call"); }), null);
	for (const streamSimple of [() => { throw new Error("auth denied"); }, () => ({ result: async () => ({ stopReason: "error", content: [] }) })]) {
		assert.equal(await generateSummary(entries, { model, modelRegistry: { streamSimple } } as any), null);
	}
});

test("summary deadline and caller cancellation abort registry work and return the last-message fallback signal", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout"] });
	let signal!: AbortSignal;
	const registry = { streamSimple(_model: any, _ctx: any, options: any) {
		signal = options.signal;
		return { result: () => new Promise((_resolve, reject) => {
			if (signal.aborted) reject(signal.reason);
			else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
		}) };
	} };
	const pending = generateSummary(entries, { model: {}, modelRegistry: registry } as any);
	t.mock.timers.tick(20_000);
	assert.equal(await pending, null);
	assert.equal(signal.aborted, true);
	const caller = new AbortController();
	const aborted = generateSummary(entries, { model: {}, modelRegistry: registry, signal: caller.signal } as any);
	caller.abort();
	assert.equal(await aborted, null);
	assert.equal(signal.aborted, true);
});
