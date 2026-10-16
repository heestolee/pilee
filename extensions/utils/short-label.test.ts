import assert from "node:assert/strict";
import test from "node:test";
import { nativeProviderFixture } from "../prompt-suggest-lite/native-provider.fixture.ts";
import { generateShortLabel } from "./short-label.ts";

test("short labels use the configured native provider without manual auth dispatch", async () => {
	const fixture = await nativeProviderFixture("호스트 요약");
	fixture.registry.getApiKeyAndHeaders = async () => { throw new Error("manual auth must not bypass request-time resolution"); };
	const label = await generateShortLabel({ model: fixture.model, modelRegistry: fixture.registry }, { systemPrompt: "fixture", prompt: "summarize", maxTokens: 20 });
	assert.equal(label, "호스트 요약");
	assert.equal(fixture.calls.length, 1);
	assert.ok(fixture.authCalls > 0, "the host owns auth resolution and may probe availability internally");
	assert.equal(fixture.calls[0].options?.maxTokens, 20);
});

test("short labels preserve quiet auth failure and do not start an aborted request", async () => {
	const fixture = await nativeProviderFixture("unused", false);
	assert.equal(await generateShortLabel({ model: fixture.model, modelRegistry: fixture.registry }, { systemPrompt: "fixture", prompt: "summarize" }), "");
	assert.equal(fixture.calls.length, 0);
	const controller = new AbortController(); controller.abort();
	assert.equal(await generateShortLabel({ model: fixture.model, modelRegistry: fixture.registry, signal: controller.signal }, { systemPrompt: "fixture", prompt: "summarize" }), "");
	assert.equal(fixture.calls.length, 0);
});
