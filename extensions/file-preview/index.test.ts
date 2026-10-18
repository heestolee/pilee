import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { initTheme } from "@mariozechner/pi-coding-agent";
import { resetCapabilitiesCache, setCapabilities } from "@mariozechner/pi-tui";
import filePreview from "./index.ts";

initTheme("dark");
function harness(transformer = true, useHostReadiness = false) {
	const commands = new Map<string, any>();
	const events = new Map<string, any>();
	let transform: (value: string) => string = (value) => value;
	filePreview({
		registerCommand: (name: string, command: any) => commands.set(name, command),
		on: (name: string, handler: any) => events.set(name, handler),
		...(transformer ? { registerMarkdownTransformer: (fn: any) => { transform = fn; } } : {}),
	} as any, useHostReadiness ? undefined : async () => false);
	return { commands, events, transform: (value: string) => transform(value) };
}

function context(cwd: string, entries: any[] = []) {
	const notices: string[] = [];
	const renders: string[] = [];
	let choices: string[] = [];
	const ctx = {
		cwd, mode: "tui", hasUI: true, isIdle: () => true,
		sessionManager: { getBranch: () => entries },
		ui: {
			notify: (text: string) => notices.push(text), setStatus() {},
			select: async (_title: string, values: string[]) => { choices = values; return values[0]; },
			custom: async (factory: any) => {
				const view = factory({ requestRender() {}, terminal: { rows: 24 } }, { fg: (_color: string, text: string) => text }, {}, () => {});
				renders.push(view.render(80).join("\n"));
				view.handleInput("\x1b"); view.dispose();
			},
		},
	};
	return { ctx, notices, renders, choices: () => choices };
}

test("공식 transformer 미지원 호스트에서도 /preview와 과거 링크 목록을 사용할 수 있다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-command-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "한글 (초안).md"), "# 결과\n\n- 확인됨");
	const source = "[이전 보고서](<./한글 (초안).md>)";
	const entry = Object.freeze({ type: "message", message: Object.freeze({ role: "assistant", content: Object.freeze([{ type: "text", text: source }]) }) });
	const host = harness(false);
	const view = context(dir, [entry]);
	// when
	await host.events.get("session_start")({}, view.ctx);
	await host.commands.get("preview").handler("", view.ctx);
	await host.events.get("session_shutdown")({});
	// then
	assert.match(view.choices()[0], /한글 \(초안\)\.md/u);
	assert.match(view.renders[0], /결과/u);
	assert.equal(entry.message.content[0].text, source);
	assert.equal(view.notices.length, 0);
});

test("세션 교체 후 이전 파일 목록과 transformer 상태를 버린다", async () => {
	// given
	const host = harness();
	const first = context("/workspace/first", [{ type: "message", message: { role: "assistant", content: "[이전](./old.sql)" } }]);
	const next = context("/workspace/next");
	// when
	await host.events.get("session_start")({}, first.ctx);
	await host.events.get("session_shutdown")({});
	await host.events.get("session_start")({}, next.ctx);
	await host.commands.get("preview").handler("", next.ctx);
	// then
	assert.equal(next.choices().length, 0);
	assert.match(next.notices[0], /찾지 못했습니다/u);
	await host.events.get("session_shutdown")({});
	assert.equal(host.transform("[새 문서](./new.md)"), "[새 문서](./new.md)");
});

test("중복 command와 busy 상태는 overlay를 추가하지 않는다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-command-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "report.sql"), "SELECT 1;");
	const host = harness(false);
	const view = context(dir);
	let finish: () => void = () => {};
	let opened = 0;
	view.ctx.ui.custom = async (factory: any) => {
		opened++;
		await new Promise<void>((resolve) => {
			const component = factory({ requestRender() {}, terminal: { rows: 20 } }, { fg: (_color: string, text: string) => text }, {}, () => resolve());
			component.render(80);
			finish = () => { component.handleInput("\x1b"); component.dispose(); };
		});
	};
	await host.events.get("session_start")({}, view.ctx);
	// when
	const pending = host.commands.get("preview").handler("report.sql", view.ctx);
	while (!opened) await new Promise((resolve) => setImmediate(resolve));
	await host.commands.get("preview").handler("report.sql", view.ctx);
	finish(); await pending;
	// then
	assert.equal(opened, 1);
	assert.match(view.notices[0], /사용 중/u);
	await host.events.get("session_shutdown")({});
});

test("파일 읽기 중 세션이 종료되면 옛 UI를 다시 사용하지 않는다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-command-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "report.md"), "# 결과");
	const host = harness(false);
	const view = context(dir);
	await host.events.get("session_start")({}, view.ctx);
	// when
	const pending = host.commands.get("preview").handler("report.md", view.ctx);
	await host.events.get("session_shutdown")({});
	view.ctx.ui.notify = () => { throw new Error("stale UI"); };
	await pending;
	// then
	assert.equal(view.renders.length, 0);
});

test("클릭 미지원 터미널은 원래 링크를 보존하고 command 목록을 제공한다", async (t) => {
	setCapabilities({ images: null, trueColor: true, hyperlinks: false });
	t.after(() => resetCapabilitiesCache());
	const host = harness(true, true);
	const view = context("/workspace");
	await host.events.get("session_start")({}, view.ctx);
	const source = "[파일](./report.md)";
	assert.equal(host.transform(source), source);
	await host.events.get("session_shutdown")({});
});

test("인코딩된 # 파일명이 과거 링크 목록과 command에서 재해석되지 않는다", async (t) => {
	const dir = await mkdtemp(join(tmpdir(), "preview-command-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "notes#1.md"), "# 해시 파일명");
	const host = harness();
	const view = context(dir, [{ type: "message", message: { role: "assistant", content: "[문서](./notes%231.md)" } }]);
	await host.events.get("session_start")({}, view.ctx);
	await host.commands.get("preview").handler("", view.ctx);
	await host.commands.get("preview").handler("./notes%231.md", view.ctx);
	assert.equal(view.renders.length, 2);
	assert.ok(view.renders.every((text) => text.includes("해시 파일명")));
	assert.equal(view.notices.length, 0);
	await host.events.get("session_shutdown")({});
});

test("headless에서는 파일이나 overlay를 열지 않고 사용법만 알린다", async () => {
	// given
	const host = harness();
	const view = context("/workspace");
	view.ctx.mode = "print"; view.ctx.hasUI = false;
	// when
	await host.events.get("session_start")({}, view.ctx);
	await host.commands.get("preview").handler("report.sql", view.ctx);
	// then
	assert.equal(view.renders.length, 0);
	assert.match(view.notices[0], /Pi TUI/u);
});
