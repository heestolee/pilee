import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parseModelFallbacks, resolveModelFallbackChain } from "./model-fallback.ts";
import { readPersistedSessionSnapshot } from "./persisted-session.ts";

test("persisted session fallback은 provider errorMessage를 runner에 전달할 수 있게 보존한다", () => {
	const dir = mkdtempSync(join(tmpdir(), "pilee-subagent-retry-"));
	const sessionFile = join(dir, "session.jsonl");
	try {
		writeFileSync(sessionFile, [
			JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "thinking", thinking: "state 확인 중" }], stopReason: "toolUse" } }),
			JSON.stringify({ type: "message", message: { role: "assistant", content: [], stopReason: "error", errorMessage: "Codex error: Our servers are currently overloaded. Please try again later." } }),
		].join("\n") + "\n");

		const snapshot = readPersistedSessionSnapshot(sessionFile);
		assert.equal(snapshot.terminalStopReason, "error");
		assert.match(snapshot.terminalErrorMessage ?? "", /overloaded/i);

		assert.equal(snapshot.isTerminal, true);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("model fallback chain은 Sol 다음 Terra와 Spark를 순서대로 유지한다", () => {
	const fallbacks = parseModelFallbacks(
		"openai-codex/gpt-5.6-terra, openai-codex/gpt-5.3-codex-spark",
		undefined,
		(model) => model.trim() || undefined,
	);
	assert.deepEqual(fallbacks, [
		"openai-codex/gpt-5.6-terra",
		"openai-codex/gpt-5.3-codex-spark",
	]);
	assert.deepEqual(resolveModelFallbackChain({
		model: "openai-codex/gpt-5.6-sol",
		modelFallback: fallbacks?.[0],
		modelFallbacks: fallbacks,
	}), fallbacks);
});

test("기존 단일 modelFallback 설정도 fallback chain으로 호환한다", () => {
	assert.deepEqual(resolveModelFallbackChain({
		model: "openai-codex/gpt-5.6-sol",
		modelFallback: "openai-codex/gpt-5.6-terra",
	}), ["openai-codex/gpt-5.6-terra"]);
});
