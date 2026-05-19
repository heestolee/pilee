import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildScreensaverTaskLines,
	loadScreensaverTaskLines,
	parentSessionFileForScreensaver,
	readSessionHeaderFromFile,
	resolveScreensaverTaskCandidates,
	screensaverProgressTasks,
} from "./task-source.ts";

function writeJson(path: string, value: unknown): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function task(subject: string, status: string, createdAt: number, extra: Record<string, unknown> = {}) {
	return { subject, status, createdAt, updatedAt: createdAt, blocks: [], blockedBy: [], metadata: {}, ...extra };
}

test("screensaverProgressTasks includes completed tasks and prioritizes current work-map state", () => {
	const visible = screensaverProgressTasks([
		task("삭제", "deleted", 1),
		task("완료 오래됨", "completed", 10),
		task("대기", "pending", 20),
		task("완료 최근", "completed", 40),
		task("blocked kind", "pending", 25, { kind: "blocked" }),
		task("진행", "in_progress", 30),
	], 5);
	assert.deepEqual(visible.map((item) => item.subject), ["진행", "blocked kind", "대기", "완료 최근", "완료 오래됨"]);
});

test("buildScreensaverTaskLines renders work progress summary, active tasks, and completed tasks", () => {
	const dir = mkdtempSync(join(tmpdir(), "pilee-screensaver-task-lines-"));
	try {
		const currentPath = join(dir, "current.json");
		writeJson(currentPath, { nextId: 5, tasks: [
			task("완료 작업", "completed", 1),
			task("대기 작업", "pending", 2),
			task("blocked 작업", "pending", 3, { blockedBy: ["1"] }),
			task("진행 작업", "in_progress", 4),
		] });
		assert.deepEqual(buildScreensaverTaskLines([
			{ source: "current", label: "current", tasksPath: currentPath },
		]), [
			"📋 작업 진행 1/4 완료",
			"  ▸ 진행 작업",
			"  ! blocked 작업",
			"  ○ 대기 작업",
			"  ✓ 완료 작업",
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("buildScreensaverTaskLines still renders all-completed work-units instead of disappearing", () => {
	const dir = mkdtempSync(join(tmpdir(), "pilee-screensaver-task-completed-"));
	try {
		const currentPath = join(dir, "current.json");
		writeJson(currentPath, { nextId: 3, tasks: [task("완료 A", "completed", 1), task("완료 B", "completed", 2)] });
		assert.deepEqual(buildScreensaverTaskLines([
			{ source: "current", label: "current", tasksPath: currentPath },
		]), [
			"📋 작업 진행 2/2 완료",
			"  ✓ 완료 B",
			"  ✓ 완료 A",
		]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("buildScreensaverTaskLines falls back to P0 only when current has no progress tasks", () => {
	const dir = mkdtempSync(join(tmpdir(), "pilee-screensaver-task-p0-"));
	try {
		const currentPath = join(dir, "current.json");
		const p0Path = join(dir, "p0.json");
		writeJson(currentPath, { nextId: 2, tasks: [task("삭제된 현재 작업", "deleted", 1)] });
		writeJson(p0Path, { nextId: 2, tasks: [task("P0 작업", "pending", 1)] });
		assert.deepEqual(buildScreensaverTaskLines([
			{ source: "current", label: "current", tasksPath: currentPath },
			{ source: "p0", label: "P0", tasksPath: p0Path },
		]), ["📋 작업 진행 0/1 완료 · P0", "  ○ P0 작업"]);
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
		assert.deepEqual(loadScreensaverTaskLines(ctx, 5, {} as any), [], "legacy .pi/tasks must not leak into screensaver");

		writeJson(join(cwd, ".pi", "work-tasks.json"), { nextId: 2, tasks: [task("현재 work-unit 작업", "pending", 1)] });
		assert.deepEqual(loadScreensaverTaskLines(ctx, 5, {} as any), ["📋 작업 진행 0/1 완료", "  ○ 현재 work-unit 작업"]);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("same session id aliases are merged into the current session work-map", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pilee-screensaver-session-alias-"));
	try {
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		const sessionDir = join(cwd, "sessions");
		mkdirSync(sessionDir, { recursive: true });
		const currentSession = join(sessionDir, "current.jsonl");
		const aliasSession = join(sessionDir, "alias.jsonl");
		writeFileSync(currentSession, `${JSON.stringify({ type: "session", id: "same-session", cwd })}\n`);
		writeFileSync(aliasSession, `${JSON.stringify({ type: "session", id: "same-session", cwd })}\n`);

		const currentCtx = {
			cwd,
			sessionManager: {
				getSessionFile: () => currentSession,
				getHeader: () => ({ type: "session", cwd }),
			},
		} as any;
		const candidates = resolveScreensaverTaskCandidates(currentCtx, {} as any);
		const current = candidates.find((candidate) => candidate.source === "current");
		const alias = candidates.find((candidate) => candidate.source === "current-alias");
		assert.ok(current, "current candidate should exist");
		assert.ok(alias, "alias candidate should exist for same session id");
		writeJson(current!.tasksPath, { nextId: 2, tasks: [task("현재 파일 완료", "completed", 1)] });
		writeJson(alias!.tasksPath, { nextId: 2, tasks: [task("alias 파일 대기", "pending", 2)] });
		assert.deepEqual(loadScreensaverTaskLines(currentCtx, 5, {} as any), [
			"📋 작업 진행 1/2 완료",
			"  ○ alias 파일 대기",
			"  ✓ 현재 파일 완료",
		]);
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

test("readSessionHeaderFromFile reads the session cwd and id for P0/alias fallback", () => {
	const dir = mkdtempSync(join(tmpdir(), "pilee-screensaver-session-header-"));
	try {
		const sessionFile = join(dir, "p0.jsonl");
		writeFileSync(sessionFile, `${JSON.stringify({ type: "session", id: "p0-id", cwd: "/tmp/p0-cwd", parentSession: "/tmp/root.jsonl" })}\n`);
		assert.deepEqual(readSessionHeaderFromFile(sessionFile), { type: "session", id: "p0-id", cwd: "/tmp/p0-cwd", parentSession: "/tmp/root.jsonl" });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
