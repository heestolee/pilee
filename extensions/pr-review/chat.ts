import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createQuestionRoutingExecution, type QuestionExecution } from "../questions/runtime.ts";
import type { PrReviewRunState } from "./run.ts";

export type PrReviewQuestionScope = "session" | "file" | "card" | "evidence";
export type PrReviewQuestionStatus = "queued" | "answering" | "answered" | "failed" | "stale";
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
	execution?: QuestionExecution;
	transcriptEventKeys?: string[];
	workerResultPath?: string;
	workerRunId?: number;
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
		execution: input.execution ?? createQuestionRoutingExecution(now),
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

export type PrReviewTranscriptEventKind = "question" | "answer" | "failed" | "stale";

export const PR_REVIEW_TRANSCRIPT_LINEAGE_ENTRY = "meta-review-transcript-lineage";
const PR_REVIEW_TRANSCRIPT_CUSTOM_TYPE = "pilee-meta-review-transcript";

function transcriptEventText(question: PrReviewQuestion, eventKind: PrReviewTranscriptEventKind): string {
	const contextLabel = question.selection?.label ?? (question.scope === "session" ? "전체 PR" : question.filePath ?? question.cardId ?? question.scope);
	if (eventKind === "question") return `🔎 Meta Review 질문 · ${contextLabel}\n\n${question.question}`;
	if (eventKind === "failed" || eventKind === "stale") {
		const label = eventKind === "stale" ? "기준 변경" : "질문 실패";
		return `⚠️ Meta Review ${label} · ${contextLabel}\n\n질문: ${question.question}\n\n원인: ${question.error || "질문 조사에 실패했습니다."}`;
	}
	return [
		`✅ Meta Review 답변 · ${contextLabel}`,
		"",
		`질문: ${question.question}`,
		"",
		"답변:",
		question.answer || "",
		question.uncertainty ? `\n미확인:\n${question.uncertainty}` : undefined,
	].filter((value): value is string => typeof value === "string").join("\n");
}

function transcriptEventKey(question: PrReviewQuestion, eventKind: PrReviewTranscriptEventKind): string {
	return `${eventKind}:${question.id}:${createHash("sha256").update(transcriptEventText(question, eventKind)).digest("hex").slice(0, 12)}`;
}

export function publishPrReviewQuestionTranscript(
	pi: Pick<ExtensionAPI, "appendEntry" | "sendMessage">,
	state: PrReviewRunState,
	question: PrReviewQuestion,
	eventKind: PrReviewTranscriptEventKind,
): PrReviewQuestion {
	const current = loadPrReviewQuestions(state.runDir).find((item) => item.id === question.id) ?? question;
	const eventKey = transcriptEventKey(current, eventKind);
	if (current.transcriptEventKeys?.includes(eventKey)) return current;
	const content = transcriptEventText(current, eventKind);
	const details = { runId: state.runId, questionId: current.id, eventKind, eventKey, scope: current.scope, selection: current.selection };
	let published = false;
	try {
		pi.appendEntry(PR_REVIEW_TRANSCRIPT_LINEAGE_ENTRY, { content, details, display: true });
		published = true;
	} catch {}
	if (!published) {
		try {
			pi.sendMessage({ customType: PR_REVIEW_TRANSCRIPT_CUSTOM_TYPE, content, display: true, details }, { deliverAs: "nextTurn", triggerTurn: false });
			published = true;
		} catch {}
	}
	if (!published) return current;
	return updatePrReviewQuestion(state.runDir, current.id, {
		transcriptEventKeys: [...new Set([...(current.transcriptEventKeys ?? []), eventKey])],
	});
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
		const visibleQuestion = publishPrReviewQuestionTranscript(pi, state, question, "question");
		pi.sendMessage({
			customType: "pilee-meta-review-question",
			display: false,
			content: [
				"# Guided Meta Review question routing request",
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
				"## routing 원칙",
				"1. 글자 수, 파일 수, 특정 단어 같은 고정 임계값으로 판단하지 않는다.",
				"2. 현재 selection과 review source만으로 답이 닫히면 direct다.",
				"3. 외부 precedent, 실행 검증, 여러 독립 경로 비교, 전체 PR 재분석이 필요하면 worker다.",
				"4. 애매하면 기존 Meta Review 동작과 호환되도록 direct로 시작하고, 새 독립 조사 축이 실제로 발견될 때만 worker로 승격한다.",
				"",
				"## 실행 규칙",
				`1. 먼저 \`meta_review_chat\` action=\"status\", runId=\"${state.runId}\"로 최신 질문 상태를 확인한다.`,
				`2. \`meta_review_chat\` action=\"route\", runId=\"${state.runId}\", questionId=\"${question.id}\", executionMode=\"direct|worker\", routeReason=\"짧은 한국어 판단 근거\"를 호출한다.`,
				"3. direct이면 실제 source, callsite, schema, test를 필요한 만큼 좁게 조사하고 repository를 수정하지 않는다.",
				`4. direct 조사 중 새 독립 작업 축이 발견되면 같은 questionId로 action=\"route\", executionMode=\"worker\"를 한 번 호출한다.`,
				`5. direct 최종 응답은 \`meta_review_chat\` action=\"answer\", runId=\"${state.runId}\", questionId=\"${question.id}\"로 저장한다. 실패하면 action=\"fail\"을 사용한다.`,
				"6. worker이면 extension이 head-pinned 전용 worker를 시작하므로 별도 subagent를 중복 실행하지 않고 turn을 끝낸다.",
			].join("\n"),
			details: { runId: state.runId, runDir: state.runDir, question: visibleQuestion },
		}, { deliverAs: "followUp", triggerTurn: true });
	} catch (error) {
		failPrReviewQuestion(state.runDir, question.id, error instanceof Error ? error.message : String(error));
		throw error;
	}
}
