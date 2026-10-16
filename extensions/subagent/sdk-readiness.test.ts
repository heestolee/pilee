import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
	// Keep this readiness regression hermetic even if the optional SDK is installed later.
	if (specifier === "@anthropic-ai/claude-agent-sdk") {
		throw Object.assign(new Error("Cannot find package '@anthropic-ai/claude-agent-sdk' imported from readiness fixture"), { code: "ERR_MODULE_NOT_FOUND" });
	}
	try { return next(specifier, context); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" && /^\.\.?\//.test(specifier) && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
		throw error;
	}
} });
const { isMissingClaudeAgentSdk, runClaudeAgentViaSdk } = await import("./claude-sdk-runner.ts");
const { resolveClaudeRuntimeMode } = await import("./config.ts");

test("missing optional SDK returns actionable readiness failure without CLI fallback or external execution", async () => {
	assert.throws(() => import.meta.resolve("@anthropic-ai/claude-agent-sdk"), /Cannot find package/);
	const result = await runClaudeAgentViaSdk("/fixture/project", { name: "fixture", description: "local readiness fixture", source: "user", runtime: "claude", model: "anthropic/claude-sonnet-4-5", filePath: "/fixture/agent.md", systemPrompt: "" }, "fixture task", 1, undefined, undefined, (results) => ({ mode: "single", inheritMainContext: false, projectAgentsDir: null, results }), undefined, "/fixture/never-created.jsonl");
	assert.equal(result.exitCode, 1);
	assert.equal(result.runtime, "claude");
	assert.equal(result.stopReason, "error");
	assert.equal(result.sessionFile, "/fixture/never-created.jsonl");
	assert.match(result.errorMessage!, /@anthropic-ai\/claude-agent-sdk/);
	assert.match(result.errorMessage!, /자동 CLI 전환은 하지 않았습니다/);
	assert.deepEqual(result.messages, []);
	assert.equal(resolveClaudeRuntimeMode("/fixture", { globalPath: null, projectPath: null }), "sdk", "do not silently change default mode");
});

test("readiness classifier does not hide unrelated transitive or import errors", () => {
	assert.equal(isMissingClaudeAgentSdk(Object.assign(new Error("Cannot find package '@anthropic-ai/claude-agent-sdk' imported from fixture"), { code: "ERR_MODULE_NOT_FOUND" })), true);
	assert.equal(isMissingClaudeAgentSdk(Object.assign(new Error("Cannot find package 'transitive-dependency' imported from @anthropic-ai/claude-agent-sdk"), { code: "ERR_MODULE_NOT_FOUND" })), false);
	assert.equal(isMissingClaudeAgentSdk(new Error("Authorization failed")), false);
});
