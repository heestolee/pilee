import type { ReviewDiffLine, ReviewSourceBundle } from "./evidence.ts";
import { validateEvidenceIds } from "./evidence.ts";

export type MetaReviewReconcileStatus = "new" | "unchanged" | "review-again" | "evidence-removed";
export type MetaReviewRelationshipDiagram = "flowchart" | "sequence";

export type MetaReviewMeaningConfidence = "high" | "medium" | "low";
export type MetaReviewMeaningBasisKind = "explicit-contract" | "definition" | "producer-consumer" | "call-flow" | "test" | "diff";
export type MetaReviewMeaningVisualRole = "removed" | "new" | "moved" | "preserved" | "guard" | "context";

interface MetaReviewMeaningVisualBase {
	title: string;
	readingHint: string;
	legend?: MetaReviewMeaningVisualRole[];
}

export interface MetaReviewMeaningFlowchartVisualInput extends MetaReviewMeaningVisualBase {
	kind: "flowchart";
	direction?: "LR" | "TB";
	groups: Array<{ id: string; label: string; phase: "before" | "after" | "shared" }>;
	nodes: Array<{ id: string; label: string; role: MetaReviewMeaningVisualRole; groupId?: string; detail?: string }>;
	edges: Array<{ from: string; to: string; label?: string; role: MetaReviewMeaningVisualRole; style?: "solid" | "dashed" }>;
}

export interface MetaReviewMeaningSequenceVisualInput extends MetaReviewMeaningVisualBase {
	kind: "sequence";
	actors: Array<{ id: string; label: string; role: MetaReviewMeaningVisualRole }>;
	messages: Array<{ from: string; to: string; label: string; role: MetaReviewMeaningVisualRole; style?: "solid" | "dashed"; note?: string }>;
}

export type MetaReviewMeaningVisualInput = MetaReviewMeaningFlowchartVisualInput | MetaReviewMeaningSequenceVisualInput;

export interface MetaReviewChangeMeaningInput {
	id: string;
	title: string;
	beforeContract: string;
	afterContract: string;
	mechanism: string;
	impact: string;
	paths: string[];
	evidenceIds: string[];
	basis: Array<{
		kind: MetaReviewMeaningBasisKind;
		path: string;
		line?: number;
		summary: string;
	}>;
	confidence: MetaReviewMeaningConfidence;
	uncertainty?: string;
	visual?: MetaReviewMeaningVisualInput;
}

export interface MetaReviewDocumentInput {
	overview: {
		summary: string;
		reviewFocus: string;
	};
	meanings?: MetaReviewChangeMeaningInput[];
	relationships: {
		summary: string;
		diagram: MetaReviewRelationshipDiagram;
		relations: Array<{
			from: string;
			to: string;
			label: string;
			detail?: string;
		}>;
		readingOrder: Array<{
			path: string;
			reason: string;
		}>;
	};
}

export interface MetaReviewExplanationHunkInput {
	id: string;
	title: string;
	evidenceIds: string[];
	whatChanged: string;
	why: string;
	evidence: string;
	responsibility: string;
	concepts?: string[];
	flowImpact: string;
	uncertainty?: string;
}

export interface MetaReviewFileGuideInput {
	path: string;
	role: string;
	changeReason: string;
	flow: string;
	impact?: string;
	hunks: MetaReviewExplanationHunkInput[];
}

export interface MetaReviewExplanationHunk extends MetaReviewExplanationHunkInput {
	status: MetaReviewReconcileStatus;
}

export interface MetaReviewFileGuide extends Omit<MetaReviewFileGuideInput, "hunks"> {
	hunks: MetaReviewExplanationHunk[];
}

export interface MetaReviewExplanationCoverage {
	filesExplained: number;
	totalFiles: number;
	changedLinesExplained: number;
	totalChangedLines: number;
	missingEvidenceIds: string[];
	duplicateEvidenceIds: string[];
}

export interface MetaReviewRemovedExplanation {
	path: string;
	hunkId: string;
	title: string;
	status: "evidence-removed";
}

export interface MetaReviewGuideReconciliation {
	guides: MetaReviewFileGuide[];
	removed: MetaReviewRemovedExplanation[];
	counts: Record<MetaReviewReconcileStatus, number>;
}

function assertText(value: unknown, label: string): asserts value is string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
}

function changedLines(bundle: ReviewSourceBundle): ReviewDiffLine[] {
	return bundle.lines.filter((line) => line.kind === "addition" || line.kind === "deletion");
}

const MEANING_VISUAL_ROLES = new Set<MetaReviewMeaningVisualRole>(["removed", "new", "moved", "preserved", "guard", "context"]);

function validateMeaningVisualRole(value: unknown, label: string): MetaReviewMeaningVisualRole {
	if (typeof value !== "string" || !MEANING_VISUAL_ROLES.has(value as MetaReviewMeaningVisualRole)) throw new Error(`${label} is invalid`);
	return value as MetaReviewMeaningVisualRole;
}

function validateMeaningVisualId(value: unknown, label: string): string {
	if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(value)) throw new Error(`${label} is invalid`);
	return value;
}

function validateMetaReviewMeaningVisual(value: unknown, label: string): MetaReviewMeaningVisualInput | undefined {
	if (value === undefined) return undefined;
	if (!value || typeof value !== "object") throw new Error(`${label} is invalid`);
	const visual = value as MetaReviewMeaningVisualInput;
	assertText(visual.title, `${label}.title`);
	assertText(visual.readingHint, `${label}.readingHint`);
	const legend = visual.legend === undefined ? undefined : (() => {
		if (!Array.isArray(visual.legend) || !visual.legend.length || visual.legend.length > 6) throw new Error(`${label}.legend is invalid`);
		return [...new Set(visual.legend.map((role, index) => validateMeaningVisualRole(role, `${label}.legend[${index}]`)))];
	})();
	if (visual.kind === "flowchart") {
		if (visual.direction !== undefined && visual.direction !== "LR" && visual.direction !== "TB") throw new Error(`${label}.direction is invalid`);
		if (!Array.isArray(visual.groups) || visual.groups.length < 2 || visual.groups.length > 6) throw new Error(`${label}.groups must contain 2 to 6 items`);
		const groupIds = new Set<string>();
		const groups = visual.groups.map((group, index) => {
			const groupLabel = `${label}.groups[${index}]`;
			const id = validateMeaningVisualId(group?.id, `${groupLabel}.id`);
			if (groupIds.has(id)) throw new Error(`duplicate visual group id: ${id}`);
			groupIds.add(id);
			assertText(group.label, `${groupLabel}.label`);
			if (!(["before", "after", "shared"] as string[]).includes(group.phase)) throw new Error(`${groupLabel}.phase is invalid`);
			return { id, label: group.label.trim(), phase: group.phase };
		});
		if (!groups.some((group) => group.phase === "before") || !groups.some((group) => group.phase === "after")) throw new Error(`${label}.groups require before and after phases`);
		if (!Array.isArray(visual.nodes) || visual.nodes.length < 2 || visual.nodes.length > 12) throw new Error(`${label}.nodes must contain 2 to 12 items`);
		const nodeIds = new Set<string>();
		const nodes = visual.nodes.map((node, index) => {
			const nodeLabel = `${label}.nodes[${index}]`;
			const id = validateMeaningVisualId(node?.id, `${nodeLabel}.id`);
			if (nodeIds.has(id)) throw new Error(`duplicate visual node id: ${id}`);
			nodeIds.add(id);
			assertText(node.label, `${nodeLabel}.label`);
			const role = validateMeaningVisualRole(node.role, `${nodeLabel}.role`);
			if (node.groupId !== undefined && !groupIds.has(node.groupId)) throw new Error(`${nodeLabel}.groupId must reference a known group`);
			return { id, label: node.label.trim(), role, ...(node.groupId ? { groupId: node.groupId } : {}), ...(typeof node.detail === "string" && node.detail.trim() ? { detail: node.detail.trim() } : {}) };
		});
		if (!Array.isArray(visual.edges) || visual.edges.length < 1 || visual.edges.length > 20) throw new Error(`${label}.edges must contain 1 to 20 items`);
		const edges = visual.edges.map((edge, index) => {
			const edgeLabel = `${label}.edges[${index}]`;
			const from = validateMeaningVisualId(edge?.from, `${edgeLabel}.from`);
			const to = validateMeaningVisualId(edge?.to, `${edgeLabel}.to`);
			if (!nodeIds.has(from) || !nodeIds.has(to)) throw new Error(`${edgeLabel} must reference known nodes`);
			if (from === to) throw new Error(`${edgeLabel} must connect different nodes`);
			const role = validateMeaningVisualRole(edge.role, `${edgeLabel}.role`);
			if (edge.style !== undefined && edge.style !== "solid" && edge.style !== "dashed") throw new Error(`${edgeLabel}.style is invalid`);
			return { from, to, role, ...(typeof edge.label === "string" && edge.label.trim() ? { label: edge.label.trim() } : {}), ...(edge.style ? { style: edge.style } : {}) };
		});
		return { kind: "flowchart", title: visual.title.trim(), readingHint: visual.readingHint.trim(), ...(legend ? { legend } : {}), direction: visual.direction ?? "LR", groups, nodes, edges };
	}
	if (visual.kind === "sequence") {
		if (!Array.isArray(visual.actors) || visual.actors.length < 2 || visual.actors.length > 8) throw new Error(`${label}.actors must contain 2 to 8 items`);
		const actorIds = new Set<string>();
		const actors = visual.actors.map((actor, index) => {
			const actorLabel = `${label}.actors[${index}]`;
			const id = validateMeaningVisualId(actor?.id, `${actorLabel}.id`);
			if (actorIds.has(id)) throw new Error(`duplicate visual actor id: ${id}`);
			actorIds.add(id);
			assertText(actor.label, `${actorLabel}.label`);
			return { id, label: actor.label.trim(), role: validateMeaningVisualRole(actor.role, `${actorLabel}.role`) };
		});
		if (!Array.isArray(visual.messages) || visual.messages.length < 1 || visual.messages.length > 16) throw new Error(`${label}.messages must contain 1 to 16 items`);
		const messages = visual.messages.map((message, index) => {
			const messageLabel = `${label}.messages[${index}]`;
			const from = validateMeaningVisualId(message?.from, `${messageLabel}.from`);
			const to = validateMeaningVisualId(message?.to, `${messageLabel}.to`);
			if (!actorIds.has(from) || !actorIds.has(to)) throw new Error(`${messageLabel} must reference known actors`);
			assertText(message.label, `${messageLabel}.label`);
			const role = validateMeaningVisualRole(message.role, `${messageLabel}.role`);
			if (message.style !== undefined && message.style !== "solid" && message.style !== "dashed") throw new Error(`${messageLabel}.style is invalid`);
			return { from, to, label: message.label.trim(), role, ...(message.style ? { style: message.style } : {}), ...(typeof message.note === "string" && message.note.trim() ? { note: message.note.trim() } : {}) };
		});
		return { kind: "sequence", title: visual.title.trim(), readingHint: visual.readingHint.trim(), ...(legend ? { legend } : {}), actors, messages };
	}
	throw new Error(`${label}.kind is invalid`);
}

function validateMetaReviewMeanings(bundle: ReviewSourceBundle, value: unknown): MetaReviewChangeMeaningInput[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new Error("document.meanings must be an array");
	if (value.length > 64) throw new Error("document.meanings must contain at most 64 items");
	const knownPaths = new Set(bundle.files.map((file) => file.path));
	const changedEvidence = new Set(changedLines(bundle).map((line) => line.id));
	const seenIds = new Set<string>();
	const allowedBasis = new Set<MetaReviewMeaningBasisKind>(["explicit-contract", "definition", "producer-consumer", "call-flow", "test", "diff"]);
	const sourceBackedBasis = new Set<MetaReviewMeaningBasisKind>(["explicit-contract", "definition", "producer-consumer", "call-flow", "test"]);
	return value.map((raw, index) => {
		const meaning = raw as MetaReviewChangeMeaningInput;
		const label = `document.meanings[${index}]`;
		if (!meaning || typeof meaning !== "object") throw new Error(`${label} is invalid`);
		if (!/^M-[A-Za-z0-9._-]+$/.test(meaning.id)) throw new Error(`${label}.id must start with M-`);
		if (seenIds.has(meaning.id)) throw new Error(`duplicate change meaning id: ${meaning.id}`);
		seenIds.add(meaning.id);
		assertText(meaning.title, `${label}.title`);
		assertText(meaning.beforeContract, `${label}.beforeContract`);
		assertText(meaning.afterContract, `${label}.afterContract`);
		assertText(meaning.mechanism, `${label}.mechanism`);
		assertText(meaning.impact, `${label}.impact`);
		if (!Array.isArray(meaning.paths) || !meaning.paths.length) throw new Error(`${label}.paths must not be empty`);
		const paths = [...new Set(meaning.paths.map((path) => String(path).trim()).filter(Boolean))];
		if (paths.some((path) => !knownPaths.has(path))) throw new Error(`${label}.paths must reference changed files`);
		if (!Array.isArray(meaning.evidenceIds) || !meaning.evidenceIds.length) throw new Error(`${label}.evidenceIds must not be empty`);
		const evidenceIds = [...new Set(meaning.evidenceIds.map((id) => String(id).trim()).filter(Boolean))];
		const unknownEvidence = evidenceIds.filter((id) => !changedEvidence.has(id));
		if (unknownEvidence.length) throw new Error(`${label} has unknown evidence: ${unknownEvidence.join(", ")}`);
		if (!Array.isArray(meaning.basis) || !meaning.basis.length) throw new Error(`${label}.basis must not be empty`);
		const basis = meaning.basis.map((item, basisIndex) => {
			const basisLabel = `${label}.basis[${basisIndex}]`;
			if (!item || !allowedBasis.has(item.kind)) throw new Error(`${basisLabel}.kind is invalid`);
			assertText(item.path, `${basisLabel}.path`);
			if (item.path.startsWith("/") || item.path.includes("://") || item.path.split("/").includes("..")) throw new Error(`${basisLabel}.path must be repo-relative`);
			assertText(item.summary, `${basisLabel}.summary`);
			if (item.line !== undefined && (!Number.isInteger(item.line) || item.line <= 0)) throw new Error(`${basisLabel}.line is invalid`);
			return { kind: item.kind, path: item.path.trim(), ...(item.line ? { line: item.line } : {}), summary: item.summary.trim() };
		});
		if (!(["high", "medium", "low"] as string[]).includes(meaning.confidence)) throw new Error(`${label}.confidence is invalid`);
		if (meaning.confidence === "high" && !basis.some((item) => sourceBackedBasis.has(item.kind) && knownPaths.has(item.path))) throw new Error("high confidence meaning requires pinned source-backed basis");
		if (meaning.confidence === "low" && !(typeof meaning.uncertainty === "string" && meaning.uncertainty.trim())) throw new Error(`${label}.uncertainty is required for low confidence`);
		const visual = validateMetaReviewMeaningVisual(meaning.visual, `${label}.visual`);
		return {
			id: meaning.id,
			title: meaning.title.trim(),
			beforeContract: meaning.beforeContract.trim(),
			afterContract: meaning.afterContract.trim(),
			mechanism: meaning.mechanism.trim(),
			impact: meaning.impact.trim(),
			paths,
			evidenceIds,
			basis,
			confidence: meaning.confidence,
			...(visual ? { visual } : {}),
			...(typeof meaning.uncertainty === "string" && meaning.uncertainty.trim() ? { uncertainty: meaning.uncertainty.trim() } : {}),
		};
	});
}

export function validateMetaReviewDocument(bundle: ReviewSourceBundle, input: MetaReviewDocumentInput): MetaReviewDocumentInput {
	if (!input || typeof input !== "object") throw new Error("document is required");
	assertText(input.overview?.summary, "document.overview.summary");
	assertText(input.overview?.reviewFocus, "document.overview.reviewFocus");
	assertText(input.relationships?.summary, "document.relationships.summary");
	if (input.relationships?.diagram !== "flowchart" && input.relationships?.diagram !== "sequence") throw new Error("document.relationships.diagram is invalid");
	if (!Array.isArray(input.relationships?.relations)) throw new Error("document.relationships.relations must be an array");
	if (!Array.isArray(input.relationships?.readingOrder)) throw new Error("document.relationships.readingOrder must be an array");
	if (input.relationships.relations.length > 128) throw new Error("document.relationships.relations must contain at most 128 items");

	const knownPaths = new Set(bundle.files.map((file) => file.path));
	const meanings = validateMetaReviewMeanings(bundle, input.meanings);
	const seenRelations = new Set<string>();
	const relations = input.relationships.relations.map((relation, index) => {
		const label = `document.relationships.relations[${index}]`;
		assertText(relation.from, `${label}.from`);
		assertText(relation.to, `${label}.to`);
		assertText(relation.label, `${label}.label`);
		if (!knownPaths.has(relation.from) || !knownPaths.has(relation.to)) throw new Error(`${label} must reference changed files`);
		if (relation.from === relation.to) throw new Error(`${label} must connect two different files`);
		const key = `${relation.from}\n${relation.to}\n${relation.label}`;
		if (seenRelations.has(key)) throw new Error(`duplicate file relationship: ${relation.from} -> ${relation.to}`);
		seenRelations.add(key);
		return {
			from: relation.from,
			to: relation.to,
			label: relation.label.trim(),
			...(typeof relation.detail === "string" && relation.detail.trim() ? { detail: relation.detail.trim() } : {}),
		};
	});
	if (bundle.files.length > 1 && relations.length === 0) throw new Error("multi-file document requires at least one file relationship");

	const seenReadingPaths = new Set<string>();
	const readingOrder = input.relationships.readingOrder.map((step, index) => {
		const label = `document.relationships.readingOrder[${index}]`;
		assertText(step.path, `${label}.path`);
		assertText(step.reason, `${label}.reason`);
		if (!knownPaths.has(step.path)) throw new Error(`${label}.path is not in the captured diff: ${step.path}`);
		if (seenReadingPaths.has(step.path)) throw new Error(`duplicate reading order path: ${step.path}`);
		seenReadingPaths.add(step.path);
		return { path: step.path, reason: step.reason.trim() };
	});
	const missingReadingPaths = bundle.files.map((file) => file.path).filter((path) => !seenReadingPaths.has(path));
	if (missingReadingPaths.length) throw new Error(`reading order must include every changed file: ${missingReadingPaths.join(", ")}`);

	return {
		overview: {
			summary: input.overview.summary.trim(),
			reviewFocus: input.overview.reviewFocus.trim(),
		},
		...(input.meanings !== undefined ? { meanings } : {}),
		relationships: {
			summary: input.relationships.summary.trim(),
			diagram: input.relationships.diagram,
			relations,
			readingOrder,
		},
	};
}

function hunkFingerprint(bundle: ReviewSourceBundle, path: string, evidenceIds: string[]): string {
	const byId = new Map(bundle.lines.map((line) => [line.id, line]));
	return `${path}\n${evidenceIds.map((id) => {
		const line = byId.get(id);
		return line ? `${line.kind}:${line.text}` : `missing:${id}`;
	}).join("\n")}`;
}

export function metaReviewExplanationCoverage(
	bundle: ReviewSourceBundle,
	guides: Array<Pick<MetaReviewFileGuideInput, "path" | "hunks">>,
): MetaReviewExplanationCoverage {
	const required = new Set(changedLines(bundle).map((line) => line.id));
	const counts = new Map<string, number>();
	for (const guide of guides) {
		for (const hunk of guide.hunks ?? []) {
			for (const evidenceId of hunk.evidenceIds ?? []) {
				if (!required.has(evidenceId)) continue;
				counts.set(evidenceId, (counts.get(evidenceId) ?? 0) + 1);
			}
		}
	}
	const missingEvidenceIds = [...required].filter((id) => !counts.has(id));
	const duplicateEvidenceIds = [...counts].filter(([, count]) => count > 1).map(([id]) => id);
	return {
		filesExplained: new Set(guides.map((guide) => guide.path)).size,
		totalFiles: bundle.files.length,
		changedLinesExplained: required.size - missingEvidenceIds.length,
		totalChangedLines: required.size,
		missingEvidenceIds,
		duplicateEvidenceIds,
	};
}

export function validateMetaReviewGuides(
	bundle: ReviewSourceBundle,
	inspectedChunkIds: string[],
	guides: MetaReviewFileGuideInput[],
): MetaReviewFileGuide[] {
	if (!Array.isArray(guides)) throw new Error("guides must be an array");
	const filesByPath = new Map(bundle.files.map((file) => [file.path, file]));
	const linesById = new Map(bundle.lines.map((line) => [line.id, line]));
	const seenPaths = new Set<string>();
	const seenHunkIds = new Set<string>();

	for (const [guideIndex, guide] of guides.entries()) {
		const label = `guides[${guideIndex}]`;
		assertText(guide.path, `${label}.path`);
		if (!filesByPath.has(guide.path)) throw new Error(`${label}.path is not in the captured diff: ${guide.path}`);
		if (seenPaths.has(guide.path)) throw new Error(`duplicate guide path: ${guide.path}`);
		seenPaths.add(guide.path);
		assertText(guide.role, `${label}.role`);
		assertText(guide.changeReason, `${label}.changeReason`);
		assertText(guide.flow, `${label}.flow`);
		if (!Array.isArray(guide.hunks)) throw new Error(`${label}.hunks must be an array`);

		const file = filesByPath.get(guide.path)!;
		const fileChangedIds = new Set(file.lineIds.filter((id) => {
			const line = linesById.get(id);
			return line?.kind === "addition" || line?.kind === "deletion";
		}));
		if (fileChangedIds.size > 0 && guide.hunks.length === 0) throw new Error(`${label}.hunks must explain changed lines`);

		for (const [hunkIndex, hunk] of guide.hunks.entries()) {
			const hunkLabel = `${label}.hunks[${hunkIndex}]`;
			if (!/^E-[A-Za-z0-9._-]+$/.test(hunk.id)) throw new Error(`${hunkLabel}.id must start with E-`);
			if (seenHunkIds.has(hunk.id)) throw new Error(`duplicate explanation hunk id: ${hunk.id}`);
			seenHunkIds.add(hunk.id);
			assertText(hunk.title, `${hunkLabel}.title`);
			assertText(hunk.whatChanged, `${hunkLabel}.whatChanged`);
			assertText(hunk.why, `${hunkLabel}.why`);
			assertText(hunk.evidence, `${hunkLabel}.evidence`);
			assertText(hunk.responsibility, `${hunkLabel}.responsibility`);
			assertText(hunk.flowImpact, `${hunkLabel}.flowImpact`);
			if (!Array.isArray(hunk.evidenceIds) || hunk.evidenceIds.length === 0) throw new Error(`${hunkLabel}.evidenceIds must not be empty`);
			const evidenceErrors = validateEvidenceIds(bundle, inspectedChunkIds, hunk.evidenceIds);
			if (evidenceErrors.length) throw new Error(`${hunkLabel}: ${evidenceErrors.join("; ")}`);
			for (const evidenceId of hunk.evidenceIds) {
				const line = linesById.get(evidenceId);
				if (line?.fileId !== file.id) throw new Error(`${hunkLabel} crosses file boundary: ${evidenceId}`);
			}
		}
	}

	const missingFiles = bundle.files.map((file) => file.path).filter((path) => !seenPaths.has(path));
	if (missingFiles.length) throw new Error(`every changed file needs a guide: ${missingFiles.join(", ")}`);
	const coverage = metaReviewExplanationCoverage(bundle, guides);
	if (coverage.missingEvidenceIds.length) throw new Error(`changed diff lines without explanation: ${coverage.missingEvidenceIds.join(", ")}`);
	if (coverage.duplicateEvidenceIds.length) throw new Error(`changed diff lines assigned to multiple explanation hunks: ${coverage.duplicateEvidenceIds.join(", ")}`);
	return guides.map((guide) => ({
		...guide,
		hunks: guide.hunks.map((hunk) => ({ ...hunk, status: "new" as const })),
	}));
}

export function reconcileMetaReviewGuides(
	previousBundle: ReviewSourceBundle,
	previousGuides: MetaReviewFileGuide[],
	currentBundle: ReviewSourceBundle,
	currentGuides: MetaReviewFileGuide[],
): MetaReviewGuideReconciliation {
	const previousHunks = new Map(previousGuides.flatMap((guide) => guide.hunks.map((hunk) => [
		`${guide.path}:${hunk.id}`,
		{ path: guide.path, hunk, fingerprint: hunkFingerprint(previousBundle, guide.path, hunk.evidenceIds) },
	] as const)));
	const matched = new Set<string>();
	const guides = currentGuides.map((guide) => ({
		...guide,
		hunks: guide.hunks.map((hunk) => {
			const key = `${guide.path}:${hunk.id}`;
			const previous = previousHunks.get(key);
			if (!previous) return { ...hunk, status: "new" as const };
			matched.add(key);
			const currentFingerprint = hunkFingerprint(currentBundle, guide.path, hunk.evidenceIds);
			return { ...hunk, status: previous.fingerprint === currentFingerprint ? "unchanged" as const : "review-again" as const };
		}),
	}));
	const removed = [...previousHunks]
		.filter(([key]) => !matched.has(key))
		.map(([, previous]) => ({ path: previous.path, hunkId: previous.hunk.id, title: previous.hunk.title, status: "evidence-removed" as const }));
	const counts: Record<MetaReviewReconcileStatus, number> = { new: 0, unchanged: 0, "review-again": 0, "evidence-removed": removed.length };
	for (const guide of guides) for (const hunk of guide.hunks) counts[hunk.status] += 1;
	return { guides, removed, counts };
}
