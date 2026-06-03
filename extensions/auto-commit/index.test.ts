import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import autoCommit, { assertLogicalAtomGate, buildLogicalAtomGateReport, evaluateLogicalAtomGate, extractGitIndexLockPath, formatResult, shouldRemoveStaleIndexLockAfterLsof } from "./index.ts";

test("extractGitIndexLockPath reads git index.lock errors", () => {
	const stderr = "fatal: Unable to create '/repo/.git/worktrees/foo/index.lock': File exists.";
	assert.equal(extractGitIndexLockPath(stderr), "/repo/.git/worktrees/foo/index.lock");
});

test("extractGitIndexLockPath returns undefined for unrelated git errors", () => {
	assert.equal(extractGitIndexLockPath("fatal: not a git repository"), undefined);
});

test("shouldRemoveStaleIndexLockAfterLsof removes only when owner check is clean", () => {
	assert.equal(shouldRemoveStaleIndexLockAfterLsof({ code: 1, stdout: "", stderr: "" }), true);
	assert.equal(shouldRemoveStaleIndexLockAfterLsof({ code: 0, stdout: "COMMAND  PID USER\nGit 123 me", stderr: "" }), false);
	assert.equal(shouldRemoveStaleIndexLockAfterLsof({ code: 127, stdout: "", stderr: "lsof: command not found" }), false);
});

test("logical atom gate warns for small same-cluster three-primary changes", () => {
	const result = evaluateLogicalAtomGate({
		commits: [{
			message: "feat: 작은 fan-out",
			paths: ["extensions/auto-commit/a.ts", "extensions/auto-commit/b.ts", "extensions/auto-commit/c.ts"],
		}],
	}, [[
		{ path: "extensions/auto-commit/a.ts", additions: 3, deletions: 0, changedLines: 3 },
		{ path: "extensions/auto-commit/b.ts", additions: 4, deletions: 0, changedLines: 4 },
		{ path: "extensions/auto-commit/c.ts", additions: 5, deletions: 0, changedLines: 5 },
	]]);

	assert.equal(result.decision, "warn");
	assert.equal(result.blocks.length, 0);
	assert.match(result.warnings.join("\n"), /3 primary paths/);
});

test("logical atom gate blocks large single-file diff", () => {
	const report = buildLogicalAtomGateReport({
		commits: [{
			message: "feat: 큰 단일 파일 변경",
			paths: ["extensions/auto-commit/index.ts"],
		}],
	}, [[{ path: "extensions/auto-commit/index.ts", additions: 1000, deletions: 0, changedLines: 1000 }]]);

	assert.match(report ?? "", /logical atom gate blocked/);
	assert.match(report ?? "", /single primary diff 1000 lines/);
	assert.throws(() => assertLogicalAtomGate({ commits: [{ message: "feat: too large", paths: ["a.ts"] }] }, [[{ path: "a.ts", additions: 1000, deletions: 0, changedLines: 1000 }]]), /logical atom gate blocked/);
});

test("logical atom gate allows primary path with companion files", () => {
	assert.doesNotThrow(() => assertLogicalAtomGate({
		commits: [{
			message: "feat: 온라인 쿠폰 태그 컴포넌트 추가",
			paths: [
				"frontend/apps/web/domain/travel/subdomain/spot/SpotThumbnailCard/parts/SpotThumbnailTags.tsx",
				"frontend/apps/web/domain/travel/subdomain/spot/SpotThumbnailCard/parts/SpotThumbnailTags.test.tsx",
				"frontend/apps/web/domain/travel/subdomain/spot/SpotThumbnailCard/parts/__generated__/SpotThumbnailTags.generated.ts",
				"frontend/apps/admin/src/graphql/generated.tsx",
				"frontend/schema.graphql",
				"package.json",
			],
		}],
	}));
});

test("formatResult makes unpushed commits explicit", () => {
	const output = formatResult({
		mode: "quick",
		commits: [{ hash: "abc123", message: "fix: 문구 수정", paths: ["a.tsx"] }],
		leftovers: [],
		pushed: false,
		completion: "committed_not_pushed",
		push: { status: "skipped_no_safe_target", requested: true, policy: "push-if-tracking", error: "safe push target was not detected" },
	} as any);

	assert.match(output, /status: committed_not_pushed/);
	assert.match(output, /push: skipped_no_safe_target/);
	assert.match(output, /지금 바로 push/);
});

test("formatResult reports committed_and_pushed when push succeeds", () => {
	const output = formatResult({
		mode: "apply",
		commits: [{ hash: "def456", message: "fix: 테스트", paths: ["b.ts"] }],
		leftovers: [],
		pushed: true,
		completion: "committed_and_pushed",
		push: { status: "done", requested: true, policy: "push-if-tracking", remote: "origin", branch: "feature/test" },
	} as any);

	assert.match(output, /status: committed_and_pushed/);
	assert.match(output, /push: done origin\/feature\/test/);
	assert.doesNotMatch(output, /next:/);
});

function exec(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { cwd });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

async function git(cwd: string, ...args: string[]) {
	const result = await exec("git", args, cwd);
	if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed\n${result.stderr}\n${result.stdout}`);
	return result.stdout;
}

test("action=status reports commit readiness and ship caveats", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-status-"));
	const repo = join(root, "repo");
	await git(root, "init", "-b", "main", repo);
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test User");
	await writeFile(join(repo, "README.md"), "init\n");
	await git(repo, "add", "README.md");
	await git(repo, "commit", "-m", "chore: init");
	await git(repo, "checkout", "-b", "feature/test");
	await exec("mkdir", ["-p", "backend/apps/trip/migrations", "frontend/apps/admin/src", "frontend/apps/web/domain"], repo);
	await writeFile(join(repo, "backend/apps/trip/migrations/20260527042440-add.js"), "module.exports = {};\n");
	await writeFile(join(repo, "frontend/apps/admin/src/view.tsx"), "export const x = 1;\n");
	await writeFile(join(repo, "frontend/apps/web/domain/view.tsx"), "export const y = 1;\n");
	await writeFile(join(repo, "frontend/schema.graphql"), "type Query { id: ID }\n");

	const tools: Record<string, any> = {};
	autoCommit({
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => exec(command, args, options.cwd ?? repo),
		registerCommand: () => undefined,
		registerTool: (tool: any) => { tools[tool.name] = tool; },
	} as any);

	const result = await tools.auto_commit.execute("call-status", { action: "status" }, new AbortController().signal, () => undefined, { cwd: repo });
	const text = result.content[0].text;
	assert.match(text, /commit readiness: READY_WITH_CAVEATS/);
	assert.match(text, /ship readiness: BLOCKED_BY_CAVEATS/);
	assert.match(text, /split recommendation: RECOMMENDED/);
	assert.match(text, /migration\/DB schema execution may still be pending/);
	assert.match(text, /pending UI capture\/verify-report is a ship evidence caveat/);
});

test("action=quick blocks layer-mixed logical atom plans before commit", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-layer-block-"));
	const repo = join(root, "repo");
	await git(root, "init", "-b", "main", repo);
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test User");
	await writeFile(join(repo, "README.md"), "init\n");
	await git(repo, "add", "README.md");
	await git(repo, "commit", "-m", "chore: init");
	await exec("mkdir", ["-p", "backend/apps/trip/src", "frontend/apps/web/domain", "scripts"], repo);
	await writeFile(join(repo, "backend/apps/trip/src/a.ts"), "export const a = 1;\n");
	await writeFile(join(repo, "frontend/apps/web/domain/b.ts"), "export const b = 1;\n");
	await writeFile(join(repo, "scripts/c.ts"), "export const c = 1;\n");

	const tools: Record<string, any> = {};
	autoCommit({
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => exec(command, args, options.cwd ?? repo),
		registerCommand: () => undefined,
		registerTool: (tool: any) => { tools[tool.name] = tool; },
	} as any);

	await assert.rejects(() => tools.auto_commit.execute("call-quick-layer-mixed", {
		action: "quick",
		message: "feat: too broad",
		paths: ["backend/apps/trip/src/a.ts", "frontend/apps/web/domain/b.ts", "scripts/c.ts"],
	}, new AbortController().signal, () => undefined, { cwd: repo }), /layer-mixed primary paths/);
	assert.equal((await git(repo, "rev-list", "--count", "HEAD")).trim(), "1");
});

test("action=quick allows warning-only same-cluster fanout and reports warning", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-warn-allow-"));
	const repo = join(root, "repo");
	await git(root, "init", "-b", "main", repo);
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test User");
	await writeFile(join(repo, "README.md"), "init\n");
	await git(repo, "add", "README.md");
	await git(repo, "commit", "-m", "chore: init");
	await exec("mkdir", ["-p", "extensions/auto-commit"], repo);
	await writeFile(join(repo, "extensions/auto-commit/a.ts"), "export const a = 1;\n");
	await writeFile(join(repo, "extensions/auto-commit/b.ts"), "export const b = 1;\n");
	await writeFile(join(repo, "extensions/auto-commit/c.ts"), "export const c = 1;\n");

	const tools: Record<string, any> = {};
	autoCommit({
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => exec(command, args, options.cwd ?? repo),
		registerCommand: () => undefined,
		registerTool: (tool: any) => { tools[tool.name] = tool; },
	} as any);

	const result = await tools.auto_commit.execute("call-quick-warning", {
		action: "quick",
		message: "feat: 작은 fan-out",
		paths: ["extensions/auto-commit/a.ts", "extensions/auto-commit/b.ts", "extensions/auto-commit/c.ts"],
		pushPolicy: "commit-only",
	}, new AbortController().signal, () => undefined, { cwd: repo });

	assert.match(result.content[0].text, /warnings:/);
	assert.match(result.content[0].text, /3 primary paths/);
	assert.equal((await git(repo, "rev-list", "--count", "HEAD")).trim(), "2");
});

test("action=quick commits explicit paths and pushes to safe upstream", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-quick-"));
	const repo = join(root, "repo");
	const remote = join(root, "origin.git");
	await git(root, "init", "--bare", remote);
	await git(root, "init", "-b", "main", repo);
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test User");
	await writeFile(join(repo, "README.md"), "init\n");
	await git(repo, "add", "README.md");
	await git(repo, "commit", "-m", "chore: init");
	await git(repo, "remote", "add", "origin", remote);
	await git(repo, "checkout", "-b", "feature/test");
	await git(repo, "push", "-u", "origin", "feature/test");
	await writeFile(join(repo, "copy.txt"), "changed\n");

	const tools: Record<string, any> = {};
	autoCommit({
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => exec(command, args, options.cwd ?? repo),
		registerCommand: () => undefined,
		registerTool: (tool: any) => { tools[tool.name] = tool; },
	} as any);

	const result = await tools.auto_commit.execute("call-1", {
		action: "quick",
		message: "fix: 문구 수정",
		paths: ["copy.txt"],
	}, new AbortController().signal, () => undefined, { cwd: repo });

	assert.match(result.content[0].text, /status: committed_and_pushed/);
	assert.equal(result.details.completion, "committed_and_pushed");
	assert.equal(result.details.push.status, "done");
	assert.equal((await git(repo, "status", "--porcelain")).trim(), "");
	const localHead = (await git(repo, "rev-parse", "HEAD")).trim();
	const remoteHead = (await git(repo, "rev-parse", "origin/feature/test")).trim();
	assert.equal(localHead, remoteHead);
});
