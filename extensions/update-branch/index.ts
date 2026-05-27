import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";

const HELP = `Usage: /update-branch [--merge]

현재 git repo 브랜치를 upstream 최신 상태로 맞춥니다.

동작:
  1. git repo 여부 확인
  2. dirty worktree면 중단
  3. git pull --ff-only 실행
  4. index.lock 고아 파일이면 제거 후 1회 재시도
  5. 성공 시 HEAD / clean 여부 / branch sync 상태 요약

Options:
  --merge    git pull --ff-only 대신 일반 git pull 실행
  -h, --help 도움말 표시`;

type ExecLike = Pick<ExtensionAPI, "exec">;

export type UpdateBranchOptions = {
	help: boolean;
	merge: boolean;
};

export type CommandResult = {
	code: number | null;
	stdout?: string;
	stderr?: string;
	killed?: boolean;
};

type LockRecovery = {
	attempted: boolean;
	removed: boolean;
	blockedBy?: string;
	message?: string;
};

type GitCommandResult = {
	result: CommandResult;
	lockRecovery?: LockRecovery;
	retried: boolean;
};

export type UpdateBranchResult = {
	status: "pass" | "blocked" | "fail" | "help";
	cwd: string;
	repoRoot?: string;
	mode?: "ff-only" | "merge";
	head?: string;
	branchStatus?: string;
	pullOutput?: string;
	dirtyStatus?: string;
	lockRecoveries: LockRecovery[];
	message: string;
};

export function parseUpdateBranchArgs(args: string): UpdateBranchOptions | { error: string } {
	const tokens = args.trim().split(/\s+/u).filter(Boolean);
	let help = false;
	let merge = false;
	for (const token of tokens) {
		if (token === "-h" || token === "--help" || token === "help") help = true;
		else if (token === "--merge") merge = true;
		else return { error: `지원하지 않는 인자입니다: ${token}` };
	}
	return { help, merge };
}

export function isIndexLockError(text: string): boolean {
	return /index\.lock|Unable to create .*\.git.*index\.lock|File exists\.?\s*$/iu.test(text);
}

function commandText(result: CommandResult): string {
	return [result.stdout ?? "", result.stderr ?? ""].filter(Boolean).join("\n").trim();
}

function firstUsefulLine(text: string): string {
	return text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean)[0] ?? "";
}

function trimOutput(text: string, maxChars = 4000): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxChars) return trimmed;
	return `${trimmed.slice(0, maxChars).trimEnd()}\n… [truncated ${trimmed.length - maxChars} chars]`;
}

async function git(pi: ExecLike, args: string[], cwd: string): Promise<CommandResult> {
	return await pi.exec("git", args, { cwd });
}

async function clearStaleIndexLock(pi: ExecLike, cwd: string, lockPath: string): Promise<LockRecovery> {
	if (!lockPath || !existsSync(lockPath)) {
		return { attempted: true, removed: false, message: "index.lock 파일이 이미 없습니다." };
	}

	const lsof = await pi.exec("lsof", [lockPath], { cwd, timeout: 5000 });
	const blocker = commandText(lsof);
	if (lsof.code === 0 && blocker) {
		return { attempted: true, removed: false, blockedBy: trimOutput(blocker), message: "index.lock을 점유 중인 프로세스가 있어 중단했습니다." };
	}

	try {
		await unlink(lockPath);
		return { attempted: true, removed: true, message: "점유 프로세스 없는 고아 index.lock을 제거했습니다." };
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { attempted: true, removed: false, message: "index.lock 파일이 이미 사라졌습니다." };
		}
		return { attempted: true, removed: false, message: `index.lock 제거 실패: ${(error as Error).message}` };
	}
}

async function runGitWithLockRetry(pi: ExecLike, cwd: string, args: string[], lockPath: string): Promise<GitCommandResult> {
	const first = await git(pi, args, cwd);
	const firstOutput = commandText(first);
	if (first.code === 0 || !isIndexLockError(firstOutput)) {
		return { result: first, retried: false };
	}

	const lockRecovery = await clearStaleIndexLock(pi, cwd, lockPath);
	if (!lockRecovery.removed) {
		return { result: first, lockRecovery, retried: false };
	}

	const second = await git(pi, args, cwd);
	return { result: second, lockRecovery, retried: true };
}

async function resolveRepo(pi: ExecLike, cwd: string): Promise<{ repoRoot: string; lockPath: string } | { error: string }> {
	const root = await git(pi, ["rev-parse", "--show-toplevel"], cwd);
	if (root.code !== 0) {
		return { error: firstUsefulLine(commandText(root)) || "현재 위치가 git repo가 아닙니다." };
	}
	const repoRoot = (root.stdout ?? "").trim();
	if (!repoRoot) return { error: "git repo root를 확인하지 못했습니다." };

	const lock = await git(pi, ["rev-parse", "--git-path", "index.lock"], repoRoot);
	const rawLockPath = (lock.stdout ?? "").trim();
	const lockPath = rawLockPath && !isAbsolute(rawLockPath) ? resolve(repoRoot, rawLockPath) : rawLockPath;
	return { repoRoot, lockPath };
}

export async function runUpdateBranch(pi: ExecLike, cwd: string, args = ""): Promise<UpdateBranchResult> {
	const options = parseUpdateBranchArgs(args);
	if ("error" in options) {
		return { status: "fail", cwd, lockRecoveries: [], message: `${options.error}\n\n${HELP}` };
	}
	if (options.help) return { status: "help", cwd, lockRecoveries: [], message: HELP };

	const repo = await resolveRepo(pi, cwd);
	if ("error" in repo) {
		return { status: "blocked", cwd, lockRecoveries: [], message: `git repo 확인 실패: ${repo.error}` };
	}

	const lockRecoveries: LockRecovery[] = [];
	const porcelain = await runGitWithLockRetry(pi, repo.repoRoot, ["status", "--porcelain"], repo.lockPath);
	if (porcelain.lockRecovery) lockRecoveries.push(porcelain.lockRecovery);
	if (porcelain.result.code !== 0) {
		return {
			status: "fail",
			cwd,
			repoRoot: repo.repoRoot,
			lockRecoveries,
			message: `git status 실패: ${trimOutput(commandText(porcelain.result))}`,
		};
	}

	const dirtyStatus = (porcelain.result.stdout ?? "").trim();
	if (dirtyStatus) {
		const shortStatus = await runGitWithLockRetry(pi, repo.repoRoot, ["status", "--short", "--branch"], repo.lockPath);
		if (shortStatus.lockRecovery) lockRecoveries.push(shortStatus.lockRecovery);
		return {
			status: "blocked",
			cwd,
			repoRoot: repo.repoRoot,
			dirtyStatus: trimOutput((shortStatus.result.stdout ?? dirtyStatus).trim()),
			lockRecoveries,
			message: "작업트리가 dirty 상태라 pull을 중단했습니다. 변경을 커밋/stash/정리한 뒤 다시 실행하세요.",
		};
	}

	const mode = options.merge ? "merge" : "ff-only";
	const pullArgs = options.merge ? ["pull"] : ["pull", "--ff-only"];
	const pull = await runGitWithLockRetry(pi, repo.repoRoot, pullArgs, repo.lockPath);
	if (pull.lockRecovery) lockRecoveries.push(pull.lockRecovery);
	const pullOutput = trimOutput(commandText(pull.result));
	if (pull.result.code !== 0) {
		const lockBlock = pull.lockRecovery?.blockedBy ? `\n\n점유 프로세스:\n${pull.lockRecovery.blockedBy}` : "";
		return {
			status: isIndexLockError(pullOutput) ? "blocked" : "fail",
			cwd,
			repoRoot: repo.repoRoot,
			mode,
			pullOutput,
			lockRecoveries,
			message: `git pull 실패: ${pullOutput || "unknown error"}${lockBlock}`,
		};
	}

	const [branchStatusResult, headResult] = await Promise.all([
		runGitWithLockRetry(pi, repo.repoRoot, ["status", "--short", "--branch"], repo.lockPath),
		git(pi, ["log", "--oneline", "-1"], repo.repoRoot),
	]);
	if (branchStatusResult.lockRecovery) lockRecoveries.push(branchStatusResult.lockRecovery);

	const branchStatus = trimOutput((branchStatusResult.result.stdout ?? "").trim());
	const head = (headResult.stdout ?? "").trim();
	return {
		status: "pass",
		cwd,
		repoRoot: repo.repoRoot,
		mode,
		head,
		branchStatus,
		pullOutput,
		lockRecoveries,
		message: "브랜치 최신화가 완료됐습니다.",
	};
}

export function formatUpdateBranchResult(result: UpdateBranchResult): string {
	if (result.status === "help") return result.message;
	const lines: string[] = [];
	const icon = result.status === "pass" ? "✅" : result.status === "blocked" ? "⛔" : "⚠️";
	lines.push(`${icon} /update-branch ${result.status === "pass" ? "완료" : result.status === "blocked" ? "중단" : "실패"}`);
	lines.push(`- cwd: ${result.cwd}`);
	if (result.repoRoot) lines.push(`- repo: ${result.repoRoot}`);
	if (result.mode) lines.push(`- mode: git pull ${result.mode === "ff-only" ? "--ff-only" : ""}`.trimEnd());
	if (result.message) lines.push(`- 결과: ${result.message}`);
	for (const recovery of result.lockRecoveries) {
		if (recovery.removed) lines.push("- lock: 고아 index.lock 제거 후 재시도");
		else if (recovery.blockedBy) lines.push("- lock: 점유 프로세스가 있어 자동 제거하지 않음");
	}
	if (result.head) lines.push(`- HEAD: ${result.head}`);
	if (result.branchStatus) {
		lines.push("- branch status:");
		lines.push("```text");
		lines.push(result.branchStatus || "(clean)");
		lines.push("```");
	}
	if (result.dirtyStatus) {
		lines.push("- dirty status:");
		lines.push("```text");
		lines.push(result.dirtyStatus);
		lines.push("```");
	}
	if (result.pullOutput && result.status !== "pass") {
		lines.push("- pull output:");
		lines.push("```text");
		lines.push(result.pullOutput);
		lines.push("```");
	}
	return lines.join("\n");
}

function completions(prefix: string): AutocompleteItem[] | null {
	const items = ["--help", "--merge"].map((value) => ({ value, label: value }));
	const filtered = items.filter((item) => item.value.startsWith(prefix));
	return filtered.length ? filtered : null;
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("update-branch", {
		description: "현재 git 브랜치를 upstream 최신 상태로 안전하게 pull",
		getArgumentCompletions: completions,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			ctx.ui.setStatus?.("update-branch", "브랜치 최신화 중…");
			try {
				const result = await runUpdateBranch(pi, ctx.cwd, args);
				const summary = formatUpdateBranchResult(result);
				pi.sendMessage({
					customType: "update-branch-result",
					content: summary,
					display: true,
					details: result,
				});
				if (result.status === "pass") notify(ctx, "브랜치 최신화 완료", "info");
				else if (result.status === "help") notify(ctx, HELP, "info");
				else notify(ctx, result.message, result.status === "blocked" ? "warning" : "error");
			} finally {
				ctx.ui.setStatus?.("update-branch", undefined);
			}
		},
	});
}
