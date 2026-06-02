import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { backlogOverlayRow, fillBacklogOverlayLines } from "./rendering.ts";

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

test("fillBacklogOverlayLines pads height so stale rows from previous renders are cleared", () => {
	const rows = fillBacklogOverlayLines(["short", "a very very long backlog row"], 10, 4);
	assert.equal(rows.length, 4);
	for (const row of rows) assert.equal(visibleWidth(row), 10);
	assert.equal(rows[0], "short     ");
	assert.equal(rows[2], "          ");
	assert.equal(rows[3], "          ");
});
