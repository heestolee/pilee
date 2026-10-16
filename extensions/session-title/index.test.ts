import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import sessionTitle from "./index.ts";

function harness() {
	const hooks: Record<string, any> = {};
	const calls: any[] = [];
	const names: string[] = [];
	let name: string | undefined;
	let result: () => Promise<any> = async () => ({ stopReason: "stop", content: [{ type: "text", text: "요청 제목" }] });
	const ctx = {
		cwd: "/tmp/title-fixture", hasUI: false,
		model: { id: "fake", provider: "fake" },
		sessionManager: { getEntries: () => [] },
		modelRegistry: {
			getApiKeyAndHeaders: async () => { throw new Error("modern stream must own auth"); },
			streamSimple(model: unknown, context: unknown, options: unknown) {
				calls.push({ model, context, options });
				return { result: () => result() };
			},
		},
	};
	sessionTitle({ on: (event: string, fn: any) => { hooks[event] = fn; }, getSessionName: () => name,
		setSessionName: (value: string) => { names.push(value); name = value; }, appendEntry() {} } as any);
	return { hooks, ctx, calls, names, setResult: (value: typeof result) => { result = value; }, clearName: () => { name = undefined; } };
}

function custom(customType: string, text: string, details: unknown = {}) {
	return { messageType: "custom", message: { role: "custom", customType, content: [{ type: "text", text }], details } };
}

test("title uses current modelRegistry stream once and ignores internal custom/status noise", async () => {
	const h = harness();
	await h.hooks.session_start({ reason: "new" }, h.ctx);
	for (const type of ["unknown", "worktree-dependency-bootstrap", "pilee-worktree-fork-continuation"]) {
		await h.hooks.before_agent_start(custom(type, "modify and push boilerplate"), h.ctx);
	}
	await h.hooks.before_agent_start({ messageType: "user", prompt: "[dependency-bootstrap] READY" }, h.ctx);
	assert.equal(h.calls.length, 0);
	await h.hooks.before_agent_start(custom("pilee-tft-command-shim", "inlined skill: do not title this", { command: "frame", args: "권한 버그" }), h.ctx);
	await setImmediate();
	assert.equal(h.calls.length, 1);
	assert.match(h.calls[0].context.messages[0].content[0].text, /\/frame 권한 버그/);
	assert.doesNotMatch(h.calls[0].context.messages[0].content[0].text, /inlined skill/);
	assert.equal(h.calls[0].options.maxTokens, 80);
	assert.equal(h.calls[0].options.signal.aborted, false);
	assert.deepEqual(h.names, ["요청 제목"]);
});

test("title provider failure preserves deterministic original-request fallback", async () => {
	const h = harness();
	h.setResult(async () => { throw new Error("fake auth failure"); });
	await h.hooks.before_agent_start({ messageType: "user", prompt: "예약 버그 수정" }, h.ctx);
	await setImmediate();
	assert.deepEqual(h.names, ["예약 버그 수정"]);
});

test("pending naming result cannot rename a switched session", async () => {
	const h = harness();
	let resolve!: (value: unknown) => void;
	h.setResult(() => new Promise((done) => { resolve = done; }));
	await h.hooks.session_start({ reason: "new" }, h.ctx);
	await h.hooks.before_agent_start({ messageType: "user", prompt: "old session work" }, h.ctx);
	await h.hooks.session_start({ reason: "new" }, h.ctx);
	resolve({ stopReason: "stop", content: [{ type: "text", text: "stale title" }] });
	await setImmediate();
	assert.deepEqual(h.names, []);
	h.setResult(async () => ({ stopReason: "stop", content: [{ type: "text", text: "새 세션" }] }));
	await h.hooks.before_agent_start({ messageType: "user", prompt: "new session work" }, h.ctx);
	await setImmediate();
	assert.deepEqual(h.names, ["새 세션"]);
});
