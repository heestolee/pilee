import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import {
	BACKLOG_OVERLAY_OPTIONS,
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

test("backlog overlay uses the full terminal viewport from the top-left", () => {
	assert.deepEqual(BACKLOG_OVERLAY_OPTIONS, { width: "100%", maxHeight: "100%", anchor: "top-left" });
	assert.equal(backlogOverlayHeight(41), 41);
	assert.equal(backlogOverlayHeight(undefined), 24);
});

test("fillBacklogOverlayLines pads height so stale rows from previous renders are cleared", () => {
	const rows = fillBacklogOverlayLines(["short", "a very very long backlog row"], 10, 4);
	assert.equal(rows.length, 4);
	for (const row of rows) assert.equal(visibleWidth(row), 10);
	assert.equal(rows[0], "short     ");
	assert.equal(rows[2], "          ");
	assert.equal(rows[3], "          ");
});

test("fillBacklogOverlayLines can force clear-safe redraws without changing visible width", () => {
	const firstRows = fillBacklogOverlayLines(["short"], 10, 2, backlogOverlayRenderToken(0));
	const nextRows = fillBacklogOverlayLines(["short"], 10, 2, backlogOverlayRenderToken(1));
	assert.equal(firstRows.length, 2);
	assert.equal(nextRows.length, 2);
	for (const row of [...firstRows, ...nextRows]) assert.equal(visibleWidth(row), 10);
	assert.notEqual(firstRows[0], nextRows[0], "render token should make repeated frames clearable");
	assert.notEqual(firstRows[1], nextRows[1], "blank filler rows should also be redrawn");
});

test("backlog index render path does not call truncateToWidth directly", () => {
	const source = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
	assert.equal(source.includes("truncateToWidth"), false, "index.ts should use backlogOverlayRow so the import cannot drift");
});
