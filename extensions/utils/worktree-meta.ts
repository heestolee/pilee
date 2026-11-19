import { readFileSync } from "node:fs";
import { join } from "node:path";

// worktree 루트의 .pi/worktree-meta.json. 쓰는 쪽(worktree)과 읽는 쪽 모두 이 경로·형식을 쓴다.
export interface WorktreeMetaSummary {
	name?: string;
	branch?: string;
	ticket?: string;
	note?: string;
}

export function worktreeMetaPath(worktreeRoot: string): string {
	return join(worktreeRoot, ".pi", "worktree-meta.json");
}

export function readWorktreeMeta<T = WorktreeMetaSummary>(worktreeRoot: string): T | null {
	try { return JSON.parse(readFileSync(worktreeMetaPath(worktreeRoot), "utf8")) as T; } catch { return null; }
}
