import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	asAddedFileDiff,
	buildAddedFileDiff,
	buildCommitMessageLines,
	buildCommitRowsMeta,
	commitPanelViewport,
	findMergeBase,
	formatDiffComparison,
	isCommitMessageToggleShortcut,
	isStashShortcut,
	loadCommitMessageForHash,
	loadDiffTotalsByScope,
	parseDiffArgs,
	parseFileDiffTotals,
	parseNumstatEntriesZ,
	parseNumstatTotals,
	renderCommitFiles,
} from "./index.ts";

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

test("stash and commit-message shortcuts keep separate keys", () => {
	assert.equal(isStashShortcut("s"), false);
	assert.equal(isStashShortcut("S"), true);
	assert.equal(isCommitMessageToggleShortcut("m"), true);
	assert.equal(isCommitMessageToggleShortcut("M"), false);
});

test("commit message lines preserve paragraphs and bullets while wrapping to pane width", () => {
	const lines = buildCommitMessageLines([
		"fix: keep the full commit message visible",
		"",
		"The controller returned 500 after handling the mismatch, so the provider retried the webhook.",
		"- preserve retries for \u001b[31mother errors\u001b[0m",
		"- keep Sentry visibility\u0000",
	].join("\n"), 34);

	assert.equal(lines.includes(""), true);
	assert.equal(lines.some((line) => line.includes("preserve retries")), true);
	assert.equal(lines.some((line) => line.includes("keep Sentry")), true);
	assert.equal(lines.every((line) => line.length <= 34), true);
	assert.equal(lines.some((line) => /[\u0000\u001b]/u.test(line)), false);
	assert.deepEqual(buildCommitMessageLines("", 34), []);
});

test("commit row metadata offsets files below the message section", () => {
	const files = [{
		path: "src/a.ts",
		status: "modified",
		rawStatus: "M",
		previousPath: null,
		diffTotals: { additions: 2, deletions: 1, binaryFiles: 0 },
	}] as any;
	const meta = buildCommitRowsMeta(files, "abc123", new Set(), new Map(), 7);
	assert.deepEqual(meta.fileStarts, [7]);
	assert.deepEqual(meta.fileEnds, [7]);
	assert.equal(meta.totalRows, 8);
});

test("commit message loader reads the complete percent-B body", async () => {
	const { pi, calls } = mockPi((command, args) => {
		if (command === "git" && args.join(" ") === "show --no-patch --no-color --format=%B abc123") {
			return { code: 0, stdout: "fix: full subject\n\nCause paragraph.\n\nRefs: https://example.com/review\n" };
		}
		throw new Error(`unexpected call: ${command} ${args.join(" ")}`);
	});
	assert.equal(
		await loadCommitMessageForHash(pi as any, "/repo", "abc123"),
		"fix: full subject\n\nCause paragraph.\n\nRefs: https://example.com/review",
	);
	assert.equal(calls[0]?.cwd, "/repo");
});

test("commit details render the full message before files on one scroll surface", () => {
	const commit = { hash: "abc123", shortHash: "abc123", author: "author", relativeDate: "1h", subject: "fix: full subject" };
	const file = {
		path: "src/a.ts",
		status: "modified",
		rawStatus: "M",
		previousPath: null,
		diffTotals: { additions: 2, deletions: 1, binaryFiles: 0 },
	};
	const state = {
		commits: [commit],
		commitSelectedIndex: 0,
		commitFilesCache: new Map([[commit.hash, [file]]]),
		commitFilesLoading: new Set(),
		commitMessageCache: new Map([[commit.hash, "fix: full subject\n\nCause paragraph.\nDecision paragraph."]]),
		commitMessageLoading: new Set(),
		commitMessageExpanded: true,
		commitExpandedByHash: new Map(),
		commitFileDiffCache: new Map(),
		commitFileDiffLoading: new Set(),
		commitFileSelectedIndex: 0,
		commitFileScrollOffset: 0,
		commitFileManualScroll: true,
		focus: "left",
		reviewDrafts: [],
		wrapLines: true,
	} as any;
	const theme = {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
	} as any;

	const top = renderCommitFiles(theme, state, 80, 4).join("\n");
	assert.match(top, /fix: full subject/u);
	assert.doesNotMatch(top, /CHANGED FILES/u);

	state.commitFileScrollOffset = commitPanelViewport(7, 4).maxOffset;
	const bottom = renderCommitFiles(theme, state, 80, 4).join("\n");
	assert.match(bottom, /CHANGED FILES/u);
	assert.match(bottom, /src\/a\.ts/u);

	state.commitMessageExpanded = false;
	state.commitFileScrollOffset = 0;
	const collapsed = renderCommitFiles(theme, state, 80, 4).join("\n");
	assert.match(collapsed, /^ CHANGED FILES/u);
	assert.doesNotMatch(collapsed, /fix: full subject/u);
});

test("commit panel reserves an indicator row without hiding the final content row", () => {
	assert.deepEqual(commitPanelViewport(7, 4), { contentHeight: 3, maxOffset: 4, showIndicator: true });
	assert.deepEqual(commitPanelViewport(3, 4), { contentHeight: 4, maxOffset: 0, showIndicator: false });
});

test("file diff totals count hunk additions and deletions without metadata", () => {
	const rawDiff = [
		"diff --git a/file.ts b/file.ts",
		"index 1111111..2222222 100644",
		"--- a/file.ts",
		"+++ b/file.ts",
		"@@ -1,2 +1,3 @@",
		"-old",
		"+new",
		"+extra",
		" context",
	].join("\n");
	assert.deepEqual(parseFileDiffTotals(rawDiff), { additions: 2, deletions: 1, binaryFiles: 0 });
	assert.deepEqual(parseFileDiffTotals("Binary files a/image.png and b/image.png differ"), {
		additions: 0,
		deletions: 0,
		binaryFiles: 1,
	});
});

test("added file diff does not invent a trailing blank addition", () => {
	const rawDiff = buildAddedFileDiff("one\ntwo\n");
	assert.equal(rawDiff, "+ one\n+ two");
	assert.deepEqual(parseFileDiffTotals(rawDiff), { additions: 2, deletions: 0, binaryFiles: 0 });
	assert.equal(buildAddedFileDiff(""), "");
});

test("untracked binary files use git diff metadata instead of cat output", async () => {
	const { pi, calls } = mockPi((command, args) => {
		if (command === "git" && args.join(" ") === "diff --no-ext-diff --no-index --no-color -- /dev/null image.png") {
			return { code: 1, stdout: "Binary files /dev/null and image.png differ\n" };
		}
		throw new Error(`unexpected call: ${command} ${args.join(" ")}`);
	});
	const rawDiff = await asAddedFileDiff(pi as any, "/repo", "image.png");
	assert.equal(rawDiff, "Binary files /dev/null and image.png differ");
	assert.deepEqual(parseFileDiffTotals(rawDiff), { additions: 0, deletions: 0, binaryFiles: 1 });
	assert.equal(calls.some((call) => call.command === "cat"), false);
});

test("parseNumstatTotals sums text lines and tracks binary files", () => {
	assert.deepEqual(
		parseNumstatTotals([
			"12\t3\tsrc/a.ts",
			"-\t-\tpublic/image.png",
			"0\t0\told.ts => new.ts",
			"invalid",
			"4\tx\tbroken.txt",
		].join("\n")),
		{ additions: 12, deletions: 3, binaryFiles: 1 },
	);
});

test("zero-terminated numstat keeps per-file totals and rename destination", () => {
	const stdout = [
		"2\t1\tsrc/file.ts",
		"-\t-\tpublic/image.png",
		"0\t0\t",
		"src/old.ts",
		"src/new.ts",
		"",
	].join("\0");
	assert.deepEqual(parseNumstatEntriesZ(stdout), [
		{ path: "src/file.ts", previousPath: null, additions: 2, deletions: 1, binaryFiles: 0 },
		{ path: "public/image.png", previousPath: null, additions: 0, deletions: 0, binaryFiles: 1 },
		{ path: "src/new.ts", previousPath: "src/old.ts", additions: 0, deletions: 0, binaryFiles: 0 },
	]);
});

test("diff totals include untracked files in branch and working scopes", async () => {
	const { pi } = mockPi((command, args) => {
		const joined = args.join(" ");
		if (command === "git" && joined === "rev-parse --verify HEAD") return { code: 0 };
		if (command === "git" && joined === "diff --no-ext-diff --numstat base123") {
			return { code: 0, stdout: "10\t2\ttracked.ts\n-\t-\timage.png\n" };
		}
		if (command === "git" && joined === "diff --no-ext-diff --numstat HEAD") {
			return { code: 0, stdout: "3\t1\tworking.ts\n" };
		}
		if (command === "git" && joined === "show --no-ext-diff --numstat --format= HEAD") {
			return { code: 0, stdout: "7\t4\tcommitted.ts\n" };
		}
		if (command === "git" && joined === "diff --no-ext-diff --numstat --no-index -- /dev/null new.txt") {
			return { code: 1, stdout: "5\t0\t/dev/null => new.txt\n" };
		}
		if (command === "git" && joined === "diff --no-ext-diff --numstat --no-index -- /dev/null new.bin") {
			return { code: 1, stdout: "-\t-\t/dev/null => new.bin\n" };
		}
		throw new Error(`unexpected call: ${command} ${joined}`);
	});

	assert.deepEqual(await loadDiffTotalsByScope(pi as any, "/repo", "base123", ["new.txt", "new.bin", "new.txt"]), {
		branch: { additions: 15, deletions: 2, binaryFiles: 2 },
		working: { additions: 8, deletions: 1, binaryFiles: 1 },
		"last-commit": { additions: 7, deletions: 4, binaryFiles: 0 },
	});
});

test("branch totals reuse working totals when no merge base exists", async () => {
	const { pi, calls } = mockPi((command, args) => {
		const joined = args.join(" ");
		if (command === "git" && joined === "rev-parse --verify HEAD") return { code: 0 };
		if (command === "git" && joined === "diff --no-ext-diff --numstat HEAD") {
			return { code: 0, stdout: "2\t1\tworking.ts\n" };
		}
		if (command === "git" && joined === "show --no-ext-diff --numstat --format= HEAD") {
			return { code: 0, stdout: "1\t1\tcommitted.ts\n" };
		}
		throw new Error(`unexpected call: ${command} ${joined}`);
	});

	const totals = await loadDiffTotalsByScope(pi as any, "/repo", null, []);
	assert.deepEqual(totals.branch, { additions: 2, deletions: 1, binaryFiles: 0 });
	assert.deepEqual(totals.working, totals.branch);
	assert.equal(calls.filter((call) => call.args.join(" ") === "diff --no-ext-diff --numstat HEAD").length, 1);
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
