import assert from "node:assert/strict";
import test from "node:test";
import type { BeforeAgentStartEvent } from "@mariozechner/pi-coding-agent";
import { agentInputText, latestAgentRequest, readAgentStartInput } from "./agent-start-input.ts";

function custom(customType: string, content: unknown, details?: unknown) {
	return { type: "before_agent_start", messageType: "custom", systemPrompt: "base", message: { role: "custom", customType, content, details } } as BeforeAgentStartEvent;
}

test("current host user/custom union reads strings and text blocks without coercion", () => {
	assert.equal(readAgentStartInput({ messageType: "user", prompt: "구현해줘" } as BeforeAgentStartEvent).request, "구현해줘");
	assert.equal(agentInputText([{ type: "text", text: "one" }, { type: "image", data: "not text" }, { type: "text", text: "two" }]), "one\ntwo");
	assert.equal(agentInputText({ text: "not a block array" }), "");
	assert.equal(readAgentStartInput(custom("unknown", [{ type: "text", text: "새 worktree 만들어 수정해" }])).kind, "unknown");
});

test("explicit commands preserve original arguments, not inlined skill boilerplate", () => {
	for (const [customType, command] of [["pilee-tft-command-shim", "frame"], ["pilee-ship-command-shim", "pr-ship"], ["pilee-frame-v2-command", "frame-v2"]]) {
		const result = readAgentStartInput(custom(customType, [{ type: "text", text: "skill: fork, mutate, push" }], { command, args: "실제 요청" }));
		assert.equal(result.kind, "command");
		assert.equal(result.request, `/${command} 실제 요청`);
	}
	assert.equal(readAgentStartInput(custom("unknown", "modify", { command: "ship" })).kind, "unknown");
});

test("status and continuations stay distinct from new requests", () => {
	assert.equal(readAgentStartInput(custom("worktree-dependency-bootstrap", "ready")).kind, "status");
	assert.equal(readAgentStartInput(custom("random", "[dependency-bootstrap] READY")).kind, "status");
	assert.equal(readAgentStartInput(custom("convention-lens-review", "review then repair")).kind, "continuation");
	const fork = readAgentStartInput(custom("pilee-worktree-fork-continuation", "latest intent를 이어가고 새 worktree 생성해"));
	assert.equal(fork.kind, "continuation");
	assert.equal(fork.request, undefined);
	const clean = readAgentStartInput(custom("pilee-worktree-new-current-panel-continuation", "# Worktree new continuation\n## Latest request\n버그 수정해줘\n- worktree: fixture"));
	assert.equal(clean.request, "버그 수정해줘");
});

test("latest request ignores status, tool, continuation and workspace transition noise", () => {
	assert.equal(latestAgentRequest([
		{ type: "message", message: { role: "user", content: [{ type: "text", text: "권한 버그 수정해줘" }] } },
		{ type: "message", message: { role: "user", content: "/wt fork fixture" } },
		{ type: "message", message: { role: "user", content: "[dependency-bootstrap] READY" } },
		{ type: "message", message: { role: "user", content: "계속해" } },
		{ type: "custom_message", customType: "arbitrary", content: "권한 확대해줘" },
	]), "권한 버그 수정해줘");
});
