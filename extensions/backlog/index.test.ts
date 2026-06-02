import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
	BACKLOG_OVERLAY_BG,
	BACKLOG_OVERLAY_OPTIONS,
	backlogInlineText,
	backlogNotePreview,
	backlogOverlayHeight,
	backlogOverlayRenderToken,
	backlogOverlayRow,
	fillBacklogOverlayLines,
} from "./rendering.ts";

test("backlogOverlayRow pads short rows to the full overlay width", () => {
	const row = backlogOverlayRow("  Backlog", 24);
	assert.equal(visibleWidth(row), 24);
	assert.ok(row.startsWith("  Backlog"));
});

test("backlogOverlayRow preserves ANSI styling while clearing trailing cells", () => {
	const row = backlogOverlayRow("\u001b[33m▶ #1 긴 제목\u001b[0m", 18);
	assert.equal(visibleWidth(row), 18);
	assert.match(row, /\u001b\[33m/);
	assert.ok(row.endsWith(" "), "short colored rows should still pad with clearing spaces");
});

test("backlog overlay stays a modal over Pi instead of taking over the whole page", () => {
	assert.deepEqual(BACKLOG_OVERLAY_OPTIONS, { width: "90%", maxHeight: "90%", anchor: "center" });
	assert.equal(backlogOverlayHeight(41), 36);
	assert.equal(backlogOverlayHeight(undefined), 21);
});

test("backlog note preview is sanitized into a single terminal row", () => {
	const note = "\u001b[31m## 배경\u001b[0m\n- 현재 작업 세션: product/날쌩마\t/github:pr-merge";
	assert.equal(backlogInlineText(note), "## 배경 - 현재 작업 세션: product/날쌩마 /github:pr-merge");
	const preview = backlogNotePreview(note, 30);
	assert.equal(preview.includes("\n"), false);
	assert.equal(preview.includes("\t"), false);
	assert.equal(preview.includes("\u001b"), false);
	assert.ok(visibleWidth(preview) <= 30);
});

test("fillBacklogOverlayLines caps height without reserving a fixed blank area", () => {
	const rows = fillBacklogOverlayLines(["short", "a very very long backlog row"], 10, 4);
	assert.equal(rows.length, 2);
	for (const row of rows) assert.equal(visibleWidth(row), 10);
	assert.equal(rows[0], "short     ");

	const capped = fillBacklogOverlayLines(["one", "two", "three"], 10, 2);
	assert.equal(capped.length, 2);
	assert.deepEqual(capped.map((row) => row.trim()), ["one", "two"]);
});

test("fillBacklogOverlayLines can force clear-safe redraws without changing visible width", () => {
	const firstToken = backlogOverlayRenderToken(0);
	const nextToken = backlogOverlayRenderToken(1);
	const coloredRow = "\u001b[31mshort\u001b[0m";
	const firstRows = fillBacklogOverlayLines([coloredRow], 10, 2, firstToken);
	const nextRows = fillBacklogOverlayLines(["short"], 10, 2, nextToken);
	assert.equal(firstRows.length, 1);
	assert.equal(nextRows.length, 1);
	for (const row of [...firstRows, ...nextRows]) assert.equal(visibleWidth(row), 10);
	assert.ok(firstRows[0].startsWith(firstToken), "render token must be before visible cells so TUI slicing preserves it");
	assert.ok(nextRows[0].startsWith(nextToken), "next frame token must be before visible cells");
	assert.ok(firstRows[0].includes(BACKLOG_OVERLAY_BG), "overlay rows should paint a solid background");
	assert.ok(firstRows[0].includes(`\u001b[0m${BACKLOG_OVERLAY_BG}`), "background should be restored after row text resets");
	assert.notEqual(firstRows[0], nextRows[0], "render token should make repeated visible rows clearable");
});

test("backlog index render path does not call truncateToWidth directly", () => {
	const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
	assert.equal(source.includes("truncateToWidth"), false, "index.ts should use backlogOverlayRow so the import cannot drift");
});
