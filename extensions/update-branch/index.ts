import { existsSync } from "node:fs";
import { unlink } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { withRepoStatusPaused } from "../utils/repo-status-coordination.ts";

const HELP = `Usage: /update-branch [--sync-only] [--no-wait] [--local] [--merge] [--no-autostash]

현재 git repo의 PR 브랜치를 GitHub Update branch와 local worktree까지 동기화합니다.

기본 동작(remote-first):
  1. 현재 git repo와 PR 확인
  2. local HEAD가 PR head와 같은지 확인
  3. GitHub PR Update branch를 원격에서 트리거
  4. PR head 갱신을 짧게 기다림
  5. 기존 safe pull 경로로 local branch를 ff-only 동기화
     - dirty worktree면 include-untracked stash로 사용자 변경 보존
     - pull 후 stash apply --index로 사용자 변경 복원, 성공 시 stash drop
  6. 성공 시 HEAD / branch sync 상태 / 복원된 dirty 상태 / CI check 링크 요약

Options:
  --sync-only      GitHub Update branch 트리거 없이 local branch를 ff-only 동기화
  --no-wait        GitHub Update branch만 트리거하고 local sync는 생략
  --local          기존 방식: git pull --ff-only 실행
  --merge          기존 방식: git pull 실행 (--local merge pull shorthand)
  --no-autostash   dirty worktree에서 자동 보존하지 않고 중단
  -h, --help       도움말 표시`;

type ExecLike = Pick<ExtensionAPI, "exec">;

export type UpdateBranchOptions = {
	help: boolean;
	local: boolean;
	merge: boolean;
	noAutostash: boolean;
	syncOnly: boolean;
	noWait: boolean;
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
const REMOTE_UPDATE_POLL_INTERVAL_MS = 2_000;
const REMOTE_UPDATE_POLL_TIMEOUT_MS = 90_000;

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

type UpdateMode = "remote" | "sync-only" | "ff-only" | "merge";

type CheckSummary = {
	name?: string;
	workflowName?: string;
	status?: string;
	conclusion?: string;
	detailsUrl?: string;
};

type PrInfo = {
	number: number;
	url?: string;
	headRefName: string;
	headRefOid: string;
	baseRefName?: string;
	mergeStateStatus?: string;
	statusCheckRollup?: CheckSummary[];
};

export type UpdateBranchResult = {
	status: "pass" | "blocked" | "fail" | "help";
	cwd: string;
	repoRoot?: string;
	mode?: UpdateMode;
	pr?: PrInfo;
	remoteUpdateTriggered?: boolean;
	remoteHeadBefore?: string;
	remoteHeadAfter?: string;
	remoteUpdateOutput?: string;
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
	let local = false;
	let merge = false;
	let noAutostash = false;
	let syncOnly = false;
	let noWait = false;
	for (const token of tokens) {
		if (token === "-h" || token === "--help" || token === "help") help = true;
		else if (token === "--local") local = true;
		else if (token === "--merge") merge = true;
		else if (token === "--no-autostash") noAutostash = true;
		else if (token === "--sync-only") syncOnly = true;
		else if (token === "--no-wait") noWait = true;
		else return { error: `지원하지 않는 인자입니다: ${token}` };
	}
	if (syncOnly && noWait) return { error: "--sync-only와 --no-wait는 함께 사용할 수 없습니다." };
	if ((syncOnly || noWait) && (local || merge)) return { error: "remote-first 옵션(--sync-only/--no-wait)과 local pull 옵션(--local/--merge)은 함께 사용할 수 없습니다." };
	return { help, local, merge, noAutostash, syncOnly, noWait };
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

async function gh(pi: ExecLike, args: string[], cwd: string): Promise<CommandResult> {
	return await pi.exec("gh", args, { cwd });
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

function parseGhJson<T>(result: CommandResult): T | { error: string } {
	const output = (result.stdout ?? "").trim();
	if (result.code !== 0) return { error: trimOutput(commandText(result)) || "gh command failed" };
	try {
		return JSON.parse(output) as T;
	} catch (error) {
		return { error: `gh JSON 파싱 실패: ${(error as Error).message}` };
	}
}

function normalizePrInfo(value: unknown): PrInfo | { error: string } {
	const raw = value as Partial<PrInfo> | undefined;
	if (!raw || typeof raw !== "object") return { error: "PR 정보를 읽지 못했습니다." };
	if (typeof raw.number !== "number") return { error: "PR 번호를 확인하지 못했습니다." };
	if (typeof raw.headRefName !== "string" || !raw.headRefName) return { error: "PR head branch를 확인하지 못했습니다." };
	if (typeof raw.headRefOid !== "string" || !raw.headRefOid) return { error: "PR head SHA를 확인하지 못했습니다." };
	return {
		number: raw.number,
		url: typeof raw.url === "string" ? raw.url : undefined,
		headRefName: raw.headRefName,
		headRefOid: raw.headRefOid,
		baseRefName: typeof raw.baseRefName === "string" ? raw.baseRefName : undefined,
		mergeStateStatus: typeof raw.mergeStateStatus === "string" ? raw.mergeStateStatus : undefined,
		statusCheckRollup: Array.isArray(raw.statusCheckRollup) ? raw.statusCheckRollup : undefined,
	};
}

async function readPrInfo(pi: ExecLike, cwd: string, selector?: string | number): Promise<PrInfo | { error: string }> {
	const args = ["pr", "view"];
	if (selector !== undefined) args.push(String(selector));
	args.push("--json", "number,url,headRefName,headRefOid,baseRefName,mergeStateStatus,statusCheckRollup");
	const result = await gh(pi, args, cwd);
	const parsed = parseGhJson<unknown>(result);
	if ("error" in parsed) return { error: parsed.error };
	return normalizePrInfo(parsed);
}

async function localHead(pi: ExecLike, cwd: string): Promise<string | { error: string }> {
	const result = await git(pi, ["rev-parse", "HEAD"], cwd);
	if (result.code !== 0) return { error: firstUsefulLine(commandText(result)) || "local HEAD를 확인하지 못했습니다." };
	const head = (result.stdout ?? "").trim();
	return head || { error: "local HEAD가 비어 있습니다." };
}

function statusRollupLines(pr: PrInfo | undefined): string[] {
	const rollup = pr?.statusCheckRollup ?? [];
	return rollup
		.map((check) => {
			const name = check.name ?? check.workflowName ?? "check";
			const state = check.conclusion ?? check.status ?? "unknown";
			return check.detailsUrl ? `${name}: ${state} ${check.detailsUrl}` : `${name}: ${state}`;
		})
		.slice(0, 8);
}

function remoteUpdateLooksAlreadyCurrent(output: string): boolean {
	return /already|up[ -]?to[ -]?date|not behind|no update/i.test(output);
}

async function waitForRemoteHeadChange(pi: ExecLike, cwd: string, prNumber: number, before: string, updateOutput: string): Promise<{ pr: PrInfo; timedOut: boolean }> {
	let last = await readPrInfo(pi, cwd, prNumber);
	if (!("error" in last) && (last.headRefOid !== before || remoteUpdateLooksAlreadyCurrent(updateOutput))) {
		return { pr: last, timedOut: false };
	}

	const deadline = Date.now() + REMOTE_UPDATE_POLL_TIMEOUT_MS;
	while (Date.now() < deadline) {
		await sleep(REMOTE_UPDATE_POLL_INTERVAL_MS);
		last = await readPrInfo(pi, cwd, prNumber);
		if (!("error" in last) && last.headRefOid !== before) return { pr: last, timedOut: false };
	}

	if ("error" in last) {
		return {
			pr: { number: prNumber, headRefName: "unknown", headRefOid: before },
			timedOut: true,
		};
	}
	return { pr: last, timedOut: true };
}

async function collectBranchSnapshot(pi: ExecLike, repo: { repoRoot: string; lockPath: string }, lockRecoveries: LockRecovery[]): Promise<{ head?: string; branchStatus?: string }> {
	const [branchStatusResult, headResult] = await Promise.all([
		runGitWithLockRetry(pi, repo.repoRoot, ["status", "--short", "--branch"], repo.lockPath),
		git(pi, ["log", "--oneline", "-1"], repo.repoRoot),
	]);
	if (branchStatusResult.lockRecovery) lockRecoveries.push(branchStatusResult.lockRecovery);
	return {
		head: (headResult.stdout ?? "").trim(),
		branchStatus: trimOutput((branchStatusResult.result.stdout ?? "").trim()),
	};
}

async function runRemoteUpdateBranchWithRepo(
	pi: ExecLike,
	cwd: string,
	options: UpdateBranchOptions,
	repo: { repoRoot: string; lockPath: string },
): Promise<UpdateBranchResult> {
	const pr = await readPrInfo(pi, repo.repoRoot);
	if ("error" in pr) {
		return { status: "blocked", cwd, repoRoot: repo.repoRoot, lockRecoveries: [], message: `현재 브랜치의 GitHub PR 확인 실패: ${pr.error}` };
	}

	const head = await localHead(pi, repo.repoRoot);
	if (typeof head !== "string") {
		return { status: "blocked", cwd, repoRoot: repo.repoRoot, pr, lockRecoveries: [], message: `local HEAD 확인 실패: ${head.error}` };
	}

	if (options.syncOnly) {
		const sync = await runLocalUpdateBranchWithRepo(pi, cwd, { ...options, local: true, merge: false }, repo);
		return {
			...sync,
			mode: "sync-only",
			pr,
			remoteHeadBefore: pr.headRefOid,
			remoteHeadAfter: pr.headRefOid,
			message: sync.status === "pass" ? "remote trigger 없이 local branch sync가 완료됐습니다." : sync.message,
		};
	}

	if (head !== pr.headRefOid) {
		return {
			status: "blocked",
			cwd,
			repoRoot: repo.repoRoot,
			pr,
			remoteHeadBefore: pr.headRefOid,
			head,
			lockRecoveries: [],
			message: "local HEAD와 PR head가 달라 원격 update branch를 중단했습니다. 먼저 /update-branch --sync-only 또는 수동 확인이 필요합니다.",
		};
	}

	const update = await gh(pi, ["pr", "update-branch", String(pr.number)], repo.repoRoot);
	const remoteUpdateOutput = trimOutput(commandText(update));
	if (update.code !== 0 && !remoteUpdateLooksAlreadyCurrent(remoteUpdateOutput)) {
		return {
			status: "fail",
			cwd,
			repoRoot: repo.repoRoot,
			mode: "remote",
			pr,
			remoteHeadBefore: pr.headRefOid,
			remoteUpdateOutput,
			lockRecoveries: [],
			message: `GitHub Update branch 트리거 실패: ${remoteUpdateOutput || "unknown error"}`,
		};
	}

	if (options.noWait) {
		const lockRecoveries: LockRecovery[] = [];
		const snapshot = await collectBranchSnapshot(pi, repo, lockRecoveries);
		return {
			status: "pass",
			cwd,
			repoRoot: repo.repoRoot,
			mode: "remote",
			pr,
			remoteUpdateTriggered: true,
			remoteHeadBefore: pr.headRefOid,
			remoteUpdateOutput,
			...snapshot,
			lockRecoveries,
			message: "GitHub Update branch를 트리거했습니다. --no-wait 옵션 때문에 local sync는 생략했습니다.",
		};
	}

	const waited = await waitForRemoteHeadChange(pi, repo.repoRoot, pr.number, pr.headRefOid, remoteUpdateOutput);
	const sync = await runLocalUpdateBranchWithRepo(pi, cwd, { ...options, local: true, merge: false }, repo);
	const remoteMessage = waited.timedOut
		? "GitHub Update branch 트리거 후 remote head 변경 확인은 시간 내 완료되지 않았고, local sync를 시도했습니다."
		: "GitHub Update branch 트리거와 local branch sync가 완료됐습니다.";
	return {
		...sync,
		mode: "remote",
		pr: waited.pr,
		remoteUpdateTriggered: true,
		remoteHeadBefore: pr.headRefOid,
		remoteHeadAfter: waited.pr.headRefOid,
		remoteUpdateOutput,
		message: sync.status === "pass" ? remoteMessage : `${remoteMessage} 하지만 local sync가 실패했습니다: ${sync.message}`,
	};
}

async function runLocalUpdateBranchWithRepo(
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

	return await withRepoStatusPaused(repo.repoRoot, () => {
		if (options.local || options.merge) return runLocalUpdateBranchWithRepo(pi, cwd, options, repo);
		return runRemoteUpdateBranchWithRepo(pi, cwd, options, repo);
	}, {
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
	if (result.mode === "remote") lines.push("- mode: GitHub Update branch → git pull --ff-only");
	else if (result.mode === "sync-only") lines.push("- mode: git pull --ff-only (sync only)");
	else if (result.mode) lines.push(`- mode: git pull ${result.mode === "ff-only" ? "--ff-only" : ""}`.trimEnd());
	if (result.pr) {
		lines.push(`- PR: #${result.pr.number}${result.pr.url ? ` ${result.pr.url}` : ""}`);
		lines.push(`- PR branch: ${result.pr.headRefName}${result.pr.baseRefName ? ` ← ${result.pr.baseRefName}` : ""}`);
	}
	if (result.remoteHeadBefore) lines.push(`- remote head before: ${result.remoteHeadBefore.slice(0, 12)}`);
	if (result.remoteHeadAfter) lines.push(`- remote head after: ${result.remoteHeadAfter.slice(0, 12)}`);
	if (result.remoteUpdateTriggered) lines.push("- remote update: triggered");
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
	if (result.remoteUpdateOutput) {
		lines.push("- remote update output:");
		lines.push("```text");
		lines.push(result.remoteUpdateOutput);
		lines.push("```");
	}
	if (result.pullOutput && result.status !== "pass") {
		lines.push("- pull output:");
		lines.push("```text");
		lines.push(result.pullOutput);
		lines.push("```");
	}
	const checks = statusRollupLines(result.pr);
	if (checks.length > 0) {
		lines.push("- checks:");
		for (const check of checks) lines.push(`  - ${check}`);
	}
	return lines.join("\n");
}

function completions(prefix: string): AutocompleteItem[] | null {
	const items = ["--help", "--sync-only", "--no-wait", "--local", "--merge", "--no-autostash"].map((value) => ({ value, label: value }));
	const filtered = items.filter((item) => item.value.startsWith(prefix));
	return filtered.length ? filtered : null;
}

function notify(ctx: ExtensionCommandContext, message: string, level: "info" | "warning" | "error"): void {
	if (ctx.hasUI) ctx.ui.notify(message, level);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("update-branch", {
		description: "현재 PR 브랜치를 GitHub Update branch와 local worktree까지 동기화",
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
