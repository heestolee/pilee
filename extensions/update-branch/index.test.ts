import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import updateBranch, {
	formatUpdateBranchResult,
	isIndexLockError,
	parseUpdateBranchArgs,
	runUpdateBranch,
	type CommandResult,
} from "./index.ts";

type ExecCall = { command: string; args: string[]; cwd?: string };

const ORIGINAL_REPO_STATUS_STATE_DIR = process.env.PILEE_REPO_STATUS_STATE_DIR;

test.beforeEach(async () => {
	process.env.PILEE_REPO_STATUS_STATE_DIR = await mkdtemp(join(tmpdir(), "update-branch-repo-status-state-"));
});

test.afterEach(() => {
	if (ORIGINAL_REPO_STATUS_STATE_DIR === undefined) {
		delete process.env.PILEE_REPO_STATUS_STATE_DIR;
	} else {
		process.env.PILEE_REPO_STATUS_STATE_DIR = ORIGINAL_REPO_STATUS_STATE_DIR;
	}
});

function mockPi(handler: (command: string, args: string[], options: any) => Promise<CommandResult> | CommandResult) {
	const calls: ExecCall[] = [];
	const messages: any[] = [];
	const pi = {
		exec: async (command: string, args: string[], options: any = {}) => {
			calls.push({ command, args, cwd: options.cwd });
			return await handler(command, args, options);
		},
		sendMessage: (message: any) => messages.push(message),
	};
	return { pi, calls, messages };
}

test("argument parser supports remote-first and local pull options", () => {
	assert.deepEqual(parseUpdateBranchArgs(""), { help: false, local: false, merge: false, noAutostash: false, syncOnly: false, noWait: false });
	assert.deepEqual(parseUpdateBranchArgs("--local"), { help: false, local: true, merge: false, noAutostash: false, syncOnly: false, noWait: false });
	assert.deepEqual(parseUpdateBranchArgs("--merge"), { help: false, local: false, merge: true, noAutostash: false, syncOnly: false, noWait: false });
	assert.deepEqual(parseUpdateBranchArgs("--sync-only"), { help: false, local: false, merge: false, noAutostash: false, syncOnly: true, noWait: false });
	assert.deepEqual(parseUpdateBranchArgs("--no-wait"), { help: false, local: false, merge: false, noAutostash: false, syncOnly: false, noWait: true });
	assert.deepEqual(parseUpdateBranchArgs("--no-autostash"), { help: false, local: false, merge: false, noAutostash: true, syncOnly: false, noWait: false });
	assert.deepEqual(parseUpdateBranchArgs("help"), { help: true, local: false, merge: false, noAutostash: false, syncOnly: false, noWait: false });
	assert.deepEqual(parseUpdateBranchArgs("--help --merge"), { help: true, local: false, merge: true, noAutostash: false, syncOnly: false, noWait: false });
	assert.deepEqual(parseUpdateBranchArgs("--sync-only --no-wait"), { error: "--sync-only와 --no-wait는 함께 사용할 수 없습니다." });
	assert.deepEqual(parseUpdateBranchArgs("--sync-only --local"), { error: "remote-first 옵션(--sync-only/--no-wait)과 local pull 옵션(--local/--merge)은 함께 사용할 수 없습니다." });
	assert.deepEqual(parseUpdateBranchArgs("origin development"), { error: "지원하지 않는 인자입니다: origin" });
});

test("index.lock error detection matches common git failures", () => {
	assert.equal(isIndexLockError("fatal: Unable to create '/repo/.git/index.lock': File exists."), true);
	assert.equal(isIndexLockError("fatal: not possible to fast-forward"), false);
});

test("runUpdateBranch triggers GitHub update branch and syncs local branch by default", async () => {
	const repo = "/repo";
	const before = "a".repeat(40);
	const after = "b".repeat(40);
	const prBefore = {
		number: 123,
		url: "https://github.com/owner/repo/pull/123",
		headRefName: "feature/x",
		headRefOid: before,
		baseRefName: "development",
		statusCheckRollup: [{ name: "Backward Compatibility Check", status: "QUEUED", detailsUrl: "https://checks.example/1" }],
	};
	const prAfter = { ...prBefore, headRefOid: after, statusCheckRollup: [{ name: "Backward Compatibility Check", status: "PENDING", detailsUrl: "https://checks.example/2" }] };
	const { pi, calls } = mockPi((command, args) => {
		const key = args.join(" ");
		if (command === "gh" && key.startsWith("pr view --json ")) return { code: 0, stdout: `${JSON.stringify(prBefore)}\n` };
		if (command === "gh" && key === "pr update-branch 123") return { code: 0, stdout: "✓ Updated branch feature/x\n" };
		if (command === "gh" && key.startsWith("pr view 123 --json ")) return { code: 0, stdout: `${JSON.stringify(prAfter)}\n` };
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: `${repo}/.git/index.lock\n` };
		if (key === "rev-parse HEAD") return { code: 0, stdout: `${before}\n` };
		if (key === "status --porcelain") return { code: 0, stdout: "" };
		if (key === "pull --ff-only") return { code: 0, stdout: "Updating aaa..bbb\n" };
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\n" };
		if (key === "log --oneline -1") return { code: 0, stdout: "bbb1234 Merge remote-tracking branch 'origin/development'\n" };
		throw new Error(`unexpected ${command} args: ${key}`);
	});

	const result = await runUpdateBranch(pi as any, repo);
	assert.equal(result.status, "pass");
	assert.equal(result.mode, "remote");
	assert.equal(result.remoteUpdateTriggered, true);
	assert.equal(result.remoteHeadBefore, before);
	assert.equal(result.remoteHeadAfter, after);
	assert.ok(calls.some((call) => call.command === "gh" && call.args.join(" ") === "pr update-branch 123"));
	assert.ok(calls.some((call) => call.command === "git" && call.args.join(" ") === "pull --ff-only"));
	const summary = formatUpdateBranchResult(result);
	assert.match(summary, /GitHub Update branch → git pull --ff-only/);
	assert.match(summary, /PR: #123/);
	assert.match(summary, /Backward Compatibility Check/);
});

test("runUpdateBranch sync-only allows local branch to be behind PR head", async () => {
	const repo = "/repo";
	const local = "a".repeat(40);
	const remote = "b".repeat(40);
	const pr = { number: 123, headRefName: "feature/x", headRefOid: remote, baseRefName: "development" };
	const { pi, calls } = mockPi((command, args) => {
		const key = args.join(" ");
		if (command === "gh" && key.startsWith("pr view --json ")) return { code: 0, stdout: `${JSON.stringify(pr)}\n` };
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: `${repo}/.git/index.lock\n` };
		if (key === "rev-parse HEAD") return { code: 0, stdout: `${local}\n` };
		if (key === "status --porcelain") return { code: 0, stdout: "" };
		if (key === "pull --ff-only") return { code: 0, stdout: "Updating aaa..bbb\n" };
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\n" };
		if (key === "log --oneline -1") return { code: 0, stdout: "bbb1234 latest\n" };
		throw new Error(`unexpected ${command} args: ${key}`);
	});

	const result = await runUpdateBranch(pi as any, repo, "--sync-only");
	assert.equal(result.status, "pass");
	assert.equal(result.mode, "sync-only");
	assert.equal(calls.some((call) => call.command === "gh" && call.args.join(" ") === "pr update-branch 123"), false);
	assert.ok(calls.some((call) => call.command === "git" && call.args.join(" ") === "pull --ff-only"));
});

test("runUpdateBranch auto-syncs when local branch is behind PR head before remote update", async () => {
	const repo = "/repo";
	const local = "a".repeat(40);
	const remoteBefore = "b".repeat(40);
	const remoteAfter = "c".repeat(40);
	const prBefore = { number: 123, headRefName: "feature/x", headRefOid: remoteBefore, baseRefName: "development" };
	const prAfter = { ...prBefore, headRefOid: remoteAfter };
	let headCalls = 0;
	const { pi, calls } = mockPi((command, args) => {
		const key = args.join(" ");
		if (command === "gh" && key.startsWith("pr view --json ")) return { code: 0, stdout: `${JSON.stringify(prBefore)}\n` };
		if (command === "gh" && key === "pr update-branch 123") return { code: 0, stdout: "✓ Updated branch feature/x\n" };
		if (command === "gh" && key.startsWith("pr view 123 --json ")) return { code: 0, stdout: `${JSON.stringify(prAfter)}\n` };
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: `${repo}/.git/index.lock\n` };
		if (key === "rev-parse HEAD") {
			headCalls += 1;
			return { code: 0, stdout: `${headCalls === 1 ? local : remoteBefore}\n` };
		}
		if (key === "status --porcelain") return { code: 0, stdout: "" };
		if (key === "pull --ff-only") return { code: 0, stdout: "Updating branch\n" };
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\n" };
		if (key === "log --oneline -1") return { code: 0, stdout: "ccc1234 latest\n" };
		throw new Error(`unexpected ${command} args: ${key}`);
	});

	const result = await runUpdateBranch(pi as any, repo);
	assert.equal(result.status, "pass");
	assert.equal(result.mode, "remote");
	assert.equal(result.remoteUpdateTriggered, true);
	assert.equal(result.remoteHeadBefore, remoteBefore);
	assert.equal(result.remoteHeadAfter, remoteAfter);
	assert.equal(calls.filter((call) => call.command === "git" && call.args.join(" ") === "pull --ff-only").length, 2);
	assert.ok(calls.some((call) => call.command === "gh" && call.args.join(" ") === "pr update-branch 123"));
});

test("runUpdateBranch treats already up-to-date remote response as no-op success", async () => {
	const repo = "/repo";
	const head = "a".repeat(40);
	const pr = { number: 123, headRefName: "feature/x", headRefOid: head, baseRefName: "development" };
	const { pi } = mockPi((command, args) => {
		const key = args.join(" ");
		if (command === "gh" && key.startsWith("pr view --json ")) return { code: 0, stdout: `${JSON.stringify(pr)}\n` };
		if (command === "gh" && key === "pr update-branch 123") return { code: 1, stderr: "GraphQL: Head branch is already up-to-date with base branch\n" };
		if (command === "gh" && key.startsWith("pr view 123 --json ")) return { code: 0, stdout: `${JSON.stringify(pr)}\n` };
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: `${repo}/.git/index.lock\n` };
		if (key === "rev-parse HEAD") return { code: 0, stdout: `${head}\n` };
		if (key === "status --porcelain") return { code: 0, stdout: "" };
		if (key === "pull --ff-only") return { code: 0, stdout: "Already up to date.\n" };
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\n" };
		if (key === "log --oneline -1") return { code: 0, stdout: "aaa1234 latest\n" };
		throw new Error(`unexpected ${command} args: ${key}`);
	});

	const result = await runUpdateBranch(pi as any, repo);
	assert.equal(result.status, "pass");
	assert.equal(result.mode, "remote");
	assert.equal(result.remoteHeadAfter, head);
	assert.match(result.remoteUpdateOutput ?? "", /already up-to-date/);
});

test("runUpdateBranch pulls with ff-only in local mode when worktree is clean", async () => {
	const repo = "/repo";
	const { pi, calls } = mockPi((_command, args) => {
		const key = args.join(" ");
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: `${repo}/.git/index.lock\n` };
		if (key === "status --porcelain") return { code: 0, stdout: "" };
		if (key === "pull --ff-only") return { code: 0, stdout: "Already up to date.\n" };
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\n" };
		if (key === "log --oneline -1") return { code: 0, stdout: "abc1234 Merge branch 'development'\n" };
		throw new Error(`unexpected git args: ${key}`);
	});

	const result = await runUpdateBranch(pi as any, repo, "--local");
	assert.equal(result.status, "pass");
	assert.equal(result.mode, "ff-only");
	assert.match(result.head ?? "", /abc1234/);
	assert.ok(calls.some((call) => call.args.join(" ") === "pull --ff-only"));
	assert.match(formatUpdateBranchResult(result), /브랜치 최신화가 완료/);
});

test("runUpdateBranch preserves dirty worktree with include-untracked stash by default", async () => {
	const repo = "/repo";
	let statusPorcelainCalls = 0;
	const { pi, calls } = mockPi((_command, args) => {
		const key = args.join(" ");
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: `${repo}/.git/index.lock\n` };
		if (key === "status --porcelain") {
			statusPorcelainCalls += 1;
			return { code: 0, stdout: statusPorcelainCalls === 1 ? " M README.md\n?? local.txt\n" : "" };
		}
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\n M README.md\n?? local.txt\n" };
		if (key.startsWith("stash push --include-untracked -m pilee/update-branch")) return { code: 0, stdout: "Saved working directory and index state\n" };
		if (key === "stash list --format=%gd%x00%gs -n 1") return { code: 0, stdout: "stash@{0}\u0000On feature/x: pilee/update-branch 2026-06-16T00:00:00.000Z\n" };
		if (key === "pull --ff-only") return { code: 0, stdout: "Updating abc..def\n" };
		if (key === "stash apply --index stash@{0}") return { code: 0, stdout: "" };
		if (key === "stash drop stash@{0}") return { code: 0, stdout: "Dropped stash@{0}\n" };
		if (key === "log --oneline -1") return { code: 0, stdout: "def5678 latest\n" };
		throw new Error(`unexpected git args: ${key}`);
	});

	const result = await runUpdateBranch(pi as any, repo, "--local");
	assert.equal(result.status, "pass");
	assert.equal(result.preserve?.stashed, true);
	assert.equal(result.preserve?.applied, true);
	assert.equal(result.preserve?.dropped, true);
	assert.ok(calls.some((call) => call.args.join(" ").startsWith("stash push --include-untracked -m pilee/update-branch")));
	assert.ok(calls.some((call) => call.args.join(" ") === "pull --ff-only"));
	assert.match(formatUpdateBranchResult(result), /dirty preserve/);
});

test("runUpdateBranch can still block dirty worktree with no-autostash", async () => {
	const repo = "/repo";
	const { pi, calls } = mockPi((_command, args) => {
		const key = args.join(" ");
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: `${repo}/.git/index.lock\n` };
		if (key === "status --porcelain") return { code: 0, stdout: " M README.md\n" };
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\n M README.md\n" };
		throw new Error(`unexpected git args: ${key}`);
	});

	const result = await runUpdateBranch(pi as any, repo, "--local --no-autostash");
	assert.equal(result.status, "blocked");
	assert.match(result.dirtyStatus ?? "", /README/);
	assert.equal(calls.some((call) => call.args[0] === "pull"), false);
});

test("runUpdateBranch keeps stash when dirty restore fails after pull", async () => {
	const repo = "/repo";
	const { pi } = mockPi((_command, args) => {
		const key = args.join(" ");
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: `${repo}/.git/index.lock\n` };
		if (key === "status --porcelain") return { code: 0, stdout: " M README.md\n" };
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\nUU README.md\n" };
		if (key.startsWith("stash push --include-untracked -m pilee/update-branch")) return { code: 0, stdout: "Saved working directory and index state\n" };
		if (key === "stash list --format=%gd%x00%gs -n 1") return { code: 0, stdout: "stash@{0}\u0000On feature/x: pilee/update-branch 2026-06-16T00:00:00.000Z\n" };
		if (key === "pull --ff-only") return { code: 0, stdout: "Updating abc..def\n" };
		if (key === "stash apply --index stash@{0}") return { code: 1, stderr: "CONFLICT (content): Merge conflict in README.md\n" };
		if (key === "log --oneline -1") return { code: 0, stdout: "def5678 latest\n" };
		throw new Error(`unexpected git args: ${key}`);
	});

	const result = await runUpdateBranch(pi as any, repo, "--local");
	assert.equal(result.status, "fail");
	assert.equal(result.preserve?.kept, true);
	assert.equal(result.preserve?.dropped, undefined);
	assert.match(result.message, /stash는 삭제하지 않았습니다|수동 확인/);
	assert.match(formatUpdateBranchResult(result), /수동 복구를 위해 stash 보존/);
});

test("runUpdateBranch removes stale index.lock and retries once", async () => {
	const root = await mkdtemp(join(tmpdir(), "update-branch-lock-"));
	const lockPath = join(root, "index.lock");
	await writeFile(lockPath, "stale");
	let statusAttempts = 0;
	const { pi } = mockPi((command, args) => {
		const key = args.join(" ");
		if (command === "lsof") return { code: 1, stdout: "", stderr: "" };
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${root}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: "index.lock\n" };
		if (key === "status --porcelain") {
			statusAttempts += 1;
			if (statusAttempts === 1) return { code: 128, stderr: `fatal: Unable to create '${lockPath}': File exists.\n` };
			return { code: 0, stdout: "" };
		}
		if (key === "pull --ff-only") return { code: 0, stdout: "Updating abc..def\n" };
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\n" };
		if (key === "log --oneline -1") return { code: 0, stdout: "def5678 latest\n" };
		throw new Error(`unexpected command: ${command} ${key}`);
	});

	const result = await runUpdateBranch(pi as any, root, "--local");
	assert.equal(result.status, "pass");
	assert.equal(statusAttempts, 2);
	assert.equal(existsSync(lockPath), false);
	assert.equal(result.lockRecoveries.some((recovery) => recovery.removed), true);
});

test("runUpdateBranch stops repo-status git status owner and retries", async () => {
	const root = await mkdtemp(join(tmpdir(), "update-branch-repo-status-owner-"));
	const lockPath = join(root, "index.lock");
	await writeFile(lockPath, "repo-status-owner");
	let statusAttempts = 0;
	let killed = false;
	const { pi, calls } = mockPi(async (command, args) => {
		const key = args.join(" ");
		if (command === "lsof") {
			return {
				code: 0,
				stdout: `COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\ngit     12345 user    3u   REG    1,1        0  123 ${lockPath}\n`,
			};
		}
		if (command === "ps" && key === "-o pid=,command= -p 12345") {
			return { code: 0, stdout: "12345 /Applications/Xcode.app/Contents/Developer/usr/bin/git status --porcelain=v2 --branch --untracked-files=normal\n" };
		}
		if (command === "kill" && key === "12345") {
			killed = true;
			await unlink(lockPath);
			return { code: 0, stdout: "" };
		}
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${root}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: "index.lock\n" };
		if (key === "status --porcelain") {
			statusAttempts += 1;
			if (statusAttempts === 1) return { code: 128, stderr: `fatal: Unable to create '${lockPath}': File exists.\n` };
			return { code: 0, stdout: "" };
		}
		if (key === "pull --ff-only") return { code: 0, stdout: "Updating abc..def\n" };
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\n" };
		if (key === "log --oneline -1") return { code: 0, stdout: "def5678 latest\n" };
		throw new Error(`unexpected command: ${command} ${key}`);
	});

	const result = await runUpdateBranch(pi as any, root, "--local");
	assert.equal(result.status, "pass");
	assert.equal(statusAttempts, 2);
	assert.equal(killed, true);
	assert.ok(calls.some((call) => call.command === "kill" && call.args.join(" ") === "12345"));
	assert.match(result.lockRecoveries.map((recovery) => recovery.message).join("\n"), /repo-status git status/);
	assert.match(formatUpdateBranchResult(result), /repo-status git status 프로세스를 중단하고 재시도/);
});

test("command registers slash command and emits visible summary", async () => {
	const commands = new Map<string, any>();
	const messages: any[] = [];
	updateBranch({
		registerCommand: (name: string, command: any) => commands.set(name, command),
		sendMessage: (message: any) => messages.push(message),
		exec: async (_command: string, args: string[]) => {
			const key = args.join(" ");
			if (key === "rev-parse --show-toplevel") return { code: 0, stdout: "/repo\n" };
			if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: "/repo/.git/index.lock\n" };
			if (key === "status --porcelain") return { code: 0, stdout: "" };
			if (key === "pull --ff-only") return { code: 0, stdout: "Already up to date.\n" };
			if (key === "status --short --branch") return { code: 0, stdout: "## main...origin/main\n" };
			if (key === "log --oneline -1") return { code: 0, stdout: "abc123 main\n" };
			return { code: 1, stderr: `unexpected ${key}` };
		},
	} as any);

	const command = commands.get("update-branch");
	assert.ok(command);
	assert.deepEqual(command.getArgumentCompletions("--h"), [{ value: "--help", label: "--help" }]);
	assert.deepEqual(command.getArgumentCompletions("--no"), [{ value: "--no-wait", label: "--no-wait" }, { value: "--no-autostash", label: "--no-autostash" }]);
	const notifications: string[] = [];
	await command.handler("--local", {
		cwd: "/repo",
		hasUI: true,
		ui: {
			notify: (message: string) => notifications.push(message),
			setStatus: () => undefined,
		},
	});
	assert.equal(messages.length, 1);
	assert.match(messages[0].content, /\/update-branch 완료/);
	assert.match(notifications.join("\n"), /브랜치 최신화 완료/);
});
