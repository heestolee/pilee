import { createHash } from "node:crypto";
import { buildCommitReadinessDiagnostic, type CommitReadinessDiagnostic } from "../utils/commit-readiness.ts";
import type { WorkContextCard } from "../utils/work-context.ts";

export interface GitStatusEntry {
	index: string;
	worktree: string;
	path: string;
	originalPath?: string;
}

export interface SliceCommitPushPlan {
	remote?: string;
	branch?: string;
	forceWithLease?: boolean;
	noVerify?: boolean;
}

export interface SliceCommitPlanInput {
	card: WorkContextCard;
	statusLines: string[];
	expectedHead?: string;
	message?: string;
	includeOutsideScope?: boolean;
	push?: SliceCommitPushPlan;
}

export interface SliceCommitPlanOutput {
	plan: {
		expectedHead?: string;
		allowLeftovers: boolean;
		commits: Array<{ message: string; paths: string[] }>;
		push?: SliceCommitPushPlan;
		metadata?: {
			commitReadiness: CommitReadinessDiagnostic["commitReadiness"];
			shipReadiness: CommitReadinessDiagnostic["shipReadiness"];
			splitRecommendation: CommitReadinessDiagnostic["splitRecommendation"];
			caveats: string[];
			notBlockers: string[];
		};
	};
	included: string[];
	outsideScope: string[];
	skipped: string[];
	message: string;
	readiness: CommitReadinessDiagnostic;
}

function stripQuotes(value: string): string {
	const trimmed = value.trim();
	if (!trimmed.startsWith('"') || !trimmed.endsWith('"')) return trimmed;
	try {
		return JSON.parse(trimmed) as string;
	} catch {
		return trimmed.slice(1, -1);
	}
}

export function parseGitStatusPorcelain(lines: string[]): GitStatusEntry[] {
	const entries: GitStatusEntry[] = [];
	for (const raw of lines) {
		if (!raw.trim()) continue;
		const index = raw.slice(0, 1);
		const worktree = raw.slice(1, 2);
		const rest = raw.slice(3).trim();
		if (!rest) continue;
		const renameParts = rest.split(/\s+->\s+/u);
		if (renameParts.length === 2) {
			entries.push({ index, worktree, originalPath: stripQuotes(renameParts[0]), path: stripQuotes(renameParts[1]) });
		} else {
			entries.push({ index, worktree, path: stripQuotes(rest) });
		}
	}
	return entries;
}

function wildcardPattern(pattern: string): RegExp | undefined {
	if (!pattern.includes("*") && !pattern.includes("...")) return undefined;
	const escaped = pattern
		.replace(/[.+?^${}()|[\]\\]/g, "\\$&")
		.replace(/\\\.\\\.\\\./g, ".*")
		.replace(/\\\*/g, "[^/]*");
	return new RegExp(`^${escaped}(?:/.*)?$`);
}

function pathMatchesScope(path: string, scope: string[]): boolean {
	const rel = path.replace(/^\.\//u, "").replace(/\\/g, "/");
	if (scope.length === 0) return true;
	return scope.some((raw) => {
		const pattern = raw.trim().replace(/^\.\//u, "").replace(/\\/g, "/");
		if (!pattern) return false;
		const wildcard = wildcardPattern(pattern);
		if (wildcard?.test(rel)) return true;
		const normalized = pattern.replace(/\.\.\.$/u, "").replace(/\/$/u, "");
		return rel === normalized || rel.startsWith(`${normalized}/`) || rel.includes(normalized);
	});
}

function slugText(value: string): string {
	return value
		.trim()
		.replace(/[`*_#[\](){}]/g, " ")
		.replace(/\s+/g, " ")
		.slice(0, 48)
		.trim();
}

export function defaultSliceCommitMessage(card: WorkContextCard): string {
	const slice = card.currentSlice;
	const title = slugText(slice?.title || card.goal || "slice 작업");
	return `feat: ${title || "slice 작업"}`;
}

function unique(values: string[]): string[] {
	return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

export function buildSliceCommitPlan(input: SliceCommitPlanInput): SliceCommitPlanOutput {
	const entries = parseGitStatusPorcelain(input.statusLines);
	const changedPaths = unique(entries.flatMap((entry) => [entry.originalPath, entry.path].filter(Boolean) as string[]));
	const scope = input.card.currentSlice?.scope ?? [];
	const includeOutsideScope = Boolean(input.includeOutsideScope);
	const included = unique(changedPaths.filter((path) => includeOutsideScope || pathMatchesScope(path, scope)));
	const outsideScope = unique(changedPaths.filter((path) => !pathMatchesScope(path, scope)));
	const skipped = includeOutsideScope ? [] : outsideScope;
	if (included.length === 0) {
		throw new Error(scope.length
			? `current slice scope에 포함되는 변경 파일이 없습니다. outsideScope=${outsideScope.join(", ") || "none"}`
			: "커밋할 변경 파일이 없습니다.");
	}
	const message = input.message?.trim() || defaultSliceCommitMessage(input.card);
	const readiness = buildCommitReadinessDiagnostic(included);
	return {
		plan: {
			expectedHead: input.expectedHead,
			allowLeftovers: skipped.length > 0,
			commits: [{ message, paths: included }],
			...(input.push ? { push: input.push } : {}),
			metadata: {
				commitReadiness: readiness.commitReadiness,
				shipReadiness: readiness.shipReadiness,
				splitRecommendation: readiness.splitRecommendation,
				caveats: readiness.caveats,
				notBlockers: readiness.notBlockers,
			},
		},
		included,
		outsideScope,
		skipped,
		message,
		readiness,
	};
}

export function sliceCommitPlanFileName(card: WorkContextCard): string {
	const sliceId = (card.currentSlice?.id || "slice").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "slice";
	const digest = createHash("sha1").update(`${card.identity.id}:${sliceId}:${Date.now()}`).digest("hex").slice(0, 8);
	return `${sliceId}-${digest}.json`;
}
