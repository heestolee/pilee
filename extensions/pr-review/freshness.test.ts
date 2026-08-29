import assert from "node:assert/strict";
import { test } from "node:test";
import { captureUnifiedDiff } from "./evidence.ts";
import { checkMetaReviewFreshness } from "./freshness.ts";
import type { PrReviewRunState } from "./run.ts";

const DIFF = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;

function run(kind: "github-pr" | "current-work"): PrReviewRunState {
	return {
		schemaVersion: 1,
		runId: "run-1",
		status: "ready",
		target: { kind, url: "https://github.com/acme/repo/pull/42", owner: "acme", repo: "repo", number: 42, title: "Review", baseRefName: "main", baseSha: "base", headSha: "head", root: "/tmp/repo" },
		runDir: "/tmp/run-1",
		sourcePath: "/tmp/run-1/source.json",
		diffPath: "/tmp/run-1/source.diff",
		inspectionPath: "/tmp/run-1/inspection.json",
		cardsPath: "/tmp/run-1/cards.json",
		guidesPath: "/tmp/run-1/guides.json",
		reportPath: "/tmp/run-1/review.md",
		createdAt: 1,
		updatedAt: 1,
	};
}

test("Meta Review freshness checks PR head/base without changing the review artifact", async () => {
	const source = captureUnifiedDiff(DIFF);
	const current = await checkMetaReviewFreshness({ exec: async () => ({ code: 0, stdout: JSON.stringify({ headRefOid: "head", baseRefOid: "base", baseRefName: "main" }), stderr: "" }) } as any, "/tmp", run("github-pr"), source, 1000);
	assert.equal(current.status, "current");
	const stale = await checkMetaReviewFreshness({ exec: async () => ({ code: 0, stdout: JSON.stringify({ headRefOid: "new-head", baseRefOid: "base", baseRefName: "main" }), stderr: "" }) } as any, "/tmp", run("github-pr"), source, 2000);
	assert.equal(stale.status, "stale");
	assert.equal(stale.observedHead, "new-head");
});

test("Meta Review freshness compares current-work diff hash read-only", async () => {
	const source = captureUnifiedDiff(DIFF);
	const samePi = {
		async exec(_command: string, args: string[]) {
			if (args[0] === "diff" && args[1] === "--no-color") return { code: 0, stdout: DIFF, stderr: "" };
			if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" };
			throw new Error(`unexpected ${args.join(" ")}`);
		},
	} as any;
	assert.equal((await checkMetaReviewFreshness(samePi, "/tmp/repo", run("current-work"), source)).status, "current");
	const changedPi = { ...samePi, async exec(_command: string, args: string[]) { if (args[0] === "diff") return { code: 0, stdout: DIFF.replace("value = 2", "value = 3"), stderr: "" }; if (args[0] === "ls-files") return { code: 0, stdout: "", stderr: "" }; throw new Error("unexpected"); } } as any;
	assert.equal((await checkMetaReviewFreshness(changedPi, "/tmp/repo", run("current-work"), source)).status, "stale");
});
