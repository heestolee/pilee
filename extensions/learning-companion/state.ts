import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type LearningCompanionStatus = "active" | "merged" | "archived";
export type LearningCompanionPhase = "framed" | "implementing" | "verifying" | "reviewing" | "merged" | "post-merge";
export type LearningEventKind =
	| "frame_ready"
	| "worktree_promoted"
	| "slice_started"
	| "slice_completed"
	| "validation_failed"
	| "validation_passed"
	| "commit_created"
	| "push_completed"
	| "pr_opened"
	| "review_received"
	| "review_applied"
	| "merged"
	| "post_merge_observation"
	| "insight";
export type LearningEventSource = "frame" | "work-context" | "git" | "verify" | "pr" | "review" | "learner";
export type LearningProposalTarget = "frame" | "decision" | "current-slice" | "verification" | "code" | "followup";
export type LearningProposalStatus = "proposed" | "accepted" | "applied" | "rejected" | "deferred";

export interface LearningArtifactRefs {
	frameHash?: string;
	sliceId?: string;
	commit?: string;
	prUrl?: string;
	reviewUrl?: string;
	evidence?: string[];
	decisionId?: string;
	taskId?: string;
}

export interface LearningCompanionManifest {
	schemaVersion: 1;
	companionId: string;
	runId: string;
	status: LearningCompanionStatus;
	phase: LearningCompanionPhase;
	frame: {
		path: string;
		identityKey: string;
		initialCanonicalHash?: string;
		latestCanonicalHash?: string;
	};
	studyHard: {
		statePath: string;
	};
	origin?: {
		kind: "frame" | "frame-v2";
		manifestPath?: string;
	};
	createdAt: number;
	updatedAt: number;
}

export interface LearningEvent {
	id: string;
	sequence: number;
	kind: LearningEventKind;
	summary: string;
	occurredAt: number;
	source: LearningEventSource;
	refs?: LearningArtifactRefs;
	dedupeKey: string;
}

export interface LearningCheckpoint {
	id: string;
	kind: "frame-ready" | "slice-complete" | "pre-pr" | "review-round" | "merged" | "post-merge";
	revision: number;
	noteHash: string;
	eventRange: { from: number; to: number };
	refs?: LearningArtifactRefs;
	createdAt: number;
}

export interface LearningProposal {
	id: string;
	summary: string;
	rationale: string;
	sourceEventIds: string[];
	target: LearningProposalTarget;
	proposedChange: string;
	status: LearningProposalStatus;
	appliedRefs?: LearningArtifactRefs;
	createdAt: number;
	updatedAt: number;
}

export interface LearningCompanionState {
	schemaVersion: 1;
	companionId: string;
	phase: LearningCompanionPhase;
	frame: LearningCompanionManifest["frame"];
	events: LearningEvent[];
	checkpoints: LearningCheckpoint[];
	proposals: LearningProposal[];
	createdAt: number;
	updatedAt: number;
}

export interface LearningEventInput {
	kind: LearningEventKind;
	summary: string;
	source: LearningEventSource;
	refs?: LearningArtifactRefs;
	dedupeKey: string;
	occurredAt?: number;
}

export interface LearningProposalInput {
	id?: string;
	summary: string;
	rationale: string;
	sourceEventIds?: string[];
	target: LearningProposalTarget;
	proposedChange: string;
	createdAt?: number;
}

function shortHash(value: string): string {
	return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function writeJsonAtomic(path: string, value: unknown, now = Date.now()): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.tmp-${process.pid}-${now}`;
	writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
	renameSync(temporaryPath, path);
}

function isManifest(value: unknown): value is LearningCompanionManifest {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, any>;
	return item.schemaVersion === 1
		&& typeof item.companionId === "string"
		&& typeof item.runId === "string"
		&& ["active", "merged", "archived"].includes(item.status)
		&& ["framed", "implementing", "verifying", "reviewing", "merged", "post-merge"].includes(item.phase)
		&& typeof item.frame?.path === "string"
		&& typeof item.frame?.identityKey === "string"
		&& typeof item.studyHard?.statePath === "string"
		&& Number.isFinite(item.createdAt)
		&& Number.isFinite(item.updatedAt);
}

export function learningCompanionId(identityKey: string): string {
	return `learning-${shortHash(identityKey)}`;
}

export function learningCompanionManifestPath(storageDir: string): string {
	return join(storageDir, "learning-companion.json");
}

export function readLearningCompanionManifest(path: string): LearningCompanionManifest | undefined {
	try {
		if (!existsSync(path)) return undefined;
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return isManifest(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function writeLearningCompanionManifest(params: {
	storageDir: string;
	identityKey: string;
	framePath: string;
	runId: string;
	statePath: string;
	canonicalHash?: string;
	origin?: LearningCompanionManifest["origin"];
	now?: number;
}): { path: string; manifest: LearningCompanionManifest } {
	const path = learningCompanionManifestPath(params.storageDir);
	const previous = readLearningCompanionManifest(path);
	const now = params.now ?? Date.now();
	const canonicalHash = params.canonicalHash || previous?.frame.latestCanonicalHash;
	const manifest: LearningCompanionManifest = {
		schemaVersion: 1,
		companionId: previous?.companionId ?? learningCompanionId(params.identityKey),
		runId: previous?.runId ?? params.runId,
		status: previous?.status ?? "active",
		phase: previous?.phase ?? "framed",
		frame: {
			path: params.framePath,
			identityKey: params.identityKey,
			initialCanonicalHash: previous?.frame.initialCanonicalHash ?? canonicalHash,
			latestCanonicalHash: canonicalHash,
		},
		studyHard: { statePath: params.statePath },
		origin: params.origin ?? previous?.origin,
		createdAt: previous?.createdAt ?? now,
		updatedAt: now,
	};
	writeJsonAtomic(path, manifest, now);
	return { path, manifest };
}

export function retargetLearningCompanionManifest(source: LearningCompanionManifest, params: {
	storageDir: string;
	identityKey: string;
	framePath: string;
	canonicalHash?: string;
	now?: number;
}): { path: string; manifest: LearningCompanionManifest } {
	const path = learningCompanionManifestPath(params.storageDir);
	const now = params.now ?? Date.now();
	const existing = readLearningCompanionManifest(path);
	if (existing) return { path, manifest: existing };
	const manifest: LearningCompanionManifest = {
		...source,
		phase: source.phase === "framed" ? "implementing" : source.phase,
		frame: {
			...source.frame,
			path: params.framePath,
			identityKey: params.identityKey,
			latestCanonicalHash: params.canonicalHash ?? source.frame.latestCanonicalHash,
		},
		updatedAt: now,
	};
	writeJsonAtomic(path, manifest, now);
	return { path, manifest };
}

export function normalizeLearningCompanionState(value: unknown): LearningCompanionState | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const item = value as Record<string, any>;
	if (item.schemaVersion !== 1
		|| typeof item.companionId !== "string"
		|| !["framed", "implementing", "verifying", "reviewing", "merged", "post-merge"].includes(item.phase)
		|| typeof item.frame?.path !== "string"
		|| typeof item.frame?.identityKey !== "string"
		|| !Array.isArray(item.events)
		|| !Array.isArray(item.checkpoints)
		|| !Array.isArray(item.proposals)) return undefined;
	return {
		schemaVersion: 1,
		companionId: item.companionId,
		phase: item.phase,
		frame: {
			path: item.frame.path,
			identityKey: item.frame.identityKey,
			initialCanonicalHash: typeof item.frame.initialCanonicalHash === "string" ? item.frame.initialCanonicalHash : undefined,
			latestCanonicalHash: typeof item.frame.latestCanonicalHash === "string" ? item.frame.latestCanonicalHash : undefined,
		},
		events: item.events.filter((event: unknown): event is LearningEvent => {
			if (!event || typeof event !== "object" || Array.isArray(event)) return false;
			const candidate = event as Record<string, unknown>;
			return typeof candidate.id === "string"
				&& Number.isInteger(candidate.sequence)
				&& typeof candidate.kind === "string"
				&& typeof candidate.summary === "string"
				&& typeof candidate.source === "string"
				&& typeof candidate.dedupeKey === "string"
				&& Number.isFinite(candidate.occurredAt);
		}),
		checkpoints: item.checkpoints.filter((checkpoint: unknown): checkpoint is LearningCheckpoint => {
			if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return false;
			const candidate = checkpoint as Record<string, any>;
			return typeof candidate.id === "string"
				&& typeof candidate.kind === "string"
				&& Number.isInteger(candidate.revision)
				&& typeof candidate.noteHash === "string"
				&& Number.isInteger(candidate.eventRange?.from)
				&& Number.isInteger(candidate.eventRange?.to)
				&& Number.isFinite(candidate.createdAt);
		}),
		proposals: item.proposals.filter((proposal: unknown): proposal is LearningProposal => {
			if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) return false;
			const candidate = proposal as Record<string, unknown>;
			return typeof candidate.id === "string"
				&& typeof candidate.summary === "string"
				&& typeof candidate.rationale === "string"
				&& Array.isArray(candidate.sourceEventIds)
				&& typeof candidate.target === "string"
				&& typeof candidate.proposedChange === "string"
				&& typeof candidate.status === "string"
				&& Number.isFinite(candidate.createdAt)
				&& Number.isFinite(candidate.updatedAt);
		}),
		createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
		updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : Date.now(),
	};
}

export function createLearningCompanionState(manifest: LearningCompanionManifest, now = Date.now()): LearningCompanionState {
	return {
		schemaVersion: 1,
		companionId: manifest.companionId,
		phase: manifest.phase,
		frame: { ...manifest.frame },
		events: [],
		checkpoints: [],
		proposals: [],
		createdAt: now,
		updatedAt: now,
	};
}

export function recordLearningEvent(state: LearningCompanionState, input: LearningEventInput): { state: LearningCompanionState; event: LearningEvent; added: boolean } {
	const existing = state.events.find((event) => event.dedupeKey === input.dedupeKey);
	if (existing) return { state, event: existing, added: false };
	const occurredAt = input.occurredAt ?? Date.now();
	const sequence = (state.events.at(-1)?.sequence ?? 0) + 1;
	const event: LearningEvent = {
		id: `event-${shortHash(`${state.companionId}:${input.dedupeKey}`)}`,
		sequence,
		kind: input.kind,
		summary: input.summary,
		occurredAt,
		source: input.source,
		refs: input.refs,
		dedupeKey: input.dedupeKey,
	};
	return {
		state: { ...state, events: [...state.events, event], updatedAt: occurredAt },
		event,
		added: true,
	};
}

export function recordLearningCheckpoint(state: LearningCompanionState, input: Omit<LearningCheckpoint, "id" | "createdAt"> & { id?: string; createdAt?: number }): LearningCompanionState {
	const createdAt = input.createdAt ?? Date.now();
	const id = input.id ?? `checkpoint-${shortHash(`${state.companionId}:${input.kind}:${input.revision}:${input.noteHash}`)}`;
	if (state.checkpoints.some((checkpoint) => checkpoint.id === id)) return state;
	return {
		...state,
		checkpoints: [...state.checkpoints, { ...input, id, createdAt }],
		updatedAt: createdAt,
	};
}

export function upsertLearningProposal(state: LearningCompanionState, input: LearningProposalInput): { state: LearningCompanionState; proposal: LearningProposal; added: boolean } {
	const createdAt = input.createdAt ?? Date.now();
	const id = input.id ?? `proposal-${shortHash(`${state.companionId}:${input.target}:${input.summary}:${input.proposedChange}`)}`;
	const existing = state.proposals.find((proposal) => proposal.id === id);
	if (existing) return { state, proposal: existing, added: false };
	const proposal: LearningProposal = {
		id,
		summary: input.summary,
		rationale: input.rationale,
		sourceEventIds: [...(input.sourceEventIds ?? [])],
		target: input.target,
		proposedChange: input.proposedChange,
		status: "proposed",
		createdAt,
		updatedAt: createdAt,
	};
	return {
		state: { ...state, proposals: [...state.proposals, proposal], updatedAt: createdAt },
		proposal,
		added: true,
	};
}

export function updateLearningProposalStatus(state: LearningCompanionState, id: string, status: LearningProposalStatus, params: { appliedRefs?: LearningArtifactRefs; now?: number } = {}): LearningCompanionState {
	const existing = state.proposals.find((proposal) => proposal.id === id);
	if (!existing) throw new Error(`학습 제안을 찾을 수 없습니다: ${id}`);
	if (status === "applied" && !params.appliedRefs) throw new Error("applied 학습 제안에는 적용 ref가 필요합니다.");
	const now = params.now ?? Date.now();
	return {
		...state,
		proposals: state.proposals.map((proposal) => proposal.id === id ? { ...proposal, status, appliedRefs: params.appliedRefs ?? proposal.appliedRefs, updatedAt: now } : proposal),
		updatedAt: now,
	};
}
