import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

// /wt와 PR review가 함께 쓰는 저장소 목록·저장소 루트·worktree 세션 폴더 계산
const REGISTRY_PATH = join(homedir(), ".pi", "worktree-repos.json");

export interface RepoRegistry {
	[name: string]: string; // name → absolute path
}

export interface WorktreeAfterSwitchFollowUp {
	customType: string;
	content: string;
	display?: boolean;
	details?: Record<string, unknown>;
}

export function loadRegistry(): RepoRegistry {
	if (!existsSync(REGISTRY_PATH)) return {};
	try { return JSON.parse(readFileSync(REGISTRY_PATH, "utf8")) as RepoRegistry; } catch { return {}; }
}

export function saveRegistry(reg: RepoRegistry) {
	mkdirSync(dirname(REGISTRY_PATH), { recursive: true });
	writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
}

export function realPathForCompare(path: string): string {
	try { return realpathSync.native(path); } catch { return path; }
}

export async function findRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd });
	return r.code === 0 ? (r.stdout ?? "").trim() || null : null;
}

// worktree 안에서 실행해도 원래 저장소(git worktree list의 첫 항목)를 루트로 쓴다.
export async function canonicalRepoRoot(pi: ExtensionAPI, repoRoot: string): Promise<string> {
	const worktrees = await pi.exec("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });
	if (worktrees.code === 0) {
		const main = (worktrees.stdout ?? "").split("\n").find((line) => line.startsWith("worktree "))?.slice("worktree ".length).trim();
		if (main && existsSync(main)) return realPathForCompare(main);
	}
	return realPathForCompare(repoRoot);
}

export async function findCanonicalRepoRoot(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const repoRoot = await findRepoRoot(pi, cwd);
	return repoRoot ? canonicalRepoRoot(pi, repoRoot) : null;
}

export function sessionDirForWorktree(worktreePath: string): string {
	return join(homedir(), ".pi", "agent", "sessions", `--${worktreePath.slice(1).replace(/\//g, "-")}--`);
}
