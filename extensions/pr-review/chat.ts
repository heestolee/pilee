import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { PrReviewRunState } from "./run.ts";

export type PrReviewQuestionScope = "session" | "file" | "card" | "evidence";
export type PrReviewQuestionStatus = "queued" | "answering" | "answered" | "failed";
export type PrReviewQuestionSelectionKind = "file" | "line" | "hunk" | "card";

export interface PrReviewQuestionSelection {
	kind: PrReviewQuestionSelectionKind;
	id: string;
	label: string;
}

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
	selection?: PrReviewQuestionSelection;
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

interface QuestionContextSnapshot {
	source: {
		files: Array<{
			id: string;
			path: string;
			lines: Array<{ id: string; oldLine?: number; newLine?: number }>;
		}>;
	};
	guides?: Array<{ path: string; hunks?: Array<{ id: string; title: string; evidenceIds?: string[] }> }>;
	cards: Array<{ id: string; title?: string; evidenceIds?: string[]; code?: { path?: string } }>;
}

function uniqueStrings(value: unknown): string[] {
	return Array.isArray(value)
		? [...new Set(value.filter((item): item is string => typeof item === "string" && !!item.trim()).map((item) => item.trim()))]
		: [];
}

function sameStringSet(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((value) => right.includes(value));
}

export function resolvePrReviewQuestionContext(snapshot: QuestionContextSnapshot, input: Record<string, unknown>): {
	scope: PrReviewQuestionScope;
	cardId?: string;
	fileId?: string;
	filePath?: string;
	evidenceIds?: string[];
	selection?: PrReviewQuestionSelection;
} {
	const scope = ["session", "file", "card", "evidence"].includes(String(input.scope)) ? String(input.scope) as PrReviewQuestionScope : "session";
	const cardId = typeof input.cardId === "string" ? input.cardId : undefined;
	const fileId = typeof input.fileId === "string" ? input.fileId : undefined;
	const evidenceIds = uniqueStrings(input.evidenceIds);
	const selectionKind = typeof input.selectionKind === "string" ? input.selectionKind as PrReviewQuestionSelectionKind : undefined;
	const selectionId = typeof input.selectionId === "string" ? input.selectionId.trim() : "";
	const card = cardId ? snapshot.cards.find((item) => item.id === cardId) : undefined;
	const file = fileId ? snapshot.source.files.find((item) => item.id === fileId) : undefined;
	const cardFile = card?.code?.path ? snapshot.source.files.find((item) => item.path === card.code?.path) : undefined;
	const cardEvidenceIds = uniqueStrings(card?.evidenceIds);
	const knownEvidence = new Set(snapshot.source.files.flatMap((item) => item.lines.map((line) => line.id)));
	if (scope === "session" && (cardId || fileId || evidenceIds.length || selectionKind || selectionId)) throw new Error("session question cannot include selected context");
	if (scope === "file" && (!file || cardId || evidenceIds.length)) throw new Error("known fileId without card or evidence is required");
	if (scope === "card") {
		if (!card) throw new Error("known cardId is required");
		if (!cardFile) throw new Error("known card source file is required");
		if ((fileId && fileId !== cardFile.id) || (evidenceIds.length && !sameStringSet(evidenceIds, cardEvidenceIds))) throw new Error("card context does not match review card");
	}
	if (scope === "evidence" && (!evidenceIds.length || evidenceIds.some((id) => !knownEvidence.has(id)))) throw new Error("known evidenceIds are required");
	let selectedFile = scope === "card" ? cardFile : file ?? (scope === "evidence" ? cardFile : undefined);
	const resolvedEvidenceIds = scope === "card" ? cardEvidenceIds : scope === "evidence" ? evidenceIds : undefined;
	let selection: PrReviewQuestionSelection | undefined;
	if (selectionKind || selectionId) {
		if (!selectionKind || !["file", "line", "hunk", "card"].includes(selectionKind) || !selectionId) throw new Error("valid selectionKind and selectionId are required together");
		if (selectionKind === "file") {
			if (scope !== "file" || !file || selectionId !== file.id) throw new Error("file selection does not match question scope");
			selection = { kind: "file", id: file.id, label: `파일 · ${file.path}` };
		} else if (selectionKind === "card") {
			if (scope !== "card" || !card || selectionId !== card.id) throw new Error("card selection does not match question scope");
			selection = { kind: "card", id: card.id, label: `리뷰 포인트 · ${card.id}${card.title ? ` · ${card.title}` : ""}` };
		} else if (selectionKind === "line") {
			const lineFile = snapshot.source.files.find((item) => item.lines.some((line) => line.id === selectionId));
			const line = lineFile?.lines.find((item) => item.id === selectionId);
			if (scope !== "evidence" || !lineFile || !line || !sameStringSet(evidenceIds, [selectionId]) || (fileId && fileId !== lineFile.id)) throw new Error("line selection does not match question evidence");
			selectedFile = lineFile;
			const lineNumber = line.newLine ?? line.oldLine;
			selection = { kind: "line", id: selectionId, label: `코드 줄 · ${lineFile.path}${lineNumber ? `:${lineNumber}` : ""}` };
		} else {
			const guide = (snapshot.guides ?? []).find((item) => item.hunks?.some((hunk) => hunk.id === selectionId));
			const hunk = guide?.hunks?.find((item) => item.id === selectionId);
			const hunkEvidenceIds = uniqueStrings(hunk?.evidenceIds);
			const hunkFile = guide ? snapshot.source.files.find((item) => item.path === guide.path) : undefined;
			if (scope !== "evidence" || !guide || !hunk || !hunkFile || !sameStringSet(evidenceIds, hunkEvidenceIds) || (fileId && fileId !== hunkFile.id)) throw new Error("hunk selection does not match question evidence");
			selectedFile = hunkFile;
			selection = { kind: "hunk", id: hunk.id, label: `설명 블록 · ${hunk.title}` };
		}
	}
	return {
		scope,
		cardId: card?.id,
		fileId: selectedFile?.id,
		filePath: selectedFile?.path,
		evidenceIds: resolvedEvidenceIds?.length ? [...new Set(resolvedEvidenceIds)] : undefined,
		selection,
	};
}

function normalizeSelection(scope: PrReviewQuestionScope, selection: PrReviewQuestionSelection | undefined): PrReviewQuestionSelection | undefined {
	if (!selection) return undefined;
	const expectedScope = selection.kind === "file" ? "file" : selection.kind === "card" ? "card" : "evidence";
	if (scope !== expectedScope || !selection.id.trim() || !selection.label.trim()) throw new Error("selection does not match question scope");
	return { kind: selection.kind, id: selection.id.trim(), label: selection.label.trim() };
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
		selection: normalizeSelection(input.scope, input.selection),
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
	if (!current) throw new Error(`unknown Meta Review question: ${questionId}`);
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
	return updatePrReviewQuestion(runDir, questionId, { status: "failed", error: error.trim() || "Meta Review question failed" }, now);
}

function questionContext(question: PrReviewQuestion): string {
	return [
		`- scope: ${question.scope}`,
		question.cardId ? `- cardId: ${question.cardId}` : undefined,
		question.fileId ? `- fileId: ${question.fileId}` : undefined,
		question.filePath ? `- filePath: ${question.filePath}` : undefined,
		question.evidenceIds?.length ? `- evidenceIds: ${question.evidenceIds.join(", ")}` : undefined,
		question.selection ? `- selectedBlock: ${question.selection.kind}:${question.selection.id} (${question.selection.label})` : undefined,
	].filter(Boolean).join("\n");
}

export function dispatchPrReviewQuestionToSession(
	pi: ExtensionAPI,
	state: PrReviewRunState,
	question: PrReviewQuestion,
): void {
	try {
		pi.sendMessage({
			customType: "pilee-meta-review-question",
			display: false,
			content: [
				"# Guided Meta Review question",
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
				"1. 설명·ReviewCard 문장을 반복하지 말고 `.pi/review-context.json` 또는 legacy metadata, 실제 source, callsite, schema, test를 필요한 만큼 직접 조사한다.",
				"2. repository를 수정하지 않는다. 읽기·검색·좁은 read-only 검증만 수행한다.",
				"3. 쉬운 설명 → 코드에서 확인된 사실 → 아직 모르는 정책/가정 → 리뷰 판단 순서로 답한다.",
				"4. 확인한 file/line/URL을 evidence로 남긴다. 추측은 uncertainty에 분리한다.",
				`5. 최종 응답은 반드시 \`meta_review_chat\` action=\"answer\", runId=\"${state.runId}\", questionId=\"${question.id}\"로 저장한다. 실패하면 action=\"fail\"을 사용한다.`,
			].join("\n"),
			details: { runId: state.runId, runDir: state.runDir, question },
		}, { deliverAs: "followUp", triggerTurn: true });
		updatePrReviewQuestion(state.runDir, question.id, { status: "answering", error: undefined });
	} catch (error) {
		failPrReviewQuestion(state.runDir, question.id, error instanceof Error ? error.message : String(error));
		throw error;
	}
}
