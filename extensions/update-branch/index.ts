import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { withRepoStatusPaused } from "../utils/repo-status-coordination.ts";

const HELP = `Usage: /update-branch [--merge] [--no-autostash]

현재 git repo 브랜치를 upstream 최신 상태로 맞춥니다.

동작:
  1. git repo 여부 확인
  2. dirty worktree면 include-untracked stash로 사용자 변경 보존
  3. git pull --ff-only 실행
  4. stash apply --index로 사용자 변경 복원, 성공 시 stash drop
  5. index.lock 고아 파일이면 제거 후 1회 재시도
  6. 성공 시 HEAD / branch sync 상태 / 복원된 dirty 상태 요약

Options:
  --merge          git pull --ff-only 대신 일반 git pull 실행
  --no-autostash   dirty worktree에서 자동 보존하지 않고 기존처럼 중단
  -h, --help       도움말 표시`;

type ExecLike = Pick<ExtensionAPI, "exec">;

export type UpdateBranchOptions = {
	help: boolean;
	merge: boolean;
	noAutostash: boolean;
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

const GIT_STATUS_OWNER_WAIT_MS = 1_500;
const GIT_STATUS_OWNER_POLL_MS = 100;
const REPO_STATUS_PAUSE_FOR_UPDATE_BRANCH_MS = 180_000;

type GitCommandResult = {
	result: CommandResult;
	lockRecovery?: LockRecovery;
	retried: boolean;
};

type StashPreservation = {
	attempted: boolean;
	dirtyBefore?: string;
	stashRef?: string;
	stashed?: boolean;
	applied?: boolean;
	dropped?: boolean;
	kept?: boolean;
	message?: string;
	output?: string;
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
	preserve?: StashPreservation;
	lockRecoveries: LockRecovery[];
	message: string;
};

export function parseUpdateBranchArgs(args: string): UpdateBranchOptions | { error: string } {
	const tokens = args.trim().split(/\s+/u).filter(Boolean);
	let help = false;
	let merge = false;
	let noAutostash = false;
	for (const token of tokens) {
		if (token === "-h" || token === "--help" || token === "help") help = true;
		else if (token === "--merge") merge = true;
		else if (token === "--no-autostash") noAutostash = true;
		else return { error: `지원하지 않는 인자입니다: ${token}` };
	}
	return { help, merge, noAutostash };
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

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function lines(text: string | undefined): string[] {
	return (text ?? "")
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean);
}

function extractLsofPids(output: string): string[] {
	return lines(output)
		.filter((line) => !line.startsWith("COMMAND "))
		.map((line) => line.split(/\s+/u)[1])
		.filter((pid): pid is string => Boolean(pid) && /^\d+$/u.test(pid));
}

function isRepoStatusGitStatusCommand(command: string): boolean {
	return /\bgit\s+(?:--no-optional-locks\s+)?status\s+--porcelain=v2\s+--branch\s+--untracked-files=normal\b/u.test(command);
}

async function waitForLockToDisappear(lockPath: string, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() <= deadline) {
		if (!existsSync(lockPath)) return true;
		await sleep(GIT_STATUS_OWNER_POLL_MS);
	}
	return !existsSync(lockPath);
}

async function readOwnerCommands(pi: ExecLike, cwd: string, pids: string[]): Promise<string> {
	if (pids.length === 0) return "";
	const ps = await pi.exec("ps", ["-o", "pid=,command=", "-p", pids.join(",")], { cwd }).catch((error: unknown) => ({ code: 1, stdout: "", stderr: String(error) }));
	return [ps.stdout ?? "", ps.stderr ?? ""].filter(Boolean).join("\n").trim();
}

async function recoverRepoStatusLockOwner(pi: ExecLike, cwd: string, lockPath: string, blocker: string): Promise<LockRecovery> {
	const pids = extractLsofPids(blocker);
	const ownerCommands = await readOwnerCommands(pi, cwd, pids);
	const ownerCommandLines = lines(ownerCommands);
	if (pids.length === 0 || ownerCommandLines.length === 0 || !ownerCommandLines.every(isRepoStatusGitStatusCommand)) {
		return { attempted: true, removed: false, blockedBy: trimOutput(blocker), message: "index.lock을 점유 중인 프로세스가 있어 중단했습니다." };
	}

	if (await waitForLockToDisappear(lockPath, GIT_STATUS_OWNER_WAIT_MS)) {
		return { attempted: true, removed: true, message: "repo-status git status가 종료되어 재시도합니다." };
	}

	await pi.exec("kill", pids, { cwd }).catch(() => ({ code: 1, stdout: "", stderr: "" }));
	if (await waitForLockToDisappear(lockPath, GIT_STATUS_OWNER_WAIT_MS)) {
		return { attempted: true, removed: true, message: "repo-status git status 프로세스를 중단하고 재시도합니다." };
	}

	return { attempted: true, removed: false, blockedBy: trimOutput(ownerCommands), message: "repo-status git status가 index.lock을 계속 점유해 중단했습니다." };
}

async function clearStaleIndexLock(pi: ExecLike, cwd: string, lockPath: string): Promise<LockRecovery> {
	if (!lockPath || !existsSync(lockPath)) {
		return { attempted: true, removed: false, message: "index.lock 파일이 이미 없습니다." };
	}

	const lsof = await pi.exec("lsof", [lockPath], { cwd, timeout: 5000 });
	const blocker = commandText(lsof);
	if (lsof.code === 0 && blocker) {
		return await recoverRepoStatusLockOwner(pi, cwd, lockPath, blocker);
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

async function findTopStashRef(pi: ExecLike, cwd: string, message: string): Promise<string | undefined> {
	const list = await git(pi, ["stash", "list", "--format=%gd%x00%gs", "-n", "1"], cwd);
	if (list.code !== 0) return undefined;
	const line = (list.stdout ?? "").split(/\r?\n/u).find(Boolean);
	if (!line) return undefined;
	const [ref, subject = ""] = line.split("\x00");
	return ref && subject.includes(message) ? ref : undefined;
}

async function applyPreservedChanges(pi: ExecLike, cwd: string, preserve: StashPreservation, lockPath: string, lockRecoveries: LockRecovery[]): Promise<boolean> {
	if (!preserve.stashRef) return true;
	const apply = await runGitWithLockRetry(pi, cwd, ["stash", "apply", "--index", preserve.stashRef], lockPath);
	if (apply.lockRecovery) lockRecoveries.push(apply.lockRecovery);
	const applyOutput = trimOutput(commandText(apply.result));
	if (apply.result.code !== 0) {
		preserve.applied = false;
		preserve.kept = true;
		preserve.output = applyOutput;
		preserve.message = `보존 stash(${preserve.stashRef}) 복원 실패. stash는 삭제하지 않았습니다.`;
		return false;
	}

	preserve.applied = true;
	const drop = await runGitWithLockRetry(pi, cwd, ["stash", "drop", preserve.stashRef], lockPath);
	if (drop.lockRecovery) lockRecoveries.push(drop.lockRecovery);
	preserve.dropped = drop.result.code === 0;
	if (!preserve.dropped) {
		preserve.kept = true;
		preserve.output = trimOutput(commandText(drop.result));
		preserve.message = `보존 stash(${preserve.stashRef})는 적용됐지만 drop에 실패했습니다.`;
		return false;
	}
	preserve.kept = false;
	preserve.message = "dirty 변경을 stash로 보존한 뒤 pull 후 복원했습니다.";
	return true;
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

async function runUpdateBranchWithRepo(
	pi: ExecLike,
	cwd: string,
	options: UpdateBranchOptions,
	repo: { repoRoot: string; lockPath: string },
): Promise<UpdateBranchResult> {
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
	let preserve: StashPreservation | undefined;
	if (dirtyStatus) {
		const shortStatus = await runGitWithLockRetry(pi, repo.repoRoot, ["status", "--short", "--branch"], repo.lockPath);
		if (shortStatus.lockRecovery) lockRecoveries.push(shortStatus.lockRecovery);
		const formattedDirtyStatus = trimOutput((shortStatus.result.stdout ?? dirtyStatus).trim());
		if (options.noAutostash) {
			return {
				status: "blocked",
				cwd,
				repoRoot: repo.repoRoot,
				dirtyStatus: formattedDirtyStatus,
				lockRecoveries,
				message: "작업트리가 dirty 상태라 pull을 중단했습니다. 기본 동작은 자동 보존이며, 이 중단은 --no-autostash 옵션 때문에 발생했습니다.",
			};
		}

		const stashMessage = `pilee/update-branch ${new Date().toISOString()}`;
		preserve = { attempted: true, dirtyBefore: formattedDirtyStatus };
		const stash = await runGitWithLockRetry(pi, repo.repoRoot, ["stash", "push", "--include-untracked", "-m", stashMessage], repo.lockPath);
		if (stash.lockRecovery) lockRecoveries.push(stash.lockRecovery);
		const stashOutput = trimOutput(commandText(stash.result));
		preserve.output = stashOutput;
		if (stash.result.code !== 0) {
			preserve.message = `dirty 변경 보존 stash 생성 실패: ${stashOutput || "unknown error"}`;
			return {
				status: "fail",
				cwd,
				repoRoot: repo.repoRoot,
				dirtyStatus: formattedDirtyStatus,
				preserve,
				lockRecoveries,
				message: preserve.message,
			};
		}
		preserve.stashed = true;
		preserve.stashRef = await findTopStashRef(pi, repo.repoRoot, stashMessage) ?? "stash@{0}";
	}

	const mode = options.merge ? "merge" : "ff-only";
	const pullArgs = options.merge ? ["pull"] : ["pull", "--ff-only"];
	const pull = await runGitWithLockRetry(pi, repo.repoRoot, pullArgs, repo.lockPath);
	if (pull.lockRecovery) lockRecoveries.push(pull.lockRecovery);
	const pullOutput = trimOutput(commandText(pull.result));
	if (pull.result.code !== 0) {
		const lockBlock = pull.lockRecovery?.blockedBy ? `\n\n점유 프로세스:\n${pull.lockRecovery.blockedBy}` : "";
		if (preserve) await applyPreservedChanges(pi, repo.repoRoot, preserve, repo.lockPath, lockRecoveries);
		const restoreNote = preserve?.applied ? " 보존했던 변경은 다시 복원했습니다." : preserve?.kept ? ` 보존 stash(${preserve.stashRef})는 삭제하지 않았습니다.` : "";
		return {
			status: isIndexLockError(pullOutput) ? "blocked" : "fail",
			cwd,
			repoRoot: repo.repoRoot,
			mode,
			pullOutput,
			preserve,
			lockRecoveries,
			message: `git pull 실패: ${pullOutput || "unknown error"}${lockBlock}${restoreNote}`,
		};
	}

	if (preserve) {
		const restored = await applyPreservedChanges(pi, repo.repoRoot, preserve, repo.lockPath, lockRecoveries);
		if (!restored) {
			const [branchStatusResult, headResult] = await Promise.all([
				runGitWithLockRetry(pi, repo.repoRoot, ["status", "--short", "--branch"], repo.lockPath),
				git(pi, ["log", "--oneline", "-1"], repo.repoRoot),
			]);
			if (branchStatusResult.lockRecovery) lockRecoveries.push(branchStatusResult.lockRecovery);
			return {
				status: "fail",
				cwd,
				repoRoot: repo.repoRoot,
				mode,
				head: (headResult.stdout ?? "").trim(),
				branchStatus: trimOutput((branchStatusResult.result.stdout ?? "").trim()),
				pullOutput,
				preserve,
				lockRecoveries,
				message: `${preserve.message ?? "dirty 변경 복원 실패"} 브랜치 최신화는 진행됐지만 사용자 변경 복원은 수동 확인이 필요합니다.`,
			};
		}
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
		preserve,
		lockRecoveries,
		message: preserve ? "브랜치 최신화와 dirty 변경 복원이 완료됐습니다." : "브랜치 최신화가 완료됐습니다.",
	};
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

	return await withRepoStatusPaused(repo.repoRoot, () => runUpdateBranchWithRepo(pi, cwd, options, repo), {
		reason: "update-branch",
		ttlMs: REPO_STATUS_PAUSE_FOR_UPDATE_BRANCH_MS,
	});
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
		if (recovery.removed) lines.push(`- lock: ${recovery.message ?? "index.lock 복구 후 재시도"}`);
		else if (recovery.blockedBy) lines.push(`- lock: ${recovery.message ?? "점유 프로세스가 있어 자동 제거하지 않음"}`);
	}
	if (result.preserve?.attempted) {
		lines.push(`- dirty preserve: ${result.preserve.stashRef ? `stash ${result.preserve.stashRef}` : "attempted"}`);
		if (result.preserve.applied) lines.push("- dirty restore: stash apply 완료");
		if (result.preserve.dropped) lines.push("- dirty stash: 복원 성공 후 drop 완료");
		else if (result.preserve.kept) lines.push("- dirty stash: 수동 복구를 위해 stash 보존");
		if (result.preserve.message) lines.push(`- dirty note: ${result.preserve.message}`);
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
	const items = ["--help", "--merge", "--no-autostash"].map((value) => ({ value, label: value }));
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
