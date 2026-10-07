import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { createNamedWorktree, type CreateWorktreeOptions } from "./create-worktree.ts";
import { WORD_NAMES } from "./names.ts";

const exec = promisify(execFile);
const host = {
	async exec(command: string, args: string[], options: { cwd?: string; signal?: AbortSignal } = {}) {
		try { return { ...await exec(command, args, { ...options, encoding: "utf8" }), code: 0, killed: false }; }
		catch (error: any) { return { stdout: error.stdout ?? "", stderr: error.stderr ?? error.message, code: typeof error.code === "number" ? error.code : 1, killed: Boolean(error.killed) }; }
	},
};
function fixture(t: { after: (fn: () => void) => void }) {
	const dir = mkdtempSync(join(tmpdir(), "pilee-naming-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	const repoRoot = join(dir, "repo");
	const rootDir = join(dir, "worktrees");
	mkdirSync(repoRoot); mkdirSync(rootDir);
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
	git("init", "-b", "main");
	git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
	git("config", "core.hooksPath", "/dev/null");
	writeFileSync(join(repoRoot, "file.txt"), "original\n");
	git("add", "file.txt"); git("commit", "-m", "baseline");
	git("clone", "--bare", repoRoot, join(dir, "remote.git"));
	git("remote", "add", "origin", join(dir, "remote.git"));
	const options: CreateWorktreeOptions = { repoRoot, rootDir, baseBranch: "main", prefix: "feature" };
	return { dir, git, options };
}
function fillNames(root: string, except: string[] = []) {
	for (const name of WORD_NAMES) if (!except.includes(name)) writeFileSync(join(root, name), "occupied");
}

test("exhausted pool extends names without touching files, symlinks or existing branches", async (t) => {
	const { git, options } = fixture(t);
	fillNames(options.rootDir);
	const result = await createNamedWorktree(host, options);
	assert.match(result.name, /^[a-z]+-[a-z]+-2$/);
	assert.equal(git("-C", result.worktreePath, "branch", "--show-current"), result.branchName);
	assert.equal(readFileSync(join(result.worktreePath, "file.txt"), "utf8"), "original\n");
	assert.equal(readFileSync(join(options.rootDir, WORD_NAMES[0]), "utf8"), "occupied");
});

test("skips orphan refs, remote-only refs, nested refs and registered worktrees outside the root", async (t) => {
	const { dir, git, options } = fixture(t);
	const [orphan, remote, nested, elsewhere, stale, symlink, free] = WORD_NAMES;
	fillNames(options.rootDir, [orphan, remote, nested, elsewhere, stale, symlink, free]);
	git("branch", `feature/${orphan}`);
	git("push", "origin", `HEAD:refs/heads/feature/${remote}`);
	git("branch", `feature/${nested}/child`);
	git("worktree", "add", "-b", "elsewhere-branch", join(dir, elsewhere), "HEAD");
	git("worktree", "add", "-b", "stale-branch", join(dir, stale), "HEAD");
	rmSync(join(dir, stale), { recursive: true });
	symlinkSync(join(dir, "missing"), join(options.rootDir, symlink));
	const result = await createNamedWorktree(host, options);
	assert.equal(result.name, free);
	assert.ok(lstatSync(join(options.rootDir, symlink)).isSymbolicLink());
	assert.ok(git("branch", "--list", `feature/${orphan}`));
});

test("explicit names and branches fail without reuse or silent renaming", async (t) => {
	const { git, options } = fixture(t);
	git("branch", "feature/chosen");
	await assert.rejects(createNamedWorktree(host, { ...options, name: "chosen" }), /임의 변경하지/);
	await assert.rejects(createNamedWorktree(host, { ...options, branch: "feature/chosen" }), /임의 변경하지/);
	assert.equal(existsSync(join(options.rootDir, "chosen")), false);
	await assert.rejects(createNamedWorktree(host, { ...options, name: "../escape" }), /단일 이름/);
});

test("fixed namespace conflicts stop immediately instead of exhausting every candidate", async (t) => {
	const { git, options } = fixture(t);
	git("branch", "feature");
	await assert.rejects(createNamedWorktree(host, options), /접두사.*feature/);
});

test("a branch created after preflight causes a real Git conflict, then a successful retry", async (t) => {
	const { git, options } = fixture(t);
	let firstBranch = "";
	let firstPath = "";
	const racingHost = { async exec(command: string, args: string[], opts: any) {
		if (args[0] === "worktree" && args[1] === "add" && !firstBranch) {
			firstBranch = args[3]; firstPath = args[5];
			git("branch", firstBranch);
		}
		return host.exec(command, args, opts);
	} };
	const result = await createNamedWorktree(racingHost, options);
	assert.notEqual(result.branchName, firstBranch);
	assert.ok(git("branch", "--list", firstBranch));
	assert.equal(existsSync(firstPath), false, "only the empty directory owned by this attempt is removed");
});

test("a late nonempty path is preserved and the request moves to another name", async (t) => {
	const { options } = fixture(t);
	let firstPath = "";
	const racingHost = { async exec(command: string, args: string[], opts: any) {
		if (args[0] === "worktree" && args[1] === "add" && !firstPath) {
			firstPath = args[5];
			writeFileSync(join(firstPath, "keep.txt"), "external work");
		}
		return host.exec(command, args, opts);
	} };
	const result = await createNamedWorktree(racingHost, options);
	assert.notEqual(result.worktreePath, firstPath);
	assert.equal(readFileSync(join(firstPath, "keep.txt"), "utf8"), "external work");
});

test("two concurrent requests with the same sole free name both succeed across Git processes", async (t) => {
	const { dir, options } = fixture(t);
	const secondRoot = join(dir, "other-root"); mkdirSync(secondRoot);
	fillNames(options.rootDir, [WORD_NAMES[0]]); fillNames(secondRoot, [WORD_NAMES[0]]);
	let arrivals = 0;
	let release!: () => void;
	const barrier = new Promise<void>((resolve) => { release = resolve; });
	const racingHost = { async exec(command: string, args: string[], opts: any) {
		if (args[0] === "worktree" && args[1] === "add" && args[3] === `feature/${WORD_NAMES[0]}`) {
			if (++arrivals === 2) release();
			await barrier;
		}
		return host.exec(command, args, opts);
	} };
	const results = await Promise.all([
		createNamedWorktree(racingHost, options),
		createNamedWorktree(racingHost, { ...options, rootDir: secondRoot }),
	]);
	assert.equal(arrivals, 2);
	assert.notEqual(results[0].name, results[1].name);
	for (const result of results) assert.equal(basename(result.worktreePath), result.name);
});

test("a progress callback failure releases only the empty claimed directory", async (t) => {
	const { git, options } = fixture(t);
	await assert.rejects(createNamedWorktree(host, { ...options, name: "progress-failure", onProgress(message) {
		if (message.startsWith("워크트리")) throw new Error("progress unavailable");
	} }), /progress unavailable/);
	assert.equal(existsSync(join(options.rootDir, "progress-failure")), false);
	assert.equal(git("branch", "--list", "feature/progress-failure"), "");
});

test("checkout/permission failures and cancellation are not disguised as naming retries", async (t) => {
	const { options } = fixture(t);
	let attempts = 0;
	const failingHost = { async exec(command: string, args: string[], opts: any) {
		if (args[0] === "worktree" && args[1] === "add") {
			attempts++;
			return { code: 128, stdout: "", stderr: "fatal: cannot lock ref: Permission denied", killed: false };
		}
		return host.exec(command, args, opts);
	} };
	await assert.rejects(createNamedWorktree(failingHost, options), /Permission denied/);
	assert.equal(attempts, 1);
	const controller = new AbortController(); controller.abort();
	await assert.rejects(createNamedWorktree(host, { ...options, signal: controller.signal }), /abort/i);
});
