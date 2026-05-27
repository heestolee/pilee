import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
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

test("argument parser supports help and merge only", () => {
	assert.deepEqual(parseUpdateBranchArgs(""), { help: false, merge: false });
	assert.deepEqual(parseUpdateBranchArgs("--merge"), { help: false, merge: true });
	assert.deepEqual(parseUpdateBranchArgs("help"), { help: true, merge: false });
	assert.deepEqual(parseUpdateBranchArgs("--help --merge"), { help: true, merge: true });
	assert.deepEqual(parseUpdateBranchArgs("origin development"), { error: "지원하지 않는 인자입니다: origin" });
});

test("index.lock error detection matches common git failures", () => {
	assert.equal(isIndexLockError("fatal: Unable to create '/repo/.git/index.lock': File exists."), true);
	assert.equal(isIndexLockError("fatal: not possible to fast-forward"), false);
});

test("runUpdateBranch pulls with ff-only when worktree is clean", async () => {
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

	const result = await runUpdateBranch(pi as any, repo);
	assert.equal(result.status, "pass");
	assert.equal(result.mode, "ff-only");
	assert.match(result.head ?? "", /abc1234/);
	assert.ok(calls.some((call) => call.args.join(" ") === "pull --ff-only"));
	assert.match(formatUpdateBranchResult(result), /브랜치 최신화가 완료/);
});

test("runUpdateBranch blocks dirty worktree before pulling", async () => {
	const repo = "/repo";
	const { pi, calls } = mockPi((_command, args) => {
		const key = args.join(" ");
		if (key === "rev-parse --show-toplevel") return { code: 0, stdout: `${repo}\n` };
		if (key === "rev-parse --git-path index.lock") return { code: 0, stdout: `${repo}/.git/index.lock\n` };
		if (key === "status --porcelain") return { code: 0, stdout: " M README.md\n" };
		if (key === "status --short --branch") return { code: 0, stdout: "## feature/x...origin/feature/x\n M README.md\n" };
		throw new Error(`unexpected git args: ${key}`);
	});

	const result = await runUpdateBranch(pi as any, repo);
	assert.equal(result.status, "blocked");
	assert.match(result.dirtyStatus ?? "", /README/);
	assert.equal(calls.some((call) => call.args[0] === "pull"), false);
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

	const result = await runUpdateBranch(pi as any, root);
	assert.equal(result.status, "pass");
	assert.equal(statusAttempts, 2);
	assert.equal(existsSync(lockPath), false);
	assert.equal(result.lockRecoveries.some((recovery) => recovery.removed), true);
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
	const notifications: string[] = [];
	await command.handler("", {
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
