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

test("actual Pi renders full transcript through compaction, reload, and branch changes", { skip: !base }, async () => {
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
	const kept = user("RETAINED_USER");
	assistant("RETAINED_ANSWER");
	session.appendCustomMessageEntry("hidden", "DO_NOT_DISPLAY", false);
	const compact = session.appendCompaction("SUMMARY_ONE", kept, 5000);
	const mode = Object.create(proto);
	const editorHistory: string[] = [];
	const renderer = new TuiMainScreen({ columns: 100, rows: 30, write() {}, hideCursor() {}, showCursor() {} });
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
			settingsManager: { getShowTerminalProgress: () => false, getShowCacheMissNotices: () => false },
			extensionRunner: { getMessageRenderer: () => undefined, getEntryRenderer: () => undefined },
		} },
		chatContainer, documentContainer, renderer, pendingTools: new Map(),
		ui: renderer, footer: { invalidate() {} },
		editor: { addToHistory: (text: string) => editorHistory.push(text) },
		toolOutputExpanded: true, hideThinkingBlock: true, outputPad: 1,
		getMarkdownThemeWithSettings: () => theme.getMarkdownTheme(),
		getMarkdownTransformers: () => [], updateEditorBorderColor() {},
		renderProjectTrustWarningIfNeeded() {}, clearStatusIndicator() {},
		flushCompactionQueue: async () => {},
	});
	const text = () => mode.chatContainer.render(100).map((line: string) => stripVTControlCharacters(line)).join("\n");
	try {
		mode.rebuildChatFromMessages();
		assert.doesNotMatch(text(), /ORIGINAL_USER_FIRST/, "unpatched core reproduces missing history");
		const modelBefore = session.buildSessionContext();
		const entriesBefore = JSON.stringify(session.getEntries());
		await toolGroupRenderer({} as ExtensionAPI);
		const patched = proto.renderSessionEntries;
		assert.notEqual(patched, original, "extension factory patches the active runtime");
		await toolGroupRenderer({} as ExtensionAPI);
		assert.equal(proto.renderSessionEntries, patched, "reload does not stack wrappers");
		mode.rebuildChatFromMessages();
		assert.notEqual(renderer.doRender, originalFrameRender, "full-history projection installs the input fast path");
		renderer.doRender();
		assert.match(renderer.previousLines.join("\n"), /ORIGINAL_USER_FIRST/);
		assert.match(text(), /ORIGINAL_USER_FIRST/);
		assert.match(text(), /ORIGINAL_ASSISTANT_FIRST/);
		assert.doesNotMatch(text(), /DO_NOT_DISPLAY/);
		assert.equal(text().split("SUMMARY_ONE").length - 1, 1);
		assert.deepEqual(session.buildSessionContext(), modelBefore);
		assert.equal(JSON.stringify(session.getEntries()), entriesBefore);

		await mode.handleEvent({ type: "compaction_end", reason: "manual", result: { summary: "SUMMARY_ONE", tokensBefore: 5000 }, aborted: false, willRetry: false });
		assert.match(text(), /ORIGINAL_USER_FIRST/);
		assert.equal(text().split("SUMMARY_ONE").length - 1, 1);
		const visibleBeforeCancel = text();
		await mode.handleEvent({ type: "compaction_end", reason: "threshold", aborted: true, willRetry: false });
		assert.ok(text().startsWith(visibleBeforeCancel));

		user("SECOND_TURN");
		assistant("SECOND_ANSWER");
		session.appendCompaction("SUMMARY_TWO", "", 9000);
		await mode.handleEvent({ type: "compaction_end", reason: "threshold", result: { summary: "SUMMARY_TWO", tokensBefore: 9000 }, aborted: false, willRetry: false });
		assert.match(text(), /ORIGINAL_ASSISTANT_FIRST/);
		assert.match(text(), /SECOND_ANSWER/);
		assert.equal(text().split("SUMMARY_ONE").length - 1, 1);
		assert.equal(text().split("SUMMARY_TWO").length - 1, 1);
		assert.equal(session.buildSessionContext().messages.length, 1, "only the new summary stays in model context");
		mode.chatContainer.clear();
		mode.renderInitialMessages();
		assert.match(text(), /ORIGINAL_USER_FIRST/);
		assert.ok(editorHistory.includes("ORIGINAL_USER_FIRST"));

		session.branch(root);
		user("SIBLING_BRANCH");
		mode.rebuildChatFromMessages();
		assert.match(text(), /SIBLING_BRANCH/);
		assert.doesNotMatch(text(), /SECOND_ANSWER|SUMMARY_TWO|ORIGINAL_ASSISTANT_FIRST/);
		session.branch(compact);
		mode.rebuildChatFromMessages();
		assert.match(text(), /ORIGINAL_ASSISTANT_FIRST/);
		assert.doesNotMatch(text(), /SIBLING_BRANCH|SECOND_ANSWER/);

		mode.runtimeHost.session.sessionManager = SessionManager.inMemory();
		mode.rebuildChatFromMessages();
		assert.equal(text(), "", "switching sessions never leaks prior history");
	} finally {
		proto.renderSessionEntries = original;
	}
});
