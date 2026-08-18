import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	answerPrReviewQuestion,
	createPrReviewQuestion,
	dispatchPrReviewQuestionToSession,
	loadPrReviewQuestions,
	prReviewQuestionsPath,
} from "./chat.ts";
import type { PrReviewRunState } from "./run.ts";

function runState(runDir: string): PrReviewRunState {
	return {
		schemaVersion: 1,
		runId: "acme-repo-pr-42-head-1",
		status: "ready",
		target: {
			url: "https://github.com/acme/repo/pull/42",
			owner: "acme",
			repo: "repo",
			number: 42,
			title: "Review target",
			headSha: "b".repeat(40),
		},
		runDir,
		sourcePath: join(runDir, "source.json"),
		diffPath: join(runDir, "source.diff"),
		inspectionPath: join(runDir, "inspection.json"),
		cardsPath: join(runDir, "cards.json"),
		reportPath: join(runDir, "review.md"),
		createdAt: 1000,
		updatedAt: 1000,
	};
}

test("PR review questions are append-only snapshots with preserved context", () => {
	const runDir = mkdtempSync(join(tmpdir(), "pilee-pr-review-chat-"));
	try {
		const question = createPrReviewQuestion(runDir, {
			runId: "run-1",
			question: "reserved_stays가 뭔데?",
			scope: "card",
			cardId: "R-01",
			fileId: "F003",
			filePath: "migration.js",
			evidenceIds: ["D000427", "D000427"],
		}, 1000);
		assert.equal(question.id, "Q001");
		assert.deepEqual(question.evidenceIds, ["D000427"]);
		const answered = answerPrReviewQuestion(runDir, question.id, "예약 당시 값을 보존하는 스냅샷입니다.", [{ label: "schema", path: "reserved-stays.entity.ts", line: 30 }], "삭제 정책은 작성자 확인이 필요합니다.", 2000);
		assert.equal(answered.status, "answered");
		assert.equal(loadPrReviewQuestions(runDir).length, 1);
		assert.equal(loadPrReviewQuestions(runDir)[0]?.answer, "예약 당시 값을 보존하는 스냅샷입니다.");
		assert.equal(readFileSync(prReviewQuestionsPath(runDir), "utf8").trim().split("\n").length, 2);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("Glimpse question dispatches into the same Pi session with review-worktree investigation rules", () => {
	const runDir = mkdtempSync(join(tmpdir(), "pilee-pr-review-chat-dispatch-"));
	try {
		const question = createPrReviewQuestion(runDir, {
			runId: "acme-repo-pr-42-head-1",
			question: "이 리뷰가 과한 것 아닌가?",
			scope: "evidence",
			cardId: "R-01",
			filePath: "migration.js",
			evidenceIds: ["D000427"],
		}, 1000);
		const messages: any[] = [];
		const pi = { sendMessage(message: any, options: any) { messages.push({ message, options }); } } as any;
		dispatchPrReviewQuestionToSession(pi, runState(runDir), question);
		assert.equal(messages.length, 1);
		assert.equal(messages[0].message.customType, "pilee-pr-review-question");
		assert.equal(messages[0].message.display, false);
		assert.equal(messages[0].options.deliverAs, "followUp");
		assert.equal(messages[0].options.triggerTurn, true);
		assert.match(messages[0].message.content, /실제 source, callsite, schema, test/);
		assert.match(messages[0].message.content, /pr_review_chat.*answer/);
		assert.match(messages[0].message.content, /D000427/);
		assert.equal(loadPrReviewQuestions(runDir)[0]?.status, "answering");
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});
