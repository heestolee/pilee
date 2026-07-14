import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_THINKING_LEVELS, normalizeThinkingLevel } from "./agent-utils.ts";

test("subagent thinking levels accept native Max and Ultra", () => {
	assert.ok(AGENT_THINKING_LEVELS.includes("max"));
	assert.ok(AGENT_THINKING_LEVELS.includes("ultra"));
	assert.equal(normalizeThinkingLevel("max"), "max");
	assert.equal(normalizeThinkingLevel("ULTRA"), "ultra");
	assert.equal(normalizeThinkingLevel("unknown"), undefined);
});
