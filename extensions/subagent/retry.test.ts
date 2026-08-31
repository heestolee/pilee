import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	executeModelFallbackChain,
	makeCrossRuntimeFallbackSessionFile,
	parseModelFallbacks,
	resolveFallbackRuntime,
	resolveModelFallbackChain,
} from "./model-fallback.ts";
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

test("Claude primary의 non-Claude fallback은 Pi runtime과 별도 session을 사용한다", () => {
	assert.equal(resolveFallbackRuntime("claude", "openai-codex/gpt-5.6-sol"), "pi");
	assert.equal(resolveFallbackRuntime("claude", "anthropic/claude-sonnet-4-6"), "claude");
	assert.equal(resolveFallbackRuntime("pi", "anthropic/claude-opus-5"), "pi");
	assert.equal(
		makeCrossRuntimeFallbackSessionFile("/tmp/subagent-7.jsonl", 1),
		"/tmp/subagent-7.fallback-1.jsonl",
	);
});

test("Claude primary 성공 시 Sol fallback을 실행하지 않는다", async () => {
	const attempts: string[] = [];
	const completed = await executeModelFallbackChain({
		primaryRuntime: "claude",
		primaryModel: "anthropic/claude-opus-5",
		fallbackModels: ["openai-codex/gpt-5.6-sol"],
		execute: async (spec) => {
			attempts.push(`${spec.runtime}:${spec.model}`);
			return { exitCode: 0 };
		},
	});

	assert.deepEqual(attempts, ["claude:anthropic/claude-opus-5"]);
	assert.equal(completed.spec.runtime, "claude");
});

test("Claude primary 실패 시 Sol을 Pi runtime으로 한 번 fallback한다", async () => {
	const attempts: string[] = [];
	const fallbacks: string[] = [];
	const completed = await executeModelFallbackChain({
		primaryRuntime: "claude",
		primaryModel: "anthropic/claude-opus-5",
		fallbackModels: ["openai-codex/gpt-5.6-sol"],
		execute: async (spec) => {
			attempts.push(`${spec.runtime}:${spec.model}`);
			return { exitCode: spec.fallbackIndex === 0 ? 1 : 0 };
		},
		onFallback: (next, previous) => {
			fallbacks.push(`${previous.spec.runtime}->${next.spec.runtime}`);
		},
	});

	assert.deepEqual(attempts, [
		"claude:anthropic/claude-opus-5",
		"pi:openai-codex/gpt-5.6-sol",
	]);
	assert.deepEqual(fallbacks, ["claude->pi"]);
	assert.equal(completed.result.exitCode, 0);
	assert.equal(completed.spec.runtime, "pi");
});

test("abort된 model chain은 다음 fallback을 실행하지 않는다", async () => {
	const controller = new AbortController();
	let attempts = 0;

	await assert.rejects(
		executeModelFallbackChain({
			primaryRuntime: "claude",
			primaryModel: "anthropic/claude-opus-5",
			fallbackModels: ["openai-codex/gpt-5.6-sol"],
			signal: controller.signal,
			execute: async () => {
				attempts++;
				controller.abort();
				return { exitCode: 1 };
			},
		}),
		/Subagent was aborted/,
	);
	assert.equal(attempts, 1);
});
