import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { buildTftVisualEmbedHtml } from "../frame-studio/index.ts";
import {
	createLearningCompanionState,
	normalizeLearningCompanionState,
	recordLearningCheckpoint,
	recordLearningEvent,
	updateLearningProposalStatus,
	upsertLearningProposal,
	type LearningArtifactRefs,
	type LearningCheckpoint,
	type LearningCompanionManifest,
	type LearningCompanionPhase,
	type LearningCompanionState,
	type LearningEventInput,
	type LearningProposalInput,
	type LearningProposalStatus,
} from "../learning-companion/state.ts";
import { captureGlimpseHtmlPng, getGlimpseOpen } from "../utils/glimpse.ts";
import { buildStudyHardStudioHtml } from "./studio-html.ts";
import { parseStudyLearningAgentJson, runIsolatedStudyLearningAgent, type StudyLearningAgentRunner } from "./learning-agents.ts";
import { resolveStudyHardRuntimeConfig } from "./runtime-config.ts";

export { buildStudyHardStudioHtml };

export type StudyConceptStatus = "unknown" | "learning" | "confused" | "understood" | "review";
export type StudyQuestionStatus = "open" | "answered" | "understood" | "review";
export type StudyQuestionOrigin = "learner" | "coach";
export type StudyQuestionScope = "session" | "node" | "flow-step" | "note-block" | "coach";
export type StudyQuestionProcessingStatus = "queued" | "running" | "answered" | "merging" | "applied" | "failed";
export type StudyBoardViewMode = "memo" | "detail" | "hybrid";
export type StudyConceptNodeType = "root" | "concept" | "question" | "confusion" | "decision" | "file" | "risk" | "summary" | "attachment";
export type StudySourceKind = "code" | "article" | "video" | "mixed";
export type StudyLearningPhase = "map" | "explain" | "trace" | "practice" | "reflect";
export type StudyCoachRole = "mentor" | "rubber-duck" | "peer" | "lead";
export type StudyLayoutMode = "auto" | "manual";
export type StudySurface = "map" | "flow" | "note";
export type StudyFlowVariant = "before" | "after" | "current";
export type StudyNoteSectionKind = "overview" | "node" | "flow" | "practice" | "reflection";
export type StudyNoteBlockType = "heading" | "paragraph" | "callout" | "list" | "table" | "code" | "reference-list" | "flow-ref" | "visual" | "visual-ref" | "divider";

const MAX_QUESTION_ATTACHMENTS = 4;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface StudyNodeReference {
	id?: string;
	kind: "code" | "article" | "video" | "link";
	label: string;
	path?: string;
	url?: string;
	symbol?: string;
	location?: string;
	excerpt?: string;
	note?: string;
	revision?: string;
	language?: string;
	startLine?: number;
}

export interface StudyCodeAnnotation {
	line: number;
	endLine?: number;
	kind?: "behavior" | "reason" | "risk" | "change";
	text: string;
}

export interface StudyCodeSample {
	language?: string;
	code: string;
	lineNumberMode?: "source" | "relative" | "none";
	startLine?: number;
	reference?: StudyNodeReference;
	annotations?: StudyCodeAnnotation[];
}

export interface StudyNoteVisualRef {
	sourceBlockId: string;
	laneId?: string;
}

export interface StudyNoteBlock {
	id: string;
	type: StudyNoteBlockType;
	level?: 1 | 2 | 3;
	text?: string;
	title?: string;
	body?: string;
	tone?: "info" | "warning" | "success" | "question";
	ordered?: boolean;
	items?: string[];
	columns?: string[];
	rows?: string[][];
	code?: StudyCodeSample;
	references?: StudyNodeReference[];
	flowId?: string;
	visual?: Record<string, unknown>;
	visualRef?: StudyNoteVisualRef;
}

export interface StudyNoteSection {
	id: string;
	kind: StudyNoteSectionKind;
	subjectId?: string;
	title: string;
	blocks: StudyNoteBlock[];
}

export interface StudyNoteDocument {
	title: string;
	sections: StudyNoteSection[];
}

export interface StudyFlowActor {
	id: string;
	label: string;
	role?: string;
}

export interface StudyFlowStep {
	id: string;
	order: number;
	from: string;
	to: string;
	action: string;
	trigger?: string;
	payload?: string;
	sideEffect?: string;
	result?: string;
	risk?: string;
	reference?: StudyNodeReference;
	code?: StudyCodeSample;
}

export interface StudyDataFlow {
	id: string;
	title: string;
	variant: StudyFlowVariant;
	summary?: string;
	actors: StudyFlowActor[];
	steps: StudyFlowStep[];
}

export interface StudyConceptNode {
	id: string;
	label: string;
	summary?: string;
	detail?: string;
	status?: StudyConceptStatus;
	type?: StudyConceptNodeType;
	parentId?: string;
	questionId?: string;
	references?: StudyNodeReference[];
	blocks?: StudyNoteBlock[];
	positionLocked?: boolean;
	x?: number;
	y?: number;
}

export interface StudyConceptEdge {
	id?: string;
	source: string;
	target: string;
	label?: string;
}

export interface StudyQuestionCard {
	id: string;
	question: string;
	origin?: StudyQuestionOrigin;
	scope?: StudyQuestionScope;
	userAnswer?: string;
	feedback?: string;
	status?: StudyQuestionStatus;
	targetNodeId?: string;
	targetFlowId?: string;
	targetFlowStepId?: string;
	targetNoteBlockId?: string;
	attachmentIds?: string[];
	createdAt?: number;
	answeredAt?: number;
	processingStatus?: StudyQuestionProcessingStatus;
	orchestrationId?: string;
	processingError?: string;
	processingErrorStage?: "tutor" | "editor" | "coach";
}

export interface StudyAttachment {
	id: string;
	scope?: Exclude<StudyQuestionScope, "coach">;
	nodeId?: string;
	targetFlowId?: string;
	targetFlowStepId?: string;
	targetNoteBlockId?: string;
	name: string;
	mimeType?: string;
	path?: string;
	url?: string;
	note?: string;
	createdAt: number;
}

export interface StudyNotionSyncState {
	pageId?: string;
	calendarDate?: string;
	pageUrl?: string;
	sessionId?: string;
	sectionHashes?: Record<string, string>;
	lastSyncedRevision?: number;
	lastSyncedHash?: string;
	lastSyncedAt?: number;
}

interface StudyDiagramExportAsset {
	blockId: string;
	fileName: string;
	mimeType: "image/png";
	path: string;
	sha256: string;
}

interface StudyNoteHistoryBundle {
	schemaVersion: 1;
	runId: string;
	revision: number;
	savedAt: number;
	hash: string;
	noteDocument: StudyNoteDocument;
	flows: StudyDataFlow[];
}

interface StudyNoteHistoryEntry {
	id: string;
	revision: number;
	savedAt: number;
	hash: string;
	title: string;
	sectionCount: number;
	current?: boolean;
}

export interface StudyHardBoardState {
	schemaVersion: 1;
	revision: number;
	runId: string;
	url: string;
	title: string;
	sourceTitle?: string;
	hints?: string;
	sourceKind: StudySourceKind;
	learningPhase: StudyLearningPhase;
	coachRole: StudyCoachRole;
	layoutMode: StudyLayoutMode;
	viewMode: StudyBoardViewMode;
	goals: string[];
	quickMap: string;
	mermaid: string;
	nodes: StudyConceptNode[];
	edges: StudyConceptEdge[];
	flows: StudyDataFlow[];
	noteDocument: StudyNoteDocument;
	activeSurface: StudySurface;
	selectedFlowId?: string;
	selectedFlowStepId?: string;
	selectedNoteBlockId?: string;
	mapViewport?: { x: number; y: number; zoom: number };
	questions: StudyQuestionCard[];
	attachments: StudyAttachment[];
	notionSync?: StudyNotionSyncState;
	companion?: LearningCompanionState;
	selectedNodeId?: string;
	recommendedNodeId?: string;
	currentQuestionId?: string;
	summary?: string;
	followups: string[];
	createdAt: number;
	updatedAt: number;
}

interface StudyHardHandle {
	state: StudyHardBoardState;
	server: Server;
	clients: Set<ServerResponse>;
	url: string;
	window?: { on?: (event: string, handler: () => void) => void; close?: () => void; show?: (options?: { title?: string }) => void };
	statePath: string;
	closed: boolean;
	pi: ExtensionAPI;
	cwd?: string;
	syncScript: string;
	downloadDir: string;
	notionSyncInFlight: boolean;
	capabilityToken: string;
	agentRunner: StudyLearningAgentRunner;
	agentModel?: string;
	agentThinking?: string;
	coachQueue: string[];
	coachQueueTimer?: ReturnType<typeof setTimeout>;
	coachOrchestrationRunning: boolean;
	orchestrationAbort: AbortController;
	transcriptEventKeys: Set<string>;
}

const execFileAsync = promisify(execFile);
const NOTE_HISTORY_LIMIT = 50;
const STUDY_HARD_TRANSCRIPT_CUSTOM_TYPE = "heestolee.study-hard.transcript";
const handles = new Map<string, StudyHardHandle>();
let latestRunId: string | undefined;

function sanitizeId(value: string): string {
	const normalized = value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[^a-z0-9가-힣]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	return normalized.slice(0, 64) || randomUUID();
}

function defaultMermaid(title: string): string {
	return `flowchart TD\n  Source["${escapeMermaid(title)}"] --> Goal["학습 목표"]\n  Goal --> Q1["1번 질문"]\n  Q1 --> Feedback["피드백"]\n  Feedback --> Next["다음 질문"]`;
}

function escapeMermaid(value: string): string {
	return value.replace(/["<>]/g, "");
}

export function createInitialBoardState(params: { url: string; title?: string; hints?: string; runId?: string }): StudyHardBoardState {
	const now = Date.now();
	const url = normalizeHttpUrl(params.url);
	if (!url) throw new Error("Study Hard requires an http(s) url");
	const title = params.title || titleFromUrl(url);
	const runId = params.runId || sanitizeId(`${title}-${now}`);
	return {
		schemaVersion: 1,
		revision: 0,
		runId,
		url,
		title,
		hints: params.hints,
		sourceKind: "mixed",
		learningPhase: "map",
		coachRole: "mentor",
		layoutMode: "auto",
		viewMode: "hybrid",
		goals: ["자료의 핵심 구조 파악", "헷갈리는 개념을 질문-답변으로 닫기", "이해한 내용을 실제 문제에 적용하기"],
		quickMap: "URL 내용을 읽은 뒤 핵심 개념 지도가 채워집니다.",
		mermaid: defaultMermaid(title),
		nodes: [
			{ id: "source", label: "자료", summary: title, status: "learning", type: "root", x: 0, y: 80 },
			{ id: "goal", label: "학습 목표", summary: "오늘 이해해야 할 핵심", status: "unknown", type: "concept", parentId: "source", x: 280, y: 80 },
			{ id: "q1", label: "1번 질문", summary: "첫 진단 질문", status: "unknown", type: "question", parentId: "goal", x: 560, y: 80 },
		],
		edges: [
			{ id: "source-goal", source: "source", target: "goal", label: "extract" },
			{ id: "goal-q1", source: "goal", target: "q1", label: "check" },
		],
		flows: [],
		noteDocument: {
			title,
			sections: [{
				id: "overview",
				kind: "overview",
				title: "학습 개요",
				blocks: [
					{ id: "overview-question", type: "heading", level: 2, text: "핵심 질문" },
					{ id: "overview-placeholder", type: "callout", tone: "question", title: "무엇을 이해해야 하나?", body: "자료를 읽은 뒤 핵심 질문과 mental model이 채워집니다." },
				],
			}],
		},
		activeSurface: "note",
		questions: [],
		attachments: [],
		selectedNodeId: "source",
		recommendedNodeId: "goal",
		followups: [],
		createdAt: now,
		updatedAt: now,
	};
}

function titleFromUrl(url: string): string {
	try {
		const parsed = new URL(url);
		const last = parsed.pathname.split("/").filter(Boolean).pop();
		return last ? decodeURIComponent(last).replace(/[-_]+/g, " ") : parsed.hostname;
	} catch {
		return "Study Hard";
	}
}

function normalizeHttpUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const parsed = new URL(value);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : undefined;
	} catch {
		return undefined;
	}
}

function normalizeReferences(value: unknown): StudyNodeReference[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
		.map((item) => ({
			id: typeof item.id === "string" ? item.id : undefined,
			kind: ["code", "article", "video", "link"].includes(String(item.kind)) ? String(item.kind) as StudyNodeReference["kind"] : "link",
			label: String(item.label || item.path || item.url || item.symbol || "근거"),
			path: typeof item.path === "string" ? item.path : undefined,
			url: normalizeHttpUrl(item.url),
			symbol: typeof item.symbol === "string" ? item.symbol : undefined,
			location: typeof item.location === "string" ? item.location : undefined,
			excerpt: typeof item.excerpt === "string" ? item.excerpt : undefined,
			note: typeof item.note === "string" ? item.note : undefined,
			revision: typeof item.revision === "string" ? item.revision : undefined,
			language: typeof item.language === "string" ? item.language : undefined,
			startLine: Number.isInteger(item.startLine) && Number(item.startLine) > 0 ? Number(item.startLine) : undefined,
		}));
}

function normalizeCodeSample(value: unknown): StudyCodeSample | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const item = value as Record<string, unknown>;
	if (typeof item.code !== "string") return undefined;
	const lineNumberMode = ["source", "relative", "none"].includes(String(item.lineNumberMode)) ? String(item.lineNumberMode) as StudyCodeSample["lineNumberMode"] : "relative";
	const startLine = Number.isInteger(item.startLine) && Number(item.startLine) > 0 ? Number(item.startLine) : lineNumberMode === "source" ? undefined : 1;
	if (lineNumberMode === "source" && !startLine) throw new Error("source line numbering requires startLine");
	const lineCount = Math.max(1, item.code.split("\n").length);
	const firstLine = lineNumberMode === "source" ? startLine! : 1;
	const lastLine = firstLine + lineCount - 1;
	const annotations = Array.isArray(item.annotations) ? item.annotations
		.filter((annotation): annotation is Record<string, unknown> => !!annotation && typeof annotation === "object")
		.map((annotation) => {
			const line = Number(annotation.line);
			const endLine = Number.isInteger(annotation.endLine) ? Number(annotation.endLine) : undefined;
			if (!Number.isInteger(line) || line < firstLine || line > lastLine || (endLine !== undefined && (endLine < line || endLine > lastLine))) {
				throw new Error(`code annotation line ${annotation.line} is outside ${firstLine}-${lastLine}`);
			}
			return {
				line,
				endLine,
				kind: ["behavior", "reason", "risk", "change"].includes(String(annotation.kind)) ? String(annotation.kind) as StudyCodeAnnotation["kind"] : undefined,
				text: String(annotation.text || ""),
			};
		}) : undefined;
	return {
		language: typeof item.language === "string" ? item.language : undefined,
		code: item.code.replace(/\r\n/g, "\n"),
		lineNumberMode,
		startLine,
		reference: normalizeReferences(item.reference ? [item.reference] : undefined)?.[0],
		annotations,
	};
}

function normalizeNoteBlocks(value: unknown): StudyNoteBlock[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const seen = new Set<string>();
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
		.map((item, index) => {
			const id = String(item.id || `block-${index + 1}`);
			if (seen.has(id)) throw new Error(`duplicate note block id: ${id}`);
			seen.add(id);
			const type = ["heading", "paragraph", "callout", "list", "table", "code", "reference-list", "flow-ref", "visual", "visual-ref", "divider"].includes(String(item.type)) ? String(item.type) as StudyNoteBlockType : undefined;
			if (!type) throw new Error(`unknown note block type: ${item.type}`);
			const columns = normalizeStringArray(item.columns)?.slice(0, 24);
			const rows = Array.isArray(item.rows) ? item.rows.slice(0, 500)
				.filter((row): row is unknown[] => Array.isArray(row))
				.map((row) => row.slice(0, columns?.length || 24).map((cell) => String(cell ?? ""))) : undefined;
			if (type === "table" && (!columns?.length || !rows)) throw new Error(`table note block requires columns and rows: ${id}`);
			const visual = item.visual && typeof item.visual === "object" && !Array.isArray(item.visual) ? JSON.parse(JSON.stringify(item.visual)) as Record<string, unknown> : undefined;
			const visualRefItem = item.visualRef && typeof item.visualRef === "object" && !Array.isArray(item.visualRef) ? item.visualRef as Record<string, unknown> : undefined;
			const visualRef = visualRefItem && typeof visualRefItem.sourceBlockId === "string" ? { sourceBlockId: visualRefItem.sourceBlockId, laneId: typeof visualRefItem.laneId === "string" ? visualRefItem.laneId : undefined } : undefined;
			if (type === "visual" && !visual) throw new Error(`visual note block requires a visual spec: ${id}`);
			if (type === "visual-ref" && !visualRef) throw new Error(`visual-ref note block requires sourceBlockId: ${id}`);
			return {
				id,
				type,
				level: [1, 2, 3].includes(Number(item.level)) ? Number(item.level) as 1 | 2 | 3 : undefined,
				text: typeof item.text === "string" ? item.text : undefined,
				title: typeof item.title === "string" ? item.title : undefined,
				body: typeof item.body === "string" ? item.body : undefined,
				tone: ["info", "warning", "success", "question"].includes(String(item.tone)) ? String(item.tone) as StudyNoteBlock["tone"] : undefined,
				ordered: item.ordered === true,
				items: normalizeStringArray(item.items),
				columns,
				rows,
				code: normalizeCodeSample(item.code || (type === "code" ? item : undefined)),
				references: normalizeReferences(item.references),
				flowId: typeof item.flowId === "string" ? item.flowId : undefined,
				visual,
				visualRef,
			};
		});
}

function normalizeNoteDocument(value: unknown, fallbackTitle: string): StudyNoteDocument | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const item = value as Record<string, unknown>;
	if (!Array.isArray(item.sections)) return undefined;
	const seen = new Set<string>();
	const sections = item.sections
		.filter((section): section is Record<string, unknown> => !!section && typeof section === "object")
		.map((section, index) => {
			const id = String(section.id || `section-${index + 1}`);
			if (seen.has(id)) throw new Error(`duplicate note section id: ${id}`);
			seen.add(id);
			const kind = ["overview", "node", "flow", "practice", "reflection"].includes(String(section.kind)) ? String(section.kind) as StudyNoteSectionKind : "overview";
			return {
				id,
				kind,
				subjectId: typeof section.subjectId === "string" ? section.subjectId : undefined,
				title: String(section.title || id),
				blocks: normalizeNoteBlocks(section.blocks) || [],
			};
		});
	const document = { title: typeof item.title === "string" ? item.title : fallbackTitle, sections };
	for (const block of sections.flatMap((section) => section.blocks)) {
		if (block.type === "visual-ref") resolveStudyNoteBlockVisual(document, block);
	}
	return document;
}

function visualLaneKey(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const lane = value as Record<string, unknown>;
	return typeof lane.id === "string" ? lane.id : typeof lane.title === "string" ? lane.title : undefined;
}

export function resolveStudyNoteBlockVisual(document: StudyNoteDocument, block: StudyNoteBlock): Record<string, unknown> | undefined {
	if (block.type === "visual" && block.visual) return JSON.parse(JSON.stringify(block.visual)) as Record<string, unknown>;
	if (block.type !== "visual-ref" || !block.visualRef) return undefined;
	const source = document.sections.flatMap((section) => section.blocks).find((candidate) => candidate.id === block.visualRef?.sourceBlockId);
	if (!source || source.type !== "visual" || !source.visual) throw new Error(`visual-ref source must be a visual block: ${block.id} -> ${block.visualRef.sourceBlockId}`);
	const derived = JSON.parse(JSON.stringify(source.visual)) as Record<string, unknown>;
	if (block.visualRef.laneId) {
		const lanes = Array.isArray(derived.lanes) ? derived.lanes : [];
		const lane = lanes.find((candidate) => visualLaneKey(candidate) === block.visualRef?.laneId);
		if (!lane) throw new Error(`visual-ref lane not found: ${block.id} -> ${block.visualRef.laneId}`);
		const nodes = Array.isArray(derived.nodes) ? derived.nodes.filter((candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate) && String((candidate as Record<string, unknown>).lane || "") === block.visualRef?.laneId) : [];
		if (!nodes.length) throw new Error(`visual-ref lane has no nodes: ${block.id} -> ${block.visualRef.laneId}`);
		const nodeIds = new Set(nodes.map((candidate) => String((candidate as Record<string, unknown>).id || "")));
		derived.lanes = [lane];
		derived.nodes = nodes;
		derived.edges = Array.isArray(derived.edges) ? derived.edges.filter((candidate) => {
			if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
			const edge = candidate as Record<string, unknown>;
			return nodeIds.has(String(edge.source || "")) && nodeIds.has(String(edge.target || ""));
		}) : [];
	}
	if (block.title) derived.title = block.title;
	if (block.body) derived.subtitle = block.body;
	return derived;
}

function materializeVisualReferences(state: StudyHardBoardState): StudyHardBoardState {
	const materialized = JSON.parse(JSON.stringify(state)) as StudyHardBoardState;
	for (const section of materialized.noteDocument.sections) {
		for (const block of section.blocks) {
			if (block.type !== "visual-ref") continue;
			const original = state.noteDocument.sections.flatMap((candidate) => candidate.blocks).find((candidate) => candidate.id === block.id);
			if (!original) continue;
			block.type = "visual";
			block.visual = resolveStudyNoteBlockVisual(state.noteDocument, original);
			delete block.visualRef;
		}
	}
	return materialized;
}

function normalizeFlows(value: unknown): StudyDataFlow[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.filter((flow): flow is Record<string, unknown> => !!flow && typeof flow === "object")
		.map((flow, flowIndex) => {
			const actors = Array.isArray(flow.actors) ? flow.actors
				.filter((actor): actor is Record<string, unknown> => !!actor && typeof actor === "object")
				.map((actor, actorIndex) => ({ id: String(actor.id || `actor-${actorIndex + 1}`), label: String(actor.label || actor.id || `Actor ${actorIndex + 1}`), role: typeof actor.role === "string" ? actor.role : undefined })) : [];
			const actorIds = new Set(actors.map((actor) => actor.id));
			const steps = Array.isArray(flow.steps) ? flow.steps
				.filter((step): step is Record<string, unknown> => !!step && typeof step === "object")
				.map((step, stepIndex) => {
					const from = String(step.from || "");
					const to = String(step.to || "");
					if (!actorIds.has(from) || !actorIds.has(to)) throw new Error(`flow step ${step.id || stepIndex + 1} references unknown actor`);
					return {
						id: String(step.id || `step-${stepIndex + 1}`),
						order: Number.isFinite(Number(step.order)) ? Number(step.order) : stepIndex + 1,
						from,
						to,
						action: String(step.action || ""),
						trigger: typeof step.trigger === "string" ? step.trigger : undefined,
						payload: typeof step.payload === "string" ? step.payload : undefined,
						sideEffect: typeof step.sideEffect === "string" ? step.sideEffect : undefined,
						result: typeof step.result === "string" ? step.result : undefined,
						risk: typeof step.risk === "string" ? step.risk : undefined,
						reference: normalizeReferences(step.reference ? [step.reference] : undefined)?.[0],
						code: normalizeCodeSample(step.code),
					};
				}).sort((a, b) => a.order - b.order) : [];
			return {
				id: String(flow.id || `flow-${flowIndex + 1}`),
				title: String(flow.title || flow.id || `Flow ${flowIndex + 1}`),
				variant: ["before", "after", "current"].includes(String(flow.variant)) ? String(flow.variant) as StudyFlowVariant : "current",
				summary: typeof flow.summary === "string" ? flow.summary : undefined,
				actors,
				steps,
			};
		});
}

function normalizeNodes(value: unknown): StudyConceptNode[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
		.map((item, index) => ({
			id: String(item.id || `node-${index + 1}`),
			label: String(item.label || item.title || item.id || `Node ${index + 1}`),
			summary: typeof item.summary === "string" ? item.summary : undefined,
			detail: typeof item.detail === "string" ? item.detail : typeof item.description === "string" ? item.description : undefined,
			status: normalizeConceptStatus(item.status),
			type: normalizeNodeType(item.type),
			parentId: typeof item.parentId === "string" ? item.parentId : undefined,
			questionId: typeof item.questionId === "string" ? item.questionId : undefined,
			references: normalizeReferences(item.references),
			blocks: normalizeNoteBlocks(item.blocks),
			positionLocked: item.positionLocked === true,
			x: typeof item.x === "number" ? item.x : index * 240,
			y: typeof item.y === "number" ? item.y : (index % 3) * 150,
		}));
}

function normalizeEdges(value: unknown): StudyConceptEdge[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && typeof item.source === "string" && typeof item.target === "string")
		.map((item, index) => ({
			id: typeof item.id === "string" ? item.id : `${item.source}-${item.target}-${index}`,
			source: item.source,
			target: item.target,
			label: typeof item.label === "string" ? item.label : undefined,
		}));
}

function normalizeQuestions(value: unknown): StudyQuestionCard[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
		.map((item, index) => ({
			id: String(item.id || `Q${String(index + 1).padStart(3, "0")}`),
			question: String(item.question || ""),
			origin: normalizeQuestionOrigin(item.origin, item),
			scope: ["session", "node", "flow-step", "note-block", "coach"].includes(String(item.scope)) ? String(item.scope) as StudyQuestionScope : typeof item.targetFlowStepId === "string" ? "flow-step" : typeof item.targetNoteBlockId === "string" ? "note-block" : typeof item.targetNodeId === "string" || typeof item.nodeId === "string" ? "node" : "session",
			userAnswer: typeof item.userAnswer === "string" ? item.userAnswer : typeof item.answer === "string" ? item.answer : undefined,
			feedback: typeof item.feedback === "string" ? item.feedback : undefined,
			status: normalizeQuestionStatus(item.status),
			targetNodeId: typeof item.targetNodeId === "string" ? item.targetNodeId : typeof item.nodeId === "string" ? item.nodeId : undefined,
			targetFlowId: typeof item.targetFlowId === "string" ? item.targetFlowId : undefined,
			targetFlowStepId: typeof item.targetFlowStepId === "string" ? item.targetFlowStepId : undefined,
			targetNoteBlockId: typeof item.targetNoteBlockId === "string" ? item.targetNoteBlockId : undefined,
			attachmentIds: Array.isArray(item.attachmentIds) ? [...new Set(item.attachmentIds.filter((id): id is string => typeof id === "string" && !!id.trim()))].slice(0, MAX_QUESTION_ATTACHMENTS) : undefined,
			createdAt: typeof item.createdAt === "number" ? item.createdAt : undefined,
			answeredAt: typeof item.answeredAt === "number" ? item.answeredAt : undefined,
			processingStatus: ["queued", "running", "answered", "merging", "applied", "failed"].includes(String(item.processingStatus)) ? String(item.processingStatus) as StudyQuestionProcessingStatus : undefined,
			orchestrationId: typeof item.orchestrationId === "string" ? item.orchestrationId : undefined,
			processingError: typeof item.processingError === "string" ? item.processingError : undefined,
			processingErrorStage: ["tutor", "editor", "coach"].includes(String(item.processingErrorStage)) ? String(item.processingErrorStage) as StudyQuestionCard["processingErrorStage"] : undefined,
		}));
}

function normalizeStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value.map((item) => typeof item === "string" ? item : JSON.stringify(item)).filter((item) => item.trim());
}

function normalizeAttachments(value: unknown): StudyAttachment[] | undefined {
	if (!Array.isArray(value)) return undefined;
	return value
		.filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
		.map((item, index) => ({
			id: String(item.id || `attachment-${index + 1}`),
			scope: ["session", "node", "flow-step", "note-block"].includes(String(item.scope)) ? String(item.scope) as Exclude<StudyQuestionScope, "coach"> : undefined,
			nodeId: typeof item.nodeId === "string" ? item.nodeId : undefined,
			targetFlowId: typeof item.targetFlowId === "string" ? item.targetFlowId : undefined,
			targetFlowStepId: typeof item.targetFlowStepId === "string" ? item.targetFlowStepId : undefined,
			targetNoteBlockId: typeof item.targetNoteBlockId === "string" ? item.targetNoteBlockId : undefined,
			name: String(item.name || item.filename || `attachment-${index + 1}`),
			mimeType: typeof item.mimeType === "string" ? item.mimeType : typeof item.type === "string" ? item.type : undefined,
			path: typeof item.path === "string" ? item.path : undefined,
			url: typeof item.url === "string" ? item.url : undefined,
			note: typeof item.note === "string" ? item.note : undefined,
			createdAt: typeof item.createdAt === "number" ? item.createdAt : Date.now(),
		}));
}

function normalizeNotionSync(value: unknown): StudyNotionSyncState | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const item = value as Record<string, unknown>;
	const sectionHashes = item.sectionHashes && typeof item.sectionHashes === "object" && !Array.isArray(item.sectionHashes)
		? Object.fromEntries(Object.entries(item.sectionHashes as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
		: undefined;
	return {
		pageId: typeof item.pageId === "string" ? item.pageId : undefined,
		calendarDate: typeof item.calendarDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.calendarDate) ? item.calendarDate : undefined,
		pageUrl: normalizeHttpUrl(item.pageUrl),
		sessionId: typeof item.sessionId === "string" ? item.sessionId : undefined,
		sectionHashes,
		lastSyncedRevision: Number.isInteger(item.lastSyncedRevision) ? Number(item.lastSyncedRevision) : undefined,
		lastSyncedHash: typeof item.lastSyncedHash === "string" ? item.lastSyncedHash : undefined,
		lastSyncedAt: typeof item.lastSyncedAt === "number" ? item.lastSyncedAt : undefined,
	};
}

function normalizeConceptStatus(value: unknown): StudyConceptStatus {
	if (["unknown", "learning", "confused", "understood", "review"].includes(String(value))) return String(value) as StudyConceptStatus;
	return "unknown";
}

function normalizeQuestionStatus(value: unknown): StudyQuestionStatus {
	if (["open", "answered", "understood", "review"].includes(String(value))) return String(value) as StudyQuestionStatus;
	return "open";
}

function normalizeQuestionOrigin(value: unknown, item?: Record<string, unknown>): StudyQuestionOrigin {
	if (value === "coach" || value === "learner") return value;
	if (item && (typeof item.userAnswer === "string" || typeof item.answer === "string")) return "coach";
	return "learner";
}

function normalizeNodeType(value: unknown): StudyConceptNodeType | undefined {
	if (["root", "concept", "question", "confusion", "decision", "file", "risk", "summary", "attachment"].includes(String(value))) return String(value) as StudyConceptNodeType;
	return undefined;
}

export function layoutStudyGraph(nodes: StudyConceptNode[], edges: StudyConceptEdge[]): StudyConceptNode[] {
	if (!nodes.length) return [];
	const NODE_WIDTH = 248;
	const NODE_HEIGHT = 112;
	const HORIZONTAL_GAP = 44;
	const VERTICAL_GAP = 92;
	const result = nodes.map((node) => ({ ...node }));
	const byId = new Map(result.map((node) => [node.id, node]));
	const children = new Map(result.map((node) => [node.id, [] as string[]]));
	const incoming = new Map(result.map((node) => [node.id, 0]));
	const connect = (source: string, target: string) => {
		if (!byId.has(source) || !byId.has(target) || source === target) return;
		const targets = children.get(source)!;
		if (targets.includes(target)) return;
		targets.push(target);
		incoming.set(target, (incoming.get(target) || 0) + 1);
	};
	for (const node of result) if (node.parentId) connect(node.parentId, node.id);
	for (const edge of edges) connect(edge.source, edge.target);

	const roots = result.filter((node) => (incoming.get(node.id) || 0) === 0);
	const primaryRoot = roots.find((node) => node.type === "root") || roots[0] || result[0]!;
	const widthMemo = new Map<string, number>();
	const subtreeWidth = (id: string, ancestry = new Set<string>()): number => {
		if (widthMemo.has(id)) return widthMemo.get(id)!;
		if (ancestry.has(id)) return NODE_WIDTH;
		const nextAncestry = new Set(ancestry).add(id);
		const childIds = (children.get(id) || []).filter((childId) => !nextAncestry.has(childId));
		const childrenWidth = childIds.reduce((sum, childId) => sum + subtreeWidth(childId, nextAncestry), 0) + Math.max(0, childIds.length - 1) * HORIZONTAL_GAP;
		const width = Math.max(NODE_WIDTH, childrenWidth);
		widthMemo.set(id, width);
		return width;
	};
	const placed = new Set<string>();
	const place = (id: string, left: number, depth: number, ancestry = new Set<string>()) => {
		if (placed.has(id) || ancestry.has(id)) return;
		const node = byId.get(id);
		if (!node) return;
		const width = subtreeWidth(id, ancestry);
		node.x = left + (width - NODE_WIDTH) / 2;
		node.y = depth * (NODE_HEIGHT + VERTICAL_GAP);
		placed.add(id);
		const nextAncestry = new Set(ancestry).add(id);
		let childLeft = left;
		for (const childId of children.get(id) || []) {
			if (nextAncestry.has(childId)) continue;
			place(childId, childLeft, depth + 1, nextAncestry);
			childLeft += subtreeWidth(childId, nextAncestry) + HORIZONTAL_GAP;
		}
	};
	place(primaryRoot.id, 0, 0);
	let orphanLeft = subtreeWidth(primaryRoot.id) + HORIZONTAL_GAP * 2;
	for (const root of roots) {
		if (placed.has(root.id)) continue;
		place(root.id, orphanLeft, 0);
		orphanLeft += subtreeWidth(root.id) + HORIZONTAL_GAP;
	}
	let orphanRow = 0;
	for (const node of result) {
		if (placed.has(node.id)) continue;
		node.x = orphanLeft;
		node.y = orphanRow * (NODE_HEIGHT + VERTICAL_GAP);
		orphanRow += 1;
	}
	return result;
}

function hasPosition(node: StudyConceptNode | undefined): node is StudyConceptNode & { x: number; y: number } {
	return !!node && Number.isFinite(node.x) && Number.isFinite(node.y);
}

function mergeStableNodePositions(previous: StudyConceptNode[], incoming: StudyConceptNode[], edges: StudyConceptEdge[]): StudyConceptNode[] {
	const previousById = new Map(previous.map((node) => [node.id, node]));
	const laidOut = layoutStudyGraph(incoming, edges);
	const byId = new Map<string, StudyConceptNode>();
	const occupied: Array<{ x: number; y: number }> = [];
	const result: StudyConceptNode[] = [];
	const isOccupied = (x: number, y: number) => occupied.some((position) => Math.abs(position.x - x) < 240 && Math.abs(position.y - y) < 118);
	const reserve = (node: StudyConceptNode) => {
		if (Number.isFinite(node.x) && Number.isFinite(node.y)) occupied.push({ x: node.x!, y: node.y! });
		byId.set(node.id, node);
		result.push(node);
	};

	for (const node of laidOut) {
		const previousNode = previousById.get(node.id);
		if (!hasPosition(previousNode)) continue;
		reserve({ ...node, x: previousNode.x, y: previousNode.y, positionLocked: previousNode.positionLocked === true });
	}
	for (const node of laidOut) {
		if (byId.has(node.id)) continue;
		const parentId = node.parentId || edges.find((edge) => edge.target === node.id)?.source;
		const parent = parentId ? byId.get(parentId) || previousById.get(parentId) : undefined;
		let x = hasPosition(parent) ? parent.x + 24 : Number(node.x || 0);
		let y = hasPosition(parent) ? parent.y + 142 : Number(node.y || 0);
		while (isOccupied(x, y)) y += 140;
		reserve({ ...node, x, y, positionLocked: false });
	}
	const order = new Map(incoming.map((node, index) => [node.id, index]));
	return result.sort((a, b) => (order.get(a.id) || 0) - (order.get(b.id) || 0));
}

export function mergeBoardState(current: StudyHardBoardState, patch: Record<string, unknown>): StudyHardBoardState {
	const next: StudyHardBoardState = { ...current, schemaVersion: 1, revision: Number(current.revision || 0) + 1, updatedAt: Date.now() };
	if (typeof patch.title === "string" && patch.title.trim()) next.title = patch.title.trim();
	if (typeof patch.sourceTitle === "string") next.sourceTitle = patch.sourceTitle.trim();
	if (["code", "article", "video", "mixed"].includes(String(patch.sourceKind))) next.sourceKind = String(patch.sourceKind) as StudySourceKind;
	if (["map", "explain", "trace", "practice", "reflect"].includes(String(patch.learningPhase))) next.learningPhase = String(patch.learningPhase) as StudyLearningPhase;
	if (["mentor", "rubber-duck", "peer", "lead"].includes(String(patch.coachRole))) next.coachRole = String(patch.coachRole) as StudyCoachRole;
	if (["auto", "manual"].includes(String(patch.layoutMode))) next.layoutMode = String(patch.layoutMode) as StudyLayoutMode;
	if (["memo", "detail", "hybrid"].includes(String(patch.viewMode))) next.viewMode = String(patch.viewMode) as StudyBoardViewMode;
	if (["map", "flow", "note"].includes(String(patch.activeSurface))) next.activeSurface = String(patch.activeSurface) as StudySurface;
	if (typeof patch.selectedFlowId === "string") next.selectedFlowId = patch.selectedFlowId;
	if (patch.selectedFlowStepId === null) next.selectedFlowStepId = undefined;
	else if (typeof patch.selectedFlowStepId === "string") next.selectedFlowStepId = patch.selectedFlowStepId;
	if (patch.selectedNoteBlockId === null) next.selectedNoteBlockId = undefined;
	else if (typeof patch.selectedNoteBlockId === "string") next.selectedNoteBlockId = patch.selectedNoteBlockId;
	if (patch.mapViewport && typeof patch.mapViewport === "object" && !Array.isArray(patch.mapViewport)) {
		const viewport = patch.mapViewport as Record<string, unknown>;
		if ([viewport.x, viewport.y, viewport.zoom].every((value) => Number.isFinite(Number(value)))) next.mapViewport = { x: Number(viewport.x), y: Number(viewport.y), zoom: Number(viewport.zoom) };
	}
	if (typeof patch.quickMap === "string") next.quickMap = patch.quickMap;
	if (typeof patch.mermaid === "string") next.mermaid = patch.mermaid;
	if (typeof patch.summary === "string") next.summary = patch.summary;
	if (typeof patch.currentQuestionId === "string") next.currentQuestionId = patch.currentQuestionId;
	if (typeof patch.recommendedNodeId === "string") next.recommendedNodeId = patch.recommendedNodeId;
	const goals = normalizeStringArray(patch.goals);
	if (goals) next.goals = goals;
	const nodes = normalizeNodes(patch.nodes);
	const edges = normalizeEdges(patch.edges);
	if (edges) next.edges = edges;
	if (nodes) {
		const hasExistingNodes = nodes.some((node) => current.nodes.some((currentNode) => currentNode.id === node.id));
		next.nodes = hasExistingNodes
			? mergeStableNodePositions(current.nodes, nodes, next.edges)
			: next.layoutMode === "auto" ? layoutStudyGraph(nodes, next.edges) : nodes;
	}
	const flows = normalizeFlows(patch.flows);
	if (flows) {
		next.flows = flows;
		if (!next.selectedFlowId || !flows.some((flow) => flow.id === next.selectedFlowId)) next.selectedFlowId = flows[0]?.id;
	}
	if (next.selectedFlowStepId && !next.flows.some((flow) => flow.id === next.selectedFlowId && flow.steps.some((step) => step.id === next.selectedFlowStepId))) next.selectedFlowStepId = undefined;
	const noteDocument = normalizeNoteDocument(patch.noteDocument, next.title);
	if (noteDocument) next.noteDocument = noteDocument;
	const questions = normalizeQuestions(patch.questions);
	if (questions) {
		const currentById = new Map(current.questions.map((question) => [question.id, question]));
		next.questions = questions.map((question) => {
			const existing = currentById.get(question.id);
			if (!existing) return question;
			return {
				...question,
				origin: existing.origin || question.origin,
				scope: existing.scope || question.scope,
				targetNodeId: existing.targetNodeId || question.targetNodeId,
				targetFlowId: existing.targetFlowId || question.targetFlowId,
				targetFlowStepId: existing.targetFlowStepId || question.targetFlowStepId,
				targetNoteBlockId: existing.targetNoteBlockId || question.targetNoteBlockId,
				processingStatus: question.processingStatus || existing.processingStatus,
				orchestrationId: question.orchestrationId || existing.orchestrationId,
				processingError: question.processingStatus === "failed" ? question.processingError || existing.processingError : undefined,
				processingErrorStage: question.processingStatus === "failed" ? question.processingErrorStage || existing.processingErrorStage : undefined,
			};
		});
	}
	const attachments = normalizeAttachments(patch.attachments);
	if (attachments) next.attachments = attachments;
	const notionSync = normalizeNotionSync(patch.notionSync);
	if (notionSync) next.notionSync = notionSync;
	if (typeof patch.selectedNodeId === "string") next.selectedNodeId = patch.selectedNodeId;
	const followups = normalizeStringArray(patch.followups);
	if (followups) next.followups = followups;
	return next;
}

function validateRunId(value: string): string {
	const runId = value.trim();
	if (!runId || runId.length > 96 || !/^[a-zA-Z0-9가-힣][a-zA-Z0-9가-힣._-]*$/.test(runId) || runId.includes("..")) {
		throw new Error(`invalid Study Hard runId: ${value}`);
	}
	return runId;
}

function stateDir(): string {
	const dir = process.env.STUDY_HARD_STATE_DIR || join(homedir(), ".pi", "agent", "study-hard");
	mkdirSync(dir, { recursive: true });
	return dir;
}

function statePathFor(runId: string): string {
	return join(stateDir(), `${validateRunId(runId)}.json`);
}

export function studyHardStatePathFor(runId: string): string {
	return statePathFor(runId);
}

function normalizePersistedState(value: unknown): StudyHardBoardState {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Study Hard state must be an object");
	const raw = value as Record<string, unknown>;
	const schemaVersion = Number(raw.schemaVersion || 0);
	if (schemaVersion > 1) throw new Error(`unsupported Study Hard schemaVersion: ${schemaVersion}`);
	const runId = validateRunId(String(raw.runId || ""));
	const url = normalizeHttpUrl(raw.url);
	if (!url) throw new Error("persisted Study Hard state requires an http(s) url");
	const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : titleFromUrl(url);
	const initial = createInitialBoardState({ runId, url, title, hints: typeof raw.hints === "string" ? raw.hints : undefined });
	const nodes = normalizeNodes(raw.nodes) || initial.nodes;
	const edges = normalizeEdges(raw.edges) || initial.edges;
	const flows = normalizeFlows(raw.flows) || [];
	const noteDocument = normalizeNoteDocument(raw.noteDocument, title) || initial.noteDocument;
	const mapViewport = raw.mapViewport && typeof raw.mapViewport === "object" && !Array.isArray(raw.mapViewport) ? raw.mapViewport as Record<string, unknown> : undefined;
	return {
		...initial,
		schemaVersion: 1,
		revision: Number.isInteger(raw.revision) && Number(raw.revision) >= 0 ? Number(raw.revision) : 0,
		sourceTitle: typeof raw.sourceTitle === "string" ? raw.sourceTitle : undefined,
		sourceKind: ["code", "article", "video", "mixed"].includes(String(raw.sourceKind)) ? String(raw.sourceKind) as StudySourceKind : initial.sourceKind,
		learningPhase: ["map", "explain", "trace", "practice", "reflect"].includes(String(raw.learningPhase)) ? String(raw.learningPhase) as StudyLearningPhase : initial.learningPhase,
		coachRole: ["mentor", "rubber-duck", "peer", "lead"].includes(String(raw.coachRole)) ? String(raw.coachRole) as StudyCoachRole : initial.coachRole,
		layoutMode: ["auto", "manual"].includes(String(raw.layoutMode)) ? String(raw.layoutMode) as StudyLayoutMode : initial.layoutMode,
		viewMode: ["memo", "detail", "hybrid"].includes(String(raw.viewMode)) ? String(raw.viewMode) as StudyBoardViewMode : initial.viewMode,
		goals: normalizeStringArray(raw.goals) || initial.goals,
		quickMap: typeof raw.quickMap === "string" ? raw.quickMap : initial.quickMap,
		mermaid: typeof raw.mermaid === "string" ? raw.mermaid : initial.mermaid,
		nodes,
		edges,
		flows,
		noteDocument,
		activeSurface: ["map", "flow", "note"].includes(String(raw.activeSurface)) ? String(raw.activeSurface) as StudySurface : "note",
		selectedFlowId: typeof raw.selectedFlowId === "string" ? raw.selectedFlowId : flows[0]?.id,
		selectedFlowStepId: typeof raw.selectedFlowStepId === "string" ? raw.selectedFlowStepId : undefined,
		selectedNoteBlockId: typeof raw.selectedNoteBlockId === "string" ? raw.selectedNoteBlockId : undefined,
		mapViewport: mapViewport && [mapViewport.x, mapViewport.y, mapViewport.zoom].every((item) => Number.isFinite(Number(item))) ? { x: Number(mapViewport.x), y: Number(mapViewport.y), zoom: Number(mapViewport.zoom) } : undefined,
		questions: normalizeQuestions(raw.questions) || [],
		attachments: normalizeAttachments(raw.attachments) || [],
		notionSync: normalizeNotionSync(raw.notionSync),
		companion: normalizeLearningCompanionState(raw.companion),
		selectedNodeId: typeof raw.selectedNodeId === "string" ? raw.selectedNodeId : nodes[0]?.id,
		recommendedNodeId: typeof raw.recommendedNodeId === "string" ? raw.recommendedNodeId : undefined,
		currentQuestionId: typeof raw.currentQuestionId === "string" ? raw.currentQuestionId : undefined,
		summary: typeof raw.summary === "string" ? raw.summary : undefined,
		followups: normalizeStringArray(raw.followups) || [],
		createdAt: typeof raw.createdAt === "number" ? raw.createdAt : initial.createdAt,
		updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : initial.updatedAt,
	};
}

export function loadPersistedStudyHardState(runId: string): StudyHardBoardState | undefined {
	const path = statePathFor(runId);
	if (!existsSync(path)) return undefined;
	try {
		return normalizePersistedState(JSON.parse(readFileSync(path, "utf-8")));
	} catch (primaryError) {
		const backupPath = `${path}.backup.json`;
		if (existsSync(backupPath)) return normalizePersistedState(JSON.parse(readFileSync(backupPath, "utf-8")));
		throw primaryError;
	}
}

function findLatestPersistedState(): StudyHardBoardState | undefined {
	const candidates = readdirSync(stateDir())
		.filter((name) => name.endsWith(".json") && !name.endsWith(".backup.json") && !name.includes(".tmp-"))
		.map((name) => ({ name, path: join(stateDir(), name), mtime: statSync(join(stateDir(), name)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime);
	for (const candidate of candidates) {
		try { return loadPersistedStudyHardState(candidate.name.slice(0, -5)); } catch {}
	}
	return undefined;
}

function noteHistoryDir(runId: string): string {
	const dir = join(stateDir(), `${validateRunId(runId)}-history`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function referencedHistoryFlows(state: Pick<StudyHardBoardState, "noteDocument" | "flows">): StudyDataFlow[] {
	const flowIds = new Set(state.noteDocument.sections.flatMap((section) => section.blocks.map((block) => block.flowId).filter((flowId): flowId is string => typeof flowId === "string")));
	return state.flows.filter((flow) => flowIds.has(flow.id));
}

function noteHistoryHash(noteDocument: StudyNoteDocument, flows: StudyDataFlow[]): string {
	return createHash("sha256").update(JSON.stringify({ noteDocument, flows })).digest("hex");
}

function buildNoteHistoryBundle(state: StudyHardBoardState): StudyNoteHistoryBundle {
	const flows = referencedHistoryFlows(state);
	return {
		schemaVersion: 1,
		runId: state.runId,
		revision: state.revision,
		savedAt: state.updatedAt,
		hash: noteHistoryHash(state.noteDocument, flows),
		noteDocument: state.noteDocument,
		flows,
	};
}

function writeNoteHistoryBundle(bundle: StudyNoteHistoryBundle): void {
	const dir = noteHistoryDir(bundle.runId);
	const shortHash = bundle.hash.slice(0, 12);
	if (readdirSync(dir).some((name) => name.endsWith(`-${shortHash}.json`))) return;
	const fileName = `${bundle.savedAt}-r${bundle.revision}-${shortHash}.json`;
	const finalPath = join(dir, fileName);
	const temporaryPath = `${finalPath}.tmp-${process.pid}`;
	writeFileSync(temporaryPath, JSON.stringify(bundle, null, 2), "utf-8");
	renameSync(temporaryPath, finalPath);
	const stale = readdirSync(dir)
		.filter((name) => /^\d+-r\d+-[a-f0-9]{12}\.json$/.test(name))
		.map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime)
		.slice(NOTE_HISTORY_LIMIT);
	for (const item of stale) {
		try { unlinkSync(join(dir, item.name)); } catch {}
	}
}

function readNoteHistoryBundle(runId: string, id: string): StudyNoteHistoryBundle {
	if (!/^\d+-r\d+-[a-f0-9]{12}\.json$/.test(id)) throw new Error("invalid note history id");
	const path = join(noteHistoryDir(runId), id);
	if (!existsSync(path)) throw new Error("note history entry not found");
	const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
	const noteDocument = normalizeNoteDocument(raw.noteDocument, "Study Hard");
	const flows = normalizeFlows(raw.flows) || [];
	if (raw.schemaVersion !== 1 || raw.runId !== runId || !noteDocument) throw new Error("invalid note history bundle");
	const hash = noteHistoryHash(noteDocument, flows);
	if (raw.hash !== hash) throw new Error("note history bundle hash mismatch");
	return {
		schemaVersion: 1,
		runId,
		revision: Number(raw.revision || 0),
		savedAt: Number(raw.savedAt || 0),
		hash,
		noteDocument,
		flows,
	};
}

function listNoteHistory(state: StudyHardBoardState): StudyNoteHistoryEntry[] {
	const current = buildNoteHistoryBundle(state);
	const entries: StudyNoteHistoryEntry[] = [{ id: "current", revision: current.revision, savedAt: current.savedAt, hash: current.hash, title: current.noteDocument.title, sectionCount: current.noteDocument.sections.length, current: true }];
	const files = readdirSync(noteHistoryDir(state.runId))
		.filter((name) => /^\d+-r\d+-[a-f0-9]{12}\.json$/.test(name))
		.map((name) => ({ name, mtime: statSync(join(noteHistoryDir(state.runId), name)).mtimeMs }))
		.sort((a, b) => b.mtime - a.mtime);
	for (const file of files) {
		try {
			const bundle = readNoteHistoryBundle(state.runId, file.name);
			entries.push({ id: file.name, revision: bundle.revision, savedAt: bundle.savedAt, hash: bundle.hash, title: bundle.noteDocument.title, sectionCount: bundle.noteDocument.sections.length });
		} catch {}
	}
	return entries;
}

function restoreHistoryFlows(current: Pick<StudyHardBoardState, "noteDocument" | "flows">, history: StudyDataFlow[]): StudyDataFlow[] {
	const currentNoteFlowIds = new Set(referencedHistoryFlows(current).map((flow) => flow.id));
	const historyFlowIds = new Set(history.map((flow) => flow.id));
	const preserved = current.flows.filter((flow) => !currentNoteFlowIds.has(flow.id) && !historyFlowIds.has(flow.id));
	return [...history, ...preserved];
}

function saveState(handle: StudyHardHandle): void {
	let previous: StudyHardBoardState | undefined;
	let primaryStateIsValid = false;
	if (existsSync(handle.statePath)) {
		try {
			previous = normalizePersistedState(JSON.parse(readFileSync(handle.statePath, "utf-8")));
			primaryStateIsValid = true;
		} catch {
			previous = loadPersistedStudyHardState(handle.state.runId);
			if (!previous) throw new Error("기존 Study Hard 상태를 읽지 못해 새 상태 저장을 중단했습니다.");
		}
	}
	const temporaryPath = `${handle.statePath}.tmp-${process.pid}-${Date.now()}`;
	const backupPath = `${handle.statePath}.backup.json`;
	try {
		if (previous) {
			const previousBundle = buildNoteHistoryBundle(previous);
			const nextBundle = buildNoteHistoryBundle(handle.state);
			if (previousBundle.hash !== nextBundle.hash) writeNoteHistoryBundle(previousBundle);
		}
		writeFileSync(temporaryPath, JSON.stringify(handle.state, null, 2), "utf-8");
		if (existsSync(handle.statePath)) {
			if (primaryStateIsValid) copyFileSync(handle.statePath, backupPath);
			else if (previous) writeFileSync(backupPath, JSON.stringify(previous, null, 2), "utf-8");
		}
		renameSync(temporaryPath, handle.statePath);
	} catch (error) {
		if (previous) handle.state = previous;
		throw error;
	}
}

function broadcast(handle: StudyHardHandle): void {
	const payload = `data: ${JSON.stringify(materializeVisualReferences(handle.state))}\n\n`;
	for (const client of [...handle.clients]) {
		try { client.write(payload); } catch { handle.clients.delete(client); }
	}
	syncStudyHardTranscript(handle);
}

function mutateStudyHardCompanion(runId: string, mutate: (board: StudyHardBoardState, companion: LearningCompanionState | undefined) => LearningCompanionState): StudyHardBoardState {
	const id = validateRunId(runId);
	const active = handles.get(id);
	const current = active?.state ?? loadPersistedStudyHardState(id);
	if (!current) throw new Error(`Study Hard Studio run을 찾을 수 없습니다: ${id}`);
	const companion = mutate(current, current.companion);
	const next: StudyHardBoardState = {
		...current,
		companion,
		revision: current.revision + 1,
		updatedAt: Math.max(Date.now(), companion.updatedAt),
	};
	if (active) {
		const previous = active.state;
		active.state = next;
		try {
			saveState(active);
			broadcast(active);
		} catch (error) {
			active.state = previous;
			throw error;
		}
	} else {
		const detached = {
			state: next,
			statePath: statePathFor(id),
			clients: new Set<ServerResponse>(),
		} as StudyHardHandle;
		saveState(detached);
	}
	return next;
}

export function attachStudyHardLearningCompanion(manifest: LearningCompanionManifest): StudyHardBoardState {
	return mutateStudyHardCompanion(manifest.runId, (_board, current) => {
		if (current && current.companionId !== manifest.companionId) {
			throw new Error(`Study Hard run ${manifest.runId}은 다른 companion에 연결되어 있습니다.`);
		}
		const base = current
			? { ...current, phase: manifest.phase, frame: { ...manifest.frame }, updatedAt: Date.now() }
			: createLearningCompanionState(manifest);
		return recordLearningEvent(base, {
			kind: "frame_ready",
			summary: "Frame 계약과 학습노트 canonical을 연결했습니다.",
			source: "frame",
			refs: { frameHash: manifest.frame.latestCanonicalHash },
			dedupeKey: `frame-ready:${manifest.frame.latestCanonicalHash || manifest.companionId}`,
		}).state;
	});
}

export function recordStudyHardLearningEvent(runId: string, input: LearningEventInput, phase?: LearningCompanionPhase): StudyHardBoardState {
	return mutateStudyHardCompanion(runId, (_board, current) => {
		if (!current) throw new Error(`Study Hard run ${runId}에 learning companion이 연결되지 않았습니다.`);
		const recorded = recordLearningEvent(current, input).state;
		return phase && recorded.phase !== phase ? { ...recorded, phase, updatedAt: input.occurredAt ?? Date.now() } : recorded;
	});
}

export function checkpointStudyHardLearning(runId: string, kind: LearningCheckpoint["kind"], refs?: LearningCheckpoint["refs"]): StudyHardBoardState {
	return mutateStudyHardCompanion(runId, (board, current) => {
		if (!current) throw new Error(`Study Hard run ${runId}에 learning companion이 연결되지 않았습니다.`);
		const lastSequence = current.events.at(-1)?.sequence ?? 0;
		const previousTo = current.checkpoints.at(-1)?.eventRange.to ?? 0;
		const noteHash = noteHistoryHash(board.noteDocument, referencedHistoryFlows(board));
		return recordLearningCheckpoint(current, {
			kind,
			revision: board.revision,
			noteHash,
			eventRange: { from: previousTo < lastSequence ? previousTo + 1 : lastSequence, to: lastSequence },
			refs,
		});
	});
}

export function proposeStudyHardLearningChange(runId: string, input: LearningProposalInput): StudyHardBoardState {
	return mutateStudyHardCompanion(runId, (_board, current) => {
		if (!current) throw new Error(`Study Hard run ${runId}에 learning companion이 연결되지 않았습니다.`);
		return upsertLearningProposal(current, input).state;
	});
}

export function updateStudyHardLearningProposal(runId: string, proposalId: string, status: LearningProposalStatus, params: { appliedRefs?: LearningArtifactRefs; now?: number } = {}): StudyHardBoardState {
	return mutateStudyHardCompanion(runId, (_board, current) => {
		if (!current) throw new Error(`Study Hard run ${runId}에 learning companion이 연결되지 않았습니다.`);
		return updateLearningProposalStatus(current, proposalId, status, params);
	});
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(value));
}

async function readJsonBody(req: Parameters<Parameters<typeof createServer>[0]>[0]): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	if (!chunks.length) return {};
	const text = Buffer.concat(chunks).toString("utf-8");
	const parsed = JSON.parse(text || "{}");
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
	return parsed as Record<string, unknown>;
}

function findNode(state: StudyHardBoardState, nodeId?: string): StudyConceptNode | undefined {
	return state.nodes.find((node) => node.id === (nodeId || state.selectedNodeId));
}

function findRootNode(state: StudyHardBoardState): StudyConceptNode | undefined {
	return state.nodes.find((node) => node.type === "root") || state.nodes.find((node) => !node.parentId) || state.nodes[0];
}

function questionContextLabel(state: StudyHardBoardState, question: StudyQuestionCard): string {
	if (question.scope === "coach") return "학습 코치";
	if (question.scope === "flow-step") {
		const flow = state.flows.find((item) => item.id === question.targetFlowId);
		const step = flow?.steps.find((item) => item.id === question.targetFlowStepId);
		return step ? `데이터 플로우 ${flow?.title || question.targetFlowId} / ${step.order}. ${step.action}` : `데이터 플로우 ${question.targetFlowStepId || "(none)"}`;
	}
	if (question.scope === "note-block") {
		for (const section of state.noteDocument.sections) {
			const block = section.blocks.find((item) => item.id === question.targetNoteBlockId);
			if (block) return `학습 노트 ${section.title} / ${block.title || block.text || block.id}`;
		}
		return `학습 노트 ${question.targetNoteBlockId || "(none)"}`;
	}
	if (question.scope === "node") {
		const node = findNode(state, question.targetNodeId);
		return node ? `선택 노드 ${node.label} (${node.id})` : `선택 노드 ${question.targetNodeId || "(none)"}`;
	}
	return "전체 자료";
}

type StudyHardTranscriptEventKind = "learner-question" | "pi-answer" | "tutor-answer" | "refiner-answer" | "coach-question" | "learner-answer" | "coach-feedback" | "processing-failed" | "note-merged" | "history-summary";

function transcriptContentHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function transcriptEventKeysFromContext(ctx: ExtensionCommandContext | ExtensionContext, runId: string): Set<string> | undefined {
	const sessionManager = "sessionManager" in ctx ? ctx.sessionManager : undefined;
	if (!sessionManager || typeof sessionManager.getBranch !== "function") return undefined;
	try {
		return new Set(sessionManager.getBranch().flatMap((entry) => {
			if (entry.type !== "custom_message" || entry.customType !== STUDY_HARD_TRANSCRIPT_CUSTOM_TYPE) return [];
			const details = entry.details as Record<string, unknown> | undefined;
			return details?.runId === runId && typeof details.eventKey === "string" ? [details.eventKey] : [];
		}));
	} catch {
		return undefined;
	}
}

function publishStudyHardTranscript(
	handle: StudyHardHandle,
	eventKind: StudyHardTranscriptEventKind,
	eventKey: string,
	content: string,
	details: Record<string, unknown> = {},
): void {
	if (handle.transcriptEventKeys.has(eventKey)) return;
	try {
		handle.pi.sendMessage({
			customType: STUDY_HARD_TRANSCRIPT_CUSTOM_TYPE,
			content,
			display: true,
			details: { runId: handle.state.runId, eventKind, eventKey, ...details },
		}, { deliverAs: "followUp", triggerTurn: false });
		handle.transcriptEventKeys.add(eventKey);
	} catch {}
}

interface StudyHardQuestionTranscriptEvent {
	eventKind: StudyHardTranscriptEventKind;
	text: string;
}

function questionTranscriptEvents(question: StudyQuestionCard): StudyHardQuestionTranscriptEvent[] {
	const events: StudyHardQuestionTranscriptEvent[] = [];
	if ((question.origin || "learner") === "coach") {
		events.push({ eventKind: "coach-question", text: question.question });
		if (question.userAnswer) events.push({ eventKind: "learner-answer", text: question.userAnswer });
		if (question.feedback) events.push({ eventKind: "coach-feedback", text: question.feedback });
	} else {
		events.push({ eventKind: "learner-question", text: question.question });
		if (question.feedback) events.push({
			eventKind: question.scope === "coach"
				? "coach-feedback"
				: question.orchestrationId?.startsWith("pi-")
					? "pi-answer"
					: question.scope === "note-block" ? "refiner-answer" : "tutor-answer",
			text: question.feedback,
		});
	}
	if (question.processingStatus === "failed" && question.processingError) {
		events.push({ eventKind: "processing-failed", text: `질문: ${question.question}\n\n원인: ${question.processingError}` });
	}
	return events;
}

function questionTranscriptEventKey(question: StudyQuestionCard, event: StudyHardQuestionTranscriptEvent): string {
	return `${event.eventKind}:${question.id}:${transcriptContentHash(event.text)}`;
}

function publishQuestionTranscriptEvent(handle: StudyHardHandle, question: StudyQuestionCard, eventKind: StudyHardTranscriptEventKind, text: string): void {
	const contextLabel = questionContextLabel(handle.state, question);
	const labels: Record<StudyHardTranscriptEventKind, string> = {
		"learner-question": "📚 Study Hard 질문",
		"pi-answer": "💬 Study Hard Pi 답변",
		"tutor-answer": "📖 Study Hard Tutor 답변",
		"refiner-answer": "🛠 Study Hard 다듬기 결과",
		"coach-question": "🧭 Study Hard 이해 확인 질문",
		"learner-answer": "✍️ Study Hard 내 답변",
		"coach-feedback": "🧭 Study Hard 학습 코치",
		"processing-failed": "⚠️ Study Hard 처리 실패",
		"note-merged": "📝 Study Hard 학습 노트 반영",
		"history-summary": "📚 Study Hard 기존 Q&A 요약",
	};
	const eventKey = questionTranscriptEventKey(question, { eventKind, text });
	const body = eventKind === "pi-answer" || eventKind === "tutor-answer" || eventKind === "refiner-answer"
		? `질문: ${question.question}\n\n답변:\n${text}`
		: eventKind === "coach-feedback"
			? `질문: ${question.question}\n\n피드백:\n${text}`
			: eventKind === "learner-answer"
				? `질문: ${question.question}\n\n내 답변:\n${text}`
				: text;
	publishStudyHardTranscript(handle, eventKind, eventKey, `${labels[eventKind]} · ${contextLabel}\n\n${body}`, {
		questionId: question.id,
		scope: question.scope || "session",
		orchestrationId: question.orchestrationId,
		contextLabel,
	});
}

function syncStudyHardTranscript(handle: StudyHardHandle): void {
	for (const question of handle.state.questions) {
		for (const event of questionTranscriptEvents(question)) publishQuestionTranscriptEvent(handle, question, event.eventKind, event.text);
	}
}

function compactTranscriptPreview(value: string, maxLength = 180): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function hydrateStudyHardTranscriptSummary(handle: StudyHardHandle): void {
	const historicalEvents = handle.state.questions.flatMap((question) => questionTranscriptEvents(question).map((event) => ({ question, event })));
	const missingEvents = historicalEvents.filter(({ question, event }) => !handle.transcriptEventKeys.has(questionTranscriptEventKey(question, event)));
	if (!missingEvents.length) return;
	const applied = handle.state.questions.filter((question) => question.processingStatus === "applied").length;
	const failed = handle.state.questions.filter((question) => question.processingStatus === "failed").length;
	const recentQuestions = handle.state.questions.slice(-3).map((question) => `- ${question.id}: ${compactTranscriptPreview(question.question)}`).join("\n") || "- (질문 없음)";
	const summaryFingerprint = handle.state.questions.map((question) => ({ id: question.id, status: question.processingStatus, feedback: question.feedback, error: question.processingError }));
	const eventKey = `history-summary:${handle.state.runId}:${transcriptContentHash(JSON.stringify(summaryFingerprint))}`;
	publishStudyHardTranscript(
		handle,
		"history-summary",
		eventKey,
		`📚 Study Hard 기존 Q&A 요약 · ${handle.state.title}\n\n기존 run을 다시 열었습니다. 과거 질문·답변 전문은 Study Hard 보드에 보존하고, 현재 Pi context에는 요약만 연결합니다.\n\n- 질문: ${handle.state.questions.length}개\n- 노트 반영 완료: ${applied}개\n- 처리 실패: ${failed}개\n- runId: ${handle.state.runId}\n\n최근 주제\n${recentQuestions}`,
		{ questionCount: handle.state.questions.length, appliedCount: applied, failedCount: failed, historicalEventCount: historicalEvents.length },
	);
	for (const { question, event } of historicalEvents) handle.transcriptEventKeys.add(questionTranscriptEventKey(question, event));
}

function changedNoteSectionTitles(before: StudyNoteDocument, after: StudyNoteDocument): string[] {
	const previous = new Map(before.sections.map((section) => [section.id, JSON.stringify(section)]));
	return after.sections.filter((section) => previous.get(section.id) !== JSON.stringify(section)).map((section) => section.title);
}

function publishNoteMergeTranscript(handle: StudyHardHandle, questionIds: string[], before: StudyNoteDocument): void {
	const changedSections = changedNoteSectionTitles(before, handle.state.noteDocument);
	const noteHash = transcriptContentHash(JSON.stringify(handle.state.noteDocument));
	const eventKey = `note-merged:${[...questionIds].sort().join(",")}:${noteHash}`;
	const sectionSummary = changedSections.length ? changedSections.join(", ") : "문장 정리";
	publishStudyHardTranscript(
		handle,
		"note-merged",
		eventKey,
		`📝 Study Hard 학습 노트 반영\n\n질문 ${questionIds.length}개의 답변을 revision ${handle.state.revision}에 반영했습니다.\n변경 섹션: ${sectionSummary}`,
		{ questionIds, revision: handle.state.revision, changedSections },
	);
}

function nextQuestionId(state: StudyHardBoardState): string {
	const max = state.questions.reduce((acc, question) => {
		const match = /^Q(\d+)$/.exec(question.id);
		return match ? Math.max(acc, Number(match[1])) : acc;
	}, 0);
	return `Q${String(max + 1).padStart(3, "0")}`;
}

function safeFileName(value: string): string {
	return value.trim().replace(/[^a-zA-Z0-9가-힣._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "attachment";
}

function extensionFromMime(mimeType?: string): string {
	if (mimeType === "image/png") return ".png";
	if (mimeType === "image/jpeg") return ".jpg";
	if (mimeType === "image/gif") return ".gif";
	if (mimeType === "image/webp") return ".webp";
	return "";
}

function escapeExportHtml(value: unknown): string {
	return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character] || character);
}

function exportMermaidSafe(value: unknown): string {
	return String(value ?? "").replace(/[\r\n:;]/g, " ").replace(/\s+/g, " ").trim();
}

function exportSequenceSource(flow: StudyDataFlow): string {
	const aliases = new Map(flow.actors.map((actor, index) => [actor.id, `A${index + 1}`]));
	const lines = ["sequenceDiagram", "autonumber"];
	for (const actor of flow.actors) lines.push(`participant ${aliases.get(actor.id)} as ${exportMermaidSafe(actor.label)}`);
	for (const step of [...flow.steps].sort((a, b) => a.order - b.order)) {
		const from = aliases.get(step.from) || "A1";
		const to = aliases.get(step.to) || "A2";
		lines.push(`${from}->>${to}: ${exportMermaidSafe(step.action)}`);
		if (step.risk) lines.push(`Note over ${from},${to}: 위험 · ${exportMermaidSafe(step.risk)}`);
	}
	return lines.join("\n");
}

function exportReferenceHtml(reference: StudyNodeReference): string {
	const url = normalizeHttpUrl(reference.url);
	const locus = [reference.path, reference.symbol, reference.location, reference.revision].filter(Boolean).join(" · ");
	return `<article class="reference"><strong>${escapeExportHtml(reference.label)}</strong>${locus ? `<div class="muted">${escapeExportHtml(locus)}</div>` : ""}${reference.note ? `<p>${escapeExportHtml(reference.note)}</p>` : ""}${url ? `<a href="${escapeExportHtml(url)}" target="_blank" rel="noreferrer">원문 열기 ↗</a>` : ""}</article>`;
}

function exportCalloutMeta(tone?: StudyNoteBlock["tone"]): { icon: string; label: string } {
	if (tone === "warning") return { icon: "⚠️", label: "주의" };
	if (tone === "success") return { icon: "✅", label: "확인" };
	if (tone === "question") return { icon: "❓", label: "질문" };
	return { icon: "💡", label: "정보" };
}

function exportListItemDepth(value: string): { depth: number; text: string } {
	const prefix = value.match(/^[\t ]*/)?.[0] || "";
	const tabs = [...prefix].filter((character) => character === "\t").length;
	const spaces = [...prefix].filter((character) => character === " ").length;
	return { depth: tabs + Math.floor(spaces / 2), text: value.slice(prefix.length) };
}

function exportListHtml(items: string[], ordered: boolean): string {
	type Item = { text: string; children: Item[] };
	const roots: Item[] = [];
	const stack: Item[] = [];
	for (const raw of items) {
		const parsed = exportListItemDepth(raw);
		const depth = Math.min(parsed.depth, stack.length);
		const item: Item = { text: parsed.text, children: [] };
		if (depth > 0 && stack[depth - 1]) stack[depth - 1].children.push(item);
		else roots.push(item);
		stack[depth] = item;
		stack.length = depth + 1;
	}
	const tag = ordered ? "ol" : "ul";
	const render = (nodes: Item[]): string => `<${tag}>${nodes.map((item) => `<li>${escapeExportHtml(item.text)}${item.children.length ? render(item.children) : ""}</li>`).join("")}</${tag}>`;
	return render(roots);
}

function exportTableHtml(columns: string[], rows: string[][]): string {
	return `<div class="tableWrap"><table class="noteTable"><thead><tr>${columns.map((column) => `<th>${escapeExportHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((_, index) => `<td>${escapeExportHtml(row[index] || "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function exportCodeHtml(sample?: StudyCodeSample): string {
	if (!sample?.code) return "";
	if (String(sample.language || "").toLowerCase() === "mermaid") return `<div class="diagram"><pre class="mermaid">${escapeExportHtml(sample.code)}</pre></div>`;
	const reference = sample.reference;
	const heading = [reference?.path, reference?.symbol, reference?.revision].filter(Boolean).join(" · ") || sample.language || "code";
	const mode = sample.lineNumberMode || "relative";
	const startLine = mode === "source" ? Number(sample.startLine || 1) : 1;
	const numbering = mode === "none" ? "" : `<div class="codeMeta"><em>Line numbering: ${escapeExportHtml(mode)}, start ${escapeExportHtml(startLine)}</em></div>`;
	const annotations = (sample.annotations || []).map((annotation) => {
		const range = annotation.endLine && annotation.endLine !== annotation.line ? `${annotation.line}–${annotation.endLine}` : String(annotation.line);
		return `<li><strong>L${escapeExportHtml(range)} · ${escapeExportHtml(annotation.kind || "explain")}</strong><span>${escapeExportHtml(annotation.text)}</span></li>`;
	}).join("");
	return `<div class="codeStudy"><div class="codeTitle">${escapeExportHtml(heading)}</div>${numbering}<pre><code>${escapeExportHtml(sample.code)}</code></pre>${annotations ? `<ol class="annotations">${annotations}</ol>` : ""}</div>`;
}

function exportDiagramDataUrl(asset?: StudyDiagramExportAsset): string | undefined {
	if (!asset || !existsSync(asset.path)) return undefined;
	return `data:${asset.mimeType};base64,${readFileSync(asset.path).toString("base64")}`;
}

function exportNoteBlockHtml(block: StudyNoteBlock, state: StudyHardBoardState, diagramAssets: Map<string, StudyDiagramExportAsset>): string {
	if (block.type === "heading") {
		const level = Math.min(3, Math.max(1, Number(block.level || 2)));
		return `<h${level}>${escapeExportHtml(block.text || block.title)}</h${level}>`;
	}
	if (block.type === "paragraph") return `<p>${escapeExportHtml(block.text)}</p>`;
	if (block.type === "callout") {
		const meta = exportCalloutMeta(block.tone);
		return `<aside class="callout ${escapeExportHtml(block.tone || "info")}"><strong><span class="calloutIcon" aria-label="${meta.label}">${meta.icon}</span>${escapeExportHtml(block.title || "핵심")}</strong><p>${escapeExportHtml(block.body || block.text)}</p></aside>`;
	}
	if (block.type === "list") return exportListHtml(block.items || [], block.ordered === true);
	if (block.type === "table") return exportTableHtml(block.columns || [], block.rows || []);
	if (block.type === "code") return exportCodeHtml(block.code);
	if (block.type === "reference-list") return `<div class="references">${(block.references || []).map(exportReferenceHtml).join("")}</div>`;
	const resolvedVisual = resolveStudyNoteBlockVisual(state.noteDocument, block);
	if (resolvedVisual) {
		const visualTitle = block.title || (typeof resolvedVisual.title === "string" ? resolvedVisual.title : "TFT visual");
		const embedHtml = buildTftVisualEmbedHtml(resolvedVisual);
		const embedSource = `data:text/html;base64,${Buffer.from(embedHtml).toString("base64")}`;
		const fallbackSource = exportDiagramDataUrl(diagramAssets.get(block.id));
		return `<figure class="visualStudy"><figcaption><strong>${escapeExportHtml(visualTitle)}</strong>${block.body ? `<span>${escapeExportHtml(block.body)}</span>` : ""}</figcaption><iframe class="visualFrame" title="${escapeExportHtml(visualTitle)}" sandbox="allow-scripts" loading="eager" src="${embedSource}"></iframe>${fallbackSource ? `<details class="visualFallback"><summary>PNG fallback 보기</summary><img src="${fallbackSource}" alt="${escapeExportHtml(visualTitle)} PNG fallback" /></details>` : ""}<details class="visualSpec"><summary>${block.type === "visual-ref" ? "파생 visual spec 보기" : "원본 visual spec 보기"}</summary><pre>${escapeExportHtml(JSON.stringify(resolvedVisual, null, 2))}</pre></details></figure>`;
	}
	if (block.type === "flow-ref") {
		const flow = state.flows.find((item) => item.id === block.flowId);
		return flow ? `<div class="diagram"><h3>${escapeExportHtml(flow.variant === "before" ? `Before · ${flow.title}` : flow.variant === "after" ? `After · ${flow.title}` : flow.title)}</h3><pre class="mermaid">${escapeExportHtml(exportSequenceSource(flow))}</pre></div>` : "";
	}
	if (block.type === "divider") return "<hr />";
	return "";
}

function exportLearningCompanionHtml(state: StudyHardBoardState): string {
	const companion = state.companion;
	if (!companion) return "";
	const events = companion.events.slice(-50).map((event) => {
		const refs = [event.refs?.sliceId, event.refs?.commit, event.refs?.prUrl, event.refs?.reviewUrl].filter(Boolean).join(" · ");
		return `<li><strong>${escapeExportHtml(event.kind)}</strong> · ${escapeExportHtml(event.summary)}${refs ? `<div class="muted">${escapeExportHtml(refs)}</div>` : ""}</li>`;
	}).join("");
	const proposals = companion.proposals.map((proposal) => `<article class="reference"><strong>${escapeExportHtml(proposal.summary)}</strong><div class="muted">${escapeExportHtml(proposal.target)} · ${escapeExportHtml(proposal.status)}</div><p>${escapeExportHtml(proposal.proposedChange)}</p></article>`).join("");
	return `<section id="learning-companion"><h2>작업과 함께 쌓인 학습 기록</h2><aside class="callout"><strong>Companion · ${escapeExportHtml(companion.phase)}</strong><p>Frame과 코드는 작업 canonical로 유지하고, 이 섹션에는 의미 있는 변화와 학습 인사이트만 기록합니다.</p></aside><h3>작업 추적 · ${companion.events.length} events · ${companion.checkpoints.length} checkpoints</h3>${events ? `<ol>${events}</ol>` : `<p class="muted">아직 작업 checkpoint가 없습니다.</p>`}${proposals ? `<h3>작업 반영 제안</h3><div class="references">${proposals}</div>` : ""}</section>`;
}

function exportNoteSectionHtml(section: StudyNoteSection, state: StudyHardBoardState, diagramAssets: Map<string, StudyDiagramExportAsset>): string {
	let headingLevel = 1;
	const blocks = section.blocks.map((block) => {
		if (block.type === "heading") {
			const explicitLevel = Number(block.level);
			headingLevel = [1, 2, 3].includes(explicitLevel) ? explicitLevel : Math.min(3, Math.max(2, headingLevel + 1));
			const rendered = exportNoteBlockHtml({ ...block, level: headingLevel as 1 | 2 | 3 }, state, diagramAssets);
			return `<div class="noteDepth${Math.max(0, headingLevel - 2)}">${rendered}</div>`;
		}
		const depth = Math.max(0, Math.min(2, headingLevel - 1));
		return `<div class="noteDepth${depth}">${exportNoteBlockHtml(block, state, diagramAssets)}</div>`;
	}).join("");
	return `<section id="${escapeExportHtml(section.id)}"><h2>${escapeExportHtml(section.title)}</h2>${blocks}</section>`;
}

export function buildStudyNoteExportHtml(state: StudyHardBoardState, diagramAssetList: StudyDiagramExportAsset[] = []): string {
	const document = state.noteDocument;
	const diagramAssets = new Map(diagramAssetList.map((asset) => [asset.blockId, asset]));
	const sections = document.sections.map((section) => exportNoteSectionHtml(section, state, diagramAssets)).join("");
	const companion = exportLearningCompanionHtml(state);
	const sourceUrl = normalizeHttpUrl(state.url);
	return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${escapeExportHtml(document.title)}</title>
<style>:root{color-scheme:light;--text:#2d2925;--muted:#756e66;--line:#d8cfc1;--panel:#fffdf8;--accent:#157a6e;--warn:#b7791f;--ok:#3f7d54;--review:#7660a9}*{box-sizing:border-box}body{margin:0;background:#f6f1e7;color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.page{max-width:920px;margin:0 auto;padding:48px 28px 90px}.hero{padding-bottom:22px;border-bottom:1px solid var(--line);margin-bottom:32px}.hero h1{font-size:34px;line-height:1.25;margin:0 0 10px}.meta,.muted{color:var(--muted);font-size:12px;line-height:1.6}.meta a{color:var(--accent)}section{margin:0 0 42px}section>h2{font-size:23px;padding-bottom:9px;border-bottom:1px solid var(--line)}h3{font-size:17px}p,li{line-height:1.75}li{margin:4px 0}.noteDepth1{margin-left:26px}.noteDepth2{margin-left:52px}.callout{border:1px solid #b9d6df;border-left:5px solid #4f87a4;border-radius:12px;padding:13px 15px;background:#edf6f8;margin:15px 0}.callout.warning{border-color:#e4c48d;border-left-color:var(--warn);background:#fff3df}.callout.success{border-color:#bbd9c0;border-left-color:var(--ok);background:#edf7ef}.callout.question{border-color:#cfc3e9;border-left-color:var(--review);background:#f3effa}.callout strong{display:flex;align-items:center;gap:7px;margin-bottom:6px}.calloutIcon{font-size:14px}.callout p{margin:0;white-space:pre-wrap}.diagram,.codeStudy,.reference{border:1px solid #d2c7b9;border-radius:14px;background:var(--panel);padding:14px;margin:15px 0;overflow:auto}.diagram svg{display:block;max-width:100%;height:auto;margin:auto}.codeTitle{font-size:11px;color:var(--muted);font-weight:700;margin-bottom:5px}.codeMeta{font-size:11px;color:var(--muted);margin:0 0 9px}.codeStudy pre{margin:0;padding:14px;background:#f1ece3;border-radius:10px;overflow:auto;font:12px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}.annotations{margin:12px 0 0;padding-left:24px}.annotations li{font-size:12px}.annotations strong,.annotations span{display:block}.tableWrap{margin:15px 0;overflow-x:auto;border:1px solid #d2c7b9;border-radius:12px;background:var(--panel)}.noteTable{width:100%;min-width:760px;border-collapse:collapse;font-size:12px;line-height:1.5}.noteTable th,.noteTable td{padding:10px 11px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);text-align:left;vertical-align:top}.noteTable th{background:#eee8de;font-weight:800;white-space:nowrap}.noteTable tr:last-child td{border-bottom:0}.noteTable th:last-child,.noteTable td:last-child{border-right:0}.references{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}.reference{margin:0}.reference p{font-size:12px}.reference a{color:var(--accent);font-weight:700;font-size:12px}.visualStudy{border:1px solid #d2c7b9;border-radius:16px;background:var(--panel);padding:14px;margin:16px 0}.visualStudy figcaption{display:grid;gap:4px;margin-bottom:10px}.visualStudy figcaption span{color:var(--muted);font-size:12px}.visualFrame{display:block;width:100%;min-height:280px;border:0;background:#fff;border-radius:12px}.visualFallback,.visualSpec{margin-top:10px}.visualFallback summary,.visualSpec summary{cursor:pointer;font-size:12px;font-weight:700;color:var(--accent)}.visualFallback img{display:block;max-width:100%;height:auto;margin:10px auto 0}.visualSpec pre{max-height:320px;overflow:auto;background:#f1ece3;border-radius:10px;padding:12px;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap}hr{border:0;border-top:1px solid var(--line);margin:28px 0}@media(max-width:640px){.page{padding:28px 16px 60px}.hero h1{font-size:27px}.noteDepth1{margin-left:14px}.noteDepth2{margin-left:28px}}</style>
</head><body><main class="page"><header class="hero"><h1>${escapeExportHtml(document.title)}</h1><div class="meta">Study Hard · revision ${state.revision} · ${escapeExportHtml(new Date(state.updatedAt).toLocaleString("ko-KR"))}${sourceUrl ? ` · <a href="${escapeExportHtml(sourceUrl)}">원본 자료</a>` : ""}</div></header>${sections}${companion}</main><script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script><script>window.addEventListener('message',function(event){if(!event.data||event.data.type!=='pilee:tft-visual-ready')return;document.querySelectorAll('iframe.visualFrame').forEach(function(frame){if(frame.contentWindow===event.source){var height=Math.max(220,Math.min(12000,Number(event.data.height)||0));if(height)frame.style.height=height+'px';}});});mermaid.initialize({startOnLoad:true,theme:'base',securityLevel:'strict'});</script></body></html>`;
}

function exportDir(runId: string): string {
	const dir = join(stateDir(), `${validateRunId(runId)}-exports`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function writeStudyNoteExport(state: StudyHardBoardState, downloadDir: string, diagramAssets: StudyDiagramExportAsset[] = []): { fileName: string; path: string } {
	const fileName = `${safeFileName(state.noteDocument.title)}-r${state.revision}.html`;
	mkdirSync(downloadDir, { recursive: true });
	const path = join(downloadDir, fileName);
	writeFileSync(path, buildStudyNoteExportHtml(state, diagramAssets), "utf-8");
	return { fileName, path };
}

function browserDiagramBlockIds(state: StudyHardBoardState): string[] {
	const flowIds = new Set(state.flows.map((flow) => flow.id));
	return state.noteDocument.sections.flatMap((section) => section.blocks)
		.filter((block) => (block.type === "code" && String(block.code?.language || "").toLowerCase() === "mermaid") || (block.type === "flow-ref" && !!block.flowId && flowIds.has(block.flowId)))
		.map((block) => block.id);
}

function visualNoteBlocks(state: StudyHardBoardState): StudyNoteBlock[] {
	return state.noteDocument.sections.flatMap((section) => section.blocks).flatMap((block) => {
		const visual = resolveStudyNoteBlockVisual(state.noteDocument, block);
		return visual ? [{ ...block, type: "visual" as const, visual, visualRef: undefined }] : [];
	});
}

function persistNotionDiagramAssets(state: StudyHardBoardState, value: unknown, expected = [...browserDiagramBlockIds(state), ...visualNoteBlocks(state).map((block) => block.id)]): StudyDiagramExportAsset[] {
	if (!expected.length) return [];
	if (!Array.isArray(value)) throw new Error(`Notion 내보내기에 렌더링된 다이어그램 ${expected.length}개가 필요합니다.`);
	const expectedSet = new Set(expected);
	const seen = new Set<string>();
	const assets: StudyDiagramExportAsset[] = [];
	let totalBytes = 0;
	const directory = join(exportDir(state.runId), "diagrams");
	mkdirSync(directory, { recursive: true });
	for (const item of value.slice(0, 64)) {
		if (!item || typeof item !== "object" || Array.isArray(item)) continue;
		const record = item as Record<string, unknown>;
		const blockId = typeof record.blockId === "string" ? record.blockId : "";
		const match = typeof record.dataUrl === "string" ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(record.dataUrl) : null;
		if (!expectedSet.has(blockId) || seen.has(blockId) || !match) continue;
		const data = Buffer.from(match[1] || "", "base64");
		if (!data.length || data.length > 8 * 1024 * 1024) throw new Error(`다이어그램 ${blockId} PNG 크기가 허용 범위를 벗어났습니다.`);
		totalBytes += data.length;
		if (totalBytes > 32 * 1024 * 1024) throw new Error("Notion 다이어그램 전체 크기가 32MB를 초과했습니다.");
		const fileName = `${safeFileName(blockId)}.png`;
		const path = join(directory, fileName);
		writeFileSync(path, data);
		assets.push({ blockId, fileName, mimeType: "image/png", path, sha256: createHash("sha256").update(data).digest("hex") });
		seen.add(blockId);
	}
	const missing = expected.filter((blockId) => !seen.has(blockId));
	if (missing.length) throw new Error(`렌더링되지 않은 Notion 다이어그램: ${missing.join(", ")}`);
	return assets;
}

async function captureStudyVisualAssets(state: StudyHardBoardState): Promise<StudyDiagramExportAsset[]> {
	const blocks = visualNoteBlocks(state);
	if (!blocks.length) return [];
	const directory = join(exportDir(state.runId), "diagrams");
	mkdirSync(directory, { recursive: true });
	const assets: StudyDiagramExportAsset[] = [];
	let totalBytes = 0;
	for (const block of blocks) {
		const visual = block.visual!;
		const title = block.title || (typeof visual.title === "string" ? visual.title : block.id);
		const capture = await captureGlimpseHtmlPng(buildTftVisualEmbedHtml(visual), { title: `Study Hard visual · ${title}` });
		const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(capture.dataUrl);
		if (!match) throw new Error(`TFT visual ${block.id} native capture가 PNG data URL을 반환하지 않았습니다.`);
		const data = Buffer.from(match[1] || "", "base64");
		if (!data.length || data.length > 8 * 1024 * 1024) throw new Error(`TFT visual ${block.id} PNG 크기가 허용 범위를 벗어났습니다.`);
		totalBytes += data.length;
		if (totalBytes > 32 * 1024 * 1024) throw new Error("TFT visual PNG 전체 크기가 32MB를 초과했습니다.");
		const fileName = `${safeFileName(block.id)}.png`;
		const path = join(directory, fileName);
		writeFileSync(path, data);
		assets.push({ blockId: block.id, fileName, mimeType: "image/png", path, sha256: createHash("sha256").update(data).digest("hex") });
	}
	return assets;
}

async function prepareExportDiagramAssets(state: StudyHardBoardState, value: unknown, requireBrowserAssets = true): Promise<StudyDiagramExportAsset[]> {
	const browserAssets = requireBrowserAssets || Array.isArray(value) ? persistNotionDiagramAssets(state, value, browserDiagramBlockIds(state)) : [];
	const visualBlocks = visualNoteBlocks(state);
	if (!visualBlocks.length) return browserAssets;
	if (process.platform !== "darwin") return [...browserAssets, ...persistNotionDiagramAssets(state, value, visualBlocks.map((block) => block.id))];
	try {
		return [...browserAssets, ...await captureStudyVisualAssets(state)];
	} catch (nativeError) {
		try {
			const fallbackAssets = persistNotionDiagramAssets(state, value, visualBlocks.map((block) => block.id));
			return [...browserAssets, ...fallbackAssets];
		} catch (fallbackError) {
			throw new Error(`TFT visual PNG 준비 실패. native: ${nativeError instanceof Error ? nativeError.message : nativeError}; browser fallback: ${fallbackError instanceof Error ? fallbackError.message : fallbackError}`);
		}
	}
}

function localCalendarDate(now = new Date()): string {
	const parts = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
	const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
	return `${value.year}-${value.month}-${value.day}`;
}

function buildNotionSyncPayload(state: StudyHardBoardState, diagramAssets: StudyDiagramExportAsset[]): Record<string, unknown> {
	return {
		...materializeVisualReferences(state),
		date: state.notionSync?.calendarDate || localCalendarDate(),
		sourceUrl: state.url,
		sessionId: state.runId,
		qa: state.questions,
		diagramAssets,
		notionSync: state.notionSync || {},
	};
}

function sanitizeStudyHardSyncError(value: unknown): string {
	return String(value || "")
		.replace(/ntn_[A-Za-z0-9]+/g, "ntn_[REDACTED]")
		.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]")
		.trim();
}

function studyHardSyncErrorDetail(error: unknown): string {
	const item = error && typeof error === "object" ? error as Record<string, unknown> : {};
	const stderr = sanitizeStudyHardSyncError(item.stderr);
	const stdout = sanitizeStudyHardSyncError(item.stdout);
	const fallback = sanitizeStudyHardSyncError(error instanceof Error ? error.message : error);
	const raw = stderr || stdout || fallback || "unknown sync process failure";
	const detail = raw.length > 4_000 ? raw.slice(-4_000) : raw;
	const code = item.code !== undefined ? ` (exit ${String(item.code)})` : "";
	return `Notion 동기화 실패${code}: ${detail}`;
}

async function runStudyHardNotionSync(handle: StudyHardHandle, diagramAssets: StudyDiagramExportAsset[]): Promise<Record<string, unknown>> {
	if (!existsSync(handle.syncScript)) throw new Error("Notion 동기화 스크립트를 찾지 못했습니다.");
	if (handle.notionSyncInFlight) throw new Error("Notion 동기화가 이미 진행 중입니다.");
	handle.notionSyncInFlight = true;
	try {
		const inputPath = join(exportDir(handle.state.runId), "notion-sync.json");
		const syncedRevision = handle.state.revision;
		const syncedHash = buildNoteHistoryBundle(handle.state).hash;
		const syncPayload = buildNotionSyncPayload(handle.state, diagramAssets);
		writeFileSync(inputPath, JSON.stringify(syncPayload, null, 2), "utf-8");
		const { stdout } = await execFileAsync(process.env.STUDY_HARD_PYTHON || "python3", [handle.syncScript, "--file", inputPath], { maxBuffer: 4 * 1024 * 1024, timeout: 300_000 });
		const result = JSON.parse(String(stdout).trim()) as Record<string, unknown>;
		const currentRevision = handle.state.revision;
		const staleAfterSync = buildNoteHistoryBundle(handle.state).hash !== syncedHash;
		handle.state = mergeBoardState(handle.state, {
			notionSync: {
				pageId: result.pageId,
				calendarDate: typeof result.calendarDate === "string" ? result.calendarDate : String(syncPayload.date || ""),
				pageUrl: result.pageUrl,
				sessionId: result.sessionId,
				sectionHashes: result.sectionHashes,
				lastSyncedRevision: syncedRevision,
				lastSyncedHash: syncedHash,
				lastSyncedAt: Date.now(),
			},
		});
		saveState(handle);
		broadcast(handle);
		return { ...result, syncedRevision, currentRevision, staleAfterSync };
	} catch (error) {
		const detail = studyHardSyncErrorDetail(error);
		console.error(`[study-hard:notion-sync] ${detail}`);
		throw new Error(detail);
	} finally {
		handle.notionSyncInFlight = false;
	}
}

function attachmentDir(runId: string): string {
	const dir = join(stateDir(), `${runId}-attachments`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function decodeDataUrl(dataUrl: string): { mimeType?: string; data: Buffer } {
	const match = /^data:([^;,]+)?;base64,(.*)$/s.exec(dataUrl);
	if (!match) return { data: Buffer.from(dataUrl, "base64") };
	return { mimeType: match[1], data: Buffer.from(match[2] || "", "base64") };
}

const MAX_STUDY_ANSWER_LENGTH = 16_000;

function cloneBoardState(state: StudyHardBoardState): StudyHardBoardState {
	return JSON.parse(JSON.stringify(state)) as StudyHardBoardState;
}

function learningAgentModel(handle: StudyHardHandle, role: "coach"): string | undefined {
	const key = `STUDY_HARD_${role.toUpperCase()}_MODEL`;
	return process.env[key] || handle.agentModel;
}

function commitHandlePatch(handle: StudyHardHandle, patch: Record<string, unknown>): void {
	handle.state = mergeBoardState(handle.state, patch);
	saveState(handle);
	broadcast(handle);
}

function updateQuestionCards(
	handle: StudyHardHandle,
	questionIds: string[],
	update: (question: StudyQuestionCard) => StudyQuestionCard,
	patch: Record<string, unknown> = {},
): void {
	const ids = new Set(questionIds);
	commitHandlePatch(handle, {
		...patch,
		questions: handle.state.questions.map((question) => ids.has(question.id) ? update(question) : question),
	});
}

function questionAttachmentRecords(state: StudyHardBoardState, question: StudyQuestionCard): StudyAttachment[] {
	const explicitIds = new Set(question.attachmentIds || []);
	if (explicitIds.size) return state.attachments.filter((attachment) => explicitIds.has(attachment.id));
	if (question.targetNodeId) return state.attachments.filter((attachment) => attachment.nodeId === question.targetNodeId);
	return [];
}

function coachSemanticFingerprint(state: StudyHardBoardState): string {
	const nodes = state.nodes.map(({ x: _x, y: _y, positionLocked: _positionLocked, ...node }) => node);
	return createHash("sha256").update(JSON.stringify({ goals: state.goals, recommendedNodeId: state.recommendedNodeId, followups: state.followups, learningPhase: state.learningPhase, coachRole: state.coachRole, summary: state.summary, nodes })).digest("hex");
}

function strictStringArray(value: unknown, label: string): string[] {
	if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim())) throw new Error(`${label}는 비어 있지 않은 문자열 배열이어야 합니다.`);
	return value.map((item) => String(item).trim());
}

function buildCoachPrompt(state: StudyHardBoardState, question: StudyQuestionCard): string {
	const nodes = state.nodes.map(({ id, label, summary, status, type, parentId }) => ({ id, label, summary, status, type, parentId }));
	const openQuestions = state.questions
		.filter((item) => item.scope !== "coach" && (item.status === "open" || item.status === "review" || item.processingStatus === "failed"))
		.map(({ id, scope, question: text, status, processingStatus }) => ({ id, scope, question: text, status, processingStatus }));
	const learnerTurn = question.origin === "coach"
		? { coachQuestion: question.question, learnerAnswer: question.userAnswer }
		: { learnerDirectionRequest: question.question };
	return `# Study Hard Learning Coach\n\n당신은 학습 내용 편집자가 아니라 학습 과정 내비게이터입니다. 현재 이해 상태와 사용자의 요청을 보고 다음 학습 방향을 조정하세요.\n\n## 기준 revision\n${state.revision}\n\n## 사용자 턴\n${JSON.stringify(learnerTurn, null, 2)}\n\n## 현재 학습 상태\n${JSON.stringify({ goals: state.goals, learningPhase: state.learningPhase, coachRole: state.coachRole, recommendedNodeId: state.recommendedNodeId, summary: state.summary, followups: state.followups, nodes, openQuestions, noteOutline: state.noteDocument.sections.map((section) => ({ id: section.id, title: section.title, blocks: section.blocks.map((block) => block.id) })) }, null, 2)}\n\n## 코치 규칙\n- 문서 내용을 직접 다시 쓰지 말고, 무엇을 이해했고 무엇을 다음에 볼지에 집중합니다.\n- 목표는 사용자의 표현을 반영해 구체적으로 다듬되 기존 목표를 함부로 삭제하지 않습니다.\n- node status 변경은 이 대화로 확인 가능한 경우만 제안합니다.\n- 필요한 경우 한 번에 하나의 짧은 메타인지 질문을 nextQuestion으로 제안합니다.\n- 반드시 아래 JSON 객체만 반환하고 noteDocument, flows, edges, questions는 출력하지 않습니다.\n\n{\n  "baseRevision": ${state.revision},\n  "feedback": "사용자에게 보여줄 코치 답변",\n  "goals": ["갱신된 전체 학습 목표"],\n  "recommendedNodeId": "existing-node-id",\n  "followups": ["복습 또는 다음 행동"],\n  "nodeStatusUpdates": [{"id":"existing-node-id","status":"unknown|learning|confused|understood|review"}],\n  "learningPhase": "map|explain|trace|practice|reflect",\n  "coachRole": "mentor|rubber-duck|peer|lead",\n  "questionStatus": "answered|understood|review",\n  "nextQuestion": "optional single reflection question"\n}`;
}

function validatedCoachResult(state: StudyHardBoardState, output: string, baseRevision: number): {
	feedback: string;
	goals?: string[];
	recommendedNodeId?: string;
	followups?: string[];
	nodeStatusUpdates: Array<{ id: string; status: StudyConceptStatus }>;
	learningPhase?: StudyLearningPhase;
	coachRole?: StudyCoachRole;
	questionStatus: StudyQuestionStatus;
	nextQuestion?: string;
} {
	const result = parseStudyLearningAgentJson<Record<string, unknown>>(output);
	if (result.baseRevision !== baseRevision) throw new Error(`학습 코치 baseRevision 불일치: expected ${baseRevision}, received ${String(result.baseRevision)}`);
	const feedback = typeof result.feedback === "string" ? result.feedback.trim().slice(0, MAX_STUDY_ANSWER_LENGTH) : "";
	if (!feedback) throw new Error("학습 코치가 feedback을 반환하지 않았습니다.");
	const goals = result.goals === undefined ? undefined : strictStringArray(result.goals, "학습 코치 goals");
	const followups = result.followups === undefined ? undefined : strictStringArray(result.followups, "학습 코치 followups");
	const nodeIds = new Set(state.nodes.map((node) => node.id));
	const recommendedNodeId = typeof result.recommendedNodeId === "string" && nodeIds.has(result.recommendedNodeId) ? result.recommendedNodeId : undefined;
	if (typeof result.recommendedNodeId === "string" && !recommendedNodeId) throw new Error(`학습 코치 recommendedNodeId가 존재하지 않습니다: ${result.recommendedNodeId}`);
	if (result.nodeStatusUpdates !== undefined && !Array.isArray(result.nodeStatusUpdates)) throw new Error("학습 코치 nodeStatusUpdates는 배열이어야 합니다.");
	const conceptStatuses = ["unknown", "learning", "confused", "understood", "review"];
	const nodeStatusUpdates = Array.isArray(result.nodeStatusUpdates) ? result.nodeStatusUpdates.map((item) => {
		if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("학습 코치 nodeStatusUpdates 항목은 객체여야 합니다.");
		const record = item as Record<string, unknown>;
		const id = typeof record.id === "string" ? record.id : "";
		if (!nodeIds.has(id)) throw new Error(`학습 코치 nodeStatusUpdates id가 존재하지 않습니다: ${id}`);
		if (!conceptStatuses.includes(String(record.status))) throw new Error(`학습 코치 node status가 유효하지 않습니다: ${String(record.status)}`);
		return { id, status: String(record.status) as StudyConceptStatus };
	}) : [];
	const learningPhases = ["map", "explain", "trace", "practice", "reflect"];
	if (result.learningPhase !== undefined && !learningPhases.includes(String(result.learningPhase))) throw new Error(`학습 코치 learningPhase가 유효하지 않습니다: ${String(result.learningPhase)}`);
	const learningPhase = result.learningPhase === undefined ? undefined : String(result.learningPhase) as StudyLearningPhase;
	const coachRoles = ["mentor", "rubber-duck", "peer", "lead"];
	if (result.coachRole !== undefined && !coachRoles.includes(String(result.coachRole))) throw new Error(`학습 코치 coachRole이 유효하지 않습니다: ${String(result.coachRole)}`);
	const coachRole = result.coachRole === undefined ? undefined : String(result.coachRole) as StudyCoachRole;
	const questionStatuses = ["answered", "understood", "review"];
	if (result.questionStatus !== undefined && !questionStatuses.includes(String(result.questionStatus))) throw new Error(`학습 코치 questionStatus가 유효하지 않습니다: ${String(result.questionStatus)}`);
	const questionStatus = result.questionStatus === undefined ? "answered" : String(result.questionStatus) as StudyQuestionStatus;
	const nextQuestion = typeof result.nextQuestion === "string" && result.nextQuestion.trim() ? result.nextQuestion.trim().slice(0, 600) : undefined;
	return { feedback, goals, recommendedNodeId, followups, nodeStatusUpdates, learningPhase, coachRole, questionStatus, nextQuestion };
}

async function runCoachTurn(handle: StudyHardHandle, questionId: string): Promise<void> {
	updateQuestionCards(handle, [questionId], (question) => ({ ...question, processingStatus: "running", processingError: "" }));
	try {
		let result: ReturnType<typeof validatedCoachResult> | undefined;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const snapshot = cloneBoardState(handle.state);
			const question = snapshot.questions.find((item) => item.id === questionId);
			if (!question) return;
			const fingerprint = coachSemanticFingerprint(snapshot);
			const output = await handle.agentRunner({
				role: "coach",
				prompt: buildCoachPrompt(snapshot, question),
				cwd: handle.cwd || process.cwd(),
				model: learningAgentModel(handle, "coach"),
				thinking: handle.agentThinking,
				signal: handle.orchestrationAbort.signal,
			});
			result = validatedCoachResult(snapshot, output, snapshot.revision);
			if (coachSemanticFingerprint(handle.state) !== fingerprint) {
				if (attempt === 0) continue;
				throw new Error("학습 코치 실행 중 학습 방향이 다시 바뀌어 안전하게 반영하지 못했습니다.");
			}
			break;
		}
		if (!result) throw new Error("학습 코치 결과가 없습니다.");
		const statusById = new Map(result.nodeStatusUpdates.map((item) => [item.id, item.status]));
		const questions = handle.state.questions.map((item) => item.id === questionId ? { ...item, feedback: result.feedback, status: result.questionStatus, answeredAt: Date.now(), processingStatus: "applied" as const, processingError: "" } : item);
		let currentQuestionId = questionId;
		if (result.nextQuestion && !questions.some((item) => item.scope === "coach" && item.origin === "coach" && item.status === "open" && !item.userAnswer && item.question === result.nextQuestion)) {
			const nextQuestion: StudyQuestionCard = { id: nextQuestionId({ ...handle.state, questions }), question: result.nextQuestion, origin: "coach", scope: "coach", status: "open", createdAt: Date.now() };
			questions.push(nextQuestion);
			currentQuestionId = nextQuestion.id;
		}
		commitHandlePatch(handle, {
			questions,
			currentQuestionId,
			goals: result.goals,
			recommendedNodeId: result.recommendedNodeId,
			followups: result.followups,
			learningPhase: result.learningPhase,
			coachRole: result.coachRole,
			nodes: handle.state.nodes.map((node) => statusById.has(node.id) ? { ...node, status: statusById.get(node.id) } : node),
		});
	} catch (error) {
		if (!handle.closed) updateQuestionCards(handle, [questionId], (item) => ({ ...item, processingStatus: "failed", processingError: error instanceof Error ? error.message : String(error) }));
	}
}

async function processCoachQueue(handle: StudyHardHandle): Promise<void> {
	if (handle.coachOrchestrationRunning || handle.closed) return;
	handle.coachOrchestrationRunning = true;
	try {
		while (handle.coachQueue.length && !handle.closed) await runCoachTurn(handle, handle.coachQueue.shift()!);
	} catch (error) {
		if (!handle.closed) {
			const interruptedIds = handle.state.questions.filter((question) => question.scope === "coach" && ["queued", "running"].includes(String(question.processingStatus))).map((question) => question.id);
			handle.coachQueue = [];
			try { updateQuestionCards(handle, interruptedIds, (question) => ({ ...question, processingStatus: "failed", processingError: error instanceof Error ? error.message : String(error) })); } catch {}
		}
	} finally {
		handle.coachOrchestrationRunning = false;
	}
}

function enqueueCoachTurn(handle: StudyHardHandle, questionId: string): void {
	if (!handle.coachQueue.includes(questionId)) handle.coachQueue.push(questionId);
	if (handle.coachQueueTimer || handle.coachOrchestrationRunning || handle.closed) return;
	handle.coachQueueTimer = setTimeout(() => {
		handle.coachQueueTimer = undefined;
		void processCoachQueue(handle);
	}, 0);
	handle.coachQueueTimer.unref?.();
}

function resumeInterruptedLearningAgents(handle: StudyHardHandle): void {
	const interrupted = new Set<StudyQuestionProcessingStatus>(["queued", "running", "answered", "merging"]);
	const learnerQuestionIds = handle.state.questions.filter((question) => {
		if (question.scope === "coach" || question.origin !== "learner") return false;
		if (question.processingStatus) return interrupted.has(question.processingStatus);
		return question.status === "open" && !question.feedback;
	}).map((question) => question.id);
	const coachQuestionIds = handle.state.questions.filter((question) => question.scope === "coach" && question.processingStatus && interrupted.has(question.processingStatus)).map((question) => question.id);
	const allIds = [...learnerQuestionIds, ...coachQuestionIds];
	if (!allIds.length) return;
	updateQuestionCards(handle, allIds, (question) => ({ ...question, processingStatus: "queued", processingError: "" }));
	for (const questionId of learnerQuestionIds) {
		const question = handle.state.questions.find((item) => item.id === questionId);
		if (question) sendLearnerQuestionToCurrentSession(handle, question);
	}
	for (const questionId of coachQuestionIds) enqueueCoachTurn(handle, questionId);
}

function sendLearnerQuestionToCurrentSession(handle: StudyHardHandle, question: StudyQuestionCard): void {
	const contextLabel = questionContextLabel(handle.state, question);
	const attachments = questionAttachmentRecords(handle.state, question).map((attachment) => ({
		name: attachment.name,
		mimeType: attachment.mimeType,
		path: attachment.path,
	}));
	handle.pi.sendMessage({
		customType: "heestolee.study-hard.learner-request",
		display: false,
		content: `# Study Hard current-session request\n\n이 메시지는 별도 Tutor/Editor 작업이 아니라 사용자가 Study Hard 입력창으로 보낸 현재 Pi 대화의 직접 요청입니다. 현재 session의 대화 맥락과 도구를 그대로 사용해 답하세요.\n\n- runId: ${handle.state.runId}\n- statePath: ${handle.statePath}\n- submittedRevision: ${handle.state.revision}\n- questionId: ${question.id}\n- scope: ${question.scope || "session"}\n- context: ${contextLabel}\n- attachments: ${JSON.stringify(attachments)}\n\n## 사용자 메시지\n${question.question}\n\n## 응답 규칙\n1. 일반 사용자 메시지처럼 현재 대화 맥락을 이어서 판단하고 Pi 채팅에 직접 답합니다. 격리 학습 agent를 호출하거나 Tutor/Editor 역할로 위임하지 않습니다.\n2. 설명만 필요한지, 로컬 수정인지, block 분할·삽입·이동을 포함한 구조 수정인지 먼저 판단합니다. 구조 수정이면 statePath의 최신 noteDocument와 필요한 renderer 코드를 확인합니다.\n3. 이미지 attachment가 있으면 위 path를 read로 확인한 뒤 답합니다.\n4. 보드 응답은 반드시 \`study_hard_board\` action=\"respond\"로 저장합니다. 호출 직전에 statePath를 다시 읽고 최신 revision을 expectedRevision으로 사용하세요.\n5. 수정이 없으면 feedback만 전달합니다. 수정이 있으면 noteDocument 등 필요한 최신 전체 patch를 함께 전달합니다. action=\"respond\"가 question 상태와 transcript를 원자적으로 갱신하므로 questions 배열을 직접 만들지 않습니다.\n6. feedback에는 Study Hard drawer에 남길 직접 답변을 넣고, Pi 최종 답변에도 같은 결론을 자연스럽게 설명합니다.`,
		details: { runId: handle.state.runId, statePath: handle.statePath, questionId: question.id, scope: question.scope, attachments },
	}, { deliverAs: "followUp", triggerTurn: true });
}

function sendNodeAnswerToAgent(handle: StudyHardHandle, question: StudyQuestionCard): void {
	const node = findNode(handle.state, question.targetNodeId);
	const contextLabel = questionContextLabel(handle.state, question);
	handle.pi.sendMessage({
		customType: "heestolee.study-hard.node-answer",
		display: false,
		content: `# Study Hard node answer\n\n사용자가 선택 노드의 이해 확인 질문에 답했습니다.\n\n- runId: ${handle.state.runId}\n- expectedRevision: ${handle.state.revision}\n- questionId: ${question.id}\n- 질문 context: ${contextLabel}\n- 선택 노드: ${node ? `${node.label} (${node.id})` : "(not-node-context)"}\n- 확인 질문: ${question.question}\n- 사용자 답변: ${question.userAnswer || "(none)"}\n\n응답 규칙:\n1. 맞은 부분, 빈틈, 오개념을 나눠 피드백하세요.\n2. \`study_hard_board update\`에 expectedRevision=${handle.state.revision}을 넣고 기존 questions 전체를 보존하면서 ${question.id}의 feedback/status를 understood 또는 review로 갱신하세요.\n3. 노드 status와 recommendedNodeId를 실제 이해 상태에 맞게 갱신하세요.\n4. 다음 질문은 새로운 빈틈을 닫을 필요가 있을 때만 같은 노드 스레드에 하나 추가하세요.`,
		details: { runId: handle.state.runId, nodeId: question.targetNodeId, questionId: question.id },
	}, { deliverAs: "followUp", triggerTurn: true });
}

export async function startStudyHardStudio(pi: ExtensionAPI, ctx: ExtensionCommandContext | ExtensionContext, params: { url: string; title?: string; hints?: string; runId?: string; syncScript?: string; downloadDir?: string; agentRunner?: StudyLearningAgentRunner; initialPatch?: Record<string, unknown> }): Promise<StudyHardHandle> {
	const requestedRunId = params.runId ? validateRunId(params.runId) : undefined;
	const canonicalUrl = normalizeHttpUrl(params.url);
	if (!canonicalUrl) throw new Error("Study Hard requires an http(s) url");
	const initialPatch = params.initialPatch && Object.values(params.initialPatch).some((value) => value !== undefined) ? params.initialPatch : undefined;
	if (requestedRunId && handles.has(requestedRunId)) {
		const active = handles.get(requestedRunId)!;
		if (active.state.url !== canonicalUrl) throw new Error(`Study Hard runId ${requestedRunId} already belongs to ${active.state.url}`);
		const contextEventKeys = transcriptEventKeysFromContext(ctx, active.state.runId);
		if (contextEventKeys) active.transcriptEventKeys = contextEventKeys;
		hydrateStudyHardTranscriptSummary(active);
		if (initialPatch) mergeBoardState(active.state, initialPatch);
		await openStudyHardWindow(pi, ctx, active);
		return initialPatch ? updateStudyHardStudio(active.state.runId, initialPatch) : active;
	}
	const initialState = createInitialBoardState({ url: canonicalUrl, title: params.title, hints: params.hints, runId: requestedRunId });
	const validatedInitialState = initialPatch ? mergeBoardState(initialState, initialPatch) : initialState;
	const persistedState = requestedRunId ? loadPersistedStudyHardState(requestedRunId) : undefined;
	if (persistedState && persistedState.url !== canonicalUrl) throw new Error(`Study Hard runId ${requestedRunId} already belongs to ${persistedState.url}`);
	const state = persistedState ? initialPatch ? mergeBoardState(persistedState, initialPatch) : persistedState : validatedInitialState;
	const server = createServer();
	const clients = new Set<ServerResponse>();
	const statePath = statePathFor(state.runId);
	const contextModel = "model" in ctx && ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
	const getThinkingLevel = (pi as ExtensionAPI & { getThinkingLevel?: () => string }).getThinkingLevel;
	const cwd = "cwd" in ctx && typeof ctx.cwd === "string" ? ctx.cwd : undefined;
	const runtimeConfig = resolveStudyHardRuntimeConfig(cwd);
	const handle: StudyHardHandle = {
		state,
		server,
		clients,
		url: "",
		statePath,
		closed: false,
		pi,
		cwd,
		syncScript: params.syncScript || runtimeConfig.syncScript,
		downloadDir: params.downloadDir || runtimeConfig.downloadDir,
		notionSyncInFlight: false,
		capabilityToken: randomUUID(),
		agentRunner: params.agentRunner || runIsolatedStudyLearningAgent,
		agentModel: contextModel,
		agentThinking: typeof getThinkingLevel === "function" ? getThinkingLevel.call(pi) : undefined,
		coachQueue: [],
		coachOrchestrationRunning: false,
		orchestrationAbort: new AbortController(),
		transcriptEventKeys: transcriptEventKeysFromContext(ctx, state.runId) ?? new Set(),
	};

	server.on("request", async (req, res) => {
		try {
			const parsedUrl = new URL(req.url || "/", "http://localhost");
			const pathname = parsedUrl.pathname;
			if (req.method === "POST") {
				const expectedUrl = new URL(handle.url);
				const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
				const capability = req.headers["x-study-hard-capability"];
				if (req.headers.host !== expectedUrl.host || (origin && origin !== expectedUrl.origin) || capability !== handle.capabilityToken) {
					sendJson(res, 403, { ok: false, error: "invalid Study Hard capability" });
					return;
				}
			}
			if (pathname === "/events") {
				res.writeHead(200, {
					"Content-Type": "text/event-stream",
					"Cache-Control": "no-cache",
					Connection: "keep-alive",
				});
				res.write(`data: ${JSON.stringify(materializeVisualReferences(handle.state))}\n\n`);
				clients.add(res);
				req.on("close", () => clients.delete(res));
				return;
			}
			if (pathname === "/state") {
				sendJson(res, 200, materializeVisualReferences(handle.state));
				return;
			}
			const noteVisualMatch = /^\/note-visual\/([^/]+)$/.exec(pathname);
			if (noteVisualMatch && req.method === "GET") {
				const blockId = decodeURIComponent(noteVisualMatch[1] || "");
				const block = handle.state.noteDocument.sections.flatMap((section) => section.blocks).find((item) => item.id === blockId);
				const visual = block ? resolveStudyNoteBlockVisual(handle.state.noteDocument, block) : undefined;
				if (!visual) {
					sendJson(res, 404, { ok: false, error: `TFT visual block not found: ${blockId}` });
					return;
				}
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
				res.end(buildTftVisualEmbedHtml(visual));
				return;
			}
			if (pathname === "/export/html" && req.method === "POST") {
				const body = await readJsonBody(req);
				const diagramAssets = await prepareExportDiagramAssets(handle.state, body.diagramAssets, false);
				const exported = writeStudyNoteExport(handle.state, handle.downloadDir, diagramAssets);
				sendJson(res, 200, { ok: true, revision: handle.state.revision, ...exported });
				return;
			}
			if (pathname === "/export/notion" && req.method === "POST") {
				const body = await readJsonBody(req);
				const diagramAssets = await prepareExportDiagramAssets(handle.state, body.diagramAssets);
				const result = await runStudyHardNotionSync(handle, diagramAssets);
				sendJson(res, 200, { ok: true, ...result });
				return;
			}
			if (pathname === "/history" && req.method === "GET") {
				sendJson(res, 200, { ok: true, entries: listNoteHistory(handle.state) });
				return;
			}
			const historyPreviewMatch = /^\/history\/([^/]+)\/html$/.exec(pathname);
			if (historyPreviewMatch && req.method === "GET") {
				const id = decodeURIComponent(historyPreviewMatch[1] || "");
				if (id === "current") {
					res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
					res.end(buildStudyNoteExportHtml(handle.state));
					return;
				}
				const bundle = readNoteHistoryBundle(handle.state.runId, id);
				const previewState: StudyHardBoardState = {
					...handle.state,
					revision: bundle.revision,
					updatedAt: bundle.savedAt,
					noteDocument: bundle.noteDocument,
					flows: restoreHistoryFlows(handle.state, bundle.flows),
				};
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(buildStudyNoteExportHtml(previewState));
				return;
			}
			if (pathname === "/history/restore" && req.method === "POST") {
				const body = await readJsonBody(req);
				const id = typeof body.id === "string" ? body.id : "";
				const bundle = readNoteHistoryBundle(handle.state.runId, id);
				const selectedBlockExists = !!handle.state.selectedNoteBlockId && bundle.noteDocument.sections.some((section) => section.blocks.some((block) => block.id === handle.state.selectedNoteBlockId));
				const restoredFlows = restoreHistoryFlows(handle.state, bundle.flows);
				const restoredSelectedFlowId = bundle.flows.some((flow) => flow.id === handle.state.selectedFlowId) ? handle.state.selectedFlowId : bundle.flows[0]?.id || restoredFlows[0]?.id;
				handle.state = mergeBoardState(handle.state, {
					noteDocument: bundle.noteDocument,
					flows: restoredFlows,
					selectedFlowId: restoredSelectedFlowId,
					selectedFlowStepId: null,
					selectedNoteBlockId: selectedBlockExists ? handle.state.selectedNoteBlockId : null,
				});
				saveState(handle);
				broadcast(handle);
				sendJson(res, 200, { ok: true, revision: handle.state.revision, restoredFromRevision: bundle.revision });
				return;
			}
			if (pathname.startsWith("/exports/") && req.method === "GET") {
				const fileName = decodeURIComponent(pathname.replace("/exports/", ""));
				if (!fileName.endsWith(".html") || fileName.includes("/") || fileName.includes("\\")) {
					sendJson(res, 400, { ok: false, error: "only exported HTML files are available" });
					return;
				}
				const root = resolve(exportDir(handle.state.runId));
				const filePath = resolve(root, fileName);
				if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
					sendJson(res, 400, { ok: false, error: "invalid export path" });
					return;
				}
				if (!existsSync(filePath)) {
					res.writeHead(404);
					res.end("not found");
					return;
				}
				res.writeHead(200, {
					"Content-Type": "text/html; charset=utf-8",
					"Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
				});
				res.end(readFileSync(filePath));
				return;
			}
			if (pathname === "/workspace" && req.method === "POST") {
				const body = await readJsonBody(req);
				handle.state = mergeBoardState(handle.state, {
					activeSurface: body.activeSurface,
					selectedFlowId: body.selectedFlowId,
					selectedFlowStepId: body.selectedFlowStepId,
					selectedNoteBlockId: body.selectedNoteBlockId,
					mapViewport: body.mapViewport,
				});
				saveState(handle);
				broadcast(handle);
				sendJson(res, 200, { ok: true, activeSurface: handle.state.activeSurface });
				return;
			}
			if (pathname === "/select" && req.method === "POST") {
				const body = await readJsonBody(req);
				const nodeId = typeof body.nodeId === "string" ? body.nodeId : undefined;
				if (!nodeId || !handle.state.nodes.some((node) => node.id === nodeId)) {
					sendJson(res, 400, { ok: false, error: "unknown nodeId" });
					return;
				}
				handle.state = mergeBoardState(handle.state, { selectedNodeId: nodeId });
				saveState(handle);
				broadcast(handle);
				sendJson(res, 200, { ok: true, selectedNodeId: nodeId });
				return;
			}
			if (pathname === "/position" && req.method === "POST") {
				const body = await readJsonBody(req);
				const nodeId = typeof body.nodeId === "string" ? body.nodeId : "";
				const x = Number(body.x);
				const y = Number(body.y);
				if (!nodeId || !Number.isFinite(x) || !Number.isFinite(y) || !handle.state.nodes.some((node) => node.id === nodeId)) {
					sendJson(res, 400, { ok: false, error: "known nodeId and finite x/y are required" });
					return;
				}
				handle.state = {
					...handle.state,
					schemaVersion: 1,
					revision: handle.state.revision + 1,
					layoutMode: "manual",
					nodes: handle.state.nodes.map((node) => node.id === nodeId ? { ...node, x, y, positionLocked: true } : node),
					updatedAt: Date.now(),
				};
				saveState(handle);
				broadcast(handle);
				sendJson(res, 200, { ok: true, nodeId, x, y });
				return;
			}
			if (pathname === "/view-mode" && req.method === "POST") {
				const body = await readJsonBody(req);
				const viewMode = typeof body.viewMode === "string" ? body.viewMode : "";
				if (!["memo", "detail", "hybrid"].includes(viewMode)) {
					sendJson(res, 400, { ok: false, error: "viewMode must be memo, detail, or hybrid" });
					return;
				}
				handle.state = mergeBoardState(handle.state, { viewMode });
				saveState(handle);
				broadcast(handle);
				sendJson(res, 200, { ok: true, viewMode });
				return;
			}
			if (pathname === "/relayout" && req.method === "POST") {
				handle.state = {
					...handle.state,
					schemaVersion: 1,
					revision: handle.state.revision + 1,
					layoutMode: "auto",
					nodes: layoutStudyGraph(handle.state.nodes, handle.state.edges).map((node) => ({ ...node, positionLocked: false })),
					updatedAt: Date.now(),
				};
				saveState(handle);
				broadcast(handle);
				sendJson(res, 200, { ok: true });
				return;
			}
			if (pathname === "/memo" && req.method === "POST") {
				const body = await readJsonBody(req);
				const text = typeof body.text === "string" ? body.text.trim() : "";
				if (!text) {
					sendJson(res, 400, { ok: false, error: "memo text is required" });
					return;
				}
				const root = handle.state.nodes.find((node) => node.type === "root") || handle.state.nodes.find((node) => !node.parentId);
				const id = `memo-${randomUUID().slice(0, 8)}`;
				const memo: StudyConceptNode = {
					id,
					label: text.split("\n")[0]!.slice(0, 42),
					type: text.includes("?") ? "question" : "concept",
					status: "learning",
					summary: text,
					detail: text,
					parentId: root?.id,
					positionLocked: false,
				};
				handle.state = {
					...handle.state,
					revision: handle.state.revision + 1,
					layoutMode: "manual",
					selectedNodeId: id,
					nodes: [...handle.state.nodes, memo],
					updatedAt: Date.now(),
				};
				saveState(handle);
				broadcast(handle);
				sendJson(res, 200, { ok: true, memo });
				return;
			}
			if (pathname === "/coach" && req.method === "POST") {
				const body = await readJsonBody(req);
				const message = typeof body.message === "string" ? body.message.trim() : "";
				if (!message) {
					sendJson(res, 400, { ok: false, error: "coach message is required" });
					return;
				}
				const orchestrationId = `coach-${randomUUID()}`;
				const question: StudyQuestionCard = {
					id: nextQuestionId(handle.state),
					question: message,
					origin: "learner",
					scope: "coach",
					status: "open",
					createdAt: Date.now(),
					processingStatus: "queued",
					orchestrationId,
				};
				commitHandlePatch(handle, { currentQuestionId: question.id, questions: [...handle.state.questions, question] });
				enqueueCoachTurn(handle, question.id);
				sendJson(res, 202, { ok: true, orchestrationId, question });
				return;
			}
			if (pathname === "/coach/answer" && req.method === "POST") {
				const body = await readJsonBody(req);
				const questionId = typeof body.questionId === "string" ? body.questionId : "";
				const answer = typeof body.answer === "string" ? body.answer.trim() : "";
				const existing = handle.state.questions.find((question) => question.id === questionId);
				if (!existing || existing.scope !== "coach" || existing.origin !== "coach" || existing.status !== "open" || existing.userAnswer) {
					sendJson(res, 400, { ok: false, error: "open unanswered coach question is required" });
					return;
				}
				if (!answer) {
					sendJson(res, 400, { ok: false, error: "coach answer is required" });
					return;
				}
				const orchestrationId = `coach-${randomUUID()}`;
				updateQuestionCards(handle, [questionId], (question) => ({ ...question, userAnswer: answer, status: "answered", processingStatus: "queued", processingError: "", orchestrationId }), { currentQuestionId: questionId });
				enqueueCoachTurn(handle, questionId);
				sendJson(res, 202, { ok: true, orchestrationId, questionId });
				return;
			}
			if (pathname === "/coach/retry" && req.method === "POST") {
				const body = await readJsonBody(req);
				const questionId = typeof body.questionId === "string" ? body.questionId : "";
				const existing = handle.state.questions.find((question) => question.id === questionId);
				if (!existing || existing.scope !== "coach" || existing.processingStatus !== "failed") {
					sendJson(res, 400, { ok: false, error: "failed coach turn is required" });
					return;
				}
				const orchestrationId = `coach-${randomUUID()}`;
				updateQuestionCards(handle, [questionId], (question) => ({ ...question, feedback: undefined, answeredAt: undefined, processingStatus: "queued", processingError: "", orchestrationId }));
				enqueueCoachTurn(handle, questionId);
				sendJson(res, 202, { ok: true, orchestrationId, questionId });
				return;
			}
			if (pathname === "/ask" && req.method === "POST") {
				const body = await readJsonBody(req);
				const questionText = typeof body.question === "string" ? body.question.trim() : "";
				const scope: StudyQuestionScope = ["session", "node", "flow-step", "note-block"].includes(String(body.scope)) ? String(body.scope) as StudyQuestionScope : "node";
				const nodeId = scope === "node" ? typeof body.nodeId === "string" ? body.nodeId : handle.state.selectedNodeId : undefined;
				const flowId = scope === "flow-step" ? typeof body.flowId === "string" ? body.flowId : handle.state.selectedFlowId : undefined;
				const flowStepId = scope === "flow-step" ? typeof body.flowStepId === "string" ? body.flowStepId : handle.state.selectedFlowStepId : undefined;
				const noteBlockId = scope === "note-block" ? typeof body.noteBlockId === "string" ? body.noteBlockId : handle.state.selectedNoteBlockId : undefined;
				const attachmentIds = Array.isArray(body.attachmentIds)
					? [...new Set(body.attachmentIds.filter((id): id is string => typeof id === "string" && !!id.trim()))].slice(0, MAX_QUESTION_ATTACHMENTS)
					: [];
				if (!questionText) {
					sendJson(res, 400, { ok: false, error: "question is required" });
					return;
				}
				if (scope === "node" && (!nodeId || !handle.state.nodes.some((node) => node.id === nodeId))) {
					sendJson(res, 400, { ok: false, error: "known nodeId is required" });
					return;
				}
				if (scope === "flow-step" && (!flowId || !flowStepId || !handle.state.flows.some((flow) => flow.id === flowId && flow.steps.some((step) => step.id === flowStepId)))) {
					sendJson(res, 400, { ok: false, error: "known flowId and flowStepId are required" });
					return;
				}
				if (scope === "note-block" && (!noteBlockId || !handle.state.noteDocument.sections.some((section) => section.blocks.some((block) => block.id === noteBlockId)))) {
					sendJson(res, 400, { ok: false, error: "known noteBlockId is required" });
					return;
				}
				const knownAttachmentIds = new Set(handle.state.attachments.map((attachment) => attachment.id));
				if (attachmentIds.some((id) => !knownAttachmentIds.has(id))) {
					sendJson(res, 400, { ok: false, error: "known attachmentIds are required" });
					return;
				}
				const orchestrationId = `pi-${randomUUID()}`;
				const question: StudyQuestionCard = {
					id: nextQuestionId(handle.state),
					question: questionText,
					origin: "learner",
					scope,
					status: "open",
					targetNodeId: nodeId,
					targetFlowId: flowId,
					targetFlowStepId: flowStepId,
					targetNoteBlockId: noteBlockId,
					attachmentIds: attachmentIds.length ? attachmentIds : undefined,
					createdAt: Date.now(),
					processingStatus: "queued",
					orchestrationId,
				};
				handle.state = mergeBoardState(handle.state, { selectedNodeId: question.scope === "node" ? nodeId : handle.state.selectedNodeId, currentQuestionId: question.id, questions: [...handle.state.questions, question] });
				saveState(handle);
				broadcast(handle);
				try {
					sendLearnerQuestionToCurrentSession(handle, question);
				} catch (error) {
					updateQuestionCards(handle, [question.id], (current) => ({ ...current, processingStatus: "failed", processingError: error instanceof Error ? error.message : String(error) }));
					throw error;
				}
				sendJson(res, 202, { ok: true, orchestrationId, question });
				return;
			}
			if (pathname === "/questions/retry" && req.method === "POST") {
				const body = await readJsonBody(req);
				const questionId = typeof body.questionId === "string" ? body.questionId : "";
				const existing = handle.state.questions.find((question) => question.id === questionId);
				if (!existing || existing.origin !== "learner" || existing.scope === "coach" || existing.processingStatus !== "failed") {
					sendJson(res, 400, { ok: false, error: "failed learner question is required" });
					return;
				}
				const retryMode = "pi";
				const orchestrationId = `pi-${randomUUID()}`;
				updateQuestionCards(handle, [questionId], (question) => ({ ...question, status: "open", feedback: undefined, answeredAt: undefined, processingStatus: "queued", processingError: "", processingErrorStage: undefined, orchestrationId }));
				const retryQuestion = handle.state.questions.find((question) => question.id === questionId)!;
				try {
					sendLearnerQuestionToCurrentSession(handle, retryQuestion);
				} catch (error) {
					updateQuestionCards(handle, [questionId], (question) => ({ ...question, processingStatus: "failed", processingError: error instanceof Error ? error.message : String(error) }));
					throw error;
				}
				sendJson(res, 202, { ok: true, orchestrationId, questionId, retryMode });
				return;
			}
			if (pathname === "/answer" && req.method === "POST") {
				const body = await readJsonBody(req);
				const questionId = typeof body.questionId === "string" ? body.questionId : "";
				const answer = typeof body.answer === "string" ? body.answer.trim() : "";
				const existing = handle.state.questions.find((item) => item.id === questionId);
				if (!existing || existing.origin !== "coach" || existing.status !== "open" || existing.userAnswer) {
					sendJson(res, 400, { ok: false, error: "open unanswered coach question is required" });
					return;
				}
				if (!answer) {
					sendJson(res, 400, { ok: false, error: "answer is required" });
					return;
				}
				const answered: StudyQuestionCard = { ...existing, userAnswer: answer, status: "answered", answeredAt: Date.now() };
				const questions = handle.state.questions.map((item) => item.id === questionId ? answered : item);
				handle.state = mergeBoardState(handle.state, {
					selectedNodeId: answered.scope === "node" ? answered.targetNodeId : handle.state.selectedNodeId,
					currentQuestionId: answered.id,
					questions,
				});
				saveState(handle);
				broadcast(handle);
				sendNodeAnswerToAgent(handle, answered);
				sendJson(res, 200, { ok: true, question: answered });
				return;
			}
			if (pathname === "/attachments" && req.method === "POST") {
				const body = await readJsonBody(req);
				const requestedScope = ["session", "node", "flow-step", "note-block"].includes(String(body.scope))
					? String(body.scope) as Exclude<StudyQuestionScope, "coach">
					: undefined;
				const nodeId = typeof body.nodeId === "string" ? body.nodeId : requestedScope === "node" ? handle.state.selectedNodeId : undefined;
				const scope = requestedScope || (nodeId ? "node" : "session");
				const name = safeFileName(typeof body.name === "string" ? body.name : "attachment");
				const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
				if (!dataUrl) {
					sendJson(res, 400, { ok: false, error: "dataUrl is required" });
					return;
				}
				const decoded = decodeDataUrl(dataUrl);
				if (!decoded.data.length || decoded.data.length > MAX_ATTACHMENT_BYTES) {
					sendJson(res, decoded.data.length ? 413 : 400, { ok: false, error: decoded.data.length ? "attachment exceeds 10MB" : "attachment is empty" });
					return;
				}
				const mimeType = typeof body.mimeType === "string" ? body.mimeType : decoded.mimeType;
				const id = `${Date.now()}-${randomUUID().slice(0, 8)}`;
				const fileName = `${id}-${name}${name.includes(".") ? "" : extensionFromMime(mimeType)}`;
				const filePath = join(attachmentDir(handle.state.runId), fileName);
				writeFileSync(filePath, decoded.data);
				const attachment: StudyAttachment = {
					id,
					scope,
					nodeId,
					targetFlowId: typeof body.flowId === "string" ? body.flowId : undefined,
					targetFlowStepId: typeof body.flowStepId === "string" ? body.flowStepId : undefined,
					targetNoteBlockId: typeof body.noteBlockId === "string" ? body.noteBlockId : undefined,
					name,
					mimeType,
					path: filePath,
					url: `/attachments/${encodeURIComponent(fileName)}`,
					note: typeof body.note === "string" ? body.note : undefined,
					createdAt: Date.now(),
				};
				handle.state = mergeBoardState(handle.state, {
					selectedNodeId: scope === "node" && nodeId ? nodeId : handle.state.selectedNodeId,
					attachments: [...handle.state.attachments, attachment],
				});
				saveState(handle);
				broadcast(handle);
				sendJson(res, 200, { ok: true, attachment });
				return;
			}
			if (pathname === "/attachments/remove" && req.method === "POST") {
				const body = await readJsonBody(req);
				const attachmentId = typeof body.attachmentId === "string" ? body.attachmentId : "";
				const attachment = handle.state.attachments.find((item) => item.id === attachmentId);
				if (!attachment) {
					sendJson(res, 404, { ok: false, error: "attachment not found" });
					return;
				}
				if (handle.state.questions.some((question) => question.attachmentIds?.includes(attachmentId))) {
					sendJson(res, 409, { ok: false, error: "attachment is already linked to a question" });
					return;
				}
				if (attachment.path) {
					const root = resolve(attachmentDir(handle.state.runId));
					const filePath = resolve(attachment.path);
					if (filePath.startsWith(`${root}${sep}`)) {
						try { unlinkSync(filePath); } catch {}
					}
				}
				handle.state = mergeBoardState(handle.state, { attachments: handle.state.attachments.filter((item) => item.id !== attachmentId) });
				saveState(handle);
				broadcast(handle);
				sendJson(res, 200, { ok: true, attachmentId });
				return;
			}
			if (pathname.startsWith("/attachments/") && req.method === "GET") {
				const fileName = decodeURIComponent(pathname.replace("/attachments/", ""));
				const root = resolve(attachmentDir(handle.state.runId));
				const filePath = resolve(root, fileName);
				if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
					sendJson(res, 400, { ok: false, error: "invalid attachment path" });
					return;
				}
				if (!existsSync(filePath)) {
					res.writeHead(404);
					res.end("not found");
					return;
				}
				const attachment = handle.state.attachments.find((item) => item.url === `/attachments/${encodeURIComponent(fileName)}`);
				res.writeHead(200, { "Content-Type": attachment?.mimeType || "application/octet-stream" });
				res.end(readFileSync(filePath));
				return;
			}
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(buildStudyHardStudioHtml(handle.capabilityToken, process.platform === "darwin"));
		} catch (error) {
			sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
		}
	});

	try {
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(0, "127.0.0.1", () => resolve());
		});
		const address = server.address();
		const port = typeof address === "object" && address ? address.port : 0;
		handle.url = `http://127.0.0.1:${port}/`;
		handles.set(state.runId, handle);
		latestRunId = state.runId;
		if (persistedState) hydrateStudyHardTranscriptSummary(handle);
		else syncStudyHardTranscript(handle);
		await openStudyHardWindow(pi, ctx, handle);
		if (!persistedState || initialPatch) saveState(handle);
		if (persistedState) resumeInterruptedLearningAgents(handle);
		return handle;
	} catch (error) {
		cleanupFailedStudyHardStart(handle, !persistedState);
		throw error;
	}
}

export function updateStudyHardStudio(runId: string | undefined, patch: Record<string, unknown>, expectedRevision?: number): StudyHardHandle {
	const id = runId || latestRunId;
	if (!id) throw new Error("활성 Study Hard Studio가 없습니다. 먼저 /study-hard <url>을 실행하세요.");
	const handle = handles.get(id);
	if (!handle) throw new Error(`Study Hard Studio run을 찾을 수 없습니다: ${id}`);
	if (expectedRevision !== undefined && handle.state.revision !== expectedRevision) throw new Error(`stale Study Hard revision: expected ${expectedRevision}, current ${handle.state.revision}`);
	handle.state = mergeBoardState(handle.state, patch);
	saveState(handle);
	broadcast(handle);
	return handle;
}

export function respondStudyHardQuestion(
	runId: string | undefined,
	expectedRevision: number,
	questionId: string,
	feedbackValue: string,
	patch: Record<string, unknown> = {},
): StudyHardHandle {
	const id = runId || latestRunId;
	if (!id) throw new Error("활성 Study Hard Studio가 없습니다.");
	const current = handles.get(id);
	if (!current) throw new Error(`Study Hard Studio run을 찾을 수 없습니다: ${id}`);
	if (current.state.revision !== expectedRevision) throw new Error(`stale Study Hard revision: expected ${expectedRevision}, current ${current.state.revision}`);
	const target = current.state.questions.find((question) => question.id === questionId);
	if (!target || target.origin !== "learner" || target.scope === "coach") throw new Error(`현재 Pi가 응답할 learner question을 찾지 못했습니다: ${questionId}`);
	const feedback = feedbackValue.trim().slice(0, MAX_STUDY_ANSWER_LENGTH);
	if (!feedback) throw new Error("study_hard_board respond에는 feedback이 필요합니다.");
	if (patch.questions !== undefined) throw new Error("study_hard_board respond는 questions를 자동 갱신하므로 직접 전달할 수 없습니다.");
	const beforeNote = cloneBoardState(current.state).noteDocument;
	const questions = current.state.questions.map((question) => question.id === questionId ? {
		...question,
		feedback,
		status: "answered" as const,
		answeredAt: Date.now(),
		processingStatus: "applied" as const,
		processingError: "",
		processingErrorStage: undefined,
	} : question);
	const handle = updateStudyHardStudio(id, { ...patch, questions, currentQuestionId: questionId }, expectedRevision);
	if (JSON.stringify(beforeNote) !== JSON.stringify(handle.state.noteDocument)) publishNoteMergeTranscript(handle, [questionId], beforeNote);
	return handle;
}

export async function openExistingStudyHardStudio(pi: ExtensionAPI, ctx: ExtensionCommandContext | ExtensionContext, runId?: string): Promise<StudyHardHandle> {
	const requestedId = runId ? validateRunId(runId) : latestRunId;
	if (requestedId && handles.has(requestedId)) {
		const active = handles.get(requestedId)!;
		await openStudyHardWindow(pi, ctx, active);
		return active;
	}
	const persisted = requestedId ? loadPersistedStudyHardState(requestedId) : findLatestPersistedState();
	if (!persisted) throw new Error(requestedId ? `Study Hard Studio run을 찾을 수 없습니다: ${requestedId}` : "저장된 Study Hard Studio가 없습니다.");
	return startStudyHardStudio(pi, ctx, { runId: persisted.runId, url: persisted.url, title: persisted.title, hints: persisted.hints });
}

function disposeStudyHardHandle(handle: StudyHardHandle): void {
	handle.closed = true;
	handle.orchestrationAbort.abort();
	if (handle.coachQueueTimer) clearTimeout(handle.coachQueueTimer);
	for (const client of handle.clients) {
		try { client.end(); } catch {}
	}
	handle.clients.clear();
	try { handle.window?.close?.(); } catch {}
	try { handle.server.close(); } catch {}
	try { handle.server.closeAllConnections(); } catch {}
}

function removeNewStudyHardStateArtifacts(statePath: string): void {
	try { unlinkSync(statePath); } catch {}
	try {
		const directory = dirname(statePath);
		const temporaryPrefix = `${basename(statePath)}.tmp-`;
		for (const name of readdirSync(directory)) {
			if (!name.startsWith(temporaryPrefix)) continue;
			try { unlinkSync(join(directory, name)); } catch {}
		}
	} catch {}
}

function cleanupFailedStudyHardStart(handle: StudyHardHandle, removeNewState: boolean): void {
	disposeStudyHardHandle(handle);
	if (handles.get(handle.state.runId) === handle) handles.delete(handle.state.runId);
	if (latestRunId === handle.state.runId) latestRunId = [...handles.keys()].at(-1);
	if (removeNewState) removeNewStudyHardStateArtifacts(handle.statePath);
}

export function stopStudyHardStudios(): void {
	for (const handle of handles.values()) disposeStudyHardHandle(handle);
	handles.clear();
	latestRunId = undefined;
}

async function openStudyHardWindow(pi: ExtensionAPI, ctx: ExtensionCommandContext | ExtensionContext, handle: StudyHardHandle): Promise<"glimpse" | "browser" | "none"> {
	if (!ctx.hasUI) return "none";
	if (handle.window?.show) {
		handle.window.show({ title: `Study Hard · ${handle.state.title}` });
		return "glimpse";
	}
	const open = await getGlimpseOpen();
	if (open) {
		const redirectHtml = `<!doctype html><meta charset="utf-8"><title>Study Hard</title><script>location.replace(${JSON.stringify(handle.url)});</script><a href=${JSON.stringify(handle.url)}>Study Hard Studio 열기</a>`;
		handle.window = open(redirectHtml, { title: `Study Hard · ${handle.state.title}`, width: 1220, height: 820 });
		handle.window?.on?.("closed", () => { handle.window = undefined; });
		return "glimpse";
	}
	try {
		await pi.exec("open", [handle.url], { timeout: 5000 });
		return "browser";
	} catch {
		return "none";
	}
}

export function registerStudyHardBoardTool(pi: ExtensionAPI) {
	pi.registerTool({
		name: "study_hard_board",
		label: "Study Hard Board",
		description: "Open, update, or respond to the visual Study Hard board while preserving the current Pi conversation context.",
		promptSnippet: "Open or update the Study Hard visual board for /study-hard learning sessions.",
		promptGuidelines: [
			"Use study_hard_board after fetching /study-hard source content to keep the visual concept graph, Mermaid flow, and Q&A state in sync with the learning session.",
			"Do not use study_hard_board as evidence that the user understood the topic; it is a visual aid only.",
			"For heestolee.study-hard.learner-request turns, answer in the current Pi session and call action=respond with questionId, feedback, latest expectedRevision, and any structural board patch. Do not delegate to isolated Tutor/Editor agents.",
		],
		parameters: Type.Object({
			action: Type.String({ description: "start | update | respond | open | status" }),
			runId: Type.Optional(Type.String()),
			expectedRevision: Type.Optional(Type.Integer({ minimum: 0, description: "Required for update/respond; reject stale snapshots." })),
			questionId: Type.Optional(Type.String({ description: "Required for respond; pending learner question id." })),
			feedback: Type.Optional(Type.String({ description: "Required for respond; direct answer shown in the Study Hard drawer." })),
			url: Type.Optional(Type.String()),
			title: Type.Optional(Type.String()),
			hints: Type.Optional(Type.String()),
			sourceTitle: Type.Optional(Type.String()),
			sourceKind: Type.Optional(Type.String({ description: "code | article | video | mixed" })),
			learningPhase: Type.Optional(Type.String({ description: "map | explain | trace | practice | reflect" })),
			coachRole: Type.Optional(Type.String({ description: "mentor | rubber-duck | peer | lead" })),
			layoutMode: Type.Optional(Type.String({ description: "auto | manual" })),
			viewMode: Type.Optional(Type.String({ description: "memo | detail | hybrid. Defaults to hybrid." })),
			goals: Type.Optional(Type.Array(Type.String())),
			quickMap: Type.Optional(Type.String()),
			mermaid: Type.Optional(Type.String()),
			nodes: Type.Optional(Type.Array(Type.Any())),
			edges: Type.Optional(Type.Array(Type.Any())),
			flows: Type.Optional(Type.Array(Type.Any())),
			noteDocument: Type.Optional(Type.Any()),
			activeSurface: Type.Optional(Type.String({ description: "map | flow | note" })),
			selectedFlowId: Type.Optional(Type.String()),
			selectedFlowStepId: Type.Optional(Type.String()),
			selectedNoteBlockId: Type.Optional(Type.String()),
			questions: Type.Optional(Type.Array(Type.Any())),
			attachments: Type.Optional(Type.Array(Type.Any())),
			selectedNodeId: Type.Optional(Type.String()),
			recommendedNodeId: Type.Optional(Type.String()),
			currentQuestionId: Type.Optional(Type.String()),
			summary: Type.Optional(Type.String()),
			followups: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const action = String(params.action || "update");
			if (action === "start") {
				if (!params.url) throw new Error("study_hard_board start에는 url이 필요합니다.");
				const { action: _action, runId: _runId, expectedRevision: _expectedRevision, url: _url, title: _title, hints: _hints, ...initialPatch } = params as Record<string, unknown>;
				const handle = await startStudyHardStudio(pi, ctx, { url: params.url, title: params.title, hints: params.hints, runId: params.runId, initialPatch });
				return boardToolResult("started", handle);
			}
			if (action === "open") {
				const handle = await openExistingStudyHardStudio(pi, ctx, params.runId);
				return boardToolResult("opened", handle);
			}
			if (action === "status") {
				const id = typeof params.runId === "string" ? params.runId : latestRunId;
				if (!id || !handles.has(id)) throw new Error("활성 Study Hard Studio가 없습니다.");
				return boardToolResult("status", handles.get(id)!);
			}
			if (action === "respond") {
				if (!Number.isInteger(params.expectedRevision)) throw new Error("study_hard_board respond에는 expectedRevision이 필요합니다.");
				if (typeof params.questionId !== "string" || !params.questionId) throw new Error("study_hard_board respond에는 questionId가 필요합니다.");
				if (typeof params.feedback !== "string" || !params.feedback.trim()) throw new Error("study_hard_board respond에는 feedback이 필요합니다.");
				const { action: _action, runId, expectedRevision, questionId, feedback, url: _url, hints: _hints, ...patch } = params as Record<string, unknown>;
				const handle = respondStudyHardQuestion(typeof runId === "string" ? runId : undefined, Number(expectedRevision), String(questionId), String(feedback), patch);
				return boardToolResult("responded", handle);
			}
			if (action !== "update") throw new Error(`지원하지 않는 study_hard_board action: ${action}`);
			if (!Number.isInteger(params.expectedRevision)) throw new Error("study_hard_board update에는 expectedRevision이 필요합니다.");
			const { action: _action, runId, expectedRevision, url: _url, hints: _hints, ...patch } = params as Record<string, unknown>;
			const handle = updateStudyHardStudio(typeof runId === "string" ? runId : undefined, patch, Number(expectedRevision));
			return boardToolResult("updated", handle);
		},
	});
}

function boardToolResult(action: string, handle: StudyHardHandle) {
	return {
		content: [{ type: "text", text: `Study Hard Board ${action}: ${handle.state.title} (${handle.state.runId})` }],
		details: {
			action,
			runId: handle.state.runId,
			url: handle.url,
			statePath: handle.statePath,
			schemaVersion: handle.state.schemaVersion,
			revision: handle.state.revision,
			nodes: handle.state.nodes.length,
			edges: handle.state.edges.length,
			flows: handle.state.flows.length,
			noteSections: handle.state.noteDocument.sections.length,
			activeSurface: handle.state.activeSurface,
			questions: handle.state.questions.length,
			attachments: handle.state.attachments.length,
			selectedNodeId: handle.state.selectedNodeId,
			selectedNode: findNode(handle.state),
		},
	};
}
