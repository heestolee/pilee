import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	activeScreensaverTasks,
	buildScreensaverTaskLines,
	loadScreensaverTaskLines,
	parentSessionFileForScreensaver,
	readSessionHeaderFromFile,
} from "./task-source.ts";

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function task(subject: string, status: string, createdAt: number) {
	return { subject, status, createdAt, updatedAt: createdAt, blocks: [], blockedBy: [], metadata: {} };
}

test("activeScreensaverTasks keeps only pending/in_progress and prioritizes in-progress", () => {
	const active = activeScreensaverTasks([
		task("완료", "completed", 1),
		task("대기 늦음", "pending", 30),
		task("진행", "in_progress", 40),
		task("대기 빠름", "pending", 20),
	], 5);
	assert.deepEqual(active.map((item) => item.subject), ["진행", "대기 빠름", "대기 늦음"]);
});

test("buildScreensaverTaskLines uses current work-unit first and falls back to P0 only when current has no active task", () => {
	const dir = mkdtempSync(join(tmpdir(), "pilee-screensaver-task-source-"));
	try {
		const currentPath = join(dir, "current.json");
		const p0Path = join(dir, "p0.json");
		writeJson(currentPath, { nextId: 2, tasks: [task("현재 작업", "pending", 1)] });
		writeJson(p0Path, { nextId: 2, tasks: [task("P0 작업", "pending", 1)] });
		assert.deepEqual(buildScreensaverTaskLines([
			{ source: "current", label: "current", tasksPath: currentPath },
			{ source: "p0", label: "P0", tasksPath: p0Path },
		]), ["📋 TODO", "  ○ 현재 작업"]);

		writeJson(currentPath, { nextId: 2, tasks: [task("현재 완료", "completed", 1)] });
		assert.deepEqual(buildScreensaverTaskLines([
			{ source: "current", label: "current", tasksPath: currentPath },
			{ source: "p0", label: "P0", tasksPath: p0Path },
		]), ["📋 TODO · P0", "  ○ P0 작업"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("loadScreensaverTaskLines ignores legacy cwd/.pi/tasks files", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pilee-screensaver-legacy-"));
	try {
		execFileSync("git", ["init", "--quiet"], { cwd });
		mkdirSync(join(cwd, ".pi", "tasks"), { recursive: true });
		writeJson(join(cwd, ".pi", "tasks", "tasks-legacy.json"), {
			nextId: 2,
			tasks: [task("COM-2424 verify check: 심사용 본문 비교", "pending", 1)],
		});
		const ctx = {
			cwd,
			sessionManager: {
				getSessionFile: () => join(cwd, "session.jsonl"),
				getHeader: () => ({ type: "session", cwd }),
			},
		} as any;
		assert.deepEqual(loadScreensaverTaskLines(ctx), [], "legacy .pi/tasks must not leak into screensaver");

		writeJson(join(cwd, ".pi", "work-tasks.json"), { nextId: 2, tasks: [task("현재 work-unit 작업", "pending", 1)] });
		assert.deepEqual(loadScreensaverTaskLines(ctx), ["📋 TODO", "  ○ 현재 work-unit 작업"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("parentSessionFileForScreensaver prefers session header and ignores self-parent", () => {
	const ctx = {
		cwd: "/tmp/example",
		sessionManager: {
			getSessionFile: () => "/tmp/example/current.jsonl",
			getHeader: () => ({ parentSession: "/tmp/example/parent.jsonl" }),
		},
	} as any;
	assert.equal(parentSessionFileForScreensaver(ctx, { PI_FORK_PARENT: "/tmp/example/env-parent.jsonl" } as any), "/tmp/example/parent.jsonl");

	const selfCtx = {
		cwd: "/tmp/example",
		sessionManager: {
			getSessionFile: () => "/tmp/example/current.jsonl",
			getHeader: () => ({ parentSession: "/tmp/example/current.jsonl" }),
		},
	} as any;
	assert.equal(parentSessionFileForScreensaver(selfCtx, {} as any), undefined);
});

test("readSessionHeaderFromFile reads the session cwd for P0 fallback", () => {
	const dir = mkdtempSync(join(tmpdir(), "pilee-screensaver-session-header-"));
	try {
		const sessionFile = join(dir, "p0.jsonl");
		writeFileSync(sessionFile, `${JSON.stringify({ type: "session", cwd: "/tmp/p0-cwd", parentSession: "/tmp/root.jsonl" })}\n`);
		assert.deepEqual(readSessionHeaderFromFile(sessionFile), { type: "session", cwd: "/tmp/p0-cwd", parentSession: "/tmp/root.jsonl" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
