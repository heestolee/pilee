import assert from "node:assert/strict";
import { test } from "node:test";
import { captureUnifiedDiff } from "./evidence.ts";
import {
	metaReviewExplanationCoverage,
	reconcileMetaReviewGuides,
	validateMetaReviewDocument,
	validateMetaReviewGuides,
	type MetaReviewFileGuide,
	type MetaReviewFileGuideInput,
} from "./guidance.ts";

const DIFF = `diff --git a/src/policy.ts b/src/policy.ts
index 1111111..2222222 100644
--- a/src/policy.ts
+++ b/src/policy.ts
@@ -1,4 +1,5 @@
 export function visible(status: string) {
-  return status !== "HIDDEN";
+  const allowed = new Set(["OPEN", "READY"]);
+  return allowed.has(status);
 }
diff --git a/src/consumer.ts b/src/consumer.ts
index 3333333..4444444 100644
--- a/src/consumer.ts
+++ b/src/consumer.ts
@@ -1,3 +1,3 @@
 export function consumer() {
-  return visible("NEW");
+  return visible("READY");
 }
`;

function guideInputs(diff = DIFF): { guides: MetaReviewFileGuideInput[]; bundle: ReturnType<typeof captureUnifiedDiff> } {
	const bundle = captureUnifiedDiff(diff);
	const changedByPath = new Map(bundle.files.map((file) => [
		file.path,
		bundle.lines.filter((line) => line.fileId === file.id && (line.kind === "addition" || line.kind === "deletion")).map((line) => line.id),
	]));
	return {
		bundle,
		guides: bundle.files.map((file, index) => ({
			path: file.path,
			role: index === 0 ? "노출 정책을 소유합니다." : "정책을 호출하는 소비자입니다.",
			changeReason: "허용 상태 계약을 명시하기 위해 변경됐습니다.",
			flow: index === 0 ? "consumer → policy" : "entry → consumer → policy",
			impact: "새 상태가 자동 노출되지 않습니다.",
			hunks: [{
				id: `E-${index + 1}`,
				title: "상태 계약 변경",
				evidenceIds: changedByPath.get(file.path) ?? [],
				whatChanged: "부정 조건을 명시적 허용 목록으로 바꿨습니다.",
				why: "새 enum 상태가 추가될 때 자동 노출되는 것을 막습니다.",
				evidence: "삭제·추가된 조건식과 consumer 호출 값을 함께 확인했습니다.",
				responsibility: "policy가 허용 상태를 소유합니다.",
				concepts: ["allowlist", "policy boundary"],
				flowImpact: "consumer의 READY 호출만 통과합니다.",
			}],
		})),
	};
}

function inspectAll(bundle: ReturnType<typeof captureUnifiedDiff>): string[] {
	return bundle.chunks.map((chunk) => chunk.id);
}

test("Meta Review document validates file relationships and a complete reading order", () => {
	const { bundle } = guideInputs();
	const [policy, consumer] = bundle.files.map((file) => file.path);
	const document = validateMetaReviewDocument(bundle, {
		overview: { summary: "상태 노출 계약을 allowlist로 좁힙니다.", reviewFocus: "정책과 consumer가 같은 상태 계약을 사용하는지 봅니다." },
		relationships: {
			summary: "consumer가 policy의 허용 상태를 사용합니다.",
			diagram: "flowchart",
			relations: [{ from: consumer!, to: policy!, label: "노출 여부 조회", detail: "READY 상태만 통과합니다." }],
			readingOrder: [{ path: policy!, reason: "정책 계약을 먼저 확인합니다." }, { path: consumer!, reason: "호출자가 계약을 따르는지 확인합니다." }],
		},
	});
	assert.equal(document.relationships.diagram, "flowchart");
	assert.equal(document.relationships.relations[0]?.from, consumer);
	assert.deepEqual(document.relationships.readingOrder.map((step) => step.path), [policy, consumer]);
});

test("Meta Review document rejects unknown relationship files and incomplete reading order", () => {
	const { bundle } = guideInputs();
	const [policy, consumer] = bundle.files.map((file) => file.path);
	const base = {
		overview: { summary: "상태 계약 변경", reviewFocus: "호출 관계 확인" },
		relationships: {
			summary: "consumer에서 policy로 이어집니다.",
			diagram: "sequence" as const,
			relations: [{ from: consumer!, to: policy!, label: "visible 호출" }],
			readingOrder: [{ path: policy!, reason: "정책부터 확인" }, { path: consumer!, reason: "호출자 확인" }],
		},
	};
	assert.throws(() => validateMetaReviewDocument(bundle, { ...base, relationships: { ...base.relationships, relations: [{ from: "src/missing.ts", to: policy!, label: "호출" }] } }), /must reference changed files/);
	assert.throws(() => validateMetaReviewDocument(bundle, { ...base, relationships: { ...base.relationships, readingOrder: [{ path: policy!, reason: "정책부터 확인" }] } }), /include every changed file/);
});

test("Meta Review guides cover every changed file and addition/deletion exactly once", () => {
	const { bundle, guides } = guideInputs();
	const validated = validateMetaReviewGuides(bundle, inspectAll(bundle), guides);
	const coverage = metaReviewExplanationCoverage(bundle, validated);
	assert.equal(coverage.filesExplained, bundle.files.length);
	assert.equal(coverage.changedLinesExplained, bundle.stats.changedRows);
	assert.deepEqual(coverage.missingEvidenceIds, []);
	assert.deepEqual(coverage.duplicateEvidenceIds, []);
	assert.ok(validated.every((guide) => guide.hunks.every((hunk) => hunk.status === "new")));
});

test("Meta Review guide validation rejects unexplained, duplicate, and cross-file changed evidence", () => {
	const { bundle, guides } = guideInputs();
	const firstChanged = guides[0]!.hunks[0]!.evidenceIds[0]!;
	const secondFileChanged = guides[1]!.hunks[0]!.evidenceIds[0]!;
	const missing = structuredClone(guides);
	missing[0]!.hunks[0]!.evidenceIds = missing[0]!.hunks[0]!.evidenceIds.slice(1);
	assert.throws(() => validateMetaReviewGuides(bundle, inspectAll(bundle), missing), /without explanation/);
	const duplicate = structuredClone(guides);
	duplicate[0]!.hunks.push({ ...duplicate[0]!.hunks[0]!, id: "E-duplicate", evidenceIds: [firstChanged] });
	assert.throws(() => validateMetaReviewGuides(bundle, inspectAll(bundle), duplicate), /multiple explanation hunks/);
	const crossFile = structuredClone(guides);
	crossFile[0]!.hunks[0]!.evidenceIds.push(secondFileChanged);
	assert.throws(() => validateMetaReviewGuides(bundle, inspectAll(bundle), crossFile), /crosses file boundary/);
});

test("Meta Review incremental reconciliation preserves unchanged hunks and identifies new, changed, and removed evidence", () => {
	const previous = guideInputs();
	const previousGuides = validateMetaReviewGuides(previous.bundle, inspectAll(previous.bundle), previous.guides);
	const currentDiff = DIFF.replace('new Set(["OPEN", "READY"])', 'new Set(["OPEN", "READY", "PAUSED"])');
	const current = guideInputs(currentDiff);
	const currentGuides = validateMetaReviewGuides(current.bundle, inspectAll(current.bundle), current.guides);
	currentGuides[1]!.hunks[0]!.id = "E-new-consumer";
	const reconciled = reconcileMetaReviewGuides(previous.bundle, previousGuides as MetaReviewFileGuide[], current.bundle, currentGuides);
	assert.equal(reconciled.guides[0]!.hunks[0]!.status, "review-again");
	assert.equal(reconciled.guides[1]!.hunks[0]!.status, "new");
	assert.equal(reconciled.removed.length, 1);
	assert.equal(reconciled.removed[0]!.hunkId, "E-2");
	assert.deepEqual(reconciled.counts, { new: 1, unchanged: 0, "review-again": 1, "evidence-removed": 1 });
});
