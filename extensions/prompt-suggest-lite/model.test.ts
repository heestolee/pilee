import assert from "node:assert/strict";
import test from "node:test";
import { completeSimple } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { defaultPromptSuggestLiteConfig } from "./config.ts";
import { generatePromptSuggestion } from "./model.ts";
import { nativeProviderFixture } from "./native-provider.fixture.ts";

function context(fixture: Awaited<ReturnType<typeof nativeProviderFixture>>, signal?: AbortSignal) {
	return { model: fixture.model, modelRegistry: fixture.registry, signal } as ExtensionContext;
}

test("suggestion uses the host native provider and request-time header/baseUrl/env auth", async () => {
	const fixture = await nativeProviderFixture("다음 검증을 진행해줘");
	await assert.rejects(completeSimple(fixture.model, { messages: [] }), /No API provider registered/);
	const signal = new AbortController().signal;
	const result = await generatePromptSuggestion({ ctx: context(fixture, signal), config: { ...defaultPromptSuggestLiteConfig, modelRef: "pi13-fixture/summary", thinking: "low" }, prompt: "다음 작업" });
	assert.deepEqual(result, { text: "다음 검증을 진행해줘", modelRef: "pi13-fixture/summary" });
	assert.equal(fixture.calls.length, 1);
	assert.equal(fixture.calls[0].options?.headers?.["x-fixture-auth"], "local-only");
	assert.equal(fixture.calls[0].model.baseUrl, "https://fixture.invalid/native");
	assert.equal(fixture.calls[0].options?.env?.FIXTURE_REGION, "local");
	assert.equal(fixture.calls[0].options?.reasoning, "low");
	assert.equal(fixture.calls[0].options?.signal, signal);
	assert.equal(fixture.calls[0].context.messages[0].role, "system");
});

test("suggestion preserves modelRef validation and session-default reasoning", async () => {
	const fixture = await nativeProviderFixture("  확인해줘  ");
	await assert.rejects(generatePromptSuggestion({ ctx: context(fixture), config: { ...defaultPromptSuggestLiteConfig, modelRef: "missing/model" }, prompt: "x" }), /model not found/);
	assert.equal(fixture.calls.length, 0);
	const result = await generatePromptSuggestion({ ctx: context(fixture), config: { ...defaultPromptSuggestLiteConfig, modelRef: "summary" }, prompt: "x" });
	assert.equal(result.text, "확인해줘");
	assert.equal(fixture.calls[0].options?.reasoning, undefined);
});

test("legacy host without registry streaming retains the Claude bridge symbol path", async () => {
	const fixture = await nativeProviderFixture("unused");
	const model = { ...fixture.model, api: "claude-bridge" };
	const key = Symbol.for("claude-bridge:activeStreamSimple");
	const globals = globalThis as Record<symbol, unknown>;
	const previous = globals[key];
	let bridgeCalls = 0;
	globals[key] = (_model: unknown, _context: unknown, options: { headers: Record<string, string> }) => {
		bridgeCalls++;
		assert.equal(options.headers["x-legacy"], "fixture");
		return { result: async () => ({ content: [{ type: "text", text: "기존 브리지" }] }) };
	};
	try {
		const ctx = { model, modelRegistry: { getAll: () => [model], getApiKeyAndHeaders: async () => ({ ok: true, headers: { "x-legacy": "fixture" } }) } } as ExtensionContext;
		const result = await generatePromptSuggestion({ ctx, config: defaultPromptSuggestLiteConfig, prompt: "x" });
		assert.equal(result.text, "기존 브리지");
		assert.equal(bridgeCalls, 1);
	} finally {
		if (previous === undefined) delete globals[key]; else globals[key] = previous;
	}
});
