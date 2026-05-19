import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { resolveWorkUnit } from "../utils/work-context.ts";

export type ScreensaverTaskStatus = "pending" | "in_progress" | string;

export interface ScreensaverTask {
	id?: string;
	subject?: string;
	status?: ScreensaverTaskStatus;
	createdAt?: number;
	updatedAt?: number;
}

export interface ScreensaverTaskStore {
	tasks?: ScreensaverTask[];
}

export interface ScreensaverTaskCandidate {
	source: "current" | "p0";
	label: string;
	tasksPath: string;
}

export interface SessionHeaderLike {
	cwd?: string;
	parentSession?: string;
}

const ACTIVE_TASK_STATUSES = new Set(["in_progress", "pending"]);

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

export function activeScreensaverTasks(tasks: ScreensaverTask[], limit = 5): ScreensaverTask[] {
	return [...tasks]
		.filter((task) => task?.subject && task.status && ACTIVE_TASK_STATUSES.has(task.status))
		.sort((a, b) => {
			const statusRank = (task: ScreensaverTask) => task.status === "in_progress" ? 0 : 1;
			return statusRank(a) - statusRank(b) || (a.createdAt ?? 0) - (b.createdAt ?? 0) || (a.updatedAt ?? 0) - (b.updatedAt ?? 0);
		})
		.slice(0, limit);
}

export function buildScreensaverTaskLines(candidates: ScreensaverTaskCandidate[], limit = 5): string[] {
	for (const candidate of candidates) {
		const store = readJsonFile<ScreensaverTaskStore | ScreensaverTask[]>(candidate.tasksPath);
		const taskList = Array.isArray(store) ? store : store?.tasks ?? [];
		const active = activeScreensaverTasks(taskList, limit);
		if (active.length === 0) continue;
		const suffix = candidate.source === "p0" ? " · P0" : "";
		const lines = [`📋 TODO${suffix}`];
		for (const task of active) {
			const icon = task.status === "in_progress" ? "▸" : "○";
			lines.push(`  ${icon} ${String(task.subject ?? "").trim()}`);
		}
		return lines;
	}
	return [];
}

function currentSessionFile(ctx: ExtensionContext): string | undefined {
	try { return ctx.sessionManager.getSessionFile?.(); } catch { return undefined; }
}

function currentHeader(ctx: ExtensionContext): SessionHeaderLike | null {
	try { return ctx.sessionManager.getHeader?.() as SessionHeaderLike | null; } catch { return null; }
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

export function resolveScreensaverTaskCandidates(ctx: ExtensionContext): ScreensaverTaskCandidate[] {
	const currentSession = currentSessionFile(ctx);
	const currentUnit = resolveWorkUnit(ctx.cwd, currentSession);
	const candidates: ScreensaverTaskCandidate[] = [{ source: "current", label: currentUnit.displayName, tasksPath: currentUnit.tasksPath }];

	const parentSession = parentSessionFileForScreensaver(ctx);
	if (!parentSession) return candidates;
	const parentHeader = readSessionHeaderFromFile(parentSession);
	const parentCwd = parentHeader?.cwd || ctx.cwd;
	const parentUnit = resolveWorkUnit(parentCwd, parentSession);
	if (parentUnit.tasksPath !== currentUnit.tasksPath) {
		candidates.push({ source: "p0", label: parentUnit.displayName, tasksPath: parentUnit.tasksPath });
	}
	return candidates;
}

export function loadScreensaverTaskLines(ctx: ExtensionContext, limit = 5): string[] {
	return buildScreensaverTaskLines(resolveScreensaverTaskCandidates(ctx), limit);
}
