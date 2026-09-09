import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

function between(start: string, end: string): string {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	assert.ok(startIndex >= 0 && endIndex > startIndex);
	return source.slice(startIndex, endIndex);
}

const dashboardLoad = between("async function loadDashboardWorktrees", "function statusIcon");
const dashboardRender = between("async function showDashboard", "async function handleSwitch");

test("wt switch dashboard opens from metadata without waiting for per-worktree git status", () => {
	assert.doesNotMatch(dashboardLoad, /await getWorktreeStatus/);
	assert.match(dashboardLoad, /gitStatus: cachedDashboardStatus\(w\.path\)/);
	assert.match(dashboardRender, /createDashboardStatusLoader<WorktreeGitStatus \| null>/);
	assert.match(dashboardRender, /concurrency: 4/);
});

test("wt switch schedules git status only for currently rendered rows", () => {
	assert.match(dashboardRender, /const renderedItems = visible\.slice\(scrollOffset, scrollOffset \+ visibleHeight\)/);
	assert.match(dashboardRender, /scheduleStatuses\(renderedItems\)/);
	assert.match(dashboardRender, /filter\(\(item\) => item\.gitStatus === undefined\)/);
	assert.doesNotMatch(dashboardRender, /scheduleStatuses\(worktrees\)/);
	assert.match(dashboardRender, /statusLoader\.close\(\)/);
});
