import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { stripVTControlCharacters } from "node:util";
import test from "node:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import toolGroupRenderer from "./index.ts";

// Point this at the running Pi's dist/modes/interactive directory, not a second
// Pi copy in this package's node_modules. The adapter patches that exact class.
const base = process.env.PI_INTERACTIVE_BASE;

test("actual Pi preserves the existing screen on compaction, without replaying history on rebuild", { skip: !base }, async () => {
	const load = (path: string) => import(pathToFileURL(resolve(base!, path)).href);
	const { InteractiveMode } = await load("interactive-mode.js");
	const { SessionManager } = await load("../../core/session-manager.js");
	const theme = await load("theme/theme.js");
	const require = createRequire(resolve(base!, "interactive-mode.js"));
	const { Container, TuiMainScreen } = await import(pathToFileURL(require.resolve("@earendil-works/pi-tui")).href);
	theme.initTheme("dark");
	const proto = InteractiveMode.prototype;
	const original = proto.renderSessionEntries;
	assert.equal(typeof original, "function", "runtime must expose the entry renderer");

	const session = SessionManager.inMemory();
	const usage = { input: 30, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 40, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const user = (text: string) => session.appendMessage({ role: "user", content: text, timestamp: Date.now() });
	const assistant = (text: string) => session.appendMessage({ role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "test", model: "test", usage, stopReason: "stop", timestamp: Date.now() });
	const root = user("ORIGINAL_USER_FIRST");
	assistant("ORIGINAL_ASSISTANT_FIRST");
	for (let i = 0; i < 80; i++) user(`OLDER_${i}`);
	const kept = user("RETAINED_USER");
	assistant("RETAINED_ANSWER");
	session.appendCustomMessageEntry("hidden", "DO_NOT_DISPLAY", false);
	const mode = Object.create(proto);
	const editorHistory: string[] = [];
	const writes: string[] = [];
	const progress: boolean[] = [];
	const clearedStatus: string[] = [];
	const queued: boolean[] = [];
	let queueWork = Promise.resolve();
	const escape = () => {};
	const renderer = new TuiMainScreen({ columns: 100, rows: 30, write: (s: string) => writes.push(s), setProgress: (active: boolean) => progress.push(active), hideCursor() {}, showCursor() {} });
	renderer.requestRender = () => {};
	const documentContainer = new Container();
	const chatContainer = new Container();
	documentContainer.addChild(chatContainer);
	renderer.addChild(documentContainer);
	const originalFrameRender = renderer.doRender;
	Object.assign(mode, {
		isInitialized: true,
		runtimeHost: { session: {
			sessionManager: session, retryAttempt: 0,
			settingsManager: { getShowTerminalProgress: () => true, getShowCacheMissNotices: () => true },
			extensionRunner: { getMessageRenderer: () => undefined, getEntryRenderer: () => undefined },
		} },
		chatContainer, documentContainer, renderer, pendingTools: new Map(),
		ui: renderer, footer: { invalidate() {} },
		editor: { addToHistory: (text: string) => editorHistory.push(text) },
		defaultEditor: { onEscape() {} }, autoCompactionEscapeHandler: escape,
		toolOutputExpanded: true, hideThinkingBlock: true, outputPad: 1,
		getMarkdownThemeWithSettings: () => theme.getMarkdownTheme(),
		getMarkdownTransformers: () => [], updateEditorBorderColor() {},
		renderProjectTrustWarningIfNeeded() {}, clearStatusIndicator: (kind: string) => clearedStatus.push(kind),
		compactionQueuedMessages: [], updatePendingMessagesDisplay() {},
		flushCompactionQueue(options: { willRetry: boolean }) {
			assert.equal(this, mode, "the core queue must not receive the preservation proxy");
			queued.push(options.willRetry);
			queueWork = proto.flushCompactionQueue.call(this, options);
			return queueWork;
		},
	});
	const text = () => mode.chatContainer.render(100).map((line: string) => stripVTControlCharacters(line)).join("\n");
	try {
		await toolGroupRenderer({} as ExtensionAPI);
		const patched = proto.renderSessionEntries;
		assert.notEqual(patched, original, "extension factory patches the active runtime");
		await toolGroupRenderer({} as ExtensionAPI);
		assert.equal(proto.renderSessionEntries, patched, "reload does not stack wrappers");
		mode.rebuildChatFromMessages();
		assert.notEqual(renderer.doRender, originalFrameRender, "ordinary entry rendering still installs the existing input fast path");
		renderer.doRender();
		assert.match(renderer.previousLines.join("\n"), /ORIGINAL_USER_FIRST/);
		assert.match(text(), /ORIGINAL_USER_FIRST/);
		assert.match(text(), /ORIGINAL_ASSISTANT_FIRST/);
		assert.doesNotMatch(text(), /DO_NOT_DISPLAY/);
		const { ToolExecutionComponent } = await load("components/tool-execution.js");
		const tool = new ToolExecutionComponent("example", "t1", {}, { showImages: false }, undefined, renderer, session.getCwd());
		tool.updateResult({ content: [{ type: "text", text: Array.from({ length: 50 }, (_, i) => `TOOL_${i}`).join("\n") }] });
		tool.setExpanded(true);
		chatContainer.addChild(tool);
		renderer.doRender();
		writes.length = 0;
		const compact = session.appendCompaction("SUMMARY_ONE", kept, 5000);
		const modelBefore = session.buildSessionContext();
		const entriesBefore = JSON.stringify(session.getEntries());
		const existingComponents = [...chatContainer.children];
		let clears = 0;
		let replays = 0;
		const clear = chatContainer.clear;
		chatContainer.clear = function () { clears++; return clear.call(this); };
		const replay = mode.renderSessionEntries;
		mode.renderSessionEntries = function (...args: unknown[]) { replays++; return replay.apply(this, args); };
		await mode.handleEvent({ type: "compaction_end", reason: "manual", result: { summary: "SUMMARY_ONE", tokensBefore: 5000, usage }, aborted: false, willRetry: false });
		assert.equal(clears, 0, "compaction must not clear the existing screen");
		assert.equal(replays, 0, "compaction must not recreate the existing screen");
		for (const [index, component] of existingComponents.entries()) {
			assert.equal(chatContainer.children[index], component, "existing screen components must keep their identity");
		}
		assert.match(text(), /ORIGINAL_USER_FIRST/);
		assert.equal(text().split("SUMMARY_ONE").length - 1, 1);
		assert.deepEqual(session.buildSessionContext(), modelBefore);
		assert.equal(JSON.stringify(session.getEntries()), entriesBefore);
		assert.equal(mode.defaultEditor.onEscape, escape);
		assert.equal(mode.autoCompactionEscapeHandler, undefined);
		assert.deepEqual(progress, [false]);
		assert.deepEqual(clearedStatus, ["compaction"]);
		assert.deepEqual(queued, [false]);
		assert.match(text(), /TOOL_49/, "expanded tool output stays expanded");
		assert.match(text(), /Compaction: 40 tokens billed/, "the original cost notice still renders");
		renderer.doRender();
		assert.doesNotMatch(writes.join(""), /ORIGINAL_USER_FIRST|OLDER_0|\x1b\[3J/, "compaction must not clear scrollback or replay old rows");
		const visibleBeforeCancel = text();
		await mode.handleEvent({ type: "compaction_end", reason: "threshold", aborted: true, willRetry: false });
		assert.ok(text().startsWith(visibleBeforeCancel));
		for (const reason of ["manual", "threshold", "overflow"]) {
			for (const outcome of [{ aborted: true }, { aborted: false, errorMessage: "COMPACTION_FAILED" }]) {
				await mode.handleEvent({ type: "compaction_end", reason, ...outcome, willRetry: false });
				for (const [index, component] of existingComponents.entries()) assert.equal(chatContainer.children[index], component);
			}
		}
		assert.match(text(), /COMPACTION_FAILED/);
		assert.equal(clears, 0);
		assert.equal(replays, 0);

		mode.addMessageToChat(session.getEntry(user("SECOND_TURN")).message);
		mode.addMessageToChat(session.getEntry(assistant("SECOND_ANSWER")).message);
		session.appendCompaction("SUMMARY_TWO", "", 9000);
		await mode.handleEvent({ type: "compaction_end", reason: "threshold", result: { summary: "SUMMARY_TWO", tokensBefore: 9000 }, aborted: false, willRetry: false });
		assert.match(text(), /ORIGINAL_ASSISTANT_FIRST/);
		assert.match(text(), /SECOND_ANSWER/);
		assert.equal(text().split("SUMMARY_ONE").length - 1, 1);
		assert.equal(text().split("SUMMARY_TWO").length - 1, 1);
		assert.equal(session.buildSessionContext().messages.length, 1, "only the new summary stays in model context");
		assert.equal(clears, 0);
		assert.equal(replays, 0);
		for (const [index, component] of existingComponents.entries()) assert.equal(chatContainer.children[index], component);
		mode.chatContainer.clear();
		mode.renderInitialMessages();
		assert.doesNotMatch(text(), /ORIGINAL_USER_FIRST|SUMMARY_ONE|SECOND_ANSWER/);
		assert.match(text(), /SUMMARY_TWO/);
		assert.ok(!editorHistory.includes("ORIGINAL_USER_FIRST"));

		session.branch(root);
		user("SIBLING_BRANCH");
		mode.rebuildChatFromMessages();
		assert.match(text(), /SIBLING_BRANCH/);
		assert.doesNotMatch(text(), /SECOND_ANSWER|SUMMARY_TWO|ORIGINAL_ASSISTANT_FIRST/);
		session.branch(compact);
		mode.rebuildChatFromMessages();
		assert.match(text(), /RETAINED_ANSWER/);
		assert.doesNotMatch(text(), /ORIGINAL_ASSISTANT_FIRST/);
		assert.doesNotMatch(text(), /SIBLING_BRANCH|SECOND_ANSWER/);

		for (const willRetry of [false, true]) {
			mode.runtimeHost.session.sessionManager = session;
			session.appendCompaction(`QUEUE_SUMMARY_${willRetry}`, kept, 10000);
			const calls: unknown[][] = [];
			const nextSession = SessionManager.inMemory();
			nextSession.appendMessage({ role: "user", content: "QUEUED_NEW_SESSION", timestamp: Date.now() });
			Object.assign(mode.runtimeHost.session, {
				prompt: async (message: string, options?: unknown) => {
					calls.push(["prompt", message, options]);
					if (message === "/switch-test") {
						// Execute at the real core queue's first await, before compaction_end returns.
						mode.runtimeHost.session.sessionManager = nextSession;
						mode.rebuildChatFromMessages();
					}
				},
				steer: async (message: string) => { calls.push(["steer", message]); },
				followUp: async (message: string) => { calls.push(["followUp", message]); },
				clearQueue: () => { assert.fail("queue processing must not fall into error recovery"); },
			});
			mode.runtimeHost.session.extensionRunner.getCommand = (name: string) => name === "switch-test" ? {} : undefined;
			mode.compactionQueuedMessages = [
				{ text: "/switch-test", mode: "steer" },
				{ text: "FIRST", mode: "steer" },
				{ text: "LATER", mode: "followUp" },
				{ text: "STEERING", mode: "steer" },
			];
			const clearCount = clears;
			const replayCount = replays;
			await mode.handleEvent({ type: "compaction_end", reason: willRetry ? "overflow" : "manual", result: { summary: `QUEUE_SUMMARY_${willRetry}`, tokensBefore: 10000 }, aborted: false, willRetry });
			await queueWork;
			assert.deepEqual(calls, [
				["prompt", "/switch-test", undefined],
				willRetry ? ["steer", "FIRST"] : ["prompt", "FIRST", { streamingBehavior: "steer" }],
				["followUp", "LATER"], ["steer", "STEERING"],
			]);
			assert.equal(clears, clearCount + 1, "reentrant session replacement must still clear its screen");
			assert.equal(replays, replayCount + 1, "reentrant session replacement must still render the new session");
			assert.equal(mode.compactionQueuedMessages.length, 0);
			assert.match(text(), /QUEUED_NEW_SESSION/);
			assert.doesNotMatch(text(), /ORIGINAL_|SUMMARY_|RETAINED_/);
		}

		mode.runtimeHost.session.sessionManager = SessionManager.inMemory();
		await assert.rejects(mode.handleEvent({ type: "compaction_end", reason: "manual", result: { summary: "INVALID", tokensBefore: 1 }, aborted: false, willRetry: false }), /missing from the session context/);
		mode.rebuildChatFromMessages();
		assert.equal(text(), "", "a failed handler leaves ordinary clear/rebuild functional");

		mode.runtimeHost.session.sessionManager = session;
		session.appendCompaction("INIT_SUMMARY", kept, 10000);
		mode.isInitialized = false;
		mode.init = async function () {
			this.isInitialized = true;
			this.renderInitialMessages();
		};
		await mode.handleEvent({ type: "compaction_end", reason: "manual", result: { summary: "INIT_SUMMARY", tokensBefore: 10000 }, aborted: false, willRetry: false });
		assert.equal(text().split("INIT_SUMMARY").length - 1, 1, "initialization before the event must not duplicate its summary");
		assert.doesNotMatch(text(), /ORIGINAL_USER_FIRST/);
	} finally {
		proto.renderSessionEntries = original;
	}
});
