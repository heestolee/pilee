import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
	analyzeShortcuts,
	buildShortcutAtlas,
	customShortcutCoverage,
	normalizeShortcutKey,
	PILEE_CUSTOM_SHORTCUTS,
	type ShortcutEntry,
} from "./registry.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function custom(key: string, action = "test action", source = "test"): ShortcutEntry {
	return { key, action, source, layer: "pilee", scope: "test" };
}

test("normalizes modifier order and symbol keys without losing the symbol", () => {
	assert.equal(normalizeShortcutKey("Shift+Ctrl+O"), "ctrl+shift+o");
	assert.equal(normalizeShortcutKey("cmd+-"), "cmd+-");
	assert.equal(normalizeShortcutKey("Ctrl+-"), "ctrl+-");
	assert.equal(normalizeShortcutKey("Option+Return"), "alt+enter");
	assert.equal(normalizeShortcutKey("Super+T"), "cmd+t");
});

test("actual pilee custom shortcuts have no custom-custom collisions", () => {
	const atlas = buildShortcutAtlas();
	const customCollisions = atlas.issues.filter((issue) => issue.type === "custom-collision");
	assert.deepEqual(customCollisions, []);
	assert.ok(atlas.entries.some((entry) => entry.layer === "pilee" && entry.key === "ctrl+shift+o" && /tasks/.test(entry.action)), "Ctrl+Shift+O tasks toggle must be in custom atlas");
});

test("Ghostty host shortcuts include tab, split, navigation, and search actions", () => {
	const atlas = buildShortcutAtlas();
	const terminalKeys = new Set(atlas.entries.filter((entry) => entry.layer === "terminal" && /Ghostty/.test(entry.scope)).map((entry) => entry.key));
	for (const key of ["cmd+t", "cmd+shift+]", "cmd+alt+right", "cmd+f", "cmd+shift+g"]) {
		assert.ok(terminalKeys.has(key), `${key} should be documented as a Ghostty host shortcut`);
	}
});

test("detects custom shortcut collisions as blocking errors", () => {
	const issues = analyzeShortcuts([...PILEE_CUSTOM_SHORTCUTS, custom("ctrl+shift+o", "duplicate tasks toggle")]);
	const collision = issues.find((issue) => issue.type === "custom-collision" && issue.key === "ctrl+shift+o");
	assert.ok(collision, "duplicate custom shortcut should be reported");
	assert.equal(collision.severity, "error");
	assert.equal(collision.entries.length, 2);
});

test("detects reserved Pi overlaps as warnings instead of hiding them", () => {
	const atlas = buildShortcutAtlas([custom("ctrl+c", "dangerous custom copy overlap")]);
	const warning = atlas.issues.find((issue) => issue.type === "reserved-overlap" && issue.key === "ctrl+c");
	assert.ok(warning, "custom Ctrl+C should overlap with Pi reserved shortcuts");
	assert.equal(warning.severity, "warning");
	assert.ok(warning.entries.some((entry) => entry.layer === "pi"));
	assert.ok(warning.entries.some((entry) => entry.layer === "pilee"));
});

test("literal registerShortcut calls in source are covered by the curated custom atlas", () => {
	const coverage = customShortcutCoverage(REPO_ROOT);
	assert.deepEqual(coverage.missing, []);
	const scannedKeys = new Set(coverage.scanned.map((entry) => entry.key));
	assert.ok(scannedKeys.has("ctrl+w"), "source scan should see worktree Ctrl+W literal");
	assert.ok(scannedKeys.has("ctrl+shift+o"), "source scan should see tasks Ctrl+Shift+O literal");
});
