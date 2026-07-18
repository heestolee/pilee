import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { learningCompanionManifestPath, writeLearningCompanionManifest } from "../learning-companion/state.ts";
import { attachStudyHardLearningCompanion, loadPersistedStudyHardState, studyHardStatePathFor } from "../study-hard/studio.ts";
import { buildFrameIdentity, type FrameIdentity, formatFrameIdentityHint } from "../tft-commands/frame-identity.ts";
import { buildFrameWorktreeForkArgs, type FrameWorktreeForkParams } from "../tft-commands/frame-worktree-fork.ts";
import {
	buildInitialFrameV2Note,
	frameV2RunId,
	linkFrameV2LearningCompanion,
	parseFrameV2Args,
	type FrameV2EntryMode,
	type FrameV2Invocation,
	updateFrameV2ManifestStatus,
	writeFrameV2Manifest,
} from "./artifact.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const SKILLS_DIR = join(PACKAGE_ROOT, "skills");
const SKILL_NAME = "frame-v2";
const PREREQUISITE_SKILLS = ["tft-guidelines", "ask-user-question-rules"] as const;
const CUSTOM_TYPE = "pilee-frame-v2-command";
const FRAME_V2_CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;
const FRAME_V2_STATE_TOOL = "frame_v2_state";
const FRAME_V2_FORK_TOOL = "frame_v2_worktree_fork";
const FRAME_V2_CONTINUATION_TYPE = "pilee-frame-v2-worktree-fork-continuation";

const HELP = `Frame v2 — Frame과 Study Hard를 원하는 순서로 연결

Usage:
  /frame-v2 <주제·티켓·URL>
  /frame-v2 help

명령을 실행하면 시작 방향을 선택합니다.
  1. Frame 먼저
  2. Study Hard 먼저

두 흐름은 이후 작업 전·병렬·후행으로 자유롭게 연결할 수 있습니다.`;

const ENTRY_OPTIONS = ["Frame 먼저", "Study Hard 먼저"] as const;

interface FrameV2CommandContextRecord {
	key: string;
	args: string;
	cwd: string;
	ctx: ExtensionCommandContext;
	identity: FrameIdentity;
	invocation: FrameV2Invocation;
	runId: string;
	statePath: string;
	manifestPath: string;
	createdAt: number;
	sessionFile?: string;
}

const commandContexts = new Map<string, FrameV2CommandContextRecord>();
let latestContextKey: string | null = null;

type FrameV2ForkRunner = (
	pi: ExtensionAPI,
	args: string,
	ctx: ExtensionCommandContext,
	options: { afterSwitchFollowUp: { customType: string; content: string; display: boolean; details: Record<string, unknown> } },
) => Promise<any>;

let frameV2ForkRunnerOverride: FrameV2ForkRunner | undefined;

export function setFrameV2ForkRunnerForTests(runner?: FrameV2ForkRunner): void {
	frameV2ForkRunnerOverride = runner;
}

async function resolveFrameV2ForkRunner(): Promise<FrameV2ForkRunner> {
	if (frameV2ForkRunnerOverride) return frameV2ForkRunnerOverride;
	const { runWorktreeForkFromCommandContext } = await import("../worktree/index.ts");
	return runWorktreeForkFromCommandContext;
}

function pruneContexts(now = Date.now()): void {
	for (const [key, record] of commandContexts.entries()) {
		if (now - record.createdAt > FRAME_V2_CONTEXT_TTL_MS) commandContexts.delete(key);
	}
	if (latestContextKey && !commandContexts.has(latestContextKey)) latestContextKey = null;
}

function rememberContext(record: FrameV2CommandContextRecord): void {
	pruneContexts();
	commandContexts.set(record.key, record);
	latestContextKey = record.key;
}

function getContext(identityKey?: string): FrameV2CommandContextRecord | null {
	pruneContexts();
	if (identityKey) return commandContexts.get(identityKey) ?? null;
	return latestContextKey ? commandContexts.get(latestContextKey) ?? null : null;
}

function blockedResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details: { blocked: true, ...details } };
}

function frameCanonicalHash(frame: Record<string, unknown>): string | undefined {
	const provenance = frame.provenance && typeof frame.provenance === "object" && !Array.isArray(frame.provenance)
		? frame.provenance as Record<string, unknown>
		: undefined;
	return typeof provenance?.canonicalHash === "string" && provenance.canonicalHash.trim()
		? provenance.canonicalHash.trim()
		: undefined;
}

function attachFrameV2LearningCompanion(record: FrameV2CommandContextRecord, frame: Record<string, unknown>): {
	manifestPath?: string;
	companionId?: string;
	warning?: string;
	stateAttached?: boolean;
	frameV2Manifest?: Record<string, unknown>;
} {
	try {
		const companion = writeLearningCompanionManifest({
			storageDir: record.identity.storageDir,
			identityKey: record.identity.key,
			framePath: join(record.identity.storageDir, "frame.json"),
			runId: record.runId,
			statePath: record.statePath,
			canonicalHash: frameCanonicalHash(frame),
			origin: { kind: "frame-v2", manifestPath: record.manifestPath },
		});
		const manifest = linkFrameV2LearningCompanion(record.manifestPath, {
			manifestPath: companion.path,
			companionId: companion.manifest.companionId,
		});
		let stateAttached = false;
		let warning: string | undefined;
		try {
			attachStudyHardLearningCompanion(companion.manifest);
			stateAttached = true;
		} catch (error) {
			warning = `Study Hard state 반영 보류: ${error instanceof Error ? error.message : String(error)}`;
		}
		return {
			manifestPath: companion.path,
			companionId: companion.manifest.companionId,
			stateAttached,
			warning,
			frameV2Manifest: manifest as unknown as Record<string, unknown>,
		};
	} catch (error) {
		return { warning: error instanceof Error ? error.message : String(error) };
	}
}

function skillPath(name: string): string {
	return join(SKILLS_DIR, name, "SKILL.md");
}

function readSkill(name: string): { name: string; path: string; content: string } {
	const path = skillPath(name);
	return { name, path, content: readFileSync(path, "utf8").trimEnd() };
}

function formatInlinedSkill(skill: { name: string; path: string; content: string }): string {
	return [
		`----- BEGIN INLINED PILEE SKILL: ${skill.name} -----`,
		`Location: ${skill.path}`,
		`References are relative to: ${dirname(skill.path)}`,
		"",
		skill.content,
		`----- END INLINED PILEE SKILL: ${skill.name} -----`,
	].join("\n");
}

export function buildFrameV2Prompt(params: {
	args: string;
	cwd: string;
	identity: FrameIdentity;
	invocation: FrameV2Invocation;
	runId: string;
	statePath: string;
	manifestPath: string;
}): string {
	const targetSkill = readSkill(SKILL_NAME);
	const prerequisiteSkills = PREREQUISITE_SKILLS.map(readSkill);
	const initialNote = buildInitialFrameV2Note(params.invocation.topic, params.invocation.mode);
	const placeholderSource = params.invocation.sourceUrl.includes("frame-v2.invalid");
	return [
		"# pilee Frame v2 command shim",
		"",
		`You are executing \`/frame-v2${params.args.trim() ? ` ${params.args.trim()}` : ""}\` through pilee's independent pilot command.`,
		"",
		"Hard routing rules:",
		`- Use the inlined \`${SKILL_NAME}\` SKILL.md as the authoritative workflow.`,
		"- Frame v2 coordinates independent Frame, Study Hard, and implementation lanes; it does not replace their own canonical artifacts.",
		`- selected entry lane: ${params.invocation.entryMode}`,
		params.invocation.entryMode === "frame-first"
			? "- Frame-first lane: use the standard Frame workflow to organize the work first. Afterwards offer implementation, Study Hard, or both; do not start Study Hard automatically."
			: "- Study-Hard-first lane: build a pedagogical learning note first. Check whether a standard frame.json exists before opening the board; if it exists, expose the complete Frame as a read-only collapsed work contract, otherwise continue without it and offer Frame later.",
		"- Study Hard may run before, alongside, or after implementation.",
		"- Do not create a Frame v2-specific hard gate for implementation. Existing safety and ask-first rules remain in force, but learning completion is status, not authorization.",
		"- Choose the visual form that best explains each subject: TFT visual, Mermaid, Study Hard flow, or a mixture. Existing backend-layer-map, architecture-flow, and data-model-migration-map visual kinds remain available; do not force one renderer onto every concept.",
		"- Any fenced tft-visual that should survive learning refinement must be transferred into noteDocument as a stable `{type:\"visual\", visual:{...original spec...}}` block; do not flatten it into prose or a screenshot-only placeholder.",
		params.invocation.mode === "draft"
			? "- Draft-first mode: show a researched draft for the selected lane before asking follow-up questions. Mark uncertainty instead of silently deciding it."
			: params.invocation.entryMode === "frame-first"
				? "- Guided mode: follow the current frame Deep Interview/(명백)/Productive Resistance rules without reducing them to a shorter substitute."
				: "- Guided mode: follow the learning conversation one concept at a time; use Frame questions only after the user chooses to create or amend a work contract.",
		placeholderSource
			? "- The source URL below is an internal placeholder. Do not fetch it; investigate the original arguments, current codebase, ticket, and conversation instead."
			: "- Fetch/read the real source URL and any linked evidence before claiming the initial note is grounded.",
		"- If a standard frame.json exists or is created, call frame_v2_state action=ready to link it with the learning run. This records state; it is not a work authorization gate.",
		"- Use frame_v2_worktree_fork only for the Frame promotion path after frame.json exists. Other implementation paths remain available without inventing a Frame v2 gate.",
		"",
		formatFrameIdentityHint(params.identity),
		"",
		"## Frame v2 runtime contract",
		`- mode: ${params.invocation.mode}`,
		`- entry mode: ${params.invocation.entryMode}`,
		`- topic: ${params.invocation.topic}`,
		`- source URL: ${params.invocation.sourceUrl}`,
		`- Study Hard runId: ${params.runId}`,
		`- expected Study Hard state path: ${params.statePath}`,
		`- Frame v2 manifest: ${params.manifestPath}`,
		`- standard frame path: ${join(params.identity.storageDir, "frame.json")}`,
		"",
		"Learning note skeleton (use only when the Study Hard lane starts; keep the complete Frame in its separate collapsed work-contract view):",
		"```json",
		JSON.stringify(initialNote, null, 2),
		"```",
		"",
		"## Inlined prerequisite skills",
		...prerequisiteSkills.map(formatInlinedSkill),
		"",
		"## Inlined target skill",
		formatInlinedSkill(targetSkill),
		"",
		"Now execute Frame v2 for the original arguments. Continue through the selected mode; do not stop after restating this contract.",
	].join("\n");
}

export function validateFrameV2ReadyFrame(framePath: string, expectedIdentityKey: string): { ok: true; frame: Record<string, unknown> } | { ok: false; error: string } {
	if (!existsSync(framePath)) return { ok: false, error: `표준 frame.json이 없습니다: ${framePath}` };
	try {
		const frame = JSON.parse(readFileSync(framePath, "utf8")) as Record<string, unknown>;
		const identity = frame.identity as Record<string, unknown> | undefined;
		if (frame.version !== 1) return { ok: false, error: "frame.json version은 1이어야 합니다." };
		if (identity?.key !== expectedIdentityKey) return { ok: false, error: `frame.json identity.key가 Frame v2 identity와 다릅니다: ${String(identity?.key ?? "(missing)")}` };
		if (typeof frame.goal !== "string" || !frame.goal.trim()) return { ok: false, error: "frame.json goal이 비어 있습니다." };
		if (!Array.isArray(frame.success_criteria) || frame.success_criteria.length === 0) return { ok: false, error: "frame.json success_criteria가 비어 있습니다." };
		if (!frame.verify_plan || typeof frame.verify_plan !== "object" || Array.isArray(frame.verify_plan)) return { ok: false, error: "frame.json verify_plan이 없습니다." };
		if (!frame.implementation_plan || typeof frame.implementation_plan !== "object" || Array.isArray(frame.implementation_plan)) return { ok: false, error: "frame.json implementation_plan이 없습니다." };
		if (!frame.provenance || typeof frame.provenance !== "object" || Array.isArray(frame.provenance)) return { ok: false, error: "frame.json provenance가 없습니다." };
		return { ok: true, frame };
	} catch (error) {
		return { ok: false, error: `frame.json을 읽을 수 없습니다: ${error instanceof Error ? error.message : String(error)}` };
	}
}

function sameSession(record: FrameV2CommandContextRecord, toolCtx: ExtensionContext): boolean {
	const currentSessionFile = toolCtx.sessionManager.getSessionFile?.();
	return !(currentSessionFile && record.sessionFile && currentSessionFile !== record.sessionFile);
}

function buildContinuationPrompt(record: FrameV2CommandContextRecord): string {
	return [
		"# Frame v2 implementation continuation",
		"",
		"The source /frame-v2 session linked its Frame, learning, and implementation context before forking this worktree.",
		"",
		"Required next actions:",
		"1. Read the promoted `.pi/frame.json` in the current worktree. If it is missing, stop as BLOCKED.",
		`2. Reopen the attached Study Hard learning note through .pi/learning-companion.json when needed (source: ${learningCompanionManifestPath(record.identity.storageDir)}).`,
		`3. Study Hard state remains the learning canonical: ${record.statePath}`,
		`4. Source Frame v2 manifest: ${record.manifestPath}`,
		"5. Refresh work_context, select the first ready implementation slice, and implement from the canonical frame contract.",
		"6. If `.pi/learning-companion.json` exists, use learning_companion only for meaningful slice/verify/PR/review checkpoints and explicit learning proposals. Missing companion never blocks work.",
		"7. Do not rerun the Frame v2 interview or resume refinement unless the canonical frame has an explicit gap.",
	].join("\n");
}

function adoptStudyHardRun(runId: string, toolCtx: ExtensionContext): FrameV2CommandContextRecord | { error: string } {
	const state = loadPersistedStudyHardState(runId);
	if (!state) return { error: `Study Hard run을 찾을 수 없습니다: ${runId}` };
	const ctx = toolCtx as ExtensionCommandContext;
	const args = state.title || state.sourceTitle || runId;
	const identity = buildFrameIdentity(ctx, args);
	const parsed = parseFrameV2Args(args, identity.key, "study-hard-first");
	if ("help" in parsed) return { error: "Study Hard 제목을 Frame v2 topic으로 변환하지 못했습니다." };
	const invocation: FrameV2Invocation = { ...parsed, sourceUrl: state.url };
	const statePath = studyHardStatePathFor(runId);
	const { path: manifestPath } = writeFrameV2Manifest({
		identity,
		invocation,
		runId,
		statePath,
		sourceUrl: state.url,
	});
	const record: FrameV2CommandContextRecord = {
		key: identity.key,
		args,
		cwd: identity.cwd,
		ctx,
		identity,
		invocation,
		runId,
		statePath,
		manifestPath,
		createdAt: Date.now(),
		sessionFile: ctx.sessionManager.getSessionFile?.(),
	};
	rememberContext(record);
	return record;
}

function registerFrameV2StateTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: FRAME_V2_STATE_TOOL,
		label: "Update Frame v2 State",
		description: "Inspect a /frame-v2 runtime manifest, adopt an existing Study Hard run, or link a validated standard frame.json.",
		promptSnippet: "When the user wants to turn the current standalone Study Hard session into work planning, call action=adopt-study-hard with its runId. When frame.json exists, call action=ready to link both canonicals.",
		promptGuidelines: [
			"Call adopt-study-hard only after the user asks to create or amend a Frame from that learning run; preserve the same runId, Q&A, and revision.",
			"Use action=ready after standard frame.json was atomically written; Study Hard completion is not required.",
			"This tool does not create frame.json or authorize implementation; it records coordination state and links companion artifacts.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("status"), Type.Literal("adopt-study-hard"), Type.Literal("ready")]),
			identityKey: Type.Optional(Type.String()),
			runId: Type.Optional(Type.String({ description: "Existing Study Hard runId for adopt-study-hard." })),
		}),
		async execute(_toolCallId, params: { action: "status" | "adopt-study-hard" | "ready"; identityKey?: string; runId?: string }, _signal, _onUpdate, toolCtx: ExtensionContext) {
			if (params.action === "adopt-study-hard") {
				if (!params.runId) return blockedResult("BLOCKED: adopt-study-hard에는 Study Hard runId가 필요합니다.", { action: FRAME_V2_STATE_TOOL });
				const adopted = adoptStudyHardRun(params.runId, toolCtx);
				if ("error" in adopted) return blockedResult(`BLOCKED: ${adopted.error}`, { action: FRAME_V2_STATE_TOOL, runId: params.runId });
				const state = loadPersistedStudyHardState(adopted.runId);
				return {
					content: [{ type: "text" as const, text: `✓ Study Hard run을 Frame v2에 연결했습니다: ${adopted.runId}\n이제 같은 학습 기록을 유지한 채 표준 Frame을 만들거나 보완할 수 있습니다.` }],
					details: { action: FRAME_V2_STATE_TOOL, adopted: true, runId: adopted.runId, revision: state?.revision, manifestPath: adopted.manifestPath, framePath: join(adopted.identity.storageDir, "frame.json"), identityKey: adopted.identity.key },
				};
			}
			const record = getContext(params.identityKey);
			if (!record) return blockedResult("BLOCKED: 활성 /frame-v2 command context를 찾지 못했습니다.", { action: FRAME_V2_STATE_TOOL });
			if (!sameSession(record, toolCtx)) return blockedResult("BLOCKED: 현재 tool session과 /frame-v2 command session이 달라 상태를 변경하지 않습니다.", { action: FRAME_V2_STATE_TOOL, reason: "session mismatch" });
			const framePath = join(record.identity.storageDir, "frame.json");
			if (params.action === "ready") {
				const readiness = validateFrameV2ReadyFrame(framePath, record.identity.key);
				if (!readiness.ok) return blockedResult(`BLOCKED: ${readiness.error}`, { action: FRAME_V2_STATE_TOOL, framePath });
				const readyManifest = updateFrameV2ManifestStatus(record.manifestPath, "ready");
				const companion = attachFrameV2LearningCompanion(record, readiness.frame);
				const manifest = companion.frameV2Manifest ?? readyManifest;
				const companionLine = companion.warning
					? companion.manifestPath
						? `\n⚠ 학습노트 companion sidecar는 저장했고 ${companion.warning}`
						: `\n⚠ 학습노트 companion 연결은 건너뛰었습니다: ${companion.warning}`
					: `\n✓ 학습노트 companion: ${companion.manifestPath}`;
				return {
					content: [{ type: "text" as const, text: `✓ Frame v2 ready: ${framePath}${companionLine}` }],
					details: { action: FRAME_V2_STATE_TOOL, manifestPath: record.manifestPath, framePath, manifest, companion },
				};
			}
			const manifest = JSON.parse(readFileSync(record.manifestPath, "utf8"));
			return { content: [{ type: "text" as const, text: `Frame v2 ${manifest.status}: ${record.manifestPath}` }], details: { action: FRAME_V2_STATE_TOOL, manifestPath: record.manifestPath, framePath, frameExists: existsSync(framePath), manifest } };
		},
	});
}

function registerFrameV2ForkTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: FRAME_V2_FORK_TOOL,
		label: "Start Frame v2 Worktree Fork",
		description: "Fork a completed /frame-v2 through the original command context, promote frame.json, switch sessions, and start implementation.",
		promptSnippet: "After Frame v2 is ready and the user selects fork해서 구현 시작, call frame_v2_worktree_fork instead of worktree_fork.",
		promptGuidelines: [
			"Call only after frame_v2_state action=ready and explicit user selection.",
			"If BLOCKED is returned, do not continue by absolute path or create a worktree another way.",
		],
		parameters: Type.Object({
			identityKey: Type.Optional(Type.String()),
			repo: Type.Optional(Type.String()),
			name: Type.Optional(Type.String()),
			ticket: Type.Optional(Type.String()),
			note: Type.Optional(Type.String()),
			hotfix: Type.Optional(Type.Boolean()),
			minimalContext: Type.Optional(Type.Boolean()),
		}),
		async execute(_toolCallId, params: FrameWorktreeForkParams, _signal, _onUpdate, toolCtx: ExtensionContext) {
			const record = getContext(params.identityKey);
			if (!record) return blockedResult("BLOCKED: 이 /frame-v2 실행의 command context를 찾지 못해 worktree를 만들지 않습니다.", { action: FRAME_V2_FORK_TOOL });
			if (!sameSession(record, toolCtx)) return blockedResult("BLOCKED: 현재 tool session과 /frame-v2 command session이 달라 fork 연속성을 보장할 수 없습니다.", { action: FRAME_V2_FORK_TOOL, reason: "session mismatch" });
			const framePath = join(record.identity.storageDir, "frame.json");
			const readiness = validateFrameV2ReadyFrame(framePath, record.identity.key);
			if (!readiness.ok) return blockedResult(`BLOCKED: 표준 frame.json이 준비되지 않아 fork를 시작하지 않습니다: ${readiness.error}`, { action: FRAME_V2_FORK_TOOL, framePath });
			const manifest = JSON.parse(readFileSync(record.manifestPath, "utf8")) as { status?: string };
			if (manifest.status !== "ready") return blockedResult("BLOCKED: Frame v2 manifest가 ready가 아닙니다. 먼저 refinement와 frame_v2_state ready를 완료하세요.", { action: FRAME_V2_FORK_TOOL, status: manifest.status });

			const args = buildFrameWorktreeForkArgs(params, record.identity);
			const runWorktreeForkFromCommandContext = await resolveFrameV2ForkRunner();
			const result = await runWorktreeForkFromCommandContext(pi, args, record.ctx, {
				afterSwitchFollowUp: {
					customType: FRAME_V2_CONTINUATION_TYPE,
					content: buildContinuationPrompt(record),
					display: false,
					details: { frameV2IdentityKey: record.key, manifestPath: record.manifestPath, statePath: record.statePath },
				},
			});
			if (result.status !== "switched") return blockedResult(`BLOCKED: Frame v2 worktree session 전환이 완료되지 않았습니다. 사유: ${result.reason}`, { action: FRAME_V2_FORK_TOOL, result });
			updateFrameV2ManifestStatus(record.manifestPath, "started");
			return {
				content: [{ type: "text" as const, text: `✓ Frame v2 구현 세션 시작: ${result.name} (${result.branch})` }],
				details: { action: FRAME_V2_FORK_TOOL, result, manifestPath: record.manifestPath, autoStarted: true },
			};
		},
	});
}

export default function (pi: ExtensionAPI) {
	registerFrameV2StateTool(pi);
	registerFrameV2ForkTool(pi);
	pi.registerCommand("frame-v2", {
		description: "Frame과 Study Hard의 시작 순서를 선택하고 작업·학습을 연결하는 pilot",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				const identity = buildFrameIdentity(ctx, args);
				const provisional = parseFrameV2Args(args, identity.key);
				if ("help" in provisional) {
					ctx.ui.notify(HELP, "info");
					return;
				}
				const selected = await ctx.ui.select("어떤 방식으로 시작할까요?", [...ENTRY_OPTIONS]);
				if (!selected) {
					ctx.ui.notify("Frame v2 시작을 취소했습니다.", "info");
					return;
				}
				const entryMode: FrameV2EntryMode = selected === ENTRY_OPTIONS[0] ? "frame-first" : "study-hard-first";
				const invocation = parseFrameV2Args(args, identity.key, entryMode);
				if ("help" in invocation) return;
				const runId = frameV2RunId(identity.key);
				const statePath = studyHardStatePathFor(runId);
				const { path: manifestPath } = writeFrameV2Manifest({
					identity,
					invocation,
					runId,
					statePath,
					sourceUrl: invocation.sourceUrl,
				});
				const record: FrameV2CommandContextRecord = {
					key: identity.key,
					args,
					cwd: identity.cwd,
					ctx,
					identity,
					invocation,
					runId,
					statePath,
					manifestPath,
					createdAt: Date.now(),
					sessionFile: ctx.sessionManager.getSessionFile?.(),
				};
				rememberContext(record);
				const prompt = buildFrameV2Prompt({ args, cwd: identity.cwd, identity, invocation, runId, statePath, manifestPath });
				ctx.ui.notify(entryMode === "frame-first"
					? "🧭 Frame 먼저 시작합니다. 이후 Study Hard나 구현을 자유롭게 연결할 수 있습니다."
					: "📚 Study Hard 먼저 시작합니다. Frame이 있으면 전체 기획을 연결하고, 없으면 학습부터 진행합니다.", "info");
				pi.sendMessage({
					customType: CUSTOM_TYPE,
					content: prompt,
					display: false,
					details: { command: "frame-v2", args, mode: invocation.mode, entryMode, identityKey: identity.key, manifestPath, runId, statePath, skillPath: skillPath(SKILL_NAME) },
				}, { deliverAs: "followUp", triggerTurn: true });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`pilee /frame-v2 failed: ${message}`, "error");
			}
		},
	});
}
