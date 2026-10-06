import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { installTranscriptRender } from "./transcript-render.ts";
import toolGroupRenderer, { __test__ } from "./index.ts";

const base = process.env.PI_INTERACTIVE_BASE;

test("regular Pi keeps full history but only processes the changed screen suffix", { skip: !base }, async (t) => {
	const load = (file: string) => import(pathToFileURL(resolve(base!, file)).href);
	const require = createRequire(resolve(base!, "interactive-mode.js"));
	const { Container, Text, Editor, TuiMainScreen } = await import(pathToFileURL(require.resolve("@earendil-works/pi-tui")).href);
	const theme = await load("theme/theme.js");
	theme.initTheme("dark");
	const fixture = (count: number, patched: boolean) => {
		let historicalRenders = 0;
		const writes: string[] = [];
		const terminal = { columns: 100, rows: 30, write: (s: string) => writes.push(s), hideCursor() {}, showCursor() {} };
		const ui = new TuiMainScreen(terminal);
		ui.requestRender = () => {};
		ui.setClearOnShrink(false);
		const chat = new Container();
		const header = new Text("HEADER", 0, 0);
		const document = new Container();
		document.addChild(header);
		document.addChild(chat);
		ui.addChild(document);
		const editor = new Editor(ui, theme.getEditorTheme());
		ui.addChild(editor);
		ui.setFocus(editor);
		for (let i = 0; i < count; i++) {
			const row = new Text(`HISTORY_${i}`, 0, 0);
			const render = row.render.bind(row);
			row.render = (width: number) => { historicalRenders++; return render(width); };
			chat.addChild(row);
		}
		const mode = { chatContainer: chat, documentContainer: document, renderer: ui };
		if (patched) installTranscriptRender(mode);
		ui.doRender();
		writes.length = 0;
		historicalRenders = 0;
		return { ui, chat, editor, header, mode, terminal, writes, renders: () => historicalRenders };
	};

	await t.test("20,000 records: Korean/English input and cursor movement do not visit old components or lines", () => {
		const f = fixture(20_000, true);
		const initial = f.ui.captureRenderState();
		const reset = f.ui.applyLineResets;
		let maxProcessed = 0;
		f.ui.applyLineResets = function (lines: string[]) {
			maxProcessed = Math.max(maxProcessed, lines.length);
			return reset.call(this, lines);
		};
		const durations: number[] = [];
		for (const key of Array.from({ length: 20 }, () => ["한", "a", "\x1b[D", "\x1b[C", "\x7f"]).flat()) {
			const start = performance.now();
			f.ui.handleTerminalInput(key);
			f.ui.doRender();
			durations.push(performance.now() - start);
		}
		assert.equal(f.renders(), 0);
		assert.ok(maxProcessed <= 40, `processed ${maxProcessed} lines`);
		assert.doesNotMatch(f.writes.join(""), /HISTORY_|\x1b\[3J/);
		assert.deepEqual(f.ui.previousLines.slice(0, 20_000), initial.previousLines.slice(0, 20_000));
		assert.equal(f.ui.fullRedraws, 1);
		durations.sort((a, b) => a - b);
		t.diagnostic(`20,000 history rows: input+render p95=${durations[94].toFixed(2)}ms, history renders=0, processed<=${maxProcessed}`);
	});

	await t.test("async tool updates and unknown animated transcript components remain live", async () => {
		const f = fixture(100, true);
		const renderFrame = f.ui.doRender.bind(f.ui);
		f.ui.doRender = () => {
			const historicalRenders = f.renders();
			renderFrame();
			assert.equal(f.renders(), historicalRenders, "frame updates must not render old components");
		};
		await toolGroupRenderer({} as Parameters<typeof toolGroupRenderer>[0]);
		const mode = {
			...f.mode, isFirstUserMessage: false, pendingTools: new Map(), ui: f.ui,
			settingsManager: { getShowImages: () => false, getImageWidthCells: () => 60 },
			sessionManager: { getCwd: () => process.cwd() }, toolOutputExpanded: false,
			getRegisteredToolDefinition: () => undefined,
		} as Parameters<typeof __test__.ensureToolHandle>[0];
		const first = __test__.ensureToolHandle(mode, "read", "r1", { path: "first.ts" });
		first.updateResult({ content: [{ type: "text", text: "first" }] });
		f.ui.doRender();
		__test__.ensureToolHandle(mode, "read", "r2", { path: "second.ts" });
		f.ui.doRender();
		mode.pendingTools.get("r2")!.updateArgs({ path: "updated.ts" });
		mode.pendingTools.get("r2")!.updateResult({ content: [{ type: "text", text: "done" }] });
		f.ui.doRender();
		assert.match(f.ui.previousLines.join("\n"), /updated\.ts/);
		const mcp = __test__.ensureToolHandle(mode, "mcp", "m1", { action: "call" });
		f.ui.doRender();
		assert.match(f.ui.previousLines.slice(-20).join("\n"), /MCP 실행 중/);
		mcp.updateResult({ content: [{ type: "text", text: "body" }], details: { server: "test", tool: "ASYNC_RESULT" } });
		f.ui.doRender();
		assert.match(f.ui.previousLines.slice(-20).join("\n"), /test\/ASYNC_RESULT/);
		let frame = "ANIMATION_A";
		f.chat.addChild({ render: () => [frame], invalidate() {} });
		f.ui.doRender();
		frame = "ANIMATION_B";
		f.ui.doRender();
		assert.match(f.ui.previousLines.join("\n"), /ANIMATION_B/);
	});

	await t.test("images already in scrollback survive input without replay", () => {
		const f = fixture(100, true);
		f.chat.children[0] = { render: () => ["\x1b_Gi=42,a=T,f=100;AA==\x1b\\"], invalidate() {} };
		f.ui.doRender();
		assert.ok(f.ui.previousKittyImageIds.has(42));
		f.writes.length = 0;
		f.editor.setText("image history preserved");
		f.ui.doRender();
		assert.ok(f.ui.previousKittyImageIds.has(42));
		assert.doesNotMatch(f.writes.join(""), /\x1b_G|HISTORY_|\x1b\[3J/);
	});

	await t.test("screen output and cursor state match the unpatched renderer across updates", async () => {
		const before = fixture(100, false);
		const after = fixture(100, true);
		const compare = () => {
			before.ui.doRender();
			after.ui.doRender();
			assert.deepEqual(after.ui.captureRenderState(), before.ui.captureRenderState());
			assert.equal(after.writes.join(""), before.writes.join(""));
			before.writes.length = after.writes.length = 0;
		};
		for (const text of ["한글 입력 test", "x".repeat(240), "short", ""]) {
			before.editor.setText(text);
			after.editor.setText(text);
			compare();
		}
		// Streaming changes only a recent row; completed history remains in scrollback.
		for (const f of [before, after]) f.chat.addChild(new Text("stream", 0, 0));
		compare();
		for (const f of [before, after]) f.chat.children.at(-1).setText("stream updated");
		compare();
		assert.equal(after.renders(), 0);
		// Explicit old-content changes, expansion and reflow must still be visible.
		const { ToolExecutionComponent } = await load("components/tool-execution.js");
		for (const f of [before, after]) {
			const tool = new ToolExecutionComponent("example", "t1", {}, {}, undefined, f.ui, process.cwd());
			tool.updateResult({ content: [{ type: "text", text: Array.from({ length: 50 }, (_, i) => `TOOL_${i}`).join("\n") }] });
			f.chat.addChild(tool);
		}
		compare();
		for (const f of [before, after]) f.chat.children.at(-1).setExpanded(true);
		compare();
		assert.match(after.ui.previousLines.join("\n"), /TOOL_49/);
		for (const f of [before, after]) f.chat.children.at(-1).setExpanded(false);
		compare();
		for (const f of [before, after]) f.chat.children[0].setText("CHANGED_OLDEST");
		compare();
		for (const f of [before, after]) f.terminal.columns = 70;
		compare();
		for (const f of [before, after]) f.terminal.rows = 40;
		compare();
		for (const f of [before, after]) f.ui.invalidate();
		compare();
		for (const f of [before, after]) f.header.setText("NEW HEADER");
		compare();
		const handles = [before, after].map((f) => f.ui.showOverlay(new Text("OVERLAY", 0, 0)));
		compare();
		for (const handle of handles) handle.hide();
		compare();
		for (const f of [before, after]) f.chat.children.splice(3, 2, new Text("REPLACED", 0, 0));
		compare();
		const installed = after.ui.doRender;
		installTranscriptRender(after.mode);
		assert.equal(after.ui.doRender, installed, "reload cannot stack adapters");
		for (const f of [before, after]) { f.chat.clear(); f.chat.addChild(new Text("NEW SESSION", 0, 0)); }
		compare();
		assert.doesNotMatch(after.ui.previousLines.join("\n"), /HISTORY_|TOOL_/);
	});
});
