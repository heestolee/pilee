import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { BeforeAgentStartEvent } from "@mariozechner/pi-coding-agent";
import { buildDispatchNotification, buildHandsFreeUpdateMessage } from "../interactive-shell/notification-utils.ts";
import { AGENT_START_COMMAND_PRODUCERS, readAgentStartInput } from "./agent-start-input.ts";
import { META_REVIEW_COMMAND_CUSTOM_TYPE } from "../pr-review/prompt.ts";
import until from "../until/index.ts";

function custom(customType: string, details: Record<string, unknown> = {}, content = "inlined skill: 새 worktree 만들어 push해줘") {
	return { messageType: "custom", message: { customType, content, details } } as BeforeAgentStartEvent;
}

const commandSources = {
	"pilee-tft-command-shim": "tft-commands/index.ts",
	"pilee-ship-command-shim": "ship-commands/index.ts",
	"pilee-frame-v2-command": "frame-v2/index.ts",
	"pilee-test-refine-command": "test-refine/index.ts",
	"pilee-ember-ship-command": "ember-ship/index.ts",
	"pilee-meta-review-command": "pr-review/index.ts",
};

export const continuationSources = [
	["pilee-tft-studio-resume", "frame-studio/index.ts", {}],
	["convention-lens-review", "convention-lens/reviewer.ts", {}],
	["subagent-tool", "subagent/tool-execute.ts", { status: "done", runId: 7 }],
	["until-prompt", "until/index.ts", { agentStart: { kind: "continuation", request: "현재 테스트 실패 원인만 조사해줘" } }],
	["heestolee.study-hard.question-route", "study-hard/studio.ts", {}],
	["heestolee.study-hard.learner-request", "study-hard/studio.ts", {}],
	["heestolee.study-hard.worker-conflict", "study-hard/studio.ts", {}],
	["heestolee.study-hard.node-answer", "study-hard/studio.ts", {}],
	["pilee-meta-review-worker-request", "pr-review/index.ts", {}],
	["pilee-meta-review-refresh-request", "study-hard/studio.ts", {}],
	["pilee-meta-review-command", "pr-review/question-worker.ts", { command: "meta-review-refresh" }],
	["pilee-meta-review-workspace-ready", "worktree/pr-review.ts", {}],
	["pilee-diff-workspace-ready", "worktree/pr-review.ts", {}],
] as const;

function source(path: string) {
	return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("command table covers actual public producer literals and every command variant", () => {
	for (const [customType, commands] of Object.entries(AGENT_START_COMMAND_PRODUCERS)) {
		const path = commandSources[customType as keyof typeof commandSources];
		const code = source(path) + (customType === "pilee-meta-review-command" ? source("pr-review/prompt.ts") : "");
		assert.ok(code.includes(`"${customType}"`), path);
		for (const command of commands) {
			assert.ok(code.includes(`"${command}"`), `${path}: ${command}`);
			const input = readAgentStartInput(custom(customType, { command, args: "explicit target" }));
			assert.equal(input.kind, "command");
			assert.equal(input.request, `/${command} explicit target`);
			assert.doesNotMatch(input.request!, /worktree|push/);
		}
	}
});

test("continuation inventory is verified against current producer literals", () => {
	for (const [customType, path, details] of continuationSources) {
		const code = source(path);
		if (path === "pr-review/question-worker.ts") {
			assert.equal(META_REVIEW_COMMAND_CUSTOM_TYPE, customType);
			assert.match(code, /import \{[^}]*META_REVIEW_COMMAND_CUSTOM_TYPE[^}]*\} from "\.\/prompt\.ts"/);
			assert.match(code, /customType: META_REVIEW_COMMAND_CUSTOM_TYPE/);
		} else assert.ok(code.includes(`"${customType}"`), `${path}: ${customType}`);
		assert.equal(readAgentStartInput(custom(customType, details)).kind, "continuation", customType);
	}
	assert.match(source("until/index.ts"), /agentStart: \{ kind: "continuation", request: task.prompt \}/);
	assert.match(source("study-hard/index.ts"), /agentStart: \{ kind: "command", command: "study-hard", args: args.trim\(\), purpose: "artifact" \}/);
});

test("actual shell update builders distinguish completion from takeover and background status", () => {
	for (const status of ["exited", "killed", "user-takeover", "backgrounded"] as const) {
		const message = buildHandsFreeUpdateMessage({ sessionId: "shell-1", status, runtime: 10, tail: [], tailTruncated: false });
		assert.ok(message);
		assert.equal(readAgentStartInput(custom("interactive-shell-update", message.details, message.content)).kind,
			status === "exited" || status === "killed" ? "continuation" : "status");
	}
	const details = { exitCode: 0, completionOutput: { lines: ["done"], totalLines: 1, truncated: false } };
	const content = buildDispatchNotification("shell-1", details, "1s");
	assert.equal(readAgentStartInput(custom("interactive-shell-transfer", details, content)).kind, "continuation");
	assert.equal(readAgentStartInput(custom("interactive-shell-transfer", { backgroundId: "bg" })).kind, "status");
});

test("actual until handler emits its saved task as continuation metadata", { timeout: 2_000 }, async () => {
	const commands: Record<string, any> = {};
	const hooks: Record<string, any> = {};
	let complete!: (value: any) => void;
	const emitted = new Promise<any>((resolve) => { complete = resolve; });
	until({
		registerCommand: (name, command) => { commands[name] = command; },
		registerTool: () => {}, registerMessageRenderer: () => {},
		on: (name, handler) => { hooks[name] = handler; },
		sendMessage: (message, options) => { if (message.customType === "until-prompt") complete({ message, options }); },
	} as any);
	const request = "원인만 조사해줘";
	try {
		await commands.until.handler(`1m ${request}`, { hasUI: false, ui: { notify: () => {} } });
		const { message, options } = await emitted;
		assert.equal(options.triggerTurn, true);
		const input = readAgentStartInput({ messageType: "custom", message } as BeforeAgentStartEvent);
		assert.equal(input.kind, "continuation");
		assert.equal(input.request, request);
		assert.doesNotMatch(input.request!, /until_report|실행|간격/);
	} finally { await hooks.session_shutdown(); }
});

test("bootstrap, in-flight subagent and arbitrary custom payloads never gain authority", () => {
	for (const details of [{ status: "started" }, { status: "done", agent: "bootstrapper" }, { status: "done", task: "WORKTREE DEPENDENCY BOOTSTRAP: ready" }]) {
		assert.equal(readAgentStartInput(custom("subagent-tool", details)).kind, "status");
	}
	assert.equal(readAgentStartInput(custom("arbitrary", { command: "ship" })).kind, "unknown");
	assert.equal(readAgentStartInput(custom("arbitrary", { agentStart: { kind: "command", command: "ship\n/wt fork" } })).kind, "unknown");
});
