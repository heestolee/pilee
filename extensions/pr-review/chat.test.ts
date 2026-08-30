import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	answerPrReviewQuestion,
	createPrReviewQuestion,
	dispatchPrReviewQuestionToSession,
	failPrReviewQuestion,
	loadPrReviewQuestions,
	PR_REVIEW_TRANSCRIPT_LINEAGE_ENTRY,
	prReviewQuestionsPath,
	publishPrReviewQuestionTranscript,
	resolvePrReviewQuestionContext,
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
			selection: { kind: "card", id: "R-01", label: "리뷰 포인트 · R-01" },
		}, 1000);
		assert.equal(question.id, "Q001");
		assert.deepEqual(question.evidenceIds, ["D000427"]);
		assert.deepEqual(question.selection, { kind: "card", id: "R-01", label: "리뷰 포인트 · R-01" });
		const answered = answerPrReviewQuestion(runDir, question.id, "예약 당시 값을 보존하는 스냅샷입니다.", [{ label: "schema", path: "reserved-stays.entity.ts", line: 30 }], "삭제 정책은 작성자 확인이 필요합니다.", 2000);
		assert.equal(answered.status, "answered");
		assert.equal(loadPrReviewQuestions(runDir).length, 1);
		assert.equal(loadPrReviewQuestions(runDir)[0]?.answer, "예약 당시 값을 보존하는 스냅샷입니다.");
		assert.equal(readFileSync(prReviewQuestionsPath(runDir), "utf8").trim().split("\n").length, 2);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("terminal Meta Review 질문은 늦은 answer와 fail이 원자 상태를 덮어쓰지 않는다", () => {
	const answeredDir = mkdtempSync(join(tmpdir(), "pilee-pr-review-chat-terminal-answer-"));
	const failedDir = mkdtempSync(join(tmpdir(), "pilee-pr-review-chat-terminal-fail-"));
	try {
		const answeredQuestion = createPrReviewQuestion(answeredDir, {
			runId: "run-answer",
			question: "첫 답변을 유지해줘",
			scope: "session",
			execution: { mode: "direct", phase: "answering", routedAt: 100, updatedAt: 100 },
		}, 100);
		const firstAnswer = answerPrReviewQuestion(answeredDir, answeredQuestion.id, "첫 답변", [], undefined, 200);
		const duplicateAnswer = answerPrReviewQuestion(answeredDir, answeredQuestion.id, "늦은 다른 답변", [], undefined, 300);
		const lateFailure = failPrReviewQuestion(answeredDir, answeredQuestion.id, "늦은 실패", 400);
		assert.equal(firstAnswer.execution?.phase, "answered");
		assert.equal(duplicateAnswer.answer, "첫 답변");
		assert.equal(lateFailure.status, "answered");
		assert.equal(loadPrReviewQuestions(answeredDir)[0]?.execution?.phase, "answered");
		assert.equal(readFileSync(prReviewQuestionsPath(answeredDir), "utf8").trim().split("\n").length, 2);

		const failedQuestion = createPrReviewQuestion(failedDir, {
			runId: "run-fail",
			question: "실패 뒤 답변을 막아줘",
			scope: "session",
			execution: { mode: "direct", phase: "answering", routedAt: 100, updatedAt: 100 },
		}, 100);
		const firstFailure = failPrReviewQuestion(failedDir, failedQuestion.id, "첫 실패", 200);
		const lateAnswer = answerPrReviewQuestion(failedDir, failedQuestion.id, "늦은 답변", [], undefined, 300);
		assert.equal(firstFailure.execution?.phase, "failed");
		assert.equal(lateAnswer.status, "failed");
		assert.equal(lateAnswer.answer, undefined);
		assert.equal(readFileSync(prReviewQuestionsPath(failedDir), "utf8").trim().split("\n").length, 2);
	} finally {
		rmSync(answeredDir, { recursive: true, force: true });
		rmSync(failedDir, { recursive: true, force: true });
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
			selection: { kind: "line", id: "D000427", label: "코드 줄 · migration.js:27" },
			attachmentIds: ["review-image-1"],
			attachments: [{ id: "review-image-1", name: "diagram.png", mimeType: "image/png", path: "/tmp/review-image-1.png", url: "/attachments/review-image-1.png" }],
		}, 1000);
		const messages: any[] = [];
		const entries: any[] = [];
		const pi = {
			appendEntry(customType: string, data: any) { entries.push({ customType, data }); },
			sendMessage(message: any, options: any) { messages.push({ message, options }); },
		} as any;
		dispatchPrReviewQuestionToSession(pi, runState(runDir), question);
		assert.equal(entries.length, 1);
		assert.equal(entries[0].customType, PR_REVIEW_TRANSCRIPT_LINEAGE_ENTRY);
		assert.equal(entries[0].data.display, true);
		assert.match(entries[0].data.content, /Meta Review 질문/);
		assert.match(entries[0].data.content, /이 리뷰가 과한 것 아닌가/);
		assert.equal(messages.length, 1);
		assert.equal(messages[0].message.customType, "pilee-meta-review-question");
		assert.equal(messages[0].message.display, false);
		assert.equal(messages[0].options.deliverAs, "followUp");
		assert.equal(messages[0].options.triggerTurn, true);
		assert.match(messages[0].message.content, /실제 source, callsite, schema, test/);
		assert.match(messages[0].message.content, /meta_review_chat.*route/);
		assert.match(messages[0].message.content, /meta_review_chat.*answer/);
		assert.match(messages[0].message.content, /D000427/);
		assert.match(messages[0].message.content, /selectedBlock: line:D000427/);
		assert.match(messages[0].message.content, /diagram\.png/);
		assert.match(messages[0].message.content, /\/tmp\/review-image-1\.png/);
		assert.doesNotMatch(messages[0].message.content, /data:image/);
		assert.deepEqual(loadPrReviewQuestions(runDir)[0]?.attachmentIds, ["review-image-1"]);
		assert.equal(loadPrReviewQuestions(runDir)[0]?.attachments?.[0]?.name, "diagram.png");
		assert.equal(loadPrReviewQuestions(runDir)[0]?.status, "queued");
		assert.equal(loadPrReviewQuestions(runDir)[0]?.execution?.phase, "routing");
		assert.equal(loadPrReviewQuestions(runDir)[0]?.transcriptEventKeys?.length, 1);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("Meta Review transcript fallback은 사용자 Q&A만 display true로 한 번 기록한다", () => {
	const runDir = mkdtempSync(join(tmpdir(), "pilee-pr-review-chat-transcript-"));
	try {
		const state = runState(runDir);
		const created = createPrReviewQuestion(runDir, {
			runId: state.runId,
			question: "이 선택 블록의 책임은 무엇인가?",
			scope: "file",
			fileId: "F001",
			filePath: "src/policy.ts",
			selection: { kind: "file", id: "F001", label: "파일 · src/policy.ts" },
		}, 1000);
		const messages: any[] = [];
		const pi = {
			appendEntry() { throw new Error("lineage unavailable"); },
			sendMessage(message: any, options: any) { messages.push({ message, options }); },
		} as any;
		const withQuestionTranscript = publishPrReviewQuestionTranscript(pi, state, created, "question");
		publishPrReviewQuestionTranscript(pi, state, withQuestionTranscript, "question");
		const answered = answerPrReviewQuestion(runDir, created.id, "정책 파일의 공개 상태 allowlist를 소유합니다.", [], undefined, 2000);
		const withAnswerTranscript = publishPrReviewQuestionTranscript(pi, state, answered, "answer");
		publishPrReviewQuestionTranscript(pi, state, withAnswerTranscript, "answer");
		assert.equal(messages.length, 2);
		assert.ok(messages.every(({ message, options }) => message.display === true && options.deliverAs === "nextTurn" && options.triggerTurn === false));
		assert.match(messages[0].message.content, /Meta Review 질문/);
		assert.match(messages[1].message.content, /Meta Review 답변/);
		assert.match(messages[1].message.content, /정책 파일의 공개 상태 allowlist/);
		assert.doesNotMatch(messages.map(({ message }) => message.content).join("\n"), /runDir|workerResultPath|답변 규칙/);
		assert.equal(loadPrReviewQuestions(runDir)[0]?.transcriptEventKeys?.length, 2);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("question context derives and validates selected review block provenance", () => {
	const snapshot = {
		source: { files: [{ id: "F001", path: "src/policy.ts", lines: [{ id: "D001", oldLine: 1 }, { id: "D002", newLine: 1 }] }] },
		guides: [{ path: "src/policy.ts", hunks: [{ id: "E-01", title: "허용 상태 명시", evidenceIds: ["D001", "D002"] }] }],
		cards: [{ id: "R-01", title: "호출자 상태 확인", evidenceIds: ["D001"], code: { path: "src/policy.ts" } }],
	};
	assert.deepEqual(resolvePrReviewQuestionContext(snapshot, {
		scope: "evidence",
		fileId: "F001",
		evidenceIds: ["D001", "D002"],
		selectionKind: "hunk",
		selectionId: "E-01",
	}), {
		scope: "evidence",
		cardId: undefined,
		fileId: "F001",
		filePath: "src/policy.ts",
		evidenceIds: ["D001", "D002"],
		selection: { kind: "hunk", id: "E-01", label: "설명 블록 · 허용 상태 명시" },
	});
	assert.throws(() => resolvePrReviewQuestionContext(snapshot, {
		scope: "evidence",
		fileId: "F001",
		evidenceIds: ["D001"],
		selectionKind: "hunk",
		selectionId: "E-01",
	}), /hunk selection does not match/);
	assert.throws(() => resolvePrReviewQuestionContext(snapshot, {
		scope: "card",
		cardId: "R-01",
		fileId: "F001",
		evidenceIds: ["D002"],
		selectionKind: "card",
		selectionId: "R-01",
	}), /card context does not match/);
	assert.throws(() => resolvePrReviewQuestionContext(snapshot, {
		scope: "session",
		evidenceIds: ["D001"],
	}), /session question cannot include selected context/);
	assert.deepEqual(resolvePrReviewQuestionContext(snapshot, {
		scope: "section",
		sectionId: "relationships",
		selectionKind: "section",
		selectionId: "relationships",
	}), {
		scope: "section",
		cardId: undefined,
		sectionId: "relationships",
		fileId: undefined,
		filePath: undefined,
		evidenceIds: undefined,
		selection: { kind: "section", id: "relationships", label: "변경 파일 관계" },
	});
	assert.throws(() => resolvePrReviewQuestionContext(snapshot, {
		scope: "section",
		sectionId: "unknown-section",
		selectionKind: "section",
		selectionId: "unknown-section",
	}), /known sectionId is required/);
	assert.throws(() => resolvePrReviewQuestionContext(snapshot, {
		scope: "section",
		sectionId: "overview",
		selectionKind: "section",
		selectionId: "relationships",
	}), /section selection does not match/);
});
