import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	learningCompanionManifestPath,
	readLearningCompanionManifest,
	retargetLearningCompanionManifest,
} from "../learning-companion/state.ts";
import { refreshWorkContext } from "../utils/work-context.ts";

export type WorkArtifactStatus = "copied" | "target-exists" | "missing-source" | "missing-source-session" | "error" | "refreshed" | "skipped";

export interface WorkArtifactPromotionResult {
	tasks: {
		status: WorkArtifactStatus;
		sourcePath?: string;
		targetPath?: string;
		count?: number;
		error?: string;
	};
	context: {
		status: WorkArtifactStatus;
		targetPath?: string;
		error?: string;
	};
	companion: {
		status: WorkArtifactStatus;
		sourcePath?: string;
		targetPath?: string;
		companionId?: string;
		runId?: string;
		error?: string;
	};
}

export interface PromotePlanningWorkArtifactsOptions {
	frame: Record<string, any>;
	worktreePath: string;
	targetFramePath: string;
	sourceFramePath?: string | null;
	workUnitsRoot?: string;
	now?: number;
}

const DEFAULT_WORK_UNITS_ROOT = join(homedir(), ".pi", "agent", "work-units");

function sha(input: string): string {
	return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function writeJsonAtomic(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp`;
	writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
	renameSync(tmp, path);
}

function readJson<T>(path: string): T | undefined {
	try {
		if (!existsSync(path)) return undefined;
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return undefined;
	}
}

function sourceSessionFileFromFrame(frame: Record<string, any>): string | undefined {
	const candidates = [
		frame?.identity?.sourceSessionFile,
		frame?.provenance?.sourceSessionFile,
		frame?.sourceSessionFile,
	];
	return candidates.find((value) => typeof value === "string" && value.trim())?.trim();
}

export function workUnitDirForSessionFile(sessionFile: string, workUnitsRoot = DEFAULT_WORK_UNITS_ROOT): string {
	return join(workUnitsRoot, sha(sessionFile));
}

function replaceString(value: string, replacements: Array<[string | undefined | null, string]>): string {
	let next = value;
	for (const [from, to] of replacements) {
		if (!from) continue;
		next = next.split(from).join(to);
	}
	return next;
}

function retargetValue(value: unknown, replacements: Array<[string | undefined | null, string]>): unknown {
	if (typeof value === "string") return replaceString(value, replacements);
	if (Array.isArray(value)) return value.map((item) => retargetValue(item, replacements));
	if (value && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, child] of Object.entries(value)) out[key] = retargetValue(child, replacements);
		return out;
	}
	return value;
}

function taskCount(board: any): number {
	return Array.isArray(board?.tasks) ? board.tasks.length : 0;
}

function targetHasUserTasks(board: any): boolean {
	return taskCount(board) > 0;
}

function valueContainsString(value: unknown, needle: string): boolean {
	if (typeof value === "string") return value.includes(needle);
	if (Array.isArray(value)) return value.some((item) => valueContainsString(item, needle));
	if (value && typeof value === "object") return Object.values(value).some((child) => valueContainsString(child, needle));
	return false;
}

function filterTaskBoardForFrame(board: any, sourceFramePath?: string | null): any {
	if (!sourceFramePath || !Array.isArray(board?.tasks)) return board;
	const tasks = board.tasks.filter((task: unknown) => valueContainsString(task, sourceFramePath));
	return { ...board, tasks };
}

export function retargetPlanningTaskBoard(board: any, options: {
	sourceFramePath?: string | null;
	targetFramePath: string;
	sourceTasksPath?: string | null;
	targetTasksPath: string;
	worktreePath: string;
	now?: number;
}): any {
	const now = options.now ?? Date.now();
	const replacements: Array<[string | undefined | null, string]> = [
		[options.sourceFramePath, options.targetFramePath],
		[options.sourceTasksPath, options.targetTasksPath],
	];
	const next = retargetValue(board, replacements) as any;
	if (Array.isArray(next?.tasks)) {
		for (const task of next.tasks) {
			if (!task || typeof task !== "object") continue;
			task.metadata = {
				...(task.metadata && typeof task.metadata === "object" ? task.metadata : {}),
				promotedFromWorkUnit: options.sourceTasksPath,
				promotedToWorktree: options.worktreePath,
				promotedAt: now,
			};
			task.updatedAt = now;
		}
	}
	return next;
}

export function promotePlanningWorkArtifactsToWorktree(options: PromotePlanningWorkArtifactsOptions): WorkArtifactPromotionResult {
	const targetTasksPath = join(options.worktreePath, ".pi", "work-tasks.json");
	const targetCompanionPath = learningCompanionManifestPath(join(options.worktreePath, ".pi"));
	const result: WorkArtifactPromotionResult = {
		tasks: { status: "missing-source", targetPath: targetTasksPath },
		context: { status: "skipped", targetPath: join(options.worktreePath, ".pi", "work-context.json") },
		companion: { status: "missing-source", targetPath: targetCompanionPath },
	};

	const sourceSessionFile = sourceSessionFileFromFrame(options.frame);
	if (!sourceSessionFile) {
		result.tasks.status = "missing-source-session";
	} else {
		const sourceTasksPath = join(workUnitDirForSessionFile(sourceSessionFile, options.workUnitsRoot), "work-tasks.json");
		result.tasks.sourcePath = sourceTasksPath;
		if (!existsSync(sourceTasksPath)) {
			result.tasks.status = "missing-source";
		} else {
			try {
				const sourceBoard = readJson<any>(sourceTasksPath);
				if (!sourceBoard || !Array.isArray(sourceBoard.tasks)) throw new Error("source task board is malformed");
				const relevantBoard = filterTaskBoardForFrame(sourceBoard, options.sourceFramePath);
				if (taskCount(relevantBoard) === 0) {
					result.tasks.status = "missing-source";
					result.tasks.count = 0;
				} else {
					const targetBoard = readJson<any>(targetTasksPath);
					if (targetHasUserTasks(targetBoard)) {
						result.tasks.status = "target-exists";
						result.tasks.count = taskCount(targetBoard);
					} else {
						const promoted = retargetPlanningTaskBoard(relevantBoard, {
							sourceFramePath: options.sourceFramePath,
							targetFramePath: options.targetFramePath,
							sourceTasksPath,
							targetTasksPath,
							worktreePath: options.worktreePath,
							now: options.now,
						});
						writeJsonAtomic(targetTasksPath, promoted);
						result.tasks.status = "copied";
						result.tasks.count = taskCount(promoted);
					}
				}
			} catch (error) {
				result.tasks.status = "error";
				result.tasks.error = error instanceof Error ? error.message : String(error);
			}
		}
	}

	if (options.sourceFramePath) {
		const sourceCompanionPath = learningCompanionManifestPath(dirname(options.sourceFramePath));
		result.companion.sourcePath = sourceCompanionPath;
		if (existsSync(targetCompanionPath)) {
			const target = readLearningCompanionManifest(targetCompanionPath);
			result.companion.status = target ? "target-exists" : "error";
			result.companion.companionId = target?.companionId;
			result.companion.runId = target?.runId;
			if (!target) result.companion.error = "target companion manifest is malformed";
		} else if (existsSync(sourceCompanionPath)) {
			try {
				const source = readLearningCompanionManifest(sourceCompanionPath);
				if (!source) throw new Error("source companion manifest is malformed");
				const frameIdentity = options.frame?.identity && typeof options.frame.identity === "object"
					? options.frame.identity as Record<string, unknown>
					: undefined;
				const provenance = options.frame?.provenance && typeof options.frame.provenance === "object"
					? options.frame.provenance as Record<string, unknown>
					: undefined;
				const identityKey = typeof frameIdentity?.key === "string" && frameIdentity.key
					? frameIdentity.key
					: `worktree:${sha(options.worktreePath)}`;
				const promoted = retargetLearningCompanionManifest(source, {
					storageDir: join(options.worktreePath, ".pi"),
					identityKey,
					framePath: options.targetFramePath,
					canonicalHash: typeof provenance?.canonicalHash === "string" ? provenance.canonicalHash : undefined,
					now: options.now,
				});
				result.companion.status = "copied";
				result.companion.companionId = promoted.manifest.companionId;
				result.companion.runId = promoted.manifest.runId;
			} catch (error) {
				result.companion.status = "error";
				result.companion.error = error instanceof Error ? error.message : String(error);
			}
		}
	}

	if (existsSync(options.targetFramePath)) {
		try {
			const card = refreshWorkContext(options.worktreePath);
			result.context.status = "refreshed";
			result.context.targetPath = card.identity.contextPath;
		} catch (error) {
			result.context.status = "error";
			result.context.error = error instanceof Error ? error.message : String(error);
		}
	}

	return result;
}
