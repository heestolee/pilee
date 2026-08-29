import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import type { ReviewDiffLine, ReviewSourceBundle } from "./evidence.ts";
import { validateEvidenceIds } from "./evidence.ts";
import {
	metaReviewExplanationCoverage,
	validateMetaReviewGuides,
	type MetaReviewFileGuide,
	type MetaReviewFileGuideInput,
} from "./guidance.ts";

export const PR_REVIEW_RUN_SCHEMA_VERSION = 1;

export type ReviewStrength = "required" | "question" | "optional";
export type ReviewConfidence = "high" | "medium" | "low";
export type MetaScope = "current-pr" | "follow-up" | "both" | "none";
export type HumanReviewDecision = "review-only" | "review-with-meta" | "edit" | "follow-up" | "hold" | "dismiss";

export interface PrReviewTarget {
	url: string;
	owner: string;
	repo: string;
	number: number;
	title: string;
	author?: string;
	body?: string;
	baseSha?: string;
	headSha?: string;
	baseRefName?: string;
	headRefName?: string;
}

export interface ReviewPrecedent {
	id: string;
	url: string;
	label: string;
	similarity: string;
	difference?: string;
	lane?: "supporting" | "contrasting" | "cross-repo";
}

export interface ReviewCardInput {
	id: string;
	title: string;
	strength: ReviewStrength;
	confidence: ReviewConfidence;
	evidenceIds: string[];
	reviewDraft: string;
	explanation: string;
	meta: {
		summary: string;
		existingGuard?: string;
		structuralPrevention?: string;
		machinePrevention?: string;
		scope: MetaScope;
	};
	precedents?: ReviewPrecedent[];
}

export interface ReviewCodeExcerpt {
	path: string;
	language: string;
	startLine?: number;
	endLine?: number;
	text: string;
}

export interface ReviewCard extends ReviewCardInput {
	code: ReviewCodeExcerpt;
	decision?: HumanReviewDecision;
	editedReviewDraft?: string;
}

export interface PrReviewRunState {
	schemaVersion: typeof PR_REVIEW_RUN_SCHEMA_VERSION;
	runId: string;
	status: "captured" | "reviewing" | "ready" | "aborted";
	target: PrReviewTarget;
	runDir: string;
	sourcePath: string;
	diffPath: string;
	inspectionPath: string;
	cardsPath: string;
	guidesPath: string;
	reportPath: string;
	createdAt: number;
	updatedAt: number;
}

interface InspectionState {
	schemaVersion: 1;
	sourceSha256: string;
	inspectedChunkIds: string[];
}

function atomicWrite(path: string, content: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temporary, content, "utf8");
	renameSync(temporary, path);
}

export function writeJsonAtomic(path: string, value: unknown): void {
	atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function readJson<T>(path: string): T {
	return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function createPrReviewRun(
	stateRoot: string,
	target: PrReviewTarget,
	bundle: ReviewSourceBundle,
	diff: string,
	now = Date.now(),
): PrReviewRunState {
	const repoSlug = `${target.owner}-${target.repo}`.replace(/[^a-zA-Z0-9._-]+/g, "-");
	const runId = `${repoSlug}-pr-${target.number}-${(target.headSha || bundle.sourceSha256).slice(0, 8)}-${now}`;
	const runsDir = join(stateRoot, "runs");
	mkdirSync(runsDir, { recursive: true });
	const runDir = join(runsDir, runId);
	mkdirSync(runDir, { recursive: false });
	const state: PrReviewRunState = {
		schemaVersion: PR_REVIEW_RUN_SCHEMA_VERSION,
		runId,
		status: "captured",
		target,
		runDir,
		sourcePath: join(runDir, "source.json"),
		diffPath: join(runDir, "source.diff"),
		inspectionPath: join(runDir, "inspection.json"),
		cardsPath: join(runDir, "cards.json"),
		guidesPath: join(runDir, "guides.json"),
		reportPath: join(runDir, "review.md"),
		createdAt: now,
		updatedAt: now,
	};
	writeFileSync(state.diffPath, diff, "utf8");
	writeJsonAtomic(state.sourcePath, bundle);
	writeJsonAtomic(state.inspectionPath, {
		schemaVersion: 1,
		sourceSha256: bundle.sourceSha256,
		inspectedChunkIds: [],
	} satisfies InspectionState);
	writeJsonAtomic(state.cardsPath, []);
	writeJsonAtomic(state.guidesPath, []);
	writeJsonAtomic(join(runDir, "run.json"), state);
	return state;
}

export function loadPrReviewRun(runDir: string): PrReviewRunState {
	const stored = readJson<Omit<PrReviewRunState, "guidesPath"> & { guidesPath?: string }>(join(runDir, "run.json"));
	return { ...stored, guidesPath: stored.guidesPath ?? join(runDir, "guides.json") };
}

export function loadMetaReviewGuides(state: PrReviewRunState): MetaReviewFileGuide[] {
	if (!existsSync(state.guidesPath)) return [];
	return readJson<MetaReviewFileGuide[]>(state.guidesPath);
}

export function loadInspection(state: PrReviewRunState): InspectionState {
	const inspection = readJson<InspectionState>(state.inspectionPath);
	const source = readJson<ReviewSourceBundle>(state.sourcePath);
	if (inspection.sourceSha256 !== source.sourceSha256) throw new Error("inspection source hash is stale");
	return inspection;
}

export function markChunkInspected(state: PrReviewRunState, chunkId: string): InspectionState {
	const source = readJson<ReviewSourceBundle>(state.sourcePath);
	if (!source.chunks.some((chunk) => chunk.id === chunkId)) throw new Error(`unknown chunk: ${chunkId}`);
	const inspection = loadInspection(state);
	inspection.inspectedChunkIds = [...new Set([...inspection.inspectedChunkIds, chunkId])].sort();
	writeJsonAtomic(state.inspectionPath, inspection);
	return inspection;
}

function languageForPath(path: string): string {
	return ({
		".js": "javascript",
		".jsx": "jsx",
		".ts": "typescript",
		".tsx": "tsx",
		".py": "python",
		".go": "go",
		".rs": "rust",
		".sql": "sql",
		".graphql": "graphql",
		".gql": "graphql",
		".json": "json",
		".yaml": "yaml",
		".yml": "yaml",
		".md": "markdown",
	}[extname(path).toLowerCase()] ?? "diff");
}

function sourceCodeLine(line: ReviewDiffLine): string | undefined {
	if (line.kind === "addition") return `+${line.text.slice(1)}`;
	if (line.kind === "deletion") return `-${line.text.slice(1)}`;
	if (line.kind === "context") return ` ${line.text.slice(1)}`;
	return undefined;
}

export function codeExcerptForEvidence(bundle: ReviewSourceBundle, evidenceIds: string[]): ReviewCodeExcerpt {
	const linesById = new Map(bundle.lines.map((line) => [line.id, line]));
	const evidenceLines = evidenceIds.map((id) => linesById.get(id)).filter((line): line is ReviewDiffLine => Boolean(line));
	if (!evidenceLines.length) throw new Error("review card requires valid evidence ids");
	const fileId = evidenceLines[0]!.fileId;
	if (!fileId || evidenceLines.some((line) => line.fileId !== fileId)) throw new Error("one review card must anchor to one file");
	const file = bundle.files.find((candidate) => candidate.id === fileId);
	if (!file) throw new Error(`unknown evidence file: ${fileId}`);
	const evidenceIndices = [...new Set(evidenceLines.map((line) => line.index))].sort((left, right) => left - right);
	const ranges: Array<{ start: number; end: number }> = [];
	for (const index of evidenceIndices) {
		const start = Math.max(0, index - 2);
		const end = Math.min(bundle.lines.length - 1, index + 2);
		const previous = ranges.at(-1);
		if (previous && start <= previous.end + 1) previous.end = Math.max(previous.end, end);
		else ranges.push({ start, end });
	}
	const parts: string[] = [];
	for (const [rangeIndex, range] of ranges.entries()) {
		if (rangeIndex > 0) {
			const omitted = Math.max(0, range.start - ranges[rangeIndex - 1]!.end - 1);
			parts.push(`... ${omitted} diff lines omitted ...`);
		}
		parts.push(...bundle.lines
			.slice(range.start, range.end + 1)
			.filter((line) => line.fileId === fileId && sourceCodeLine(line) !== undefined)
			.map((line) => sourceCodeLine(line)!));
	}
	const lineNumbers = evidenceLines.flatMap((line) => [line.newLine, line.oldLine]).filter((value): value is number => typeof value === "number");
	return {
		path: file.path,
		language: languageForPath(file.path),
		startLine: lineNumbers.length ? Math.min(...lineNumbers) : undefined,
		endLine: lineNumbers.length ? Math.max(...lineNumbers) : undefined,
		text: parts.join("\n"),
	};
}

function assertText(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

export function validateReviewCardInputs(
	bundle: ReviewSourceBundle,
	inspectedChunkIds: string[],
	cards: ReviewCardInput[],
): void {
	if (!Array.isArray(cards)) throw new Error("cards must be an array");
	const ids = new Set<string>();
	for (const [index, card] of cards.entries()) {
		const label = `cards[${index}]`;
		if (!/^R-[A-Za-z0-9._-]+$/.test(card.id)) throw new Error(`${label}.id must start with R-`);
		if (ids.has(card.id)) throw new Error(`duplicate card id: ${card.id}`);
		ids.add(card.id);
		assertText(card.title, `${label}.title`);
		assertText(card.reviewDraft, `${label}.reviewDraft`);
		assertText(card.explanation, `${label}.explanation`);
		assertText(card.meta?.summary, `${label}.meta.summary`);
		if (!["required", "question", "optional"].includes(card.strength)) throw new Error(`${label}.strength is invalid`);
		if (!["high", "medium", "low"].includes(card.confidence)) throw new Error(`${label}.confidence is invalid`);
		if (!["current-pr", "follow-up", "both", "none"].includes(card.meta?.scope)) throw new Error(`${label}.meta.scope is invalid`);
		if (!Array.isArray(card.evidenceIds) || card.evidenceIds.length === 0) throw new Error(`${label}.evidenceIds must not be empty`);
		const evidenceErrors = validateEvidenceIds(bundle, inspectedChunkIds, card.evidenceIds);
		if (evidenceErrors.length) throw new Error(`${label}: ${evidenceErrors.join("; ")}`);
		codeExcerptForEvidence(bundle, card.evidenceIds);
	}
}

function escapeCodeFence(value: string): string {
	return value.replaceAll("```", "`\u200b``");
}

export function renderReviewMarkdown(state: PrReviewRunState, bundle: ReviewSourceBundle, cards: ReviewCard[]): string {
	const output = [
		`# PR Review · #${state.target.number} ${state.target.title}`,
		"",
		`- 대상: ${state.target.url}`,
		`- 기준: \`${(state.target.headSha || bundle.sourceSha256).slice(0, 12)}\``,
		`- 범위: 파일 ${bundle.stats.files}개 · +${bundle.stats.additions}/-${bundle.stats.deletions}`,
		`- 리뷰 카드: ${cards.length}개`,
		"",
	];
	if (!cards.length) {
		output.push("직접 근거로 닫을 수 있는 리뷰 포인트를 찾지 못했습니다. 이는 승인이나 안전 보장을 의미하지 않습니다.", "");
		return output.join("\n");
	}
	for (const card of cards) {
		const location = [card.code.path, card.code.startLine ? `${card.code.startLine}${card.code.endLine && card.code.endLine !== card.code.startLine ? `-${card.code.endLine}` : ""}` : ""].filter(Boolean).join(":");
		const finalDraft = card.editedReviewDraft ?? card.reviewDraft;
		output.push(
			`## ${card.id} · ${card.title}`,
			"",
			`**${card.strength} · confidence ${card.confidence} · \`${location}\`**`,
			"",
			"### 코드",
			"",
			"```diff",
			escapeCodeFence(card.code.text),
			"```",
			"",
			"### 리뷰 초안",
			"",
			`> ${finalDraft.replace(/\n/g, "\n> ")}`,
			"",
			"### 설명",
			"",
			card.explanation,
			"",
			"### 메타적 관점",
			"",
			card.meta.summary,
		);
		if (card.meta.existingGuard) output.push("", `- **기존 가드:** ${card.meta.existingGuard}`);
		if (card.meta.structuralPrevention) output.push(`- **구조적 방지:** ${card.meta.structuralPrevention}`);
		if (card.meta.machinePrevention) output.push(`- **기계적 방지:** ${card.meta.machinePrevention}`);
		output.push(`- **범위:** ${card.meta.scope}`);
		if (card.decision) output.push("", `- **인간 결정:** ${card.decision}`);
		if (card.precedents?.length) {
			output.push("", "<details>", "<summary>참고한 인간 리뷰</summary>", "");
			for (const precedent of card.precedents) {
				output.push(`- [${precedent.label}](${precedent.url}) — ${precedent.similarity}${precedent.difference ? ` · 차이: ${precedent.difference}` : ""}`);
			}
			output.push("", "</details>");
		}
		output.push("");
	}
	return output.join("\n");
}

export function renderMetaReviewMarkdown(
	state: PrReviewRunState,
	bundle: ReviewSourceBundle,
	guides: MetaReviewFileGuide[],
	cards: ReviewCard[],
): string {
	const coverage = metaReviewExplanationCoverage(bundle, guides);
	const lines = [
		`# Meta Review · #${state.target.number} ${state.target.title}`,
		"",
		`- 대상: ${state.target.url}`,
		`- 기준: \`${(state.target.headSha || bundle.sourceSha256).slice(0, 12)}\``,
		`- 설명 coverage: 파일 ${coverage.filesExplained}/${coverage.totalFiles} · 변경 줄 ${coverage.changedLinesExplained}/${coverage.totalChangedLines}`,
		`- 실제 리뷰 포인트: ${cards.length}개`,
		"",
		"## 이 변경을 읽는 순서",
		"",
		"변경 목적 → 먼저 볼 점 → 파일별 역할과 diff 설명 → 실제 리뷰 포인트 → 검토 범위",
		"",
	];
	for (const guide of guides) {
		lines.push(
			`## ${guide.path}`,
			"",
			`- **파일 역할:** ${guide.role}`,
			`- **변경 이유:** ${guide.changeReason}`,
			`- **호출·데이터 흐름:** ${guide.flow}`,
		);
		if (guide.impact) lines.push(`- **영향:** ${guide.impact}`);
		lines.push("");
		for (const hunk of guide.hunks) {
			lines.push(
				`### ${hunk.id} · ${hunk.title}`,
				"",
				`- **무엇이 바뀌었나:** ${hunk.whatChanged}`,
				`- **왜 바뀌었나:** ${hunk.why}`,
				`- **코드·도메인 근거:** ${hunk.evidence}`,
				`- **책임:** ${hunk.responsibility}`,
				`- **흐름과 영향:** ${hunk.flowImpact}`,
			);
			if (hunk.concepts?.length) lines.push(`- **사용된 개념:** ${hunk.concepts.join(", ")}`);
			if (hunk.uncertainty) lines.push(`- **확인 필요:** ${hunk.uncertainty}`);
			lines.push(`- **상태:** ${hunk.status}`, "");
		}
	}
	lines.push(renderReviewMarkdown(state, bundle, cards));
	return lines.join("\n");
}

export function saveMetaReviewSubmission(
	state: PrReviewRunState,
	guideInputs: MetaReviewFileGuideInput[],
	cardInputs: ReviewCardInput[],
): { guides: MetaReviewFileGuide[]; cards: ReviewCard[] } {
	const bundle = readJson<ReviewSourceBundle>(state.sourcePath);
	const inspection = loadInspection(state);
	const guides = validateMetaReviewGuides(bundle, inspection.inspectedChunkIds, guideInputs);
	validateReviewCardInputs(bundle, inspection.inspectedChunkIds, cardInputs);
	const cards = cardInputs.map((input) => ({ ...input, code: codeExcerptForEvidence(bundle, input.evidenceIds) }));
	writeJsonAtomic(state.guidesPath, guides);
	writeJsonAtomic(state.cardsPath, cards);
	atomicWrite(state.reportPath, renderMetaReviewMarkdown(state, bundle, guides, cards));
	const next = { ...state, status: "ready" as const, updatedAt: Date.now() };
	writeJsonAtomic(join(state.runDir, "run.json"), next);
	return { guides, cards };
}

export function saveReviewCards(state: PrReviewRunState, inputs: ReviewCardInput[]): ReviewCard[] {
	const bundle = readJson<ReviewSourceBundle>(state.sourcePath);
	const inspection = loadInspection(state);
	validateReviewCardInputs(bundle, inspection.inspectedChunkIds, inputs);
	const cards = inputs.map((input) => ({ ...input, code: codeExcerptForEvidence(bundle, input.evidenceIds) }));
	writeJsonAtomic(state.cardsPath, cards);
	atomicWrite(state.reportPath, renderReviewMarkdown(state, bundle, cards));
	const next = { ...state, status: "ready" as const, updatedAt: Date.now() };
	writeJsonAtomic(join(state.runDir, "run.json"), next);
	return cards;
}

export function saveHumanDecision(
	state: PrReviewRunState,
	cardId: string,
	decision: HumanReviewDecision,
	editedReviewDraft?: string,
): ReviewCard[] {
	if (!existsSync(state.cardsPath)) throw new Error("review cards are not ready");
	const cards = readJson<ReviewCard[]>(state.cardsPath);
	const card = cards.find((candidate) => candidate.id === cardId);
	if (!card) throw new Error(`unknown review card: ${cardId}`);
	card.decision = decision;
	if (editedReviewDraft?.trim()) card.editedReviewDraft = editedReviewDraft.trim();
	writeJsonAtomic(state.cardsPath, cards);
	const bundle = readJson<ReviewSourceBundle>(state.sourcePath);
	const guides = loadMetaReviewGuides(state);
	atomicWrite(state.reportPath, guides.length ? renderMetaReviewMarkdown(state, bundle, guides, cards) : renderReviewMarkdown(state, bundle, cards));
	const decisionPath = join(state.runDir, "decisions.jsonl");
	const row = JSON.stringify({ runId: state.runId, cardId, decision, editedReviewDraft: card.editedReviewDraft, createdAt: Date.now() });
	appendFileSync(decisionPath, `${row}\n`, "utf8");
	return cards;
}

export function runLabel(state: PrReviewRunState): string {
	return `${state.target.owner}/${state.target.repo}#${state.target.number} · ${basename(state.runDir)}`;
}
