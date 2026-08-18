import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { captureUnifiedDiff } from "./evidence.ts";
import {
	codeExcerptForEvidence,
	createPrReviewRun,
	loadInspection,
	markChunkInspected,
	readJson,
	renderReviewMarkdown,
	saveHumanDecision,
	saveReviewCards,
	type ReviewCard,
	type ReviewCardInput,
} from "./run.ts";

const DIFF = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,4 +1,5 @@
 export function visible(status: string) {
-  return status !== "HIDDEN";
+  const allowed = new Set(["OPEN", "READY"]);
+  return allowed.has(status);
 }
`;

function cardInput(evidenceId: string): ReviewCardInput {
	return {
		id: "R-01",
		title: "허용 상태를 명시한다",
		strength: "required",
		confidence: "high",
		evidenceIds: [evidenceId],
		reviewDraft: "새 상태가 자동 노출되지 않도록 허용 상태를 명시해주세요.",
		explanation: "부정 조건은 이후 enum 추가를 자동 허용합니다.",
		meta: {
			summary: "같은 패턴이 반복되면 상태 allowlist 계약을 공통화할 수 있습니다.",
			existingGuard: "관련 상태 처리 가이드 적용 여부는 trace가 없어 확인이 필요합니다.",
			structuralPrevention: "isVisibleStatus 함수가 허용 범위를 소유합니다.",
			machinePrevention: "새 상태 추가 시 focused test가 실패하게 합니다.",
			scope: "current-pr",
		},
	};
}

test("review run persists exact source, inspection, cards and markdown", () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-pr-review-run-"));
	try {
		const bundle = captureUnifiedDiff(DIFF, { kind: "github-pr" });
		const state = createPrReviewRun(root, {
			url: "https://github.com/acme/repo/pull/7",
			owner: "acme",
			repo: "repo",
			number: 7,
			title: "Visibility contract",
			headSha: "1234567890abcdef",
		}, bundle, DIFF, 1234);
		assert.equal(readFileSync(state.diffPath, "utf8"), DIFF);
		assert.deepEqual(loadInspection(state).inspectedChunkIds, []);
		markChunkInspected(state, bundle.chunks[0]!.id);
		const evidence = bundle.lines.find((line) => line.kind === "deletion")!;
		const cards = saveReviewCards(state, [cardInput(evidence.id)]);
		assert.equal(cards.length, 1);
		assert.equal(cards[0]?.code.path, "src/example.ts");
		assert.match(cards[0]?.code.text ?? "", /-  return status !== "HIDDEN";/);
		const markdown = readFileSync(state.reportPath, "utf8");
		assert.match(markdown, /### 코드/);
		assert.match(markdown, /### 리뷰 초안/);
		assert.match(markdown, /### 설명/);
		assert.match(markdown, /### 메타적 관점/);
		assert.match(markdown, /새 상태가 자동 노출되지 않도록/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("review cards cannot cite uninspected or cross-file evidence", () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-pr-review-run-"));
	try {
		const diff = `${DIFF}diff --git a/src/other.ts b/src/other.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/other.ts\n@@ -0,0 +1 @@\n+export const other = true;\n`;
		const bundle = captureUnifiedDiff(diff);
		const state = createPrReviewRun(root, {
			url: "https://github.com/acme/repo/pull/8",
			owner: "acme",
			repo: "repo",
			number: 8,
			title: "Evidence boundary",
		}, bundle, diff);
		const first = bundle.lines.find((line) => line.kind === "deletion")!;
		assert.throws(() => saveReviewCards(state, [cardInput(first.id)]), /uninspected chunk/);
		for (const chunk of bundle.chunks) markChunkInspected(state, chunk.id);
		const second = bundle.lines.find((line) => line.fileId === "F002" && line.kind === "addition")!;
		assert.throws(() => saveReviewCards(state, [{ ...cardInput(first.id), evidenceIds: [first.id, second.id] }]), /one file/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("human decision is append-only and does not rewrite the review draft", () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-pr-review-run-"));
	try {
		const bundle = captureUnifiedDiff(DIFF);
		const state = createPrReviewRun(root, {
			url: "https://github.com/acme/repo/pull/9",
			owner: "acme",
			repo: "repo",
			number: 9,
			title: "Human decision",
		}, bundle, DIFF);
		markChunkInspected(state, bundle.chunks[0]!.id);
		const evidence = bundle.lines.find((line) => line.kind === "deletion")!;
		const original = cardInput(evidence.id);
		saveReviewCards(state, [original]);
		const cards = saveHumanDecision(state, "R-01", "edit", "사람이 다듬은 리뷰 문장");
		assert.equal(cards[0]?.reviewDraft, original.reviewDraft);
		assert.equal(cards[0]?.editedReviewDraft, "사람이 다듬은 리뷰 문장");
		assert.equal(cards[0]?.decision, "edit");
		assert.match(readFileSync(join(state.runDir, "decisions.jsonl"), "utf8"), /"decision":"edit"/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("empty review result is explicit and does not claim approval", () => {
	const bundle = captureUnifiedDiff(DIFF);
	const markdown = renderReviewMarkdown({
		schemaVersion: 1,
		runId: "run",
		status: "ready",
		target: { url: "https://github.com/acme/repo/pull/1", owner: "acme", repo: "repo", number: 1, title: "No finding" },
		runDir: "/tmp/run",
		sourcePath: "/tmp/source.json",
		diffPath: "/tmp/source.diff",
		inspectionPath: "/tmp/inspection.json",
		cardsPath: "/tmp/cards.json",
		reportPath: "/tmp/review.md",
		createdAt: 0,
		updatedAt: 0,
	}, bundle, [] as ReviewCard[]);
	assert.match(markdown, /승인이나 안전 보장을 의미하지 않습니다/);
});

test("code excerpts are derived from exact source instead of caller supplied text", () => {
	const bundle = captureUnifiedDiff(DIFF);
	const evidence = bundle.lines.find((line) => line.kind === "addition")!;
	const excerpt = codeExcerptForEvidence(bundle, [evidence.id]);
	assert.equal(excerpt.path, "src/example.ts");
	assert.match(excerpt.text, /\+  const allowed/);
});
