import type {
	ConventionLensAuthority,
	ConventionLensMode,
	ConventionLensNodeStatus,
} from "../utils/private-profiles.ts";
import type { ReviewSourceBundle } from "../pr-review/evidence.ts";

export type ConventionLensRelationType =
	| "alias_of"
	| "contains"
	| "refines"
	| "supports"
	| "requires"
	| "balances"
	| "separate_axis"
	| "evidenced_by"
	| "related";

export interface ConventionLensRelation {
	type: ConventionLensRelationType;
	target: string;
}

export interface ConventionLensSourceRef {
	path: string;
	heading?: string;
	startLine?: number;
	endLine?: number;
	digest?: string;
}

export interface ConventionLensNode {
	id: string;
	title: string;
	kind: "category" | "rule" | "decision-lens" | "case";
	authority: ConventionLensAuthority;
	status: ConventionLensNodeStatus;
	packId: string;
	scope?: string;
	confidence?: "high" | "medium" | "low";
	appliesTo: string[];
	signals: string[];
	aliases: string[];
	relations: ConventionLensRelation[];
	body: string;
	source: ConventionLensSourceRef;
}

export interface ConventionLensGraph {
	profileId: string;
	version: string;
	nodes: ConventionLensNode[];
	errors: string[];
	warnings: string[];
}

export interface ConventionLensFactSet {
	paths: string[];
	terms: string[];
	changedLines: string[];
}

export interface ConventionLensCandidate {
	node: ConventionLensNode;
	score: number;
	matchedSignals: string[];
	matchedPaths: string[];
	reasons: string[];
}

export interface ConventionLensSelection {
	profileId: string;
	graphVersion: string;
	facts: ConventionLensFactSet;
	candidates: ConventionLensCandidate[];
}

export type ConventionLensReviewTargetKind = "working-diff" | "same-run-commits" | "combined-run-diff";

export interface ConventionLensRunBaseline {
	startHead: string;
	startDiffFingerprint?: string;
	fileHashes: Record<string, string>;
	startedAt: number;
}

export interface ConventionLensReviewTarget {
	kind: ConventionLensReviewTargetKind;
	baseHead: string;
	currentHead: string;
	paths: string[];
	diff: string;
	fingerprint: string;
	bundle: ReviewSourceBundle;
}

export interface ConventionLensRuntimeRecord {
	schemaVersion: 1;
	timestamp: number;
	profileId: string;
	mode: ConventionLensMode;
	cwdHash: string;
	diffFingerprint?: string;
	targetKind?: ConventionLensReviewTargetKind;
	paths: string[];
	selected: Array<{ id: string; score: number; authority: ConventionLensAuthority; status: ConventionLensNodeStatus }>;
	status: "skipped" | "shadow" | "review-started" | "review-done" | "review-error" | "suppressed";
	reason?: string;
	latencyMs: number;
}
