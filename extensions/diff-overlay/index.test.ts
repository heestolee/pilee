import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function createWorktreeRoot(metadata: unknown): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pilee-diff-base-"));
	const piDir = join(root, ".pi");
	await mkdir(piDir, { recursive: true });
	await writeFile(
		join(piDir, "worktree-meta.json"),
		typeof metadata === "string" ? metadata : JSON.stringify(metadata),
	);
	return root;
}

async function createPrReviewRoot(overrides: Record<string, unknown> = {}): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "pilee-diff-pr-review-"));
	const piDir = join(root, ".pi");
	await mkdir(piDir, { recursive: true });
	await writeFile(join(piDir, "pr-review.json"), JSON.stringify({
		schemaVersion: 1,
		runId: "acme-repo-pr-42-head-1",
		runDir: "/tmp/pr-review/acme-repo-pr-42-head-1",
		prUrl: "https://github.com/acme/repo/pull/42",
		repository: "acme/repo",
		number: 42,
		title: "Review target",
		baseRefName: "main",
		baseSha: "a".repeat(40),
		headRefName: "feature/review",
		headSha: "b".repeat(40),
		branch: "review/pr-42-bbbbbbbb",
		worktreeName: "review-pr-42-bbbbbbbb",
		worktreePath: root,
		createdAt: 1000,
		...overrides,
	}));
	return root;
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

test("PR review workspace metadata pins /diff to the captured base and head", async () => {
	const root = await createPrReviewRoot();
	const mergeBase = "c".repeat(40);
	try {
		const { pi, calls } = mockPi((command, args) => {
			const joined = args.join(" ");
			if (command === "git" && joined === "rev-parse HEAD") return { code: 0, stdout: `${"b".repeat(40)}\n` };
			if (command === "git" && joined === `merge-base HEAD ${"a".repeat(40)}`) return { code: 0, stdout: `${mergeBase}\n` };
			throw new Error(`unexpected call: ${command} ${joined}`);
		});
		const result = await findMergeBase(pi as any, root, "review/pr-42-bbbbbbbb");
		assert.deepEqual(result, { commit: mergeBase, baseBranch: "main", baseSource: "PR #42 review workspace" });
		assert.equal(calls.some((call) => call.command === "gh"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("PR review workspace refuses /diff when HEAD drifted", async () => {
	const root = await createPrReviewRoot();
	try {
		const { pi, calls } = mockPi((command, args) => {
			if (command === "git" && args.join(" ") === "rev-parse HEAD") return { code: 0, stdout: `${"d".repeat(40)}\n` };
			throw new Error(`unexpected call: ${command} ${args.join(" ")}`);
		});
		await assert.rejects(() => findMergeBase(pi as any, root, "review/pr-42-bbbbbbbb"), /review workspace가 stale합니다/);
		assert.equal(calls.some((call) => call.args[0] === "merge-base"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
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

test("open pull request base wins over worktree metadata", async () => {
	const root = await createWorktreeRoot({
		branch: "feature/activation",
		baseBranch: "feature/local-foundation",
	});
	const mergeBase = "f".repeat(40);
	try {
		const { pi, calls } = mockPi((command, args) => {
			const joined = args.join(" ");
			if (command === "gh" && joined === "pr view feature/activation --json number,baseRefName") {
				return { code: 0, stdout: JSON.stringify({ number: 4572, baseRefName: "feature/pr-foundation" }) };
			}
			if (command === "git" && joined === "merge-base HEAD origin/feature/pr-foundation") {
				return { code: 0, stdout: `${mergeBase}\n` };
			}
			throw new Error(`unexpected call: ${command} ${joined}`);
		});

		const result = await findMergeBase(pi as any, root, "feature/activation");
		assert.deepEqual(result, { commit: mergeBase, baseBranch: "feature/pr-foundation", baseSource: "PR #4572" });
		assert.equal(calls.some((call) => call.args.includes("feature/local-foundation")), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("matching worktree metadata base wins over origin HEAD when no pull request exists", async () => {
	const root = await createWorktreeRoot({
		branch: "feature/activation",
		baseBranch: "feature/foundation",
	});
	const mergeBase = "1".repeat(40);
	try {
		const { pi, calls } = mockPi((command, args) => {
			const joined = args.join(" ");
			if (command === "gh") return { code: 1, stderr: "no pull requests found" };
			if (command === "git" && joined === "merge-base HEAD origin/feature/foundation") return { code: 1 };
			if (command === "git" && joined === "merge-base HEAD feature/foundation") {
				return { code: 0, stdout: `${mergeBase}\n` };
			}
			throw new Error(`unexpected call: ${command} ${joined}`);
		});

		const result = await findMergeBase(pi as any, root, "feature/activation");
		assert.deepEqual(result, {
			commit: mergeBase,
			baseBranch: "feature/foundation",
			baseSource: "worktree metadata",
		});
		assert.equal(calls.some((call) => call.args[0] === "symbolic-ref"), false);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("stale or malformed worktree metadata falls back to origin HEAD", async () => {
	for (const metadata of [
		{ branch: "feature/old-name", baseBranch: "feature/foundation" },
		"{ malformed",
	]) {
		const root = await createWorktreeRoot(metadata);
		const mergeBase = "2".repeat(40);
		try {
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

			const result = await findMergeBase(pi as any, root, "feature/activation");
			assert.deepEqual(result, { commit: mergeBase, baseBranch: "development", baseSource: "origin/HEAD" });
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	}
});

test("unresolvable worktree metadata base falls back to origin HEAD", async () => {
	const root = await createWorktreeRoot({
		branch: "feature/activation",
		baseBranch: "feature/deleted-foundation",
	});
	const mergeBase = "3".repeat(40);
	try {
		const { pi } = mockPi((command, args) => {
			const joined = args.join(" ");
			if (command === "gh") return { code: 1, stderr: "no pull requests found" };
			if (command === "git" && joined === "merge-base HEAD origin/feature/deleted-foundation") return { code: 1 };
			if (command === "git" && joined === "merge-base HEAD feature/deleted-foundation") return { code: 1 };
			if (command === "git" && joined === "symbolic-ref refs/remotes/origin/HEAD --short") {
				return { code: 0, stdout: "origin/development\n" };
			}
			if (command === "git" && joined === "merge-base HEAD origin/development") {
				return { code: 0, stdout: `${mergeBase}\n` };
			}
			throw new Error(`unexpected call: ${command} ${joined}`);
		});

		const result = await findMergeBase(pi as any, root, "feature/activation");
		assert.deepEqual(result, { commit: mergeBase, baseBranch: "development", baseSource: "origin/HEAD" });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
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
