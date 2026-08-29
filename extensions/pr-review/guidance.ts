import type { ReviewDiffLine, ReviewSourceBundle } from "./evidence.ts";
import { validateEvidenceIds } from "./evidence.ts";

export type MetaReviewReconcileStatus = "new" | "unchanged" | "review-again" | "evidence-removed";

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
