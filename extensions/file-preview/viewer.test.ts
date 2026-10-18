import assert from "node:assert/strict";
import test from "node:test";
import { initTheme, type Theme } from "@mariozechner/pi-coding-agent";
import { resetCapabilitiesCache, setCapabilities, visibleWidth } from "@mariozechner/pi-tui";
import { stripVTControlCharacters } from "node:util";
import { FileViewer } from "./viewer.ts";

initTheme("dark");
const theme = { fg: (_color: string, text: string) => text } as Theme;

test("Markdown을 렌더링하고 원문 토글·스크롤·좁은 폭·닫기를 제공한다", () => {
	// given
	let rows = 16;
	let closed = false;
	const display = "# 한글 제목\n\n| 이름 | 값 |\n| --- | --- |\n| 항목 | 하나 |\n\n```sql\nSELECT 1;\n```\n\n" + Array.from({ length: 80 }, (_, i) => `- 항목 ${i}`).join("\n");
	const view = new FileViewer({ path: "/workspace/한글.md", markdown: true, display, original: display }, theme, () => {}, () => rows, () => { closed = true; });
	// when
	const rendered = stripVTControlCharacters(view.render(70).join("\n"));
	view.handleInput("G");
	const end = stripVTControlCharacters(view.render(70).join("\n"));
	view.handleInput("g");
	view.handleInput("r");
	const raw = stripVTControlCharacters(view.render(70).join("\n"));
	rows = 8;
	const narrow = view.render(12);
	view.handleInput("\x1b");
	// then
	assert.match(rendered, /한글 제목/u);
	assert.doesNotMatch(rendered, /# 한글 제목/u);
	assert.match(rendered, /SELECT 1/u);
	assert.match(end, /항목 79/u);
	assert.match(raw, /# 한글 제목/u);
	assert.ok(narrow.every((line) => visibleWidth(line) <= 12));
	assert.ok(narrow.length <= 7);
	assert.equal(closed, true);
});

test("파일 안의 OS 실행 링크를 막고 HTTP 링크는 유지한다", (t) => {
	// given
	setCapabilities({ images: null, trueColor: true, hyperlinks: true });
	t.after(() => resetCapabilitiesCache());
	const display = "[외부](https://example.org) [실행](custom-run://danger) [로컬](file:///tmp/example.sql)";
	const view = new FileViewer({ path: "/workspace/report.md", markdown: true, display, original: display }, theme, () => {}, () => 20, () => {});
	// when
	const output = view.render(120).join("\n");
	// then
	assert.match(output, /\x1b\]8;;https:\/\/example\.org/u);
	assert.doesNotMatch(output, /\x1b\]8;;(?:custom-run|file):/u);
	assert.match(stripVTControlCharacters(output), /실행/u);
});

test("SQL 복사는 화면 변환 전 원문을 사용한다", async () => {
	// given
	let copied = "";
	const view = new FileViewer({ path: "/workspace/report.sql", markdown: false, display: "SELECT 1;\n", original: "SELECT 1;\r\n" }, theme, () => {}, () => 20, () => {}, async (text) => { copied = text; });
	// when
	view.render(60);
	view.handleInput("c");
	await new Promise((resolve) => setImmediate(resolve));
	// then
	assert.equal(copied, "SELECT 1;\r\n");
	assert.match(stripVTControlCharacters(view.render(100).join("\n")), /원문 복사됨/u);
});
