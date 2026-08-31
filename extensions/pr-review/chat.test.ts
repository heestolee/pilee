import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	answerPrReviewQuestion,
	createPrReviewQuestion,
	failPrReviewQuestion,
	loadPrReviewQuestions,
	PR_REVIEW_TRANSCRIPT_LINEAGE_ENTRY,
	reloadPrReviewQuestionCanonical,
	prReviewQuestionsPath,
	publishPrReviewQuestionTranscript,
	replayPrReviewQuestionTranscript,
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

test("명시적 reopen은 다른 Pi coordinator의 질문 snapshot을 reload하고 이후 snapshot도 보존한다", () => {
	const runDir = mkdtempSync(join(tmpdir(), "pilee-pr-review-chat-cross-process-"));
	try {
		createPrReviewQuestion(runDir, {
			runId: "run-cross-process",
			question: "첫 process 질문",
			scope: "session",
		}, 1000);
		const externalQuestion = {
			runId: "run-cross-process",
			id: "Q002",
			question: "다른 process 질문",
			scope: "session" as const,
			status: "answered" as const,
			createdAt: 2000,
			updatedAt: 2100,
			answeredAt: 2100,
			answer: "다른 process 답변",
		};
		appendFileSync(prReviewQuestionsPath(runDir), `${JSON.stringify({ type: "question-snapshot", question: externalQuestion })}\n`, "utf8");
		assert.deepEqual(loadPrReviewQuestions(runDir).map((question) => question.id), ["Q001"], "평상시 load는 worker integrity를 위해 process cache를 유지한다");
		assert.deepEqual(reloadPrReviewQuestionCanonical(runDir).map((question) => question.id), ["Q001", "Q002"], "명시적 reopen에서 disk canonical을 다시 읽는다");

		const third = createPrReviewQuestion(runDir, {
			runId: "run-cross-process",
			question: "원래 process의 다음 질문",
			scope: "session",
		}, 3000);
		assert.equal(third.id, "Q003");
		assert.deepEqual(loadPrReviewQuestions(runDir).map((question) => question.id), ["Q001", "Q002", "Q003"]);
		assert.match(readFileSync(prReviewQuestionsPath(runDir), "utf8"), /다른 process 답변/);
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

test("새 Pi session reopen은 기존 canonical transcript key와 무관하게 누락된 Q&A를 한 번 replay한다", () => {
	const runDir = mkdtempSync(join(tmpdir(), "pilee-pr-review-chat-replay-"));
	try {
		const state = runState(runDir);
		const created = createPrReviewQuestion(runDir, {
			runId: state.runId,
			question: "이전 session 질문",
			scope: "session",
		}, 1000);
		const answered = answerPrReviewQuestion(runDir, created.id, "이전 session 답변", [], undefined, 2000);
		const originalPi = { appendEntry() {}, sendMessage() {} } as any;
		const publishedQuestion = publishPrReviewQuestionTranscript(originalPi, state, answered, "question");
		const publishedAnswer = publishPrReviewQuestionTranscript(originalPi, state, publishedQuestion, "answer");
		assert.equal(publishedAnswer.transcriptEventKeys?.length, 2);

		const entries: any[] = [];
		const reopenedPi = { appendEntry(customType: string, data: any) { entries.push({ customType, data }); }, sendMessage() {} } as any;
		const currentSessionEventKeys = new Set<string>();
		replayPrReviewQuestionTranscript(reopenedPi, state, publishedAnswer, "question", currentSessionEventKeys);
		replayPrReviewQuestionTranscript(reopenedPi, state, publishedAnswer, "answer", currentSessionEventKeys);
		replayPrReviewQuestionTranscript(reopenedPi, state, publishedAnswer, "question", currentSessionEventKeys);
		replayPrReviewQuestionTranscript(reopenedPi, state, publishedAnswer, "answer", currentSessionEventKeys);
		assert.equal(entries.length, 2);
		assert.deepEqual(entries.map((entry) => entry.customType), [PR_REVIEW_TRANSCRIPT_LINEAGE_ENTRY, PR_REVIEW_TRANSCRIPT_LINEAGE_ENTRY]);
		assert.ok(entries.every((entry) => entry.data.display === true));
		assert.match(entries[0].data.content, /이전 session 질문/);
		assert.match(entries[1].data.content, /이전 session 답변/);
	} finally {
		rmSync(runDir, { recursive: true, force: true });
	}
});

test("question context derives and validates selected review block provenance", () => {
	const snapshot = {
		source: { files: [{
			id: "F001",
			path: "src/policy.ts",
			lines: [{ id: "D001", oldLine: 1 }, { id: "D002", newLine: 1 }],
			declarationSource: {
				declarations: [{
					id: "A-F001-value",
					fileId: "F001",
					kind: "variable",
					name: "allowed",
					symbolPath: ["src/policy.ts", "visible", "allowed"],
					parentId: "A-F001-visible",
					childIds: [],
					depth: 2,
					before: { startLine: 1, endLine: 1 },
					after: { startLine: 1, endLine: 2 },
					evidenceIds: ["D001", "D002"],
				}],
			},
		}] },
		guides: [{ path: "src/policy.ts", hunks: [{ id: "E-01", title: "허용 상태 명시", evidenceIds: ["D001", "D002"] }] }],
		document: { meanings: [{ id: "M-visible", title: "암묵적 허용을 명시적 상태 계약으로 전환", evidenceIds: ["D001", "D002"] }] },
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
		selection: { kind: "hunk", id: "E-01", label: "변경 단위 · 허용 상태 명시" },
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
	assert.deepEqual(resolvePrReviewQuestionContext(snapshot, {
		scope: "declaration",
		fileId: "F001",
		declarationId: "A-F001-value",
		declarationSide: "after",
		evidenceIds: ["D001", "D002"],
		selectionKind: "declaration",
		selectionId: "A-F001-value",
	}), {
		scope: "declaration",
		cardId: undefined,
		declarationId: "A-F001-value",
		declarationSide: "after",
		fileId: "F001",
		filePath: "src/policy.ts",
		evidenceIds: ["D001", "D002"],
		selection: { kind: "declaration", id: "A-F001-value", label: "변수 · allowed · 변경 후 L1–L2" },
	});
	assert.throws(() => resolvePrReviewQuestionContext(snapshot, {
		scope: "declaration",
		fileId: "F001",
		declarationId: "A-F001-value",
		declarationSide: "after",
		evidenceIds: ["D002"],
		selectionKind: "declaration",
		selectionId: "A-F001-value",
	}), /declaration context does not match/);
	assert.throws(() => resolvePrReviewQuestionContext(snapshot, {
		scope: "declaration",
		fileId: "F001",
		declarationId: "A-F001-value",
		declarationSide: "before-mutation",
		evidenceIds: ["D001", "D002"],
		selectionKind: "declaration",
		selectionId: "A-F001-value",
	}), /valid declarationSide is required/);
	assert.deepEqual(resolvePrReviewQuestionContext(snapshot, {
		scope: "meaning",
		meaningId: "M-visible",
		evidenceIds: ["D001", "D002"],
		selectionKind: "meaning",
		selectionId: "M-visible",
	}), {
		scope: "meaning",
		cardId: undefined,
		meaningId: "M-visible",
		fileId: undefined,
		filePath: undefined,
		evidenceIds: ["D001", "D002"],
		selection: { kind: "meaning", id: "M-visible", label: "변경 의미 · 암묵적 허용을 명시적 상태 계약으로 전환" },
	});
	assert.throws(() => resolvePrReviewQuestionContext(snapshot, {
		scope: "meaning",
		meaningId: "M-visible",
		evidenceIds: ["D002"],
		selectionKind: "meaning",
		selectionId: "M-visible",
	}), /meaning context does not match/);
});
