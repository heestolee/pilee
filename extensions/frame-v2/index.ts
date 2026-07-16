import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { studyHardStatePathFor } from "../study-hard/studio.ts";
import { buildFrameIdentity, type FrameIdentity, formatFrameIdentityHint } from "../tft-commands/frame-identity.ts";
import { buildFrameWorktreeForkArgs, type FrameWorktreeForkParams } from "../tft-commands/frame-worktree-fork.ts";
import {
	buildInitialFrameV2Note,
	frameV2RunId,
	parseFrameV2Args,
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

const HELP = `Frame v2 — 이해를 학습노트로 만들고 소화한 뒤 작업 시작

Usage:
  /frame-v2 <주제·티켓·URL>           현재 Frame 질문 규율로 함께 최초 노트 작성
  /frame-v2 --guided <주제·티켓·URL>  guided 모드 명시
  /frame-v2 --draft <주제·티켓·URL>   질문 전에 조사된 최초 노트를 먼저 제시
  /frame-v2 help

Flow:
  TFT Studio 최초 노트·시각화 → Study Hard refinement → HTML/Notion → frame.json → 구현 시작`;

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
		"- Existing `/frame`, `/decide`, and `/study-hard` behavior is out of scope; do not edit or reinterpret those workflows during this invocation.",
		"- Do not start implementation until the user explicitly confirms understanding and a standard frame.json is written.",
		"- Use TFT Studio first for the initial note and current Frame tft-visual renderers; only then start the Study Hard board for refinement.",
		params.invocation.mode === "draft"
			? "- Draft-first mode: show a researched initial note before asking contract questions. Mark uncertainty instead of silently deciding it."
			: "- Guided mode: follow the current frame Deep Interview/(명백)/Productive Resistance rules without reducing them to a shorter substitute.",
		placeholderSource
			? "- The source URL below is an internal placeholder. Do not fetch it; investigate the original arguments, current codebase, ticket, and conversation instead."
			: "- Fetch/read the real source URL and any linked evidence before claiming the initial note is grounded.",
		"- After standard frame.json is ready, call frame_v2_state action=ready before offering worktree fork.",
		"- If the user selects fork해서 구현 시작, call frame_v2_worktree_fork rather than worktree_fork.",
		"",
		formatFrameIdentityHint(params.identity),
		"",
		"## Frame v2 runtime contract",
		`- mode: ${params.invocation.mode}`,
		`- topic: ${params.invocation.topic}`,
		`- source URL: ${params.invocation.sourceUrl}`,
		`- Study Hard runId: ${params.runId}`,
		`- expected Study Hard state path: ${params.statePath}`,
		`- Frame v2 manifest: ${params.manifestPath}`,
		`- standard frame path: ${join(params.identity.storageDir, "frame.json")}`,
		"",
		"Initial note skeleton (replace placeholders with grounded content before Study Hard transition):",
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

function sameSession(record: FrameV2CommandContextRecord, toolCtx: ExtensionContext): boolean {
	const currentSessionFile = toolCtx.sessionManager.getSessionFile?.();
	return !(currentSessionFile && record.sessionFile && currentSessionFile !== record.sessionFile);
}

function buildContinuationPrompt(record: FrameV2CommandContextRecord): string {
	return [
		"# Frame v2 implementation continuation",
		"",
		"The source /frame-v2 session completed the understanding/refinement gate and forked this worktree.",
		"",
		"Required next actions:",
		"1. Read the promoted `.pi/frame.json` in the current worktree. If it is missing, stop as BLOCKED.",
		`2. Use the Study Hard source artifact only as provenance: ${record.statePath}`,
		`3. Source Frame v2 manifest: ${record.manifestPath}`,
		"4. Refresh work_context, select the first ready implementation slice, and implement from the canonical frame contract.",
		"5. Do not rerun the Frame v2 interview or resume refinement unless the canonical frame has an explicit gap.",
	].join("\n");
}

function registerFrameV2StateTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: FRAME_V2_STATE_TOOL,
		label: "Update Frame v2 State",
		description: "Inspect a /frame-v2 runtime manifest or mark it ready after the standard frame.json has been written and validated.",
		promptSnippet: "After Frame v2 refinement produces and validates standard frame.json, call frame_v2_state action=ready before offering implementation start.",
		promptGuidelines: [
			"Use action=ready only after the user confirmed understanding and standard frame.json was atomically written.",
			"This tool does not create frame.json; it only verifies the file exists and advances the runtime manifest.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("status"), Type.Literal("ready")]),
			identityKey: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params: { action: "status" | "ready"; identityKey?: string }, _signal, _onUpdate, toolCtx: ExtensionContext) {
			const record = getContext(params.identityKey);
			if (!record) return blockedResult("BLOCKED: 활성 /frame-v2 command context를 찾지 못했습니다.", { action: FRAME_V2_STATE_TOOL });
			if (!sameSession(record, toolCtx)) return blockedResult("BLOCKED: 현재 tool session과 /frame-v2 command session이 달라 상태를 변경하지 않습니다.", { action: FRAME_V2_STATE_TOOL, reason: "session mismatch" });
			const framePath = join(record.identity.storageDir, "frame.json");
			if (params.action === "ready") {
				if (!existsSync(framePath)) return blockedResult(`BLOCKED: 표준 frame.json이 없습니다: ${framePath}`, { action: FRAME_V2_STATE_TOOL, framePath });
				const manifest = updateFrameV2ManifestStatus(record.manifestPath, "ready");
				return { content: [{ type: "text" as const, text: `✓ Frame v2 ready: ${framePath}` }], details: { action: FRAME_V2_STATE_TOOL, manifestPath: record.manifestPath, framePath, manifest } };
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
			if (!existsSync(framePath)) return blockedResult(`BLOCKED: 표준 frame.json이 없어 fork를 시작하지 않습니다: ${framePath}`, { action: FRAME_V2_FORK_TOOL, framePath });
			const manifest = JSON.parse(readFileSync(record.manifestPath, "utf8")) as { status?: string };
			if (manifest.status !== "ready") return blockedResult("BLOCKED: Frame v2 manifest가 ready가 아닙니다. 먼저 refinement와 frame_v2_state ready를 완료하세요.", { action: FRAME_V2_FORK_TOOL, status: manifest.status });

			const args = buildFrameWorktreeForkArgs(params, record.identity);
			const { runWorktreeForkFromCommandContext } = await import("../worktree/index.ts");
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
		description: "초안 먼저 또는 질문형 학습노트 → Study Hard refinement → export → 작업 시작 pilot",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				const identity = buildFrameIdentity(ctx, args);
				const invocation = parseFrameV2Args(args, identity.key);
				if ("help" in invocation) {
					ctx.ui.notify(HELP, "info");
					return;
				}
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
				ctx.ui.notify(invocation.mode === "draft"
					? "📝 Frame v2 초안 먼저 모드를 시작합니다. 조사된 최초 학습노트를 먼저 만듭니다."
					: "🧭 Frame v2 guided 모드를 시작합니다. 현재 Frame 질문 규율로 학습노트를 함께 만듭니다.", "info");
				pi.sendMessage({
					customType: CUSTOM_TYPE,
					content: prompt,
					display: false,
					details: { command: "frame-v2", args, mode: invocation.mode, identityKey: identity.key, manifestPath, runId, statePath, skillPath: skillPath(SKILL_NAME) },
				}, { deliverAs: "followUp", triggerTurn: true });
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`pilee /frame-v2 failed: ${message}`, "error");
			}
		},
	});
}
