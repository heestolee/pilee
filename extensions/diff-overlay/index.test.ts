import assert from "node:assert/strict";
import test from "node:test";
import { findMergeBase, formatDiffComparison, parseDiffArgs } from "./index.ts";

type ExecResult = { code: number; stdout?: string; stderr?: string };
type ExecCall = { command: string; args: string[]; cwd?: string };

function mockPi(handler: (command: string, args: string[]) => ExecResult | Promise<ExecResult>) {
	const calls: ExecCall[] = [];
	const pi = {
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => {
			calls.push({ command, args, cwd: options.cwd });
			return await handler(command, args);
		},
	};
	return { pi, calls };
}

test("parseDiffArgs supports PR auto mode and explicit base override", () => {
	assert.deepEqual(parseDiffArgs(""), { help: false, baseBranch: null });
	assert.deepEqual(parseDiffArgs("--base feature/foundation"), { help: false, baseBranch: "feature/foundation" });
	assert.deepEqual(parseDiffArgs("--base=origin/production"), { help: false, baseBranch: "origin/production" });
	assert.deepEqual(parseDiffArgs("--help"), { help: true, baseBranch: null });
	assert.deepEqual(parseDiffArgs("--base"), { error: "--base 뒤에 유효한 branch를 입력하세요." });
	assert.deepEqual(parseDiffArgs("--base --help"), { error: "--base 뒤에 유효한 branch를 입력하세요." });
	assert.deepEqual(parseDiffArgs("development"), { error: "지원하지 않는 인자입니다: development" });
});

test("formatDiffComparison exposes base, head, and resolution source", () => {
	assert.equal(
		formatDiffComparison("feature/activation", "feature/foundation", "PR #4572"),
		"feature/foundation...feature/activation · PR #4572",
	);
	assert.equal(formatDiffComparison("development", null, null), "development");
});

test("explicit --base overrides pull request lookup", async () => {
	const mergeBase = "a".repeat(40);
	const { pi, calls } = mockPi((command, args) => {
		if (command === "git" && args.join(" ") === "merge-base HEAD origin/release") {
			return { code: 0, stdout: `${mergeBase}\n` };
		}
		throw new Error(`unexpected call: ${command} ${args.join(" ")}`);
	});

	const result = await findMergeBase(pi as any, "/repo", "feature/activation", "release");
	assert.deepEqual(result, { commit: mergeBase, baseBranch: "release", baseSource: "--base" });
	assert.equal(calls.some((call) => call.command === "gh"), false);
});

test("open pull request base wins over origin HEAD", async () => {
	const mergeBase = "b".repeat(40);
	const { pi, calls } = mockPi((command, args) => {
		const joined = args.join(" ");
		if (command === "gh" && joined === "pr view feature/activation --json number,baseRefName") {
			return { code: 0, stdout: JSON.stringify({ number: 4572, baseRefName: "feature/foundation" }) };
		}
		if (command === "git" && joined === "merge-base HEAD origin/feature/foundation") {
			return { code: 0, stdout: `${mergeBase}\n` };
		}
		throw new Error(`unexpected call: ${command} ${joined}`);
	});

	const result = await findMergeBase(pi as any, "/repo", "feature/activation");
	assert.deepEqual(result, { commit: mergeBase, baseBranch: "feature/foundation", baseSource: "PR #4572" });
	assert.equal(calls.some((call) => call.args[0] === "symbolic-ref"), false);
});

test("unresolvable pull request base never falls back to the default branch", async () => {
	const { pi, calls } = mockPi((command, args) => {
		const joined = args.join(" ");
		if (command === "gh" && joined === "pr view feature/activation --json number,baseRefName") {
			return { code: 0, stdout: JSON.stringify({ number: 4572, baseRefName: "feature/foundation" }) };
		}
		if (command === "git" && joined === "merge-base HEAD origin/feature/foundation") return { code: 1 };
		throw new Error(`unexpected call: ${command} ${joined}`);
	});

	await assert.rejects(
		() => findMergeBase(pi as any, "/repo", "feature/activation"),
		/PR #4572의 base branch를 로컬에서 찾을 수 없습니다/,
	);
	assert.equal(calls.some((call) => call.args[0] === "symbolic-ref"), false);
});

test("hotfix branch uses production when no pull request exists", async () => {
	const mergeBase = "c".repeat(40);
	const { pi } = mockPi((command, args) => {
		const joined = args.join(" ");
		if (command === "gh") return { code: 1, stderr: "no pull requests found" };
		if (command === "git" && joined === "merge-base HEAD origin/production") {
			return { code: 0, stdout: `${mergeBase}\n` };
		}
		throw new Error(`unexpected call: ${command} ${joined}`);
	});

	const result = await findMergeBase(pi as any, "/repo", "hotfix/fix-reservation");
	assert.deepEqual(result, { commit: mergeBase, baseBranch: "production", baseSource: "hotfix/hotfeature" });
});

test("pull request lookup still wins when the head branch has a default-branch name", async () => {
	const mergeBase = "e".repeat(40);
	const { pi } = mockPi((command, args) => {
		const joined = args.join(" ");
		if (command === "gh" && joined === "pr view development --json number,baseRefName") {
			return { code: 0, stdout: JSON.stringify({ number: 99, baseRefName: "release" }) };
		}
		if (command === "git" && joined === "merge-base HEAD origin/release") {
			return { code: 0, stdout: `${mergeBase}\n` };
		}
		throw new Error(`unexpected call: ${command} ${joined}`);
	});

	const result = await findMergeBase(pi as any, "/repo", "development");
	assert.deepEqual(result, { commit: mergeBase, baseBranch: "release", baseSource: "PR #99" });
});

test("ordinary branch falls back to origin HEAD when no pull request exists", async () => {
	const mergeBase = "d".repeat(40);
	const { pi } = mockPi((command, args) => {
		const joined = args.join(" ");
		if (command === "gh") return { code: 1, stderr: "no pull requests found" };
		if (command === "git" && joined === "symbolic-ref refs/remotes/origin/HEAD --short") {
			return { code: 0, stdout: "origin/development\n" };
		}
		if (command === "git" && joined === "merge-base HEAD origin/development") {
			return { code: 0, stdout: `${mergeBase}\n` };
		}
		throw new Error(`unexpected call: ${command} ${joined}`);
	});

	const result = await findMergeBase(pi as any, "/repo", "feature/no-pr-yet");
	assert.deepEqual(result, { commit: mergeBase, baseBranch: "development", baseSource: "origin/HEAD" });
});
