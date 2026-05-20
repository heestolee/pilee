import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import toProduction, { __toProductionForTests } from "./index.ts";

function registerFixture(exec?: (command: string, args: string[]) => Promise<{ code: number; stdout?: string; stderr?: string }>) {
	const commands = new Map<string, any>();
	const tools = new Map<string, any>();
	const pi = {
		async exec(command: string, args: string[]) {
			if (!exec) throw new Error(`unexpected exec call: ${command} ${args.join(" ")}`);
			return exec(command, args);
		},
		registerCommand(name: string, command: any) { commands.set(name, command); },
		registerTool(tool: any) { tools.set(tool.name, tool); },
	};
	toProduction(pi as any);
	return { commands, tools };
}

function gitMockExec(repoRoot: string, options: { untrackedRaw?: string; calls?: string[]; state?: { committed?: boolean } } = {}) {
	return async (command: string, args: string[]) => {
		assert.equal(command, "git");
		const joined = args.join(" ");
		options.calls?.push(joined);
		if (joined === "rev-parse --show-toplevel") return { code: 0, stdout: repoRoot };
		if (joined === "branch --show-current") return { code: 0, stdout: "feature/source\n" };
		if (joined === "rev-parse HEAD") return { code: 0, stdout: options.state?.committed ? "4444444444444444444444444444444444444444\n" : "1111111111111111111111111111111111111111\n" };
		if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return { code: 0, stdout: "origin/feature/source\n" };
		if (joined === "status --short --branch") return { code: 0, stdout: "## feature/source...origin/feature/source\n" };
		if (joined === "status --porcelain=v1") return { code: 0, stdout: "" };
		if (joined === "diff --binary HEAD --") return { code: 0, stdout: "" };
		if (joined === "ls-files --others --exclude-standard -z") return { code: 0, stdout: options.state?.committed ? "" : (options.untrackedRaw ?? "") };
		if (joined === "merge-base HEAD origin/feature/source") return { code: 0, stdout: "0000000000000000000000000000000000000000\n" };
		if (joined === "rev-list --reverse 0000000000000000000000000000000000000000..HEAD") return { code: 0, stdout: options.state?.committed ? "2222222222222222222222222222222222222222\n4444444444444444444444444444444444444444\n" : "2222222222222222222222222222222222222222\n" };
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

test("to-production registers a dedicated natural-language tool bridge", () => {
	const { commands, tools } = registerFixture();
	assert.ok(commands.has("to-production"));
	const tool = tools.get("to_production");
	assert.ok(tool);
	assert.match(tool.promptSnippet, /자연어|natural-language|to-production/);
	assert.match(tool.promptGuidelines.join("\n"), /instead of worktree_fork, worktree_create/);
	assert.match(tool.promptGuidelines.join("\n"), /standalone \/to-production/);
});

test("to-production tool parses raw args or structured params but not both", () => {
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
	assert.throws(() => __toProductionForTests.toolParamsToParsed({ includeUntracked: true, untrackedMode: "skip" }), /충돌/);
});

test("to-production asks before handling untracked files and can skip them", async () => {
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-to-production-source-"));
	const calls: string[] = [];
	const parsed = __toProductionForTests.parseArgs("--branch hotfeature/COM-1/foo");
	const plan = await __toProductionForTests.buildPlan(
		{ exec: gitMockExec(repoRoot, { untrackedRaw: "scratch.txt\0", calls }) } as any,
		repoRoot,
		parsed,
		{ cwd: repoRoot, hasUI: true, ui: { select: async () => "이번 이식에서 제외하고 진행" } } as any,
	);
	assert.deepEqual(plan.source.untrackedFiles, []);
	assert.deepEqual(plan.source.skippedUntrackedFiles, ["scratch.txt"]);
	assert.equal(plan.includeUntracked, false);
	assert.equal(calls.some((call) => call.startsWith("add --")), false);
});

test("to-production can commit untracked files in source when explicitly selected", async () => {
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-to-production-source-"));
	const calls: string[] = [];
	const state = { committed: false };
	const parsed = __toProductionForTests.parseArgs("--branch hotfeature/COM-1/foo");
	const plan = await __toProductionForTests.buildPlan(
		{ exec: gitMockExec(repoRoot, { untrackedRaw: "scratch.txt\0", calls, state }) } as any,
		repoRoot,
		parsed,
		{ cwd: repoRoot, hasUI: true, ui: { select: async () => "source에 커밋 후 진행" } } as any,
	);
	assert.equal(state.committed, true);
	assert.ok(calls.includes("add -- scratch.txt"));
	assert.ok(calls.includes("commit -m chore: feature/source untracked 파일 보존 -- scratch.txt"));
	assert.equal(plan.source.committedUntrackedCommit, "4444444444444444444444444444444444444444");
	assert.deepEqual(plan.source.untrackedFiles, []);
	assert.deepEqual(plan.source.commits, ["2222222222222222222222222222222222222222", "4444444444444444444444444444444444444444"]);
});

test("to-production tool stops safely in headless mode without explicit yes", async () => {
	const repoRoot = mkdtempSync(join(tmpdir(), "pilee-to-production-source-"));
	const { tools } = registerFixture(gitMockExec(repoRoot));
	const tool = tools.get("to_production");
	const targetPath = join(tmpdir(), `pilee-to-production-target-${Date.now()}`);
	const result = await tool.execute("call-1", { branch: "hotfeature/COM-1/foo", path: targetPath }, undefined, undefined, {
		cwd: repoRoot,
		hasUI: false,
		ui: {},
	});
	assert.equal(result.details.blocked, true);
	assert.match(result.content[0].text, /비대화 모드에서는 --yes 없이는 실행하지 않습니다/);
	assert.match(result.content[0].text, /source worktree에는 checkout\/stash\/reset\/clean을 실행하지 않았습니다/);
});
