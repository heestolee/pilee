import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	createQuestionRoutingExecution,
	normalizeQuestionExecution,
	routeQuestionExecution,
	updateQuestionExecutionPhase,
	type QuestionExecution,
	type QuestionExecutionMode,
} from "../questions/runtime.ts";
import type { ReviewDeclarationUnit, ReviewFileSourceSnapshot } from "./evidence.ts";
import type { PrReviewRunState } from "./run.ts";

export type PrReviewQuestionScope = "session" | "section" | "meaning" | "declaration" | "file" | "card" | "evidence";
export type PrReviewQuestionStatus = "queued" | "answering" | "answered" | "failed" | "stale";
export type PrReviewQuestionSelectionKind = "section" | "meaning" | "declaration" | "file" | "line" | "hunk" | "card";

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

export interface PrReviewQuestionAttachment {
	id: string;
	name: string;
	mimeType?: string;
	path: string;
	url?: string;
}

export interface PrReviewQuestion {
	id: string;
	runId: string;
	question: string;
	scope: PrReviewQuestionScope;
	cardId?: string;
	sectionId?: string;
	meaningId?: string;
	declarationId?: string;
	declarationSide?: "before" | "after";
	fileId?: string;
	filePath?: string;
	evidenceIds?: string[];
	selection?: PrReviewQuestionSelection;
	attachmentIds?: string[];
	attachments?: PrReviewQuestionAttachment[];
	status: PrReviewQuestionStatus;
	execution?: QuestionExecution;
	transcriptEventKeys?: string[];
	workerResultPath?: string;
	workerRunId?: number;
	expectedSourceSha256?: string;
	expectedHeadSha?: string;
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

interface PrReviewQuestionCanonicalState {
	content: string;
	latest: Map<string, PrReviewQuestion>;
}

interface PrReviewQuestionCanonicalRegistry {
	states: Map<string, PrReviewQuestionCanonicalState>;
}

const PR_REVIEW_QUESTION_CANONICAL_REGISTRY = Symbol.for("pilee.meta-review.question-canonical-registry");

function parseQuestionCanonical(content: string): Map<string, PrReviewQuestion> {
	const latest = new Map<string, PrReviewQuestion>();
	for (const line of content.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const event = JSON.parse(line) as QuestionEvent;
			if (event.type === "question-snapshot" && event.question?.id) latest.set(event.question.id, structuredClone(event.question));
		} catch {}
	}
	return latest;
}

function questionCanonicalRegistry(): PrReviewQuestionCanonicalRegistry {
	const root = globalThis as typeof globalThis & { [PR_REVIEW_QUESTION_CANONICAL_REGISTRY]?: PrReviewQuestionCanonicalRegistry };
	return root[PR_REVIEW_QUESTION_CANONICAL_REGISTRY] ??= { states: new Map() };
}

function questionCanonicalState(runDir: string): PrReviewQuestionCanonicalState {
	const key = resolve(prReviewQuestionsPath(runDir));
	const registry = questionCanonicalRegistry();
	const existing = registry.states.get(key);
	if (existing) return existing;
	const content = existsSync(key) ? readFileSync(key, "utf8") : "";
	const state = { content, latest: parseQuestionCanonical(content) };
	registry.states.set(key, state);
	return state;
}

function appendQuestion(runDir: string, question: PrReviewQuestion): PrReviewQuestion {
	const path = prReviewQuestionsPath(runDir);
	const state = questionCanonicalState(runDir);
	const snapshot = structuredClone(question);
	const separator = state.content && !state.content.endsWith("\n") ? "\n" : "";
	state.content = `${state.content}${separator}${JSON.stringify({ type: "question-snapshot", question: snapshot } satisfies QuestionEvent)}\n`;
	state.latest.set(snapshot.id, snapshot);
	writeFileSync(path, state.content, "utf8");
	return structuredClone(snapshot);
}

export function assertPrReviewQuestionCanonicalIntegrity(runDir: string): void {
	const path = prReviewQuestionsPath(runDir);
	const state = questionCanonicalState(runDir);
	const observed = existsSync(path) ? readFileSync(path, "utf8") : "";
	if (observed !== state.content) throw new Error("Meta Review worker가 coordinator-owned questions canonical을 변경했습니다.");
}

export function appendPrReviewQuestionCoordinatorSnapshot(runDir: string, question: PrReviewQuestion): PrReviewQuestion {
	if (!question.id || !question.runId || !question.question || !question.scope || !Number.isFinite(question.createdAt)) {
		throw new Error("invalid coordinator-owned Meta Review question snapshot");
	}
	return appendQuestion(runDir, question);
}

export function loadPrReviewQuestions(runDir: string): PrReviewQuestion[] {
	const latest = questionCanonicalState(runDir).latest;
	return [...latest.values()]
		.map((question) => structuredClone(question))
		.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
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
			declarationSource?: Pick<ReviewFileSourceSnapshot, "declarations">;
			lines: Array<{ id: string; oldLine?: number; newLine?: number }>;
		}>;
	};
	document?: { meanings?: Array<{ id: string; title: string; evidenceIds?: string[] }> };
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

const PR_REVIEW_SECTION_LABELS: Record<string, string> = {
	overview: "한눈에 보기",
	relationships: "변경 파일 관계",
};

const PR_REVIEW_DECLARATION_KIND_LABELS: Record<ReviewDeclarationUnit["kind"], string> = {
	file: "파일",
	import: "import",
	variable: "변수",
	function: "함수",
	component: "컴포넌트",
	hook: "훅",
	method: "메서드",
	constructor: "생성자",
	class: "클래스",
	interface: "인터페이스",
	type: "타입",
	enum: "enum",
	namespace: "namespace",
	property: "속성",
	accessor: "접근자",
	"test-suite": "테스트 묶음",
	test: "테스트",
};

function declarationSelectionLabel(declaration: ReviewDeclarationUnit, side: "before" | "after"): string {
	const range = declaration[side]!;
	const lines = range.startLine === range.endLine ? `L${range.startLine}` : `L${range.startLine}–L${range.endLine}`;
	return `${PR_REVIEW_DECLARATION_KIND_LABELS[declaration.kind]} · ${declaration.name} · ${side === "before" ? "변경 전" : "변경 후"} ${lines}`;
}

export function resolvePrReviewQuestionContext(snapshot: QuestionContextSnapshot, input: Record<string, unknown>): {
	scope: PrReviewQuestionScope;
	cardId?: string;
	sectionId?: string;
	meaningId?: string;
	declarationId?: string;
	declarationSide?: "before" | "after";
	fileId?: string;
	filePath?: string;
	evidenceIds?: string[];
	selection?: PrReviewQuestionSelection;
} {
	const scope = ["session", "section", "meaning", "declaration", "file", "card", "evidence"].includes(String(input.scope)) ? String(input.scope) as PrReviewQuestionScope : "session";
	const cardId = typeof input.cardId === "string" ? input.cardId : undefined;
	const sectionId = typeof input.sectionId === "string" ? input.sectionId.trim() : undefined;
	const meaningId = typeof input.meaningId === "string" ? input.meaningId.trim() : undefined;
	const declarationId = typeof input.declarationId === "string" ? input.declarationId.trim() : undefined;
	const declarationSide = input.declarationSide === "before" || input.declarationSide === "after" ? input.declarationSide : undefined;
	const declarationSideProvided = input.declarationSide !== undefined && input.declarationSide !== null;
	const fileId = typeof input.fileId === "string" ? input.fileId : undefined;
	const evidenceIds = uniqueStrings(input.evidenceIds);
	const selectionKind = typeof input.selectionKind === "string" ? input.selectionKind as PrReviewQuestionSelectionKind : undefined;
	const selectionId = typeof input.selectionId === "string" ? input.selectionId.trim() : "";
	const card = cardId ? snapshot.cards.find((item) => item.id === cardId) : undefined;
	const meaning = meaningId ? snapshot.document?.meanings?.find((item) => item.id === meaningId) : undefined;
	const meaningEvidenceIds = uniqueStrings(meaning?.evidenceIds);
	const file = fileId ? snapshot.source.files.find((item) => item.id === fileId) : undefined;
	const declarationFile = declarationId ? snapshot.source.files.find((item) => item.declarationSource?.declarations.some((declaration) => declaration.id === declarationId)) : undefined;
	const declaration = declarationId ? declarationFile?.declarationSource?.declarations.find((item) => item.id === declarationId) : undefined;
	const declarationEvidenceIds = uniqueStrings(declaration?.evidenceIds);
	const cardFile = card?.code?.path ? snapshot.source.files.find((item) => item.path === card.code?.path) : undefined;
	const cardEvidenceIds = uniqueStrings(card?.evidenceIds);
	const knownEvidence = new Set(snapshot.source.files.flatMap((item) => item.lines.map((line) => line.id)));
	if (scope === "session" && (cardId || sectionId || meaningId || declarationId || declarationSideProvided || fileId || evidenceIds.length || selectionKind || selectionId)) throw new Error("session question cannot include selected context");
	if (scope === "section" && (!sectionId || !PR_REVIEW_SECTION_LABELS[sectionId] || cardId || meaningId || declarationId || declarationSideProvided || fileId || evidenceIds.length)) throw new Error("known sectionId is required without meaning, declaration, file, card, or evidence context");
	if (scope !== "section" && sectionId) throw new Error("sectionId requires section question scope");
	if (scope === "meaning") {
		if (!meaningId || !meaning) throw new Error("known meaningId is required");
		if (cardId || declarationId || declarationSideProvided || fileId || !sameStringSet(evidenceIds, meaningEvidenceIds)) throw new Error("meaning context does not match captured document");
	}
	if (scope !== "meaning" && meaningId) throw new Error("meaningId requires meaning question scope");
	if (scope === "declaration") {
		if (!declarationId || !declaration || !declarationFile) throw new Error("known declarationId is required");
		if (!declarationSide) throw new Error("valid declarationSide is required");
		if (!declaration[declarationSide] || cardId || sectionId || (fileId && fileId !== declarationFile.id) || !sameStringSet(evidenceIds, declarationEvidenceIds)) throw new Error("declaration context does not match captured source");
	}
	if (scope !== "declaration" && (declarationId || declarationSideProvided)) throw new Error("declaration context requires declaration question scope");
	if (scope === "file" && (!file || cardId || evidenceIds.length)) throw new Error("known fileId without card or evidence is required");
	if (scope === "card") {
		if (!card) throw new Error("known cardId is required");
		if (!cardFile) throw new Error("known card source file is required");
		if ((fileId && fileId !== cardFile.id) || (evidenceIds.length && !sameStringSet(evidenceIds, cardEvidenceIds))) throw new Error("card context does not match review card");
	}
	if (scope === "evidence" && (!evidenceIds.length || evidenceIds.some((id) => !knownEvidence.has(id)))) throw new Error("known evidenceIds are required");
	let selectedFile = scope === "declaration" ? declarationFile : scope === "card" ? cardFile : file ?? (scope === "evidence" ? cardFile : undefined);
	const resolvedEvidenceIds = scope === "meaning" ? meaningEvidenceIds : scope === "declaration" ? declarationEvidenceIds : scope === "card" ? cardEvidenceIds : scope === "evidence" ? evidenceIds : undefined;
	let selection: PrReviewQuestionSelection | undefined;
	if (selectionKind || selectionId) {
		if (!selectionKind || !["section", "meaning", "declaration", "file", "line", "hunk", "card"].includes(selectionKind) || !selectionId) throw new Error("valid selectionKind and selectionId are required together");
		if (selectionKind === "section") {
			if (scope !== "section" || !sectionId || selectionId !== sectionId || !PR_REVIEW_SECTION_LABELS[sectionId]) throw new Error("section selection does not match question scope");
			selection = { kind: "section", id: sectionId, label: PR_REVIEW_SECTION_LABELS[sectionId] };
		} else if (selectionKind === "meaning") {
			if (scope !== "meaning" || !meaning || selectionId !== meaning.id) throw new Error("meaning selection does not match question scope");
			selection = { kind: "meaning", id: meaning.id, label: `변경 의미 · ${meaning.title}` };
		} else if (selectionKind === "declaration") {
			if (scope !== "declaration" || !declaration || !declarationSide || selectionId !== declaration.id) throw new Error("declaration selection does not match question scope");
			selection = { kind: "declaration", id: declaration.id, label: declarationSelectionLabel(declaration, declarationSide) };
		} else if (selectionKind === "file") {
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
			selection = { kind: "hunk", id: hunk.id, label: `변경 단위 · ${hunk.title}` };
		}
	}
	return {
		scope,
		cardId: card?.id,
		...(sectionId ? { sectionId } : {}),
		...(meaningId ? { meaningId } : {}),
		...(declarationId ? { declarationId } : {}),
		...(declarationSide ? { declarationSide } : {}),
		fileId: selectedFile?.id,
		filePath: selectedFile?.path,
		evidenceIds: resolvedEvidenceIds?.length ? [...new Set(resolvedEvidenceIds)] : undefined,
		selection,
	};
}

function normalizeSelection(scope: PrReviewQuestionScope, selection: PrReviewQuestionSelection | undefined): PrReviewQuestionSelection | undefined {
	if (!selection) return undefined;
	const expectedScope = selection.kind === "section" ? "section" : selection.kind === "meaning" ? "meaning" : selection.kind === "declaration" ? "declaration" : selection.kind === "file" ? "file" : selection.kind === "card" ? "card" : "evidence";
	if (scope !== expectedScope || !selection.id.trim() || !selection.label.trim()) throw new Error("selection does not match question scope");
	return { kind: selection.kind, id: selection.id.trim(), label: selection.label.trim() };
}

function normalizeQuestionAttachments(
	attachmentIds: string[] | undefined,
	attachments: PrReviewQuestionAttachment[] | undefined,
): { attachmentIds?: string[]; attachments?: PrReviewQuestionAttachment[] } {
	const records: PrReviewQuestionAttachment[] = [];
	const seen = new Set<string>();
	for (const attachment of attachments ?? []) {
		const id = attachment.id.trim();
		const name = attachment.name.trim();
		const path = attachment.path.trim();
		if (!id || !name || !path) throw new Error("question attachment requires id, name, and path");
		if (seen.has(id)) continue;
		seen.add(id);
		records.push({
			id,
			name,
			mimeType: attachment.mimeType?.trim() || undefined,
			path,
			url: attachment.url?.trim() || undefined,
		});
		if (records.length === 4) break;
	}
	const ids = [...new Set((attachmentIds ?? records.map((attachment) => attachment.id)).map((id) => id.trim()).filter(Boolean))].slice(0, 4);
	if (ids.length && (!records.length || ids.some((id) => !seen.has(id)) || records.some((attachment) => !ids.includes(attachment.id)))) {
		throw new Error("question attachmentIds and attachment records must match");
	}
	return {
		attachmentIds: ids.length ? ids : undefined,
		attachments: records.length ? records : undefined,
	};
}

export function createPrReviewQuestion(
	runDir: string,
	input: Omit<PrReviewQuestion, "id" | "status" | "createdAt" | "updatedAt">,
	now = Date.now(),
): PrReviewQuestion {
	if (!input.question.trim()) throw new Error("question is required");
	const questions = loadPrReviewQuestions(runDir);
	const attachmentData = normalizeQuestionAttachments(input.attachmentIds, input.attachments);
	return appendQuestion(runDir, {
		...input,
		id: nextQuestionId(questions),
		question: input.question.trim(),
		evidenceIds: input.evidenceIds?.length ? [...new Set(input.evidenceIds)] : undefined,
		selection: normalizeSelection(input.scope, input.selection),
		...attachmentData,
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

export function isPrReviewQuestionTerminal(question: PrReviewQuestion): boolean {
	const phase = normalizeQuestionExecution(question.execution)?.phase;
	return ["answered", "failed", "stale"].includes(question.status) || phase === "answered" || phase === "failed" || phase === "stale";
}

function questionExecutionForMode(question: PrReviewQuestion, mode: QuestionExecutionMode, reason: string, now: number): QuestionExecution {
	const execution = normalizeQuestionExecution(question.execution);
	if (execution?.mode && execution.mode !== mode) throw new Error(`${execution.mode} 질문을 ${mode} 경로로 완료할 수 없습니다.`);
	return execution?.mode ? execution : routeQuestionExecution(question.execution, mode, reason, now);
}

export function answerPrReviewQuestion(
	runDir: string,
	questionId: string,
	answer: string,
	evidence: PrReviewQuestionEvidence[] = [],
	uncertainty?: string,
	now = Date.now(),
	executionMode: QuestionExecutionMode = "direct",
	workerRunId?: number,
): PrReviewQuestion {
	if (!answer.trim()) throw new Error("answer is required");
	const current = loadPrReviewQuestions(runDir).find((question) => question.id === questionId);
	if (!current) throw new Error(`unknown Meta Review question: ${questionId}`);
	if (isPrReviewQuestionTerminal(current)) return current;
	const execution = updateQuestionExecutionPhase(questionExecutionForMode(current, executionMode, `${executionMode} 답변 완료`, now), "answered", now);
	return appendQuestion(runDir, {
		...current,
		status: "answered",
		execution,
		answer: answer.trim(),
		evidence,
		uncertainty: uncertainty?.trim() || undefined,
		error: undefined,
		answeredAt: now,
		workerRunId: Number.isInteger(workerRunId) ? workerRunId : current.workerRunId,
		updatedAt: now,
	});
}

export function failPrReviewQuestion(
	runDir: string,
	questionId: string,
	error: string,
	now = Date.now(),
	executionMode: QuestionExecutionMode = "direct",
	workerRunId?: number,
): PrReviewQuestion {
	const current = loadPrReviewQuestions(runDir).find((question) => question.id === questionId);
	if (!current) throw new Error(`unknown Meta Review question: ${questionId}`);
	if (isPrReviewQuestionTerminal(current)) return current;
	const execution = updateQuestionExecutionPhase(questionExecutionForMode(current, executionMode, `${executionMode} 처리 실패`, now), "failed", now);
	return appendQuestion(runDir, {
		...current,
		status: "failed",
		execution,
		workerRunId: Number.isInteger(workerRunId) ? workerRunId : current.workerRunId,
		error: error.trim() || "Meta Review question failed",
		updatedAt: now,
	});
}

export function stalePrReviewQuestion(
	runDir: string,
	questionId: string,
	error: string,
	now = Date.now(),
	executionMode: QuestionExecutionMode = "worker",
	workerRunId?: number,
): PrReviewQuestion {
	const current = loadPrReviewQuestions(runDir).find((question) => question.id === questionId);
	if (!current) throw new Error(`unknown Meta Review question: ${questionId}`);
	if (isPrReviewQuestionTerminal(current)) return current;
	const execution = updateQuestionExecutionPhase(questionExecutionForMode(current, executionMode, "review source freshness 변경", now), "stale", now);
	return appendQuestion(runDir, {
		...current,
		status: "stale",
		execution,
		workerRunId: Number.isInteger(workerRunId) ? workerRunId : current.workerRunId,
		error: error.trim() || "Meta Review review source가 변경되었습니다.",
		updatedAt: now,
	});
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
		question.sectionId ? `- sectionId: ${question.sectionId}` : undefined,
		question.meaningId ? `- meaningId: ${question.meaningId}` : undefined,
		question.declarationId ? `- declarationId: ${question.declarationId}` : undefined,
		question.declarationSide ? `- declarationSide: ${question.declarationSide}` : undefined,
		question.fileId ? `- fileId: ${question.fileId}` : undefined,
		question.filePath ? `- filePath: ${question.filePath}` : undefined,
		question.evidenceIds?.length ? `- evidenceIds: ${question.evidenceIds.join(", ")}` : undefined,
		question.selection ? `- selectedBlock: ${question.selection.kind}:${question.selection.id} (${question.selection.label})` : undefined,
		question.attachments?.length ? `- attachments: ${JSON.stringify(question.attachments)}` : undefined,
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
