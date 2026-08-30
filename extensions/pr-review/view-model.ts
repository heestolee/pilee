import type { ReviewSourceBundle } from "./evidence.ts";
import { metaReviewExplanationCoverage } from "./guidance.ts";
import { loadPrReviewQuestions } from "./chat.ts";
import { loadMetaReviewSeriesForRun } from "./revision.ts";
import {
	loadInspection,
	loadMetaReviewDocument,
	loadMetaReviewGuides,
	loadPrReviewRun,
	readJson,
	type ReviewCard,
} from "./run.ts";

export function resolveMetaReviewDisplayRun(linkedRunDir: string) {
	const linkedRun = loadPrReviewRun(linkedRunDir);
	const series = loadMetaReviewSeriesForRun(linkedRun);
	const latestReadyRevision = series?.revisions.slice().reverse().find((revision) => revision.status === "ready");
	return latestReadyRevision ? loadPrReviewRun(latestReadyRevision.runDir) : linkedRun;
}

export function buildMetaReviewClientState(linkedRunDir: string) {
	const linkedRun = loadPrReviewRun(linkedRunDir);
	const series = loadMetaReviewSeriesForRun(linkedRun);
	const latestRevision = series?.revisions.at(-1);
	const run = resolveMetaReviewDisplayRun(linkedRunDir);
	const source = readJson<ReviewSourceBundle>(run.sourcePath);
	const inspection = loadInspection(run);
	const guides = loadMetaReviewGuides(run);
	const document = loadMetaReviewDocument(run);
	const cards = readJson<ReviewCard[]>(run.cardsPath);
	const declarationSourcesByFile = new Map((source.fileSources ?? []).map((snapshot) => [snapshot.fileId, snapshot]));
	return {
		run: {
			runId: run.runId,
			status: run.status,
			target: run.target,
			reportPath: run.reportPath,
			updatedAt: run.updatedAt,
			revisionNumber: run.revisionNumber,
			revisionMode: run.revisionMode,
		},
		source: {
			sourceSha256: source.sourceSha256,
			stats: source.stats,
			files: source.files.map((file) => ({
				id: file.id,
				path: file.path,
				oldPath: file.oldPath,
				status: file.status,
				additions: file.additions,
				deletions: file.deletions,
				binary: file.binary,
				declarationSource: declarationSourcesByFile.get(file.id),
				lines: source.lines
					.filter((line) => line.fileId === file.id)
					.map((line) => ({
						id: line.id,
						kind: line.kind,
						text: line.text,
						oldLine: line.oldLine,
						newLine: line.newLine,
					})),
			})),
		},
		inspection: {
			inspected: inspection.inspectedChunkIds.length,
			total: source.chunks.length,
			pending: source.chunks.filter((chunk) => !inspection.inspectedChunkIds.includes(chunk.id)).map((chunk) => chunk.id),
		},
		document,
		guides,
		explanationCoverage: metaReviewExplanationCoverage(source, guides),
		cards,
		series,
		freshness: latestRevision && latestRevision.runId !== run.runId
			? { status: "refreshing" as const, revision: latestRevision.number, mode: latestRevision.mode, headSha: latestRevision.headSha }
			: { status: "current" as const, revision: run.revisionNumber ?? 1, mode: run.revisionMode ?? "initial", headSha: run.target.headSha },
		questions: loadPrReviewQuestions(run.runDir),
	};
}

export type MetaReviewClientState = ReturnType<typeof buildMetaReviewClientState>;
