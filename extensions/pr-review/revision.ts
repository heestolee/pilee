import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MetaReviewGuideReconciliation } from "./guidance.ts";
import type { PrReviewRunState, PrReviewTarget } from "./run.ts";

export type MetaReviewRevisionMode = "initial" | "incremental" | "full";
export type MetaReviewRevisionStatus = "captured" | "ready" | "aborted";

export interface MetaReviewRevisionEntry {
	number: number;
	runId: string;
	runDir: string;
	mode: MetaReviewRevisionMode;
	status: MetaReviewRevisionStatus;
	baseSha?: string;
	headSha?: string;
	sourceSha256: string;
	previousRunId?: string;
	createdAt: number;
	readyAt?: number;
	reconciliation?: MetaReviewGuideReconciliation["counts"];
}

export interface MetaReviewSeries {
	schemaVersion: 1;
	seriesId: string;
	source: "github-pr" | "current-work";
	key: string;
	title: string;
	revisions: MetaReviewRevisionEntry[];
	createdAt: number;
	updatedAt: number;
}

export interface MetaReviewRefreshDecision {
	mode: "none" | "incremental" | "full";
	reason: string;
}

function atomicWrite(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	renameSync(temporary, path);
}

function stateRootFromRun(run: PrReviewRunState): string {
	return dirname(dirname(run.runDir));
}

function safeId(value: string): string {
	return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 120);
}

export function metaReviewSeriesIdentity(target: PrReviewTarget): { seriesId: string; source: MetaReviewSeries["source"]; key: string } {
	if (target.kind === "current-work") {
		const key = target.root || target.url;
		return { seriesId: safeId(`current-${target.repo}-${target.rootHash || target.repo}`), source: "current-work", key };
	}
	const key = `${target.owner}/${target.repo}#${target.number}`;
	return { seriesId: safeId(`github-${target.owner}-${target.repo}-pr-${target.number}`), source: "github-pr", key };
}

export function metaReviewSeriesPath(stateRoot: string, seriesId: string): string {
	return join(stateRoot, "series", `${safeId(seriesId)}.json`);
}

export function loadMetaReviewSeries(stateRoot: string, seriesId: string): MetaReviewSeries | undefined {
	try { return JSON.parse(readFileSync(metaReviewSeriesPath(stateRoot, seriesId), "utf8")) as MetaReviewSeries; } catch { return undefined; }
}

export function attachMetaReviewRevision(
	run: PrReviewRunState,
	sourceSha256: string,
	mode: MetaReviewRevisionMode,
	previous?: PrReviewRunState,
	now = Date.now(),
): { run: PrReviewRunState; series: MetaReviewSeries; revision: MetaReviewRevisionEntry } {
	const identity = metaReviewSeriesIdentity(run.target);
	const stateRoot = stateRootFromRun(run);
	const current = loadMetaReviewSeries(stateRoot, identity.seriesId);
	const series: MetaReviewSeries = current ?? {
		schemaVersion: 1,
		seriesId: identity.seriesId,
		source: identity.source,
		key: identity.key,
		title: run.target.title,
		revisions: [],
		createdAt: now,
		updatedAt: now,
	};
	const existing = series.revisions.find((entry) => entry.runId === run.runId);
	if (existing) return { run: { ...run, seriesId: series.seriesId, revisionNumber: existing.number, previousRunDir: previous?.runDir, revisionMode: existing.mode }, series, revision: existing };
	const revision: MetaReviewRevisionEntry = {
		number: (series.revisions.at(-1)?.number ?? 0) + 1,
		runId: run.runId,
		runDir: run.runDir,
		mode,
		status: "captured",
		baseSha: run.target.baseSha,
		headSha: run.target.headSha,
		sourceSha256,
		previousRunId: previous?.runId,
		createdAt: now,
	};
	series.revisions.push(revision);
	series.updatedAt = now;
	atomicWrite(metaReviewSeriesPath(stateRoot, series.seriesId), series);
	const linkedRun: PrReviewRunState = {
		...run,
		seriesId: series.seriesId,
		revisionNumber: revision.number,
		previousRunDir: previous?.runDir,
		revisionMode: mode,
	};
	atomicWrite(join(run.runDir, "run.json"), linkedRun);
	return { run: linkedRun, series, revision };
}

export function markMetaReviewRevisionReady(
	run: PrReviewRunState,
	reconciliation?: MetaReviewGuideReconciliation["counts"],
	now = Date.now(),
): MetaReviewSeries | undefined {
	if (!run.seriesId || !run.revisionNumber) return undefined;
	const stateRoot = stateRootFromRun(run);
	const series = loadMetaReviewSeries(stateRoot, run.seriesId);
	if (!series) return undefined;
	const revision = series.revisions.find((entry) => entry.number === run.revisionNumber && entry.runId === run.runId);
	if (!revision) return undefined;
	revision.status = "ready";
	revision.readyAt = now;
	revision.reconciliation = reconciliation;
	series.updatedAt = now;
	atomicWrite(metaReviewSeriesPath(stateRoot, series.seriesId), series);
	return series;
}

export function loadMetaReviewSeriesForRun(run: PrReviewRunState): MetaReviewSeries | undefined {
	return run.seriesId ? loadMetaReviewSeries(stateRootFromRun(run), run.seriesId) : undefined;
}

export function decideMetaReviewRefresh(
	previous: PrReviewTarget,
	current: PrReviewTarget,
	options: { forceFull?: boolean; previousIsAncestor?: boolean; sourceChanged?: boolean } = {},
): MetaReviewRefreshDecision {
	if (previous.headSha && current.headSha && previous.headSha === current.headSha && options.sourceChanged !== true) return { mode: "none", reason: "head SHA와 diff가 동일합니다." };
	if (options.forceFull) return { mode: "full", reason: "사용자가 전체 다시 검토를 요청했습니다." };
	if (previous.kind !== current.kind) return { mode: "full", reason: "source 종류가 바뀌었습니다." };
	if (previous.baseRefName !== current.baseRefName || previous.baseSha !== current.baseSha) return { mode: "full", reason: "base 또는 merge-base가 바뀌었습니다." };
	if (previous.kind === "github-pr" && options.previousIsAncestor !== true) return { mode: "full", reason: "rebase·force-push 가능성으로 head 계보를 안전하게 연결할 수 없습니다." };
	return { mode: "incremental", reason: "이전 revision 위에 선형 변경이 추가됐습니다." };
}
