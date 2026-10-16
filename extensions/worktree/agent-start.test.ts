import assert from "node:assert/strict";
import test from "node:test";
import type { BeforeAgentStartEvent } from "@mariozechner/pi-coding-agent";
import { dependencyBootstrapPrompt, isImplementationStartPrompt } from "./bootstrap-domains.ts";

function custom(customType: string, text: string, details: unknown = {}) {
	return { messageType: "custom", message: { customType, content: [{ type: "text", text }], details } } as BeforeAgentStartEvent;
}

const branch = [{ type: "message", message: { role: "user", content: "예약 버그 구현하고 검증해줘" } }];

test("readiness sees explicit custom implementation and inherited work, not arbitrary boilerplate", () => {
	for (const event of [
		custom("pilee-tft-command-shim", "inlined skill", { command: "frame", args: "예약 버그 구현해줘" }),
		custom("pilee-tft-command-shim", "inlined skill", { command: "verify", args: "예약" }),
		custom("pilee-ship-command-shim", "inlined skill", { command: "pr-ship", args: "7" }),
		custom("pilee-worktree-fork-continuation", "exact session ready"),
		custom("pilee-frame-worktree-fork-continuation", "구현 시작"),
		custom("pilee-frame-v2-worktree-fork-continuation", "구현 시작"),
	]) {
		const prompt = dependencyBootstrapPrompt(event, branch);
		assert.equal(typeof prompt, "string");
		assert.equal(isImplementationStartPrompt(prompt!), true);
		assert.doesNotMatch(prompt!, /inlined skill|exact session ready/);
	}
	for (const customType of ["unknown", "worktree-dependency-bootstrap", "worktree-cwd-binding"]) {
		assert.equal(dependencyBootstrapPrompt(custom(customType, "구현하고 install 해줘"), branch), undefined);
	}
});

test("scoped question/result readiness never bootstraps an unrelated implementation", () => {
	for (const customType of ["heestolee.study-hard.question-route", "pilee-meta-review-worker-request"]) {
		const question = custom(customType, "자료 질문: 코드 수정 권한 아님");
		const scopedBranch = [...branch, { type: "custom_message", ...question.message }];
		for (const event of [question, custom("subagent-tool", "구현하고 install 해줘", { status: "done" }), custom("subagent-tool", "실패", { status: "error" }), custom("until-prompt", "loop", { agentStart: { kind: "continuation", request: "예약 버그 구현해줘" } }), { messageType: "user", prompt: "계속해" } as BeforeAgentStartEvent]) {
			const prompt = dependencyBootstrapPrompt(event, scopedBranch);
			assert.equal(prompt, undefined);
			assert.equal(isImplementationStartPrompt(prompt ?? ""), false);
		}
		const explicitBranch = [...scopedBranch, { type: "message", message: { role: "user", content: "이제 예약 버그 수정해줘" } }];
		const prompt = dependencyBootstrapPrompt(custom("subagent-tool", "완료", { status: "done" }), explicitBranch);
		assert.equal(prompt, "이제 예약 버그 수정해줘");
		assert.equal(isImplementationStartPrompt(prompt!), true);
	}
});

test("clean continuation preserves original request and no-request fork cannot invent work", () => {
	assert.equal(dependencyBootstrapPrompt(custom("pilee-worktree-fork-continuation", "검증 수정 구현"), []), undefined);
	assert.equal(dependencyBootstrapPrompt(custom("pilee-worktree-new-current-panel-continuation", "# Worktree new continuation\n## Latest request\nAPI 수정해줘\n- worktree: fixture"), []), "API 수정해줘");
	assert.equal(dependencyBootstrapPrompt({ messageType: "user", prompt: "진짜 사용자 요청" } as BeforeAgentStartEvent, []), "진짜 사용자 요청");
});
