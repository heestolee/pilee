import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolveWorkUnit } from "../utils/work-context.ts";

export type ScreensaverTaskStatus = "pending" | "in_progress" | "completed" | "blocked" | "deleted" | "rejected" | "deprioritized" | "superseded" | string;

export interface ScreensaverTask {
	id?: string;
	subject?: string;
	status?: ScreensaverTaskStatus;
	kind?: string;
	blockedBy?: string[];
	createdAt?: number;
	updatedAt?: number;
}

export interface ScreensaverTaskStore {
	tasks?: ScreensaverTask[];
}

export interface ScreensaverTaskCandidate {
	source: "current" | "current-alias" | "p0";
	label: string;
	tasksPath: string;
}

export interface SessionHeaderLike {
	id?: string;
	cwd?: string;
	parentSession?: string;
}

const PROGRESS_STATUSES = new Set(["in_progress", "pending", "blocked", "completed"]);
const SOFT_DISPOSITION_STATUSES = new Set(["deleted", "rejected", "deprioritized", "superseded"]);

function readJsonFile<T>(path: string): T | null {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

export function readSessionHeaderFromFile(sessionFile: string | undefined | null): SessionHeaderLike | null {
	if (!sessionFile) return null;
	try {
		const raw = readFileSync(sessionFile, "utf8");
		for (const line of raw.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			const parsed = JSON.parse(trimmed);
			if (parsed?.type === "session") return parsed as SessionHeaderLike;
			return null;
		}
	} catch {}
	return null;
}

function taskSubject(task: ScreensaverTask): string {
	return String(task.subject ?? "").trim();
}

function isProgressTask(task: ScreensaverTask): boolean {
	if (!taskSubject(task)) return false;
	if (!task.status) return false;
	if (SOFT_DISPOSITION_STATUSES.has(task.status)) return false;
	return PROGRESS_STATUSES.has(task.status);
}

function statusRank(task: ScreensaverTask): number {
	if (task.status === "in_progress") return 0;
	if (isBlockedTask(task)) return 1;
	if (task.status === "pending") return 2;
	if (task.status === "completed") return 3;
	return 9;
}

function taskTime(task: ScreensaverTask): number {
	return task.updatedAt ?? task.createdAt ?? 0;
}

function sortProgressTasks(tasks: ScreensaverTask[]): ScreensaverTask[] {
	return [...tasks].sort((a, b) => {
		const rank = statusRank(a) - statusRank(b);
		if (rank !== 0) return rank;
		if (a.status === "completed" && b.status === "completed") return taskTime(b) - taskTime(a);
		return (a.createdAt ?? 0) - (b.createdAt ?? 0) || taskTime(a) - taskTime(b);
	});
}

function taskKey(task: ScreensaverTask): string {
	return [task.id ?? "", taskSubject(task), task.status ?? "", task.createdAt ?? ""].join("\u0000");
}

function uniqueProgressTasks(tasks: ScreensaverTask[]): ScreensaverTask[] {
	const seen = new Set<string>();
	const out: ScreensaverTask[] = [];
	for (const task of tasks) {
		if (!isProgressTask(task)) continue;
		const key = taskKey(task);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(task);
	}
	return out;
}

export function screensaverProgressTasks(tasks: ScreensaverTask[], limit = 5): ScreensaverTask[] {
	return sortProgressTasks(uniqueProgressTasks(tasks)).slice(0, limit);
}

function isBlockedTask(task: ScreensaverTask): boolean {
	return task.status === "blocked" || task.kind === "blocked" || Boolean(task.blockedBy?.length);
}

function taskIcon(task: ScreensaverTask): string {
	if (task.status === "in_progress") return "▸";
	if (isBlockedTask(task)) return "!";
	if (task.status === "pending") return "○";
	if (task.status === "completed") return "✓";
	return "•";
}

function readTasks(candidate: ScreensaverTaskCandidate): ScreensaverTask[] {
	const store = readJsonFile<ScreensaverTaskStore | ScreensaverTask[]>(candidate.tasksPath);
	return Array.isArray(store) ? store : store?.tasks ?? [];
}

function taskGroupLines(source: "current" | "p0", tasks: ScreensaverTask[], limit: number): string[] {
	const progressTasks = uniqueProgressTasks(tasks);
	if (progressTasks.length === 0) return [];
	const completed = progressTasks.filter((task) => task.status === "completed").length;
	const suffix = source === "p0" ? " · P0" : "";
	const lines = [`📋 작업 진행 ${completed}/${progressTasks.length} 완료${suffix}`];
	for (const task of screensaverProgressTasks(progressTasks, limit)) {
		lines.push(`  ${taskIcon(task)} ${taskSubject(task)}`);
	}
	return lines;
}

export function buildScreensaverTaskLines(candidates: ScreensaverTaskCandidate[], limit = 5): string[] {
	const currentTasks = candidates
		.filter((candidate) => candidate.source === "current" || candidate.source === "current-alias")
		.flatMap(readTasks);
	const currentLines = taskGroupLines("current", currentTasks, limit);
	if (currentLines.length > 0) return currentLines;

	const p0Tasks = candidates
		.filter((candidate) => candidate.source === "p0")
		.flatMap(readTasks);
	return taskGroupLines("p0", p0Tasks, limit);
}

function currentSessionFile(ctx: ExtensionContext): string | undefined {
	try { return ctx.sessionManager.getSessionFile?.(); } catch { return undefined; }
}

function currentHeader(ctx: ExtensionContext): SessionHeaderLike | null {
	try { return ctx.sessionManager.getHeader?.() as SessionHeaderLike | null; } catch { return null; }
}

function sameSessionIdAliases(sessionFile: string | undefined, header: SessionHeaderLike | null, cwd: string): ScreensaverTaskCandidate[] {
	if (!sessionFile || !header?.id) return [];
	try {
		const currentReal = resolve(sessionFile);
		const dir = dirname(sessionFile);
		return readdirSync(dir)
			.filter((fileName) => fileName.endsWith(".jsonl"))
			.map((fileName) => resolve(dir, fileName))
			.filter((filePath) => filePath !== currentReal)
			.map((filePath) => ({ filePath, header: readSessionHeaderFromFile(filePath), mtime: safeMtime(filePath) }))
			.filter((item) => item.header?.id === header.id)
			.sort((a, b) => b.mtime - a.mtime)
			.map((item) => {
				const unit = resolveWorkUnit(item.header?.cwd || cwd, item.filePath);
				return { source: "current-alias" as const, label: unit.displayName, tasksPath: unit.tasksPath };
			});
	} catch {
		return [];
	}
}

function safeMtime(path: string): number {
	try { return statSync(path).mtimeMs; } catch { return 0; }
}

export function parentSessionFileForScreensaver(ctx: ExtensionContext, env: NodeJS.ProcessEnv = process.env): string | undefined {
	const fromHeader = currentHeader(ctx)?.parentSession;
	const fromEnv = env.PI_FORK_PARENT;
	const parent = (fromHeader || fromEnv || "").trim();
	if (!parent) return undefined;
	try {
		const current = currentSessionFile(ctx);
		if (current && resolve(parent) === resolve(current)) return undefined;
	} catch {}
	return parent;
}

export function resolveScreensaverTaskCandidates(ctx: ExtensionContext, env: NodeJS.ProcessEnv = process.env): ScreensaverTaskCandidate[] {
	const currentSession = currentSessionFile(ctx);
	const liveHeader = currentHeader(ctx);
	const fileHeader = readSessionHeaderFromFile(currentSession);
	const header = { ...(fileHeader ?? {}), ...(liveHeader ?? {}), id: liveHeader?.id || fileHeader?.id } as SessionHeaderLike;
	const currentUnit = resolveWorkUnit(ctx.cwd, currentSession);
	const candidates: ScreensaverTaskCandidate[] = [{ source: "current", label: currentUnit.displayName, tasksPath: currentUnit.tasksPath }];
	const seen = new Set(candidates.map((candidate) => candidate.tasksPath));

	for (const alias of sameSessionIdAliases(currentSession, header, ctx.cwd)) {
		if (seen.has(alias.tasksPath)) continue;
		seen.add(alias.tasksPath);
		candidates.push(alias);
	}

	const parentSession = parentSessionFileForScreensaver(ctx, env);
	if (!parentSession) return candidates;
	const parentHeader = readSessionHeaderFromFile(parentSession);
	const parentCwd = parentHeader?.cwd || ctx.cwd;
	const parentUnit = resolveWorkUnit(parentCwd, parentSession);
	if (!seen.has(parentUnit.tasksPath)) {
		candidates.push({ source: "p0", label: parentUnit.displayName, tasksPath: parentUnit.tasksPath });
	}
	return candidates;
}

export function loadScreensaverTaskLines(ctx: ExtensionContext, limit = 5, env: NodeJS.ProcessEnv = process.env): string[] {
	return buildScreensaverTaskLines(resolveScreensaverTaskCandidates(ctx, env), limit);
}
