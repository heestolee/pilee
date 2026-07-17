import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { checkpointStudyHardLearning, loadPersistedStudyHardState, recordStudyHardLearningEvent } from "../study-hard/studio.ts";
import { buildFrameIdentity } from "../tft-commands/frame-identity.ts";
import {
	learningCompanionManifestPath,
	readLearningCompanionManifest,
	type LearningArtifactRefs,
	type LearningCompanionManifest,
	type LearningCompanionPhase,
	type LearningEventInput,
} from "./state.ts";

const eventKinds = [
	"frame_ready",
	"worktree_promoted",
	"slice_started",
	"slice_completed",
	"validation_failed",
	"validation_passed",
	"commit_created",
	"push_completed",
	"pr_opened",
	"review_received",
	"review_applied",
	"merged",
	"post_merge_observation",
	"insight",
] as const;
const eventSources = ["frame", "work-context", "git", "verify", "pr", "review", "learner"] as const;
const phases = ["framed", "implementing", "verifying", "reviewing", "merged", "post-merge"] as const;
const checkpointKinds = ["frame-ready", "slice-complete", "pre-pr", "review-round", "merged", "post-merge"] as const;

function literalUnion<T extends readonly string[]>(values: T) {
	return Type.Union(values.map((value) => Type.Literal(value)) as [ReturnType<typeof Type.Literal>, ReturnType<typeof Type.Literal>, ...ReturnType<typeof Type.Literal>[]]);
}

function toolText(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details };
}

function currentManifest(ctx: ExtensionContext): { path: string; manifest: LearningCompanionManifest } | undefined {
	const identity = buildFrameIdentity(ctx, "");
	const candidates = [
		learningCompanionManifestPath(join(ctx.cwd ?? process.cwd(), ".pi")),
		learningCompanionManifestPath(identity.storageDir),
	];
	for (const path of [...new Set(candidates)]) {
		const manifest = readLearningCompanionManifest(path);
		if (manifest) return { path, manifest };
	}
	return undefined;
}

function refsFromParams(params: Record<string, unknown>): LearningArtifactRefs | undefined {
	const refs: LearningArtifactRefs = {
		frameHash: typeof params.frameHash === "string" ? params.frameHash : undefined,
		sliceId: typeof params.sliceId === "string" ? params.sliceId : undefined,
		commit: typeof params.commit === "string" ? params.commit : undefined,
		prUrl: typeof params.prUrl === "string" ? params.prUrl : undefined,
		reviewUrl: typeof params.reviewUrl === "string" ? params.reviewUrl : undefined,
		evidence: Array.isArray(params.evidence) ? params.evidence.filter((item): item is string => typeof item === "string") : undefined,
		decisionId: typeof params.decisionId === "string" ? params.decisionId : undefined,
		taskId: typeof params.taskId === "string" ? params.taskId : undefined,
	};
	return Object.values(refs).some((value) => value !== undefined) ? refs : undefined;
}

export default function learningCompanionExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "learning_companion",
		label: "Learning Companion",
		description: "Inspect or append meaningful work checkpoints to the Study Hard learning note attached to the current Frame work unit.",
		promptSnippet: "When a current work unit has learning-companion.json, record only meaningful slice/verify/PR/review transitions; do not log every tool call.",
		promptGuidelines: [
			"Frame and code remain the work canonicals; Study Hard remains the learning canonical.",
			"Use record for meaningful append-only facts and checkpoint only at frame-ready, slice completion, pre-PR, review round, merge, or post-merge.",
			"A missing or malformed companion must not block implementation, validation, commit, push, or PR workflows.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("status"), Type.Literal("record"), Type.Literal("checkpoint")]),
			kind: Type.Optional(literalUnion(eventKinds)),
			source: Type.Optional(literalUnion(eventSources)),
			summary: Type.Optional(Type.String()),
			dedupeKey: Type.Optional(Type.String()),
			phase: Type.Optional(literalUnion(phases)),
			checkpointKind: Type.Optional(literalUnion(checkpointKinds)),
			frameHash: Type.Optional(Type.String()),
			sliceId: Type.Optional(Type.String()),
			commit: Type.Optional(Type.String()),
			prUrl: Type.Optional(Type.String()),
			reviewUrl: Type.Optional(Type.String()),
			evidence: Type.Optional(Type.Array(Type.String())),
			decisionId: Type.Optional(Type.String()),
			taskId: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params: Record<string, unknown>, _signal, _onUpdate, ctx: ExtensionContext) {
			const current = currentManifest(ctx);
			if (!current) return toolText("현재 work unit에 learning companion이 연결되어 있지 않습니다. 기존 작업 흐름은 계속 진행하세요.", { blocked: false, attached: false });
			const state = loadPersistedStudyHardState(current.manifest.runId);
			if (!state) return toolText("Companion sidecar는 있지만 Study Hard state를 찾지 못했습니다. 기존 작업 흐름은 계속 진행하세요.", { blocked: false, attached: true, stateMissing: true, manifestPath: current.path });
			if (params.action === "status") {
				return toolText([
					`Learning companion: ${current.manifest.companionId}`,
					`phase: ${state.companion?.phase ?? current.manifest.phase}`,
					`events: ${state.companion?.events.length ?? 0}`,
					`checkpoints: ${state.companion?.checkpoints.length ?? 0}`,
					`proposals: ${state.companion?.proposals.length ?? 0}`,
				].join("\n"), { attached: true, manifestPath: current.path, manifest: current.manifest, companion: state.companion });
			}
			if (params.action === "record") {
				if (!eventKinds.includes(params.kind as any) || !eventSources.includes(params.source as any) || typeof params.summary !== "string" || !params.summary.trim() || typeof params.dedupeKey !== "string" || !params.dedupeKey.trim()) {
					throw new Error("record에는 kind, source, summary, dedupeKey가 필요합니다.");
				}
				const input: LearningEventInput = {
					kind: params.kind as LearningEventInput["kind"],
					source: params.source as LearningEventInput["source"],
					summary: params.summary.trim(),
					dedupeKey: params.dedupeKey.trim(),
					refs: refsFromParams(params),
				};
				const next = recordStudyHardLearningEvent(current.manifest.runId, input, params.phase as LearningCompanionPhase | undefined);
				return toolText(`학습노트에 ${input.kind} 이벤트를 기록했습니다.`, { attached: true, manifestPath: current.path, companion: next.companion });
			}
			if (!checkpointKinds.includes(params.checkpointKind as any)) throw new Error("checkpoint에는 checkpointKind가 필요합니다.");
			const next = checkpointStudyHardLearning(current.manifest.runId, params.checkpointKind as Parameters<typeof checkpointStudyHardLearning>[1], refsFromParams(params));
			return toolText(`학습노트 ${params.checkpointKind} checkpoint를 기록했습니다.`, { attached: true, manifestPath: current.path, companion: next.companion });
		},
	});
}
