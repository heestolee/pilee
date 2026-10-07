import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { listSnapshots, saveCompleteSnapshot } from "./store.ts";
import { bindCapturedWindow } from "./capture.ts";
import { readProcessStarts, writeRegistration } from "./registry.ts";
import { planWorkspaceRestore } from "./planner.ts";
import { readSnapshotSelection } from "./selection.ts";
import type { WorkspaceSnapshot } from "./index.ts";

function fixture() {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-store-")));
	const file = join(root, "session.jsonl");
	writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: "fixture", cwd: root }) + "\n");
	const snapshot = (number: number, source: "auto" | "manual" = "auto"): WorkspaceSnapshot => ({
		version: 1, id: `autosave-${number}`, name: "fixture", source, host: "ghostty", createdAt: number, updatedAt: number, complete: true,
		window: { id: "window", name: "window" }, tabs: [{ id: "tab", index: 1, selected: true, name: "tab", terminals: [
			{ id: "panel", index: 1, name: "session", cwd: root, sessionFile: file, match: "exact" },
		] }],
	});
	return { root, snapshot, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("complete 10 to 11 removes only the oldest auto; manual, unknown, corrupt and restore sources survive", () => {
	const f = fixture();
	try {
		const manual = saveCompleteSnapshot(f.root, f.snapshot(0, "manual")).path;
		const manualBytes = readFileSync(manual);
		for (let n = 1; n <= 10; n++) saveCompleteSnapshot(f.root, { ...f.snapshot(n), id: n === 1 ? "autosave" : `autosave-${n}` });
		const directory = join(f.root, "snapshots");
		writeFileSync(join(directory, "corrupt.json"), "{");
		writeFileSync(join(directory, "unknown.json"), JSON.stringify({ ...f.snapshot(-1), source: "unknown" }));
		mkdirSync(join(f.root, "restore-sources"));
		writeFileSync(join(f.root, "restore-sources", "source.json"), "preserved");
		assert.equal(listSnapshots(f.root).length, 11); // Listing does not prune.
		const result = saveCompleteSnapshot(f.root, f.snapshot(11));
		assert.deepEqual(result.deleted, [join(directory, "autosave.json")]);
		assert.deepEqual(listSnapshots(f.root).map((item) => item.updatedAt), [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 0]);
		assert.deepEqual(readFileSync(manual), manualBytes);
		assert.equal(readFileSync(join(directory, "corrupt.json"), "utf8"), "{");
		assert.ok(readFileSync(join(directory, "unknown.json"), "utf8").includes("unknown"));
		assert.equal(readFileSync(join(f.root, "restore-sources", "source.json"), "utf8"), "preserved");
	} finally { f.cleanup(); }
});

test("write/rename failures and incomplete captures keep all previous snapshots and leave no partial temporary file", () => {
	const f = fixture();
	try {
		for (let n = 1; n <= 10; n++) saveCompleteSnapshot(f.root, f.snapshot(n));
		const before = listSnapshots(f.root).map((item) => [item.path, readFileSync(item.path)] as const);
		assert.throws(() => saveCompleteSnapshot(f.root, { ...f.snapshot(11), id: "x".repeat(240) }), /ENAMETOOLONG/);
		mkdirSync(join(f.root, "snapshots", "autosave-11.json"));
		assert.throws(() => saveCompleteSnapshot(f.root, f.snapshot(11)), /EISDIR|ENOTEMPTY/);
		const invalid = f.snapshot(12); delete invalid.tabs[0].terminals[0].sessionFile;
		assert.throws(() => saveCompleteSnapshot(f.root, invalid), /불완전 capture/);
		for (const [path, bytes] of before) assert.deepEqual(readFileSync(path), bytes);
		assert.equal(listSnapshots(f.root).length, 10);
		assert.equal(readdirSync(join(f.root, "snapshots")).some((name) => name.endsWith(".tmp")), false);
	} finally { f.cleanup(); }
});

test("v3 source-state roundtrip survives registry clearing without modifying original JSONL", () => {
	const f = fixture();
	try {
		const files = ["original", "fork"].map((name) => {
			const file = join(f.root, `${name}.jsonl`);
			writeFileSync(file, [
				{ type: "session", version: 3, id: "same-header-id", timestamp: "2026-01-01T00:00:00.000Z", cwd: f.root },
				{ type: "message", id: "u1", parentId: null, timestamp: "2026-01-01T00:00:01.000Z", message: { role: "user", content: name, timestamp: 1 } },
				{ type: "session_info", id: "info", parentId: "u1", timestamp: "2026-01-01T00:00:02.000Z", name: "same title" },
			].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
			return file;
		});
		const originalBytes = files.map((file) => readFileSync(file));
		files.forEach((file, index) => writeRegistration(f.root, {
			version: 1, pid: process.pid, processStartedAt: readProcessStarts([process.pid]).get(process.pid)!, processToken: index ? "bbb" : "aaa", generation: "one", updatedAt: 1,
			sessionFile: file, cwd: f.root, title: "same title", panelLabel: "P0", binding: { windowId: "window", terminalId: `panel-${index}` },
		}));
		const snapshot = f.snapshot(1, "manual");
		snapshot.tabs = bindCapturedWindow({ id: "window", name: "window", tabs: [{ id: "tab", index: 1, selected: true, name: "tab",
			terminals: files.map((_file, index) => ({ id: `panel-${index}`, index: index + 1, name: "same title", cwd: f.root })),
		}] }, f.root);
		const { path } = saveCompleteSnapshot(f.root, snapshot);
		rmSync(join(f.root, "registrations"), { recursive: true });
		const plan = planWorkspaceRestore(readSnapshotSelection(path).snapshot, (term) => `pi --session '${term.sessionFile}'`);
		assert.deepEqual([plan.total, plan.ready, plan.blocked], [2, 2, 0]);
		assert.deepEqual(plan.actions.flat().map((action) => action.sessionFile), files);
		assert.ok(plan.actions.flat().every((action) => action.cwd === f.root));
		files.forEach((file, index) => assert.deepEqual(readFileSync(file), originalBytes[index]));
	} finally { f.cleanup(); }
});
