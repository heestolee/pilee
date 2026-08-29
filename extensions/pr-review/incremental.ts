import { rechunkReviewSourceByFile, type ReviewDiffFile, type ReviewDiffLine, type ReviewSourceBundle } from "./evidence.ts";
import {
	codeExcerptForEvidence,
	loadMetaReviewGuides,
	loadPrReviewRun,
	markChunkInspected,
	readJson,
	writeJsonAtomic,
	type PrReviewRunState,
	type ReviewCard,
} from "./run.ts";
import type { MetaReviewFileGuide } from "./guidance.ts";

export interface MetaReviewIncrementalSeedResult {
	unchangedPaths: string[];
	impactedPaths: string[];
	seededGuideCount: number;
	seededCardCount: number;
	autoInspectedChunkIds: string[];
}

function fileLines(bundle: ReviewSourceBundle, file: ReviewDiffFile): ReviewDiffLine[] {
	const ids = new Set(file.lineIds);
	return bundle.lines.filter((line) => ids.has(line.id));
}

function lineSignature(line: ReviewDiffLine): string {
	return `${line.kind}:${line.text}`;
}

function evidenceMapForUnchangedFile(
	previousBundle: ReviewSourceBundle,
	previousFile: ReviewDiffFile,
	currentBundle: ReviewSourceBundle,
	currentFile: ReviewDiffFile,
): Map<string, string> | undefined {
	const previousLines = fileLines(previousBundle, previousFile);
	const currentLines = fileLines(currentBundle, currentFile);
	if (previousLines.length !== currentLines.length) return undefined;
	const mapping = new Map<string, string>();
	for (let index = 0; index < previousLines.length; index += 1) {
		const previous = previousLines[index]!;
		const current = currentLines[index]!;
		if (lineSignature(previous) !== lineSignature(current)) return undefined;
		mapping.set(previous.id, current.id);
	}
	return mapping;
}

function remapEvidence(evidenceIds: string[], mapping: Map<string, string>): string[] | undefined {
	const remapped = evidenceIds.map((id) => mapping.get(id));
	return remapped.every((id): id is string => typeof id === "string") ? remapped : undefined;
}

export function seedIncrementalMetaReviewRevision(
	previousState: PrReviewRunState,
	currentState: PrReviewRunState,
): MetaReviewIncrementalSeedResult {
	const previous = loadPrReviewRun(previousState.runDir);
	const current = loadPrReviewRun(currentState.runDir);
	const previousBundle = readJson<ReviewSourceBundle>(previous.sourcePath);
	const currentBundle = rechunkReviewSourceByFile(readJson<ReviewSourceBundle>(current.sourcePath));
	writeJsonAtomic(current.sourcePath, currentBundle);
	writeJsonAtomic(current.inspectionPath, { schemaVersion: 1, sourceSha256: currentBundle.sourceSha256, inspectedChunkIds: [] });
	const previousGuides = loadMetaReviewGuides(previous);
	const previousCards = readJson<ReviewCard[]>(previous.cardsPath);
	const previousFiles = new Map(previousBundle.files.map((file) => [file.path, file]));
	const unchanged = new Map<string, Map<string, string>>();

	for (const currentFile of currentBundle.files) {
		const previousFile = previousFiles.get(currentFile.path);
		if (!previousFile) continue;
		const mapping = evidenceMapForUnchangedFile(previousBundle, previousFile, currentBundle, currentFile);
		if (mapping) unchanged.set(currentFile.path, mapping);
	}

	const guides: MetaReviewFileGuide[] = [];
	for (const guide of previousGuides) {
		const mapping = unchanged.get(guide.path);
		if (!mapping) continue;
		const hunks = guide.hunks.map((hunk) => {
			const evidenceIds = remapEvidence(hunk.evidenceIds, mapping);
			return evidenceIds ? { ...hunk, evidenceIds, status: "unchanged" as const } : undefined;
		}).filter((hunk): hunk is MetaReviewFileGuide["hunks"][number] => Boolean(hunk));
		if (hunks.length === guide.hunks.length) guides.push({ ...guide, hunks });
	}

	const cards: ReviewCard[] = [];
	for (const card of previousCards) {
		const mapping = unchanged.get(card.code.path);
		if (!mapping) continue;
		const evidenceIds = remapEvidence(card.evidenceIds, mapping);
		if (!evidenceIds) continue;
		cards.push({ ...card, evidenceIds, code: codeExcerptForEvidence(currentBundle, evidenceIds) });
	}

	writeJsonAtomic(current.guidesPath, guides);
	writeJsonAtomic(current.cardsPath, cards);
	const unchangedFileIds = new Set(currentBundle.files.filter((file) => unchanged.has(file.path)).map((file) => file.id));
	const autoInspectedChunkIds: string[] = [];
	for (const chunk of currentBundle.chunks) {
		if (chunk.fileIds.length > 0 && chunk.fileIds.every((fileId) => unchangedFileIds.has(fileId))) {
			markChunkInspected(current, chunk.id);
			autoInspectedChunkIds.push(chunk.id);
		}
	}
	const unchangedPaths = [...unchanged.keys()];
	return {
		unchangedPaths,
		impactedPaths: currentBundle.files.map((file) => file.path).filter((path) => !unchanged.has(path)),
		seededGuideCount: guides.length,
		seededCardCount: cards.length,
		autoInspectedChunkIds,
	};
}
