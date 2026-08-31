import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { captureUnifiedDiff } from "./evidence.ts";
import { createPrReviewRun, markChunkInspected, saveReviewCards } from "./run.ts";
import { buildPrReviewStudioHtml, closePrReviewStudios, startPrReviewStudioServer } from "./studio.ts";

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

function createReadyRun(root: string) {
	const bundle = captureUnifiedDiff(DIFF);
	const state = createPrReviewRun(root, {
		url: "https://github.com/acme/repo/pull/42",
		owner: "acme",
		repo: "repo",
		number: 42,
		title: "Visibility contract",
		headSha: "head1234567890",
	}, bundle, DIFF, 1000);
	for (const chunk of bundle.chunks) markChunkInspected(state, chunk.id);
	const evidence = bundle.lines.find((line) => line.kind === "deletion")!;
	saveReviewCards(state, [{
		id: "R-01",
		title: "허용 상태를 명시한다",
		strength: "required",
		confidence: "high",
		evidenceIds: [evidence.id],
		reviewDraft: "새 상태가 자동 노출되지 않도록 허용 상태를 명시해주세요.",
		explanation: "부정 조건은 이후 상태 추가를 자동 허용합니다.",
		meta: {
			summary: "focused test로 같은 회귀를 막을 수 있습니다.",
			existingGuard: "기존 상태 처리 가이드 적용 여부는 확인이 필요합니다.",
			structuralPrevention: "도메인 함수가 허용 범위를 소유합니다.",
			machinePrevention: "새 enum 상태 fixture를 추가합니다.",
			scope: "current-pr",
		},
		precedents: [{
			id: "case-1",
			url: "https://github.com/acme/repo/pull/10#discussion_r10",
			label: "과거 인간 리뷰",
			similarity: "상태 allowlist 계약",
			difference: "과거에는 여러 consumer가 있었습니다.",
			lane: "supporting",
		}],
	}]);
	return state;
}

test("Review Studio HTML uses the Easy Review document hierarchy with inline human decisions", () => {
	const html = buildPrReviewStudioHtml("Review");
	for (const marker of ["report-header", "overview report-section", "attention report-section", "review-layout", "review-section", "inline-fold", "inline-code-note", "review-companion", "conversation-thread", "companion-contents"]) {
		assert.match(html, new RegExp(marker));
	}
	for (const label of ["먼저 볼 점", "파일별 diff", "리뷰 채택", "메타 포함", "리뷰 문구 수정", "후속", "폐기", "이해하면서 질문하기", "더 쉽게", "사실/추측", "질문 보내기", "공통 worker", "Worker로 다시 시도", "captureReviewInteraction", "restoreReviewInteraction"]) {
		assert.match(html, new RegExp(label));
	}
	const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
	assert.ok(script);
	assert.doesNotThrow(() => new Function(script));
});

test("Review Studio routes selected card questions to the connected Pi session", async () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-pr-review-studio-question-"));
	try {
		const state = createReadyRun(root);
		const questions: any[] = [];
		const retries: string[] = [];
		const handle = await startPrReviewStudioServer(state, {
			onQuestion(question) { questions.push(question); },
			onRetry(questionId) { retries.push(questionId); return questions[0]; },
		});
		const url = new URL(handle.url);
		const token = url.searchParams.get("token");
		const response = await fetch(`${url.origin}/ask?token=${encodeURIComponent(token ?? "")}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ question: "이 리뷰가 과한 것 아닌가?", scope: "card", cardId: "R-01" }),
		});
		assert.equal(response.status, 202);
		assert.equal(questions.length, 1);
		assert.equal(questions[0].cardId, "R-01");
		assert.deepEqual(questions[0].evidenceIds.length, 1);
		const stateResponse = await fetch(`${url.origin}/state?token=${encodeURIComponent(token ?? "")}`);
		const payload = await stateResponse.json() as any;
		assert.equal(payload.questions[0].question, "이 리뷰가 과한 것 아닌가?");
		assert.equal(payload.questions[0].status, "queued");
		const retryResponse = await fetch(`${url.origin}/retry?token=${encodeURIComponent(token ?? "")}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ questionId: payload.questions[0].id }),
		});
		assert.equal(retryResponse.status, 202);
		assert.deepEqual(retries, [payload.questions[0].id]);
		handle.server.close();
	} finally {
		closePrReviewStudios();
		rmSync(root, { recursive: true, force: true });
	}
});

test("Review Studio serves cards and persists human decisions without rewriting original draft", async () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-pr-review-studio-"));
	try {
		const state = createReadyRun(root);
		const handle = await startPrReviewStudioServer(state);
		const rootResponse = await fetch(handle.url);
		assert.equal(rootResponse.status, 200);
		assert.match(await rootResponse.text(), /Human PR Review/);
		const url = new URL(handle.url);
		const token = url.searchParams.get("token");
		const stateResponse = await fetch(`${url.origin}/state?token=${encodeURIComponent(token ?? "")}`);
		const payload = await stateResponse.json() as any;
		assert.equal(payload.cards.length, 1);
		assert.equal(payload.source.files.length, 1);
		assert.ok(payload.source.files[0].lines.some((line: any) => line.id === "D000001"));
		assert.equal(payload.cards[0].reviewDraft, "새 상태가 자동 노출되지 않도록 허용 상태를 명시해주세요.");

		const decisionResponse = await fetch(`${url.origin}/decision?token=${encodeURIComponent(token ?? "")}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cardId: "R-01", decision: "edit", editedReviewDraft: "사람이 다듬은 리뷰" }),
		});
		assert.equal(decisionResponse.status, 200);
		const updatedResponse = await fetch(`${url.origin}/state?token=${encodeURIComponent(token ?? "")}`);
		const updated = await updatedResponse.json() as any;
		assert.equal(updated.cards[0].decision, "edit");
		assert.equal(updated.cards[0].reviewDraft, "새 상태가 자동 노출되지 않도록 허용 상태를 명시해주세요.");
		assert.equal(updated.cards[0].editedReviewDraft, "사람이 다듬은 리뷰");
		const report = readFileSync(state.reportPath, "utf8");
		assert.match(report, /사람이 다듬은 리뷰/);
		assert.match(report, /인간 결정:\*\* edit/);
		handle.server.close();
	} finally {
		closePrReviewStudios();
		rmSync(root, { recursive: true, force: true });
	}
});
