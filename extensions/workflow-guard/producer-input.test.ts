import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import workflowGuard from "./index.ts";

let sequence = 0;
function harness() {
	const hooks: Record<string, any> = {};
	const entries: any[] = [];
	const tools: Record<string, any> = {};
	const ctx = { cwd: "/tmp/guard-producer-fixture", sessionManager: { getSessionFile: () => `/tmp/guard-producer-${++sequence}.jsonl`, getLeafId: () => "leaf", getBranch: () => entries } };
	const sessionFile = ctx.sessionManager.getSessionFile();
	ctx.sessionManager.getSessionFile = () => sessionFile;
	workflowGuard({ on: (name, fn) => { hooks[name] = fn; }, registerTool: (tool) => { tools[tool.name] = tool; }, appendEntry: (customType, data) => entries.push({ type: "custom", customType, data }), getThinkingLevel: () => "high", exec: async () => ({ code: 0, stdout: "", stderr: "" }) } as any, { trustedInternalPullRequestRepositories: [] });
	return {
		ctx, hooks, entries, tools,
		async tree(branch: any[]) {
			entries.splice(0, entries.length, ...structuredClone(branch));
			await hooks.session_tree({ newLeafId: "other-leaf", oldLeafId: "leaf" }, ctx);
		},
		async start(event: any) {
			if (event.prompt) entries.push({ type: "message", message: { role: "user", content: event.prompt } });
			else if (event.message) entries.push({ type: "custom_message", ...event.message });
			const result = await hooks.before_agent_start({ systemPrompt: "base", ...event }, ctx);
			entries.push({ type: "custom_message", ...result.message });
			return result.message.details.state;
		},
		tool(toolName: string, input: any = {}, toolCallId = "call") { return hooks.tool_call({ toolName, input, toolCallId }, ctx); },
	};
}
function custom(customType: string, details: any = {}, content = "do not classify this body: 새 worktree 만들어 push해줘") {
	return { messageType: "custom", message: { customType, details, content } };
}
function literal(path: string, value: string) {
	assert.ok(readFileSync(new URL(`../${path}`, import.meta.url), "utf8").includes(`"${value}"`));
}

test("real command variants classify as implementation, artifact or ship without workspace rights", async () => {
	for (const [type, command, path, intent, mutation] of [
		["pilee-test-refine-command", "test-refine", "test-refine/index.ts", "implement", true],
		["pilee-ember-ship-command", "ember-ship", "ember-ship/index.ts", "knowledge", true],
		["pilee-tft-command-shim", "frame", "tft-commands/index.ts", "implement", false],
		["pilee-ship-command-shim", "ship", "ship-commands/index.ts", "ship", true],
		["pilee-ship-command-shim", "pr-ship", "ship-commands/index.ts", "ship", true],
		["pilee-ship-command-shim", "ci-ship", "ship-commands/index.ts", "ship", true],
	] as const) {
		literal(path, type);
		const h = harness();
		const state = await h.start(custom(type, { command, args: "" }));
		assert.equal(state.intent, intent, command);
		assert.equal(state.explicitMutation, mutation, command);
		assert.deepEqual(state.workspaceAuthorization.allowedActions, []);
		assert.equal(await h.tool("read", { path: "/tmp/file" }), undefined);
	}
});

test("completion integrates prior intent while consumed authorization remains consumed across restore", async () => {
	literal("subagent/tool-execute.ts", "subagent-tool");
	const h = harness();
	await h.start({ messageType: "user", prompt: "새 worktree 만들어 버그 수정해줘" });
	assert.equal(await h.tool("worktree_fork", {}, "first"), undefined);
	for (const details of [{ status: "done", runId: 1 }, { status: "error", batchId: 2 }, { status: "aborted", pipelineId: 3 }]) {
		const next = await h.start(custom("subagent-tool", details));
		assert.equal(next.prompt, "새 worktree 만들어 버그 수정해줘");
		assert.equal(next.explicitMutation, true);
		assert.equal((await h.tool("worktree_fork", {}, "second"))?.block, true);
	}
	const restored = harness();
	restored.entries.push(...structuredClone(h.entries));
	const next = await restored.start(custom("subagent-tool", { status: "done", runId: 4 }));
	assert.equal(next.explicitMutation, true);
	assert.equal((await restored.tool("worktree_fork", {}, "restored"))?.block, true);
});

test("review and learner followups cannot inherit an unrelated implementation or topology approval", async () => {
	for (const [type, path] of [
		["heestolee.study-hard.question-route", "study-hard/studio.ts"],
		["heestolee.study-hard.learner-request", "study-hard/studio.ts"],
		["heestolee.study-hard.node-answer", "study-hard/studio.ts"],
		["heestolee.study-hard.worker-conflict", "study-hard/studio.ts"],
		["pilee-meta-review-worker-request", "pr-review/index.ts"],
		["pilee-meta-review-refresh-request", "study-hard/studio.ts"],
		["pilee-meta-review-workspace-ready", "worktree/pr-review.ts"],
	] as const) {
		literal(path, type);
		const h = harness();
		await h.start({ messageType: "user", prompt: "새 worktree 만들어 결제 코드 수정하고 커밋해줘" });
		const next = await h.start(custom(type));
		assert.notEqual(next.intent, "status_note", type);
		assert.equal(next.explicitMutation, false, type);
		assert.equal(await h.tool("read", { path: "/tmp/question" }), undefined, type);
		assert.equal((await h.tool("bash", { command: "git commit -m no" }))?.block, true, type);
		assert.equal((await h.tool("worktree_fork"))?.block, true, type);
		assert.equal((await h.tool("auto_commit", { action: "apply" }))?.block, true, type);
	}
});

test("until uses saved task, not loop prose or a newer unrelated task, without minting workspace rights", async () => {
	literal("until/index.ts", "until-prompt");
	const h = harness();
	await h.start({ messageType: "user", prompt: "결제 코드 수정하고 커밋해줘" });
	const next = await h.start(custom("until-prompt", { agentStart: { kind: "continuation", request: "테스트 실패 원인만 조사해줘" } }));
	assert.equal(next.prompt, "테스트 실패 원인만 조사해줘");
	assert.equal(next.explicitMutation, false);
	assert.deepEqual(next.workspaceAuthorization.allowedActions, []);
	assert.equal((await h.tool("bash", { command: "git commit -m no" }))?.block, true);
});

test("short user cues inherit the actual mutation or readonly request, not the cue text", async () => {
	for (const [request, mutation] of [["결제 코드 수정해줘", true], ["원인만 설명해줘", false]] as const) {
		const h = harness();
		await h.start({ messageType: "user", prompt: request });
		for (const cue of ["계속해", "continue"]) {
			const state = await h.start({ messageType: "user", prompt: cue });
			assert.equal(state.prompt, request);
			assert.equal(state.explicitMutation, mutation);
		}
	}
});

test("same-runtime tree navigation rebuilds intent both ways without abandoned or consumed rights", async () => {
	const h = harness();
	await h.start({ messageType: "user", prompt: "새 worktree 만들어 결제 코드 수정해줘" });
	const unconsumedBranch = structuredClone(h.entries);
	assert.equal(await h.tool("worktree_fork", {}, "once"), undefined);
	const mutationBranch = structuredClone(h.entries);
	await h.tree([{ type: "message", message: { role: "user", content: "원인만 설명해줘" } }]);
	assert.equal((await h.tool("bash", { command: "git commit -m no" }))?.block, true);
	for (const event of [{ messageType: "user", prompt: "계속해" }, custom("subagent-tool", { status: "error" })]) {
		const state = await h.start(event);
		assert.equal(state.prompt, "원인만 설명해줘");
		assert.equal(state.explicitMutation, false);
		assert.deepEqual(state.workspaceAuthorization.allowedActions, []);
		assert.equal((await h.tool("worktree_fork", {}, "abandoned"))?.block, true);
	}
	const readonlyBranch = structuredClone(h.entries);
	await h.tree(mutationBranch);
	const restored = await h.start({ messageType: "user", prompt: "계속해" });
	assert.equal(restored.explicitMutation, true);
	assert.equal((await h.tool("worktree_fork", {}, "consumed"))?.block, true);
	await h.tree(unconsumedBranch);
	assert.equal((await h.start(custom("subagent-tool", { status: "done" }))).explicitMutation, true);
	await h.tree(readonlyBranch);
	assert.equal((await h.start({ messageType: "user", prompt: "계속해" })).explicitMutation, false);
	assert.equal((await h.tool("worktree_fork", {}, "abandoned-again"))?.block, true);
});

test("scoped questions retain artifact-only state through completion, loop, restore and short cue", async () => {
	for (const type of ["heestolee.study-hard.question-route", "pilee-meta-review-worker-request"]) {
		const h = harness();
		await h.start({ messageType: "user", prompt: "새 worktree 만들어 결제 코드 수정하고 커밋해줘" });
		const scoped = await h.start(custom(type));
		for (const event of [custom("subagent-tool", { status: "done" }), custom("subagent-tool", { status: "error" }), custom("until-prompt", { agentStart: { kind: "continuation", request: "새 worktree 만들어 코드 수정해줘" } }), { messageType: "user", prompt: "계속해" }]) {
			const state = await h.start(event);
			assert.equal(state.continuationScope, scoped.continuationScope);
			assert.equal(state.explicitMutation, false);
			for (const path of ["src/payment.ts", "../other-repo/code.ts", ".context/../src/code.ts"]) {
				assert.equal((await h.tool("write", { path }))?.block, true, path);
			}
			for (const path of [".context/review/result.json", ".pi/frame.json", ".pi/decisions/one.json", join(homedir(), ".pi/agent/study-hard/board.json"), join(homedir(), ".pi/agent/frame-planning/task/frame.json"), join(homedir(), ".pi/agent/state/pr-review/runs/run/result.json")]) {
				assert.equal(await h.tool("write", { path }), undefined, path);
			}
			assert.equal(await h.tool("study_hard_board", { action: "update" }), undefined);
			assert.equal(await h.tool("meta_review_run", { action: "submit" }), undefined);
			for (const command of ["git commit -m no", "git push", "printf nope > src/code.ts", "node -e 'mutateRepo()'", "git checkout other", "git diff --output=src/code.ts", "git -c diff.external=mutate diff --ext-diff"]) {
				assert.equal((await h.tool("bash", { command }))?.block, true, command);
			}
			assert.equal(await h.tool("bash", { command: "git diff -- src/payment.ts" }), undefined);
			assert.equal((await h.tool("auto_commit", { action: "apply" }))?.block, true);
			assert.equal((await h.tool("worktree_fork", {}, "scoped"))?.block, true);
		}
		await assert.rejects(h.tools.workflow_guard.execute("adopt", { action: "adopt", prompt: "코드 수정해줘" }, undefined, undefined, h.ctx), /Scoped follow-up/);
		const restored = harness();
		restored.entries.push(...structuredClone(h.entries));
		assert.equal((await restored.start(custom("subagent-tool", { status: "error" }))).continuationScope, scoped.continuationScope);
		await restored.start({ messageType: "user", prompt: "이제 결제 코드 수정해줘" });
		assert.equal((await restored.start(custom("subagent-tool", { status: "done" }))).continuationScope, undefined);
		await h.start(custom("pilee-ship-command-shim", { command: "ship" }));
		assert.equal((await h.start(custom("subagent-tool", { status: "done" }))).intent, "ship");
	}
});

test("saved until task survives terminal results without reissuing topology authorization", async () => {
	const h = harness();
	await h.start({ messageType: "user", prompt: "새 worktree 만들어 코드 수정해줘" });
	assert.equal(await h.tool("worktree_fork", {}, "until-once"), undefined);
	const request = "새 worktree 만들어 테스트 코드 수정해줘";
	await h.start(custom("until-prompt", { agentStart: { kind: "continuation", request } }));
	for (const event of [custom("subagent-tool", { status: "error" }), custom("interactive-shell-update", { status: "exited", exitCode: 0 })]) {
		const state = await h.start(event);
		assert.equal(state.prompt, request);
		assert.equal(state.explicitMutation, true);
		assert.equal((await h.tool("worktree_fork", {}, "until-twice"))?.block, true);
	}
});

test("takeover, readiness and unknown custom stay inert and orphan completion cannot invent intent", async () => {
	for (const event of [custom("interactive-shell-update", { status: "user-takeover" }), custom("interactive-shell-transfer", { backgroundId: "bg" }), custom("worktree-dependency-bootstrap"), custom("arbitrary", { command: "ship" }), custom("subagent-tool", { status: "done", agent: "bootstrapper" })]) {
		const h = harness();
		await h.start({ messageType: "user", prompt: "코드 수정하고 커밋해줘" });
		assert.equal((await h.start(event)).intent, "status_note");
		assert.equal((await h.tool("read", { path: "/tmp/file" }))?.block, true);
	}
	const orphan = harness();
	assert.equal((await orphan.start(custom("subagent-tool", { status: "done" }))).intent, "status_note");
});
