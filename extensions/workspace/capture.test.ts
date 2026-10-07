import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { bindCapturedWindow, parseGhosttySnapshotOutput } from "./capture.ts";
import { readProcessStarts, writeRegistration } from "./registry.ts";

const processStartedAt = readProcessStarts([process.pid]).get(process.pid)!;

test("same title, cwd and header ID in distinct files map only to exact terminal IDs, including idle sessions", () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-capture-")));
	try {
		const files = ["first", "second"].map((name) => {
			const file = join(root, `${name}.jsonl`);
			writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: "shared-id", cwd: root }) + "\n");
			return file;
		});
		for (const [index, file] of files.entries()) writeRegistration(root, {
			version: 1, pid: process.pid, processStartedAt, processToken: index ? "bbb" : "aaa", generation: "one", updatedAt: 1,
			sessionFile: file, cwd: root, title: "same", panelLabel: `P${index}`,
			binding: { windowId: "window", terminalId: `terminal-${index}` },
		});
		const window = parseGhosttySnapshotOutput(`WINDOW\twindow\tsame\nTAB\ttab\t1\ttrue\tsame\nTERM\tterminal-1\t1\tsame\t${root}\nTERM\tterminal-0\t2\tsame\t${root}`);
		const tabs = bindCapturedWindow(window, root);
		assert.deepEqual(tabs[0].terminals.map((term) => term.sessionFile), files.toReversed());
		assert.deepEqual(tabs[0].terminals.map((term) => term.panelLabel), ["P1", "P0"]);
		window.tabs[0].terminals[0].id = "unregistered";
		assert.throws(() => bindCapturedWindow(window, root), /panel 1.*정확한 live binding 없음/s);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("malformed capture and ambiguous/dead registrations never produce a complete capture", () => {
	const root = mkdtempSync(join(tmpdir(), "workspace-capture-invalid-"));
	try {
		assert.throws(() => parseGhosttySnapshotOutput("WINDOW\tw\tw\nTERM\tx\t1\tname\t/tmp"), /불완전/);
		const window = parseGhosttySnapshotOutput(`WINDOW\tw\tw\nTAB\tt\t1\ttrue\tt\nTERM\tx\t1\tname\t${root}`);
		for (const token of ["aaa", "bbb"]) writeRegistration(root, {
			version: 1, pid: process.pid, processStartedAt, processToken: token, generation: "one", updatedAt: 1,
			sessionFile: "/missing.jsonl", cwd: root, title: "name", panelLabel: "P0", binding: { windowId: "w", terminalId: "x" },
		});
		assert.throws(() => bindCapturedWindow(window, root), /중복 binding/);
		for (const token of ["aaa", "bbb"]) writeRegistration(root, {
			version: 1, pid: process.pid, processStartedAt, processToken: token, generation: "one", updatedAt: 1,
			sessionFile: "/missing.jsonl", cwd: root, title: "name", panelLabel: "P0", error: "registration failed",
		});
		assert.throws(() => bindCapturedWindow(window, root), /저장·자동본 정리를 하지 않습니다/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
