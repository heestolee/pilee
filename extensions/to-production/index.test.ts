import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import toProduction, { __toProductionForTests } from "./index.ts";

function registerFixture(exec?: (command: string, args: string[], options?: any) => Promise<{ code: number; stdout?: string; stderr?: string }>) {
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();
	const messages: any[] = [];
	const pi = {
		async exec(command: string, args: string[], options?: any) {
			if (!exec) throw new Error(`unexpected exec call: ${command} ${args.join(" ")}`);
			return exec(command, args, options);
		},
		sendMessage(message: any) { messages.push(message); },
		registerCommand(name: string, command: any) { commands.set(name, command); },
		registerTool(tool: any) { tools.set(tool.name, tool); },
	};
	toProduction(pi as any);
	return { commands, tools, messages };
}

function git(cwd: string, args: string[]): string {
	return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function gitPiExec(command: string, args: string[], options?: any) {
	const result = spawnSync(command, args, { cwd: options?.cwd, encoding: "utf8" });
	return Promise.resolve({ code: result.status ?? 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" });
}

function missingSourceBaseCandidates(joined: string) {
	return [
		"rev-parse --verify origin/development",
		"rev-parse --verify origin/develop",
		"rev-parse --verify origin/main",
		"rev-parse --verify origin/master",
		"rev-parse --verify origin/HEAD",
	].includes(joined);
}

function gitMockExec(repoRoot: string, options: { untrackedRaw?: string; calls?: string[]; state?: { committed?: boolean }; emptyCommits?: boolean } = {}) {
	return async (command: string, args: string[]) => {
		assert.equal(command, "git");
		const joined = args.join(" ");
		options.calls?.push(joined);
		const head = options.state?.committed ? "4444444444444444444444444444444444444444" : "1111111111111111111111111111111111111111";
		if (joined === "rev-parse --show-toplevel") return { code: 0, stdout: repoRoot };
		if (joined === "branch --show-current") return { code: 0, stdout: "feature/source\n" };
		if (joined === "rev-parse HEAD") return { code: 0, stdout: `${head}\n` };
		if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return { code: 0, stdout: "origin/feature/source\n" };
		if (joined === "status --short --branch") return { code: 0, stdout: "## feature/source...origin/feature/source\n" };
		if (joined === "status --porcelain=v1") return { code: 0, stdout: "" };
		if (joined === "diff --binary HEAD --") return { code: 0, stdout: "" };
		if (joined === "ls-files --others --exclude-standard -z") return { code: 0, stdout: options.state?.committed ? "" : (options.untrackedRaw ?? "") };
		if (joined === "merge-base HEAD origin/feature/source") return { code: 0, stdout: options.emptyCommits ? `${head}\n` : "0000000000000000000000000000000000000000\n" };
		if (joined === `${head}..HEAD`) throw new Error("rev-list command was split incorrectly");
		if (joined === `rev-list --reverse ${head}..HEAD`) return { code: 0, stdout: "" };
		if (options.emptyCommits && missingSourceBaseCandidates(joined)) return { code: 1, stdout: "" };
		if (joined === "rev-list --reverse 0000000000000000000000000000000000000000..HEAD") {
			return { code: 0, stdout: options.state?.committed
				? "2222222222222222222222222222222222222222\n4444444444444444444444444444444444444444\n"
				: "2222222222222222222222222222222222222222\n" };
		}
		if (joined === "rev-list --merges 0000000000000000000000000000000000000000..HEAD") return { code: 0, stdout: "" };
		if (joined === "add -- scratch.txt") return { code: 0, stdout: "" };
		if (joined === "commit -m chore: feature/source untracked 파일 보존 -- scratch.txt") {
			if (options.state) options.state.committed = true;
			return { code: 0, stdout: "[feature/source 4444444] chore: feature/source untracked 파일 보존\n" };
		}
		if (joined === "fetch origin production") return { code: 0, stdout: "" };
		if (joined === "rev-parse --verify origin/production") return { code: 0, stdout: "3333333333333333333333333333333333333333\n" };
		if (joined === "check-ref-format --branch hotfeature/COM-1/foo") return { code: 0, stdout: "hotfeature/COM-1/foo\n" };
		if (joined === "show-ref --verify --quiet refs/heads/hotfeature/COM-1/foo") return { code: 1, stdout: "" };
		throw new Error(`unexpected git call: ${joined}`);
	};
}

test("to-production registers an in-place natural-language tool bridge", () => {
	const { commands, tools } = registerFixture();
	assert.ok(commands.has("to-production"));
	const tool = tools.get("to_production");
	assert.ok(tool);
	assert.match(tool.promptSnippet, /현재 workspace|current workspace|worktree|to-production/);
	assert.match(tool.promptGuidelines.join("\n"), /Do not create a sibling worktree/);
	assert.match(tool.promptGuidelines.join("\n"), /cherry-picks those commits/);
	assert.match(tool.promptGuidelines.join("\n"), /\/wt fork --hotfix/);
	assert.match(tool.promptGuidelines.join("\n"), /standalone \/to-production/);
});

test("to-production tool parses raw args or structured params but rejects removed worktree migration options", () => {
	const raw = __toProductionForTests.toolParamsToParsed({ args: "--range abc..HEAD --branch hotfeature/COM-1/foo --yes" });
	assert.equal(raw.range, "abc..HEAD");
	assert.equal(raw.branch, "hotfeature/COM-1/foo");
	assert.equal(raw.yes, true);

	const structured = __toProductionForTests.toolParamsToParsed({ range: "abc..HEAD", branch: "hotfeature/COM-1/foo", base: "production", untrackedMode: "commit", untrackedCommitMessage: "chore: 보존", yes: true });
	assert.equal(structured.range, "abc..HEAD");
	assert.equal(structured.branch, "hotfeature/COM-1/foo");
	assert.equal(structured.baseRef, "origin/production");
	assert.equal(structured.untrackedMode, "commit");
	assert.equal(structured.untrackedCommitMessage, "chore: 보존");
	assert.equal(structured.yes, true);

	assert.throws(() => __toProductionForTests.toolParamsToParsed({ args: "--yes", branch: "hotfeature/COM-1/foo" }), /함께 쓰지 않습니다/);
	assert.throws(() => __toProductionForTests.toolParamsToParsed({ path: "/tmp/target" }), /새 worktree|path 옵션/);
	assert.throws(() => __toProductionForTests.toolParamsToParsed({ includeUntracked: true }), /includeUntracked|지원하지 않습니다/);
	assert.throws(() => __toProductionForTests.toolParamsToParsed({ message: "fix: dirty" }), /미커밋 diff/);
});

test("to-production treats pushed branch commits as current workspace work", async () => {
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-to-production-pushed-source-"));
	const calls: string[] = [];
	const head = "1111111111111111111111111111111111111111";
	const base = "0000000000000000000000000000000000000000";
	const parsed = __toProductionForTests.parseArgs("--branch hotfeature/COM-1/foo");
	const plan = await __toProductionForTests.buildPlan(
		{ exec: async (command: string, args: string[]) => {
			assert.equal(command, "git");
			const joined = args.join(" ");
			calls.push(joined);
			if (joined === "rev-parse --show-toplevel") return { code: 0, stdout: repoRoot };
			if (joined === "branch --show-current") return { code: 0, stdout: "feature/source\n" };
			if (joined === "rev-parse HEAD") return { code: 0, stdout: `${head}\n` };
			if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return { code: 0, stdout: "origin/feature/source\n" };
			if (joined === "status --short --branch") return { code: 0, stdout: "## feature/source...origin/feature/source\n" };
			if (joined === "status --porcelain=v1") return { code: 0, stdout: "" };
			if (joined === "diff --binary HEAD --") return { code: 0, stdout: "" };
			if (joined === "ls-files --others --exclude-standard -z") return { code: 0, stdout: "" };
			if (joined === "merge-base HEAD origin/feature/source") return { code: 0, stdout: `${head}\n` };
			if (joined === `rev-list --reverse ${head}..HEAD`) return { code: 0, stdout: "" };
			if (joined === "rev-parse --verify origin/development") return { code: 0, stdout: `${base}\n` };
			if (joined === "merge-base HEAD origin/development") return { code: 0, stdout: `${base}\n` };
			if (joined === `rev-list --reverse ${base}..HEAD`) return { code: 0, stdout: `${head}\n` };
			if (joined === `rev-list --merges ${base}..HEAD`) return { code: 0, stdout: "" };
			throw new Error(`unexpected git call: ${joined}`);
		} } as any,
		repoRoot,
		parsed,
		{ cwd: repoRoot, hasUI: false, ui: {} } as any,
	);
	assert.equal(plan.source.commitRange, `${base}..HEAD`);
	assert.equal(plan.source.commitRangeSource, "source base origin/development");
	assert.deepEqual(plan.source.commits, [head]);
	assert.equal(plan.worktreePath, repoRoot);
	assert.ok(calls.includes(`rev-list --reverse ${head}..HEAD`));
});

test("to-production allows empty clean setup and does not require a diff", async () => {
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-to-production-empty-source-"));
	const parsed = __toProductionForTests.parseArgs("--branch hotfeature/COM-1/foo");
	const plan = await __toProductionForTests.buildPlan(
		{ exec: gitMockExec(repoRoot, { emptyCommits: true }) } as any,
		repoRoot,
		parsed,
		{ cwd: repoRoot, hasUI: false, ui: {} } as any,
	);
	assert.deepEqual(plan.source.commits, []);
	assert.equal(plan.targetBranch, "hotfeature/COM-1/foo");
	assert.equal(plan.worktreePath, repoRoot);
});

test("to-production asks before handling untracked files and can keep them in the current worktree", async () => {
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-to-production-source-"));
	const calls: string[] = [];
	const parsed = __toProductionForTests.parseArgs("--branch hotfeature/COM-1/foo");
	const plan = await __toProductionForTests.buildPlan(
		{ exec: gitMockExec(repoRoot, { untrackedRaw: "scratch.txt\0", calls }) } as any,
		repoRoot,
		parsed,
		{ cwd: repoRoot, hasUI: true, ui: { select: async () => "그대로 두고 브랜치 전환" } } as any,
	);
	assert.deepEqual(plan.source.untrackedFiles, []);
	assert.deepEqual(plan.source.skippedUntrackedFiles, ["scratch.txt"]);
	assert.equal(calls.some((call) => call.startsWith("add --")), false);
});

test("to-production can commit untracked files before cherry-pick when explicitly selected", async () => {
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-to-production-source-"));
	const calls: string[] = [];
	const state = { committed: false };
	const parsed = __toProductionForTests.parseArgs("--branch hotfeature/COM-1/foo");
	const plan = await __toProductionForTests.buildPlan(
		{ exec: gitMockExec(repoRoot, { untrackedRaw: "scratch.txt\0", calls, state }) } as any,
		repoRoot,
		parsed,
		{ cwd: repoRoot, hasUI: true, ui: { select: async () => "source에 커밋 후 cherry-pick" } } as any,
	);
	assert.equal(state.committed, true);
	assert.ok(calls.includes("add -- scratch.txt"));
	assert.ok(calls.includes("commit -m chore: feature/source untracked 파일 보존 -- scratch.txt"));
	assert.equal(plan.source.committedUntrackedCommit, "4444444444444444444444444444444444444444");
	assert.deepEqual(plan.source.untrackedFiles, []);
	assert.deepEqual(plan.source.commits, ["2222222222222222222222222222222222222222", "4444444444444444444444444444444444444444"]);
});

test("to-production in-place apply switches current worktree and cherry-picks without git worktree add", async () => {
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-to-production-apply-"));
	const calls: string[] = [];
	const plan = {
		source: { repoRoot, commits: ["2222222222222222222222222222222222222222", "3333333333333333333333333333333333333333"] },
		baseRef: "origin/production",
		targetBranch: "hotfeature/COM-1/foo",
	} as any;
	const artifacts = { artifactDir: join(tmpdir(), "artifact"), backupBranch: "to-production/source-backup/source-1" } as any;
	await __toProductionForTests.applyInPlace({ exec: async (command: string, args: string[]) => {
		assert.equal(command, "git");
		calls.push(args.join(" "));
		return { code: 0, stdout: "" };
	} } as any, plan, artifacts);
	assert.deepEqual(calls, [
		"switch -c hotfeature/COM-1/foo --track origin/production",
		"cherry-pick 2222222222222222222222222222222222222222",
		"cherry-pick 3333333333333333333333333333333333333333",
	]);
	assert.equal(calls.some((call) => call.startsWith("worktree add")), false);
});

test("to-production tool stops safely in headless mode without explicit yes", async () => {
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-to-production-source-"));
	let called = false;
	const { tools } = registerFixture(async () => {
		called = true;
		throw new Error("git should not run before confirmation block");
	});
	const tool = tools.get("to_production");
	const result = await tool.execute("call-1", { branch: "hotfeature/COM-1/foo" }, undefined, undefined, {
		cwd: repoRoot,
		hasUI: false,
		ui: {},
	});
	assert.equal(called, false);
	assert.equal(result.details.status, "cancelled");
	assert.equal(result.details.mode, "in-place-branch-switch");
	assert.match(result.content[0].text, /비대화 모드에서는 --yes 없이는 실행하지 않습니다/);
	assert.match(result.content[0].text, /자동 reset\/clean\/stash는 실행하지 않았습니다/);
});

test("to-production executes clean setup in-place in a real git repo", async () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-to-production-real-"));
	const remote = join(root, "origin.git");
	const seed = join(root, "seed");
	const repo = join(root, "repo");
	git(root, ["init", "--bare", remote]);
	mkdirSync(seed);
	git(seed, ["init"]);
	git(seed, ["config", "user.email", "pilee@example.test"]);
	git(seed, ["config", "user.name", "pilee test"]);
	writeFileSync(join(seed, "README.md"), "base\n");
	git(seed, ["add", "README.md"]);
	git(seed, ["commit", "-m", "chore: base"]);
	git(seed, ["branch", "-M", "production"]);
	git(seed, ["remote", "add", "origin", remote]);
	git(seed, ["push", "-u", "origin", "production"]);
	git(root, ["clone", remote, repo]);
	git(repo, ["config", "user.email", "pilee@example.test"]);
	git(repo, ["config", "user.name", "pilee test"]);
	git(repo, ["switch", "-c", "feature/source", "origin/production"]);

	const { tools } = registerFixture(gitPiExec);
	const tool = tools.get("to_production");
	const result = await tool.execute("call-1", { branch: "hotfix/e2e", yes: true }, undefined, undefined, {
		cwd: repo,
		hasUI: false,
		ui: {},
	});

	assert.equal(result.details.status, "success");
	assert.equal(result.details.mode, "in-place-branch-switch");
	assert.equal(git(repo, ["branch", "--show-current"]).trim(), "hotfix/e2e");
	assert.equal(git(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).trim(), "origin/production");
	assert.match(result.content[0].text, /production 기반 빈 branch로 준비/);
	assert.match(git(repo, ["branch", "--list", "to-production/source-backup/*"]), /to-production\/source-backup\/source-/);
});
