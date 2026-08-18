import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PrReviewRunState } from "./run.ts";

export type PrReviewQuestionScope = "session" | "file" | "card" | "evidence";
export type PrReviewQuestionStatus = "queued" | "answering" | "answered" | "failed";

export interface PrReviewQuestionEvidence {
	label: string;
	path?: string;
	line?: number;
	url?: string;
	note?: string;
}

export interface PrReviewQuestion {
	id: string;
	runId: string;
	question: string;
	scope: PrReviewQuestionScope;
	cardId?: string;
	fileId?: string;
	filePath?: string;
	evidenceIds?: string[];
	status: PrReviewQuestionStatus;
	answer?: string;
	evidence?: PrReviewQuestionEvidence[];
	uncertainty?: string;
	error?: string;
	createdAt: number;
	updatedAt: number;
	answeredAt?: number;
}

interface QuestionEvent {
	type: "question-snapshot";
	question: PrReviewQuestion;
}

export function prReviewQuestionsPath(runDir: string): string {
	return join(runDir, "questions.jsonl");
}

function appendQuestion(runDir: string, question: PrReviewQuestion): PrReviewQuestion {
	appendFileSync(prReviewQuestionsPath(runDir), `${JSON.stringify({ type: "question-snapshot", question } satisfies QuestionEvent)}\n`, "utf8");
	return question;
}

export function loadPrReviewQuestions(runDir: string): PrReviewQuestion[] {
	const path = prReviewQuestionsPath(runDir);
	if (!existsSync(path)) return [];
	const latest = new Map<string, PrReviewQuestion>();
	for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line) as QuestionEvent;
			if (event.type === "question-snapshot" && event.question?.id) latest.set(event.question.id, event.question);
		} catch {}
	}
	return [...latest.values()].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

function nextQuestionId(questions: PrReviewQuestion[]): string {
	const max = questions.reduce((value, question) => Math.max(value, Number(question.id.match(/^Q(\d+)$/)?.[1] ?? 0)), 0);
	return `Q${String(max + 1).padStart(3, "0")}`;
}

export function createPrReviewQuestion(
	runDir: string,
	input: Omit<PrReviewQuestion, "id" | "status" | "createdAt" | "updatedAt">,
	now = Date.now(),
): PrReviewQuestion {
	if (!input.question.trim()) throw new Error("question is required");
	const questions = loadPrReviewQuestions(runDir);
	return appendQuestion(runDir, {
		...input,
		id: nextQuestionId(questions),
		question: input.question.trim(),
		evidenceIds: input.evidenceIds?.length ? [...new Set(input.evidenceIds)] : undefined,
		status: "queued",
		createdAt: now,
		updatedAt: now,
	});
}

export function updatePrReviewQuestion(
	runDir: string,
	questionId: string,
	patch: Partial<Omit<PrReviewQuestion, "id" | "runId" | "question" | "scope" | "createdAt">>,
	now = Date.now(),
): PrReviewQuestion {
	const current = loadPrReviewQuestions(runDir).find((question) => question.id === questionId);
	if (!current) throw new Error(`unknown PR review question: ${questionId}`);
	return appendQuestion(runDir, { ...current, ...patch, updatedAt: now });
}

export function answerPrReviewQuestion(
	runDir: string,
	questionId: string,
	answer: string,
	evidence: PrReviewQuestionEvidence[] = [],
	uncertainty?: string,
	now = Date.now(),
): PrReviewQuestion {
	if (!answer.trim()) throw new Error("answer is required");
	return updatePrReviewQuestion(runDir, questionId, {
		status: "answered",
		answer: answer.trim(),
		evidence,
		uncertainty: uncertainty?.trim() || undefined,
		error: undefined,
		answeredAt: now,
	}, now);
}

export function failPrReviewQuestion(runDir: string, questionId: string, error: string, now = Date.now()): PrReviewQuestion {
	return updatePrReviewQuestion(runDir, questionId, { status: "failed", error: error.trim() || "PR review question failed" }, now);
}

function questionContext(question: PrReviewQuestion): string {
	return [
		`- scope: ${question.scope}`,
		question.cardId ? `- cardId: ${question.cardId}` : undefined,
		question.fileId ? `- fileId: ${question.fileId}` : undefined,
		question.filePath ? `- filePath: ${question.filePath}` : undefined,
		question.evidenceIds?.length ? `- evidenceIds: ${question.evidenceIds.join(", ")}` : undefined,
	].filter(Boolean).join("\n");
}

export function dispatchPrReviewQuestionToSession(
	pi: ExtensionAPI,
	state: PrReviewRunState,
	question: PrReviewQuestion,
): void {
	try {
		pi.sendMessage({
			customType: "pilee-pr-review-question",
			display: false,
			content: [
				"# Guided PR Review question",
				"",
				"이 질문은 현재 Glimpse 오른쪽 대화 패널에서 사용자가 보낸 직접 요청이다. 현재 Pi session cwd는 PR head가 checkout된 review worktree여야 한다.",
				"",
				`- runId: ${state.runId}`,
				`- runDir: ${state.runDir}`,
				`- PR: ${state.target.url}`,
				`- expected head: ${state.target.headSha ?? "unknown"}`,
				`- questionId: ${question.id}`,
				questionContext(question),
				"",
				"## 사용자 질문",
				question.question,
				"",
				"## 답변 규칙",
				"1. ReviewCard 문장을 반복하지 말고 `.pi/pr-review.json`, 실제 source, callsite, schema, test를 필요한 만큼 직접 조사한다.",
				"2. repository를 수정하지 않는다. 읽기·검색·좁은 read-only 검증만 수행한다.",
				"3. 쉬운 설명 → 코드에서 확인된 사실 → 아직 모르는 정책/가정 → 리뷰 판단 순서로 답한다.",
				"4. 확인한 file/line/URL을 evidence로 남긴다. 추측은 uncertainty에 분리한다.",
				`5. 최종 응답은 반드시 \`pr_review_chat\` action=\"answer\", runId=\"${state.runId}\", questionId=\"${question.id}\"로 저장한다. 실패하면 action=\"fail\"을 사용한다.`,
			].join("\n"),
			details: { runId: state.runId, runDir: state.runDir, question },
		}, { deliverAs: "followUp", triggerTurn: true });
		updatePrReviewQuestion(state.runDir, question.id, { status: "answering", error: undefined });
	} catch (error) {
		failPrReviewQuestion(state.runDir, question.id, error instanceof Error ? error.message : String(error));
		throw error;
	}
}
