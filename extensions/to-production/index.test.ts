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

function gitMockExec(repoRoot: string) {
	return async (command: string, args: string[]) => {
		assert.equal(command, "git");
		const joined = args.join(" ");
		if (joined === "rev-parse --show-toplevel") return { code: 0, stdout: repoRoot };
		if (joined === "branch --show-current") return { code: 0, stdout: "feature/source\n" };
		if (joined === "rev-parse HEAD") return { code: 0, stdout: "1111111111111111111111111111111111111111\n" };
		if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{upstream}") return { code: 0, stdout: "origin/feature/source\n" };
		if (joined === "status --short --branch") return { code: 0, stdout: "## feature/source...origin/feature/source\n" };
		if (joined === "status --porcelain=v1") return { code: 0, stdout: "" };
		if (joined === "diff --binary HEAD --") return { code: 0, stdout: "" };
		if (joined === "ls-files --others --exclude-standard -z") return { code: 0, stdout: "" };
		if (joined === "merge-base HEAD origin/feature/source") return { code: 0, stdout: "0000000000000000000000000000000000000000\n" };
		if (joined === "rev-list --reverse 0000000000000000000000000000000000000000..HEAD") return { code: 0, stdout: "2222222222222222222222222222222222222222\n" };
		if (joined === "rev-list --merges 0000000000000000000000000000000000000000..HEAD") return { code: 0, stdout: "" };
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

	const structured = __toProductionForTests.toolParamsToParsed({ range: "abc..HEAD", branch: "hotfeature/COM-1/foo", base: "production", yes: true });
	assert.equal(structured.range, "abc..HEAD");
	assert.equal(structured.branch, "hotfeature/COM-1/foo");
	assert.equal(structured.baseRef, "origin/production");
	assert.equal(structured.yes, true);

	assert.throws(() => __toProductionForTests.toolParamsToParsed({ args: "--yes", branch: "hotfeature/COM-1/foo" }), /함께 쓰지 않습니다/);
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
