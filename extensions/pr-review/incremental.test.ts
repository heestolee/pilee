import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { captureUnifiedDiff } from "./evidence.ts";
import { seedIncrementalMetaReviewRevision } from "./incremental.ts";
import { createPrReviewRun, loadInspection, loadMetaReviewGuides, markChunkInspected, readJson, saveMetaReviewSubmission, writeJsonAtomic, type ReviewCard } from "./run.ts";

const BEFORE = `diff --git a/src/stable.ts b/src/stable.ts
index 1111111..2222222 100644
--- a/src/stable.ts
+++ b/src/stable.ts
@@ -1 +1 @@
-export const stable = 1;
+export const stable = 2;
diff --git a/src/changing.ts b/src/changing.ts
index 3333333..4444444 100644
--- a/src/changing.ts
+++ b/src/changing.ts
@@ -1 +1 @@
-export const changing = 1;
+export const changing = 2;
`;

function target(headSha: string) {
	return { kind: "github-pr" as const, url: "https://github.com/acme/repo/pull/42", owner: "acme", repo: "repo", number: 42, title: "Review", baseRefName: "main", baseSha: "base", headSha };
}

function changedIds(bundle: ReturnType<typeof captureUnifiedDiff>, path: string): string[] {
	const file = bundle.files.find((candidate) => candidate.path === path)!;
	return bundle.lines.filter((line) => line.fileId === file.id && (line.kind === "addition" || line.kind === "deletion")).map((line) => line.id);
}

test("incremental Meta Review seeds unchanged file explanations, findings, decisions, and inspection", () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-meta-review-incremental-"));
	try {
		const previousBundle = captureUnifiedDiff(BEFORE, {}, { chunkBytes: 220 });
		const previous = createPrReviewRun(root, target("head1"), previousBundle, BEFORE, 1000);
		for (const chunk of previousBundle.chunks) markChunkInspected(previous, chunk.id);
		const stableIds = changedIds(previousBundle, "src/stable.ts");
		const changingIds = changedIds(previousBundle, "src/changing.ts");
		saveMetaReviewSubmission(previous, [
			{ path: "src/stable.ts", role: "stable role", changeReason: "stable reason", flow: "stable flow", hunks: [{ id: "E-stable", title: "stable", evidenceIds: stableIds, whatChanged: "stable change", why: "stable why", evidence: "stable evidence", responsibility: "stable responsibility", flowImpact: "stable impact" }] },
			{ path: "src/changing.ts", role: "changing role", changeReason: "changing reason", flow: "changing flow", hunks: [{ id: "E-changing", title: "changing", evidenceIds: changingIds, whatChanged: "changing change", why: "changing why", evidence: "changing evidence", responsibility: "changing responsibility", flowImpact: "changing impact" }] },
		], [{ id: "R-stable", title: "stable finding", strength: "question", confidence: "medium", evidenceIds: [stableIds[0]!], reviewDraft: "stable draft", explanation: "stable explanation", meta: { summary: "stable meta", scope: "none" } }]);
		const previousCards = readJson<ReviewCard[]>(previous.cardsPath);
		previousCards[0]!.decision = "review-only";
		previousCards[0]!.editedReviewDraft = "human stable draft";
		writeJsonAtomic(previous.cardsPath, previousCards);

		const currentDiff = BEFORE.replace("changing = 2", "changing = 3");
		const currentBundle = captureUnifiedDiff(currentDiff, {}, { chunkBytes: 220 });
		const current = createPrReviewRun(root, target("head2"), currentBundle, currentDiff, 2000);
		const seeded = seedIncrementalMetaReviewRevision(previous, current);
		assert.deepEqual(seeded.unchangedPaths, ["src/stable.ts"]);
		assert.deepEqual(seeded.impactedPaths, ["src/changing.ts"]);
		assert.equal(seeded.seededGuideCount, 1);
		assert.equal(seeded.seededCardCount, 1);
		assert.ok(seeded.autoInspectedChunkIds.length >= 1);
		const guides = loadMetaReviewGuides(current);
		assert.equal(guides[0]!.hunks[0]!.status, "unchanged");
		const cards = readJson<ReviewCard[]>(current.cardsPath);
		assert.equal(cards[0]!.decision, "review-only");
		assert.equal(cards[0]!.editedReviewDraft, "human stable draft");
		assert.ok(loadInspection(current).inspectedChunkIds.length >= 1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

