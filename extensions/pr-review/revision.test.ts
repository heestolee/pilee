import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { captureUnifiedDiff } from "./evidence.ts";
import { createPrReviewRun, loadPrReviewRun } from "./run.ts";
import {
	attachMetaReviewRevision,
	decideMetaReviewRefresh,
	loadMetaReviewSeriesForRun,
	markMetaReviewRevisionReady,
} from "./revision.ts";

const DIFF = `diff --git a/a.ts b/a.ts
index 1111111..2222222 100644
--- a/a.ts
+++ b/a.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = 2;
`;

function target(headSha: string, baseSha = "base1234") {
	return {
		kind: "github-pr" as const,
		url: "https://github.com/acme/repo/pull/42",
		owner: "acme",
		repo: "repo",
		number: 42,
		title: "Review target",
		baseRefName: "main",
		baseSha,
		headSha,
	};
}

test("Meta Review series appends immutable run revisions and preserves readiness", () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-meta-review-series-"));
	try {
		const firstBundle = captureUnifiedDiff(DIFF);
		const first = createPrReviewRun(root, target("head1111"), firstBundle, DIFF, 1000);
		const attachedFirst = attachMetaReviewRevision(first, firstBundle.sourceSha256, "initial", undefined, 1000);
		assert.equal(attachedFirst.revision.number, 1);
		markMetaReviewRevisionReady(attachedFirst.run, { new: 1, unchanged: 0, "review-again": 0, "evidence-removed": 0 }, 1100);
		const secondDiff = DIFF.replace("value = 2", "value = 3");
		const secondBundle = captureUnifiedDiff(secondDiff);
		const second = createPrReviewRun(root, target("head2222"), secondBundle, secondDiff, 2000);
		const attachedSecond = attachMetaReviewRevision(second, secondBundle.sourceSha256, "incremental", attachedFirst.run, 2000);
		assert.equal(attachedSecond.revision.number, 2);
		assert.equal(attachedSecond.run.previousRunDir, attachedFirst.run.runDir);
		const series = loadMetaReviewSeriesForRun(attachedSecond.run)!;
		assert.equal(series.revisions.length, 2);
		assert.equal(series.revisions[0]!.status, "ready");
		assert.equal(series.revisions[1]!.status, "captured");
		assert.equal(loadPrReviewRun(second.runDir).seriesId, series.seriesId);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Meta Review refresh chooses incremental only for safe linear changes", () => {
	const previous = target("head1111");
	assert.deepEqual(decideMetaReviewRefresh(previous, target("head1111"), { previousIsAncestor: true }), { mode: "none", reason: "head SHA와 diff가 동일합니다." });
	assert.equal(decideMetaReviewRefresh({ ...previous, kind: "current-work" }, { ...target("head1111"), kind: "current-work" }, { previousIsAncestor: true, sourceChanged: true }).mode, "incremental");
	assert.equal(decideMetaReviewRefresh(previous, target("head2222"), { previousIsAncestor: true }).mode, "incremental");
	assert.equal(decideMetaReviewRefresh(previous, target("head2222"), { previousIsAncestor: false }).mode, "full");
	assert.equal(decideMetaReviewRefresh(previous, target("head2222", "different-base"), { previousIsAncestor: true }).mode, "full");
	assert.equal(decideMetaReviewRefresh(previous, target("head2222"), { forceFull: true, previousIsAncestor: true }).mode, "full");
});
