import { lstatSync, mkdirSync, readdirSync, realpathSync, rmdirSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { conflictingBranch, worktreeNameCandidates, type WorktreeNamingScheme } from "./names.ts";

export interface CreateWorktreeOptions {
	repoRoot: string;
	rootDir: string;
	baseBranch: string;
	prefix: string;
	ticket?: string;
	name?: string;
	branch?: string;
	namingScheme?: WorktreeNamingScheme;
	signal?: AbortSignal;
	onProgress?: (message: string) => void;
}
export interface CreatedWorktree {
	name: string;
	worktreePath: string;
	branchName: string;
}

function pathEntry(path: string) {
	try { return lstatSync(path); }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
function canonicalPath(path: string): string {
	try { return realpathSync.native(path); }
	catch { return resolve(path); }
}
function validName(name: string): boolean {
	return Boolean(name) && name !== "." && name !== ".." && !name.startsWith("-") && !/[\\/\x00-\x1f\x7f]/u.test(name);
}

// Git remains the final arbiter: a preflight snapshot cannot prevent an external process racing us.
// Match only name/path conflicts, never generic lock, checkout, permission or network failures.
function isCreationCollision(stderr: string): boolean {
	return /already exists|already checked out|already registered|already used by worktree|not an empty directory|exists; cannot create|reference already exists/iu.test(stderr);
}

export async function createNamedWorktree(pi: Pick<ExtensionAPI, "exec">, options: CreateWorktreeOptions): Promise<CreatedWorktree> {
	const { repoRoot, baseBranch, signal } = options;
	const git = (args: string[]) => pi.exec("git", args, { cwd: repoRoot, signal });
	const checkedGit = async (args: string[]) => {
		const result = await git(args);
		if (result.code !== 0 || result.killed) throw new Error(`git ${args[0]} 실패: ${result.stderr.trim() || result.stdout.trim() || "실행 중단"}`);
		return result.stdout;
	};
	signal?.throwIfAborted();
	if (options.name !== undefined && !validName(options.name)) throw new Error("워크트리 이름은 경로 구분자 없는 단일 이름이어야 합니다.");
	const branchPrefix = options.ticket ? `${options.prefix}/${options.ticket}` : options.prefix;
	const branchFor = (name: string) => options.branch ?? `${branchPrefix}/${name}`;
	await checkedGit(["check-ref-format", "--branch", branchFor(options.name ?? "name-check")]);
	await checkedGit(["check-ref-format", `refs/heads/${baseBranch}`]);

	options.onProgress?.(`origin/${baseBranch}와 사용 중인 브랜치를 확인합니다…`);
	// Do not share FETCH_HEAD across parallel requests. Refresh the exact base ref, then pin its OID.
	await checkedGit(["fetch", "--no-write-fetch-head", "origin", `+refs/heads/${baseBranch}:refs/remotes/origin/${baseBranch}`]);
	const baseOid = (await checkedGit(["rev-parse", "--verify", `refs/remotes/origin/${baseBranch}^{commit}`])).trim();
	const remoteHeads = await checkedGit(["ls-remote", "--heads", "origin"]);
	const remoteBranches = remoteHeads.split("\n").flatMap((line) => {
		const ref = line.split("\t")[1];
		return ref?.startsWith("refs/heads/") ? [ref.slice(11).trim()] : [];
	});
	mkdirSync(options.rootDir, { recursive: true });
	const rootDir = realpathSync.native(options.rootDir);
	const snapshot = async () => {
		const names = new Set(readdirSync(rootDir)); // Includes files and dangling symlinks, not only directories.
		const paths = new Set<string>();
		const refs = (await checkedGit(["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"])).trim().split("\n");
		const branches = new Set(remoteBranches);
		for (const ref of refs) {
			if (ref.startsWith("refs/heads/")) branches.add(ref.slice(11));
			else if (ref.startsWith("refs/remotes/")) branches.add(ref.slice(13).split("/").slice(1).join("/"));
		}
		for (const field of (await checkedGit(["worktree", "list", "--porcelain", "-z"])).split("\0")) {
			if (field.startsWith("worktree ")) {
				const path = field.slice(9);
				names.add(basename(path));
				paths.add(canonicalPath(path));
			} else if (field.startsWith("branch refs/heads/")) branches.add(field.slice(18));
		}
		return { names, paths, branches };
	};
	let occupied = await snapshot();
	const candidates = worktreeNameCandidates(options.namingScheme);
	// Only actual create races consume retries. Thousands of old names do not exhaust this budget.
	for (let attempt = 0; attempt < 20; attempt++) {
		signal?.throwIfAborted();
		if (options.branch !== undefined) {
			const conflict = conflictingBranch(options.branch, occupied.branches);
			if (conflict) throw new Error(`지정한 브랜치 "${options.branch}"가 "${conflict}"와 충돌합니다. 이름을 임의 변경하지 않았습니다.`);
		} else {
			const ancestor = [...occupied.branches].find((branch) => branch === branchPrefix || branchPrefix.startsWith(`${branch}/`));
			if (ancestor) throw new Error(`브랜치 접두사 "${branchPrefix}/"가 기존 브랜치 "${ancestor}"와 충돌합니다. 접두사를 바꿔야 합니다.`);
		}
		let name: string;
		while (true) {
			name = options.name ?? candidates.next().value!;
			const conflict = occupied.names.has(name) || occupied.paths.has(join(rootDir, name)) || pathEntry(join(rootDir, name))
				|| conflictingBranch(branchFor(name), occupied.branches);
			if (!conflict) break;
			if (options.name !== undefined) throw new Error(`지정한 워크트리 "${name}"의 경로 또는 브랜치가 이미 사용 중입니다. 이름을 임의 변경하지 않았습니다.`);
		}
		const worktreePath = join(rootDir, name);
		const branchName = branchFor(name);
		try { mkdirSync(worktreePath); } // Exclusive path claim across processes and even different repos sharing a root.
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (options.name !== undefined) throw new Error(`지정한 워크트리 "${name}"의 경로가 생성 직전에 점유됐습니다.`);
			occupied = await snapshot();
			continue;
		}
		const claim = lstatSync(worktreePath);
		const releaseEmptyClaim = () => {
			const current = pathEntry(worktreePath);
			// Never recursively delete or remove a replaced/nonempty path, even after cancellation.
			if (current?.dev === claim.dev && current.ino === claim.ino && current.isDirectory()) {
				try { rmdirSync(worktreePath); }
				catch (error) {
					if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
				}
			}
		};
		let result;
		try {
			options.onProgress?.(`워크트리 "${name}"를 생성합니다…`);
			result = await git(["worktree", "add", "-b", branchName, "--", worktreePath, baseOid]);
		} catch (error) {
			releaseEmptyClaim();
			throw error;
		}
		if (result.code === 0 && !result.killed) return { name, worktreePath, branchName };
		releaseEmptyClaim();
		const reason = result.stderr.trim() || result.stdout.trim() || "실행 중단";
		if (signal?.aborted || result.killed || !isCreationCollision(reason)) {
			throw new Error(`워크트리 생성 실패 (${name}): ${reason}. 부분 생성 결과는 덮어쓰거나 삭제하지 않았습니다.`);
		}
		if (options.name !== undefined || options.branch !== undefined) {
			throw new Error(`지정한 이름/브랜치가 생성 중 충돌했습니다: ${reason}. 이름을 임의 변경하지 않았습니다.`);
		}
		// If Git partially created a branch/path, leave it occupied. We cannot prove exclusive ownership.
		occupied = await snapshot();
		occupied.names.add(name);
		options.onProgress?.(`"${name}" 생성 중 충돌하여 다른 이름으로 재시도합니다. 기존/부분 생성 결과는 보존합니다.`);
	}
	throw new Error("동시 생성 충돌이 20회 반복되어 중단했습니다. 기존 작업은 보존했으며 다시 시도할 수 있습니다.");
}
