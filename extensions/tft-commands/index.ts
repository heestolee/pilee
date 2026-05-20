import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { runWorktreeForkFromCommandContext } from "../worktree/index.ts";
import { buildFrameIdentity, type FrameIdentity, formatFrameIdentityHint, resolveEffectiveCwd } from "./frame-identity.ts";
import { buildFrameForkContinuationPrompt, buildFrameWorktreeForkArgs, type FrameWorktreeForkParams } from "./frame-worktree-fork.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const SKILLS_DIR = join(PACKAGE_ROOT, "skills");

const PREREQUISITE_SKILLS = ["tft-guidelines", "ask-user-question-rules"] as const;
const SHIM_CUSTOM_TYPE = "pilee-tft-command-shim";

type TftCommandName = "frame" | "decide" | "verify";

const COMMANDS: Record<TftCommandName, { description: string }> = {
	frame: {
		description: "pilee /frame — 목표·성공 기준·범위·검증 계획을 frame.json으로 정렬",
	},
	decide: {
		description: "pilee /decide — frame.decision 또는 즉석 기술 의사결정 처리",
	},
	verify: {
		description: "pilee /verify — frame.json success_criteria 기반 증거 우선 검증",
	},
};

const FRAME_COMMAND_CONTEXT_TTL_MS = 6 * 60 * 60 * 1000;
const FRAME_FORK_TOOL_NAME = "frame_worktree_fork";
const FRAME_FORK_CONTINUATION_TYPE = "pilee-frame-worktree-fork-continuation";

interface FrameCommandContextRecord {
	key: string;
	args: string;
	cwd: string;
	ctx: ExtensionCommandContext;
	frameIdentity: FrameIdentity;
	createdAt: number;
	sessionFile?: string;
}

const frameCommandContexts = new Map<string, FrameCommandContextRecord>();
let latestFrameCommandContextKey: string | null = null;

function pruneFrameCommandContexts(now = Date.now()): void {
	for (const [key, record] of frameCommandContexts.entries()) {
		if (now - record.createdAt > FRAME_COMMAND_CONTEXT_TTL_MS) frameCommandContexts.delete(key);
	}
	if (latestFrameCommandContextKey && !frameCommandContexts.has(latestFrameCommandContextKey)) latestFrameCommandContextKey = null;
}

function rememberFrameCommandContext(ctx: ExtensionCommandContext, args: string, cwd: string, frameIdentity: FrameIdentity): void {
	pruneFrameCommandContexts();
	const record: FrameCommandContextRecord = {
		key: frameIdentity.key,
		args,
		cwd,
		ctx,
		frameIdentity,
		createdAt: Date.now(),
		sessionFile: ctx.sessionManager.getSessionFile?.(),
	};
	frameCommandContexts.set(frameIdentity.key, record);
	latestFrameCommandContextKey = frameIdentity.key;
}

function getFrameCommandContext(identityKey?: string): FrameCommandContextRecord | null {
	pruneFrameCommandContexts();
	if (identityKey) return frameCommandContexts.get(identityKey) ?? null;
	return latestFrameCommandContextKey ? frameCommandContexts.get(latestFrameCommandContextKey) ?? null : null;
}

function blockedResult(text: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text }], details: { blocked: true, ...details } };
}

function skillPath(skillName: string): string {
	return join(SKILLS_DIR, skillName, "SKILL.md");
}

function readSkill(skillName: string): { name: string; path: string; content: string } {
	const path = skillPath(skillName);
	return {
		name: skillName,
		path,
		content: readFileSync(path, "utf-8").trimEnd(),
	};
}

function formatInlinedSkill(skill: { name: string; path: string; content: string }): string {
	const baseDir = dirname(skill.path);
	return [
		`----- BEGIN INLINED PILEE SKILL: ${skill.name} -----`,
		`Location: ${skill.path}`,
		`References are relative to: ${baseDir}`,
		"",
		skill.content,
		`----- END INLINED PILEE SKILL: ${skill.name} -----`,
	].join("\n");
}

export function buildPileeTftPrompt(command: TftCommandName, args: string, cwd: string, frameIdentity?: FrameIdentity): string {
	const targetSkill = readSkill(command);
	const prerequisiteSkills = PREREQUISITE_SKILLS.map((name) => readSkill(name));
	const commandLine = `/${command}${args.trim() ? ` ${args.trim()}` : ""}`;
	const frameIdentitySection = command === "frame" && frameIdentity ? ["", formatFrameIdentityHint(frameIdentity)] : [];

	return [
		"# pilee TFT command shim",
		"",
		`You are executing \`${commandLine}\` through pilee's extension command shim.`,
		"",
		"Hard routing rules:",
		`- Use the inlined pilee \`${command}\` SKILL.md below as the authoritative workflow for this invocation.`,
		`- Treat the inlined prerequisite skills as already loaded/read. Do not substitute project-local \`.agents/skills/*\` versions.`,
		`- Ignore any project skill with the same name, especially \`.agents/skills/${command}/SKILL.md\`.`,
		"- Do not ask the user to re-invoke `/skill:*`; continue now using the inlined instructions.",
		"- If a referenced helper file is not inlined, resolve relative paths from the listed pilee skill directory only.",
		"",
		`Current cwd: ${cwd}`,
		"",
		"Original user command arguments:",
		"----- BEGIN ORIGINAL ARGUMENTS -----",
		args.trim() || "(none)",
		"----- END ORIGINAL ARGUMENTS -----",
		...frameIdentitySection,
		"",
		"## Inlined prerequisite skills",
		...prerequisiteSkills.map(formatInlinedSkill),
		"",
		"## Inlined target skill",
		formatInlinedSkill(targetSkill),
		"",
		"Now execute the target skill for the original user command.",
	].join("\n");
}

function registerFrameWorktreeForkTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: FRAME_FORK_TOOL_NAME,
		label: "Start Frame Worktree Fork",
		description: "Continue a completed /frame by running the real /wt fork command-context path, switching into the forked worktree session, and starting implementation there.",
		promptSnippet: "After /frame Step 9 selects fork해서 시작, call frame_worktree_fork instead of worktree_fork so the original /frame command context performs the real worktree fork/session switch.",
		promptGuidelines: [
			"Use only after a /frame invocation has reached Step 9 and the user selected fork해서 시작.",
			"Do not call worktree_fork for /frame completion; this tool reuses the original /frame command context so session switching happens for real.",
			"If this tool returns BLOCKED, stop and report that no forked session was started. Do not continue by absolute path or ask for a switch command.",
		],
		parameters: Type.Object({
			identityKey: Type.Optional(Type.String({ description: "Frame identity key from the /frame identity hint. Defaults to latest active /frame command context." })),
			repo: Type.Optional(Type.String({ description: "Registered worktree repo name, if the frame started outside a repo or multiple repos are registered." })),
			name: Type.Optional(Type.String({ description: "Optional worktree name." })),
			ticket: Type.Optional(Type.String({ description: "Issue/ticket key. Defaults to the frame identity ticket when present." })),
			note: Type.Optional(Type.String({ description: "Short note stored in worktree metadata." })),
			hotfix: Type.Optional(Type.Boolean({ description: "Fork from production/hotfix base." })),
			minimalContext: Type.Optional(Type.Boolean({ description: "Use minimal handoff instead of the default full transcript." })),
		}),
		async execute(_toolCallId, params: FrameWorktreeForkParams, _signal, _onUpdate, toolCtx: ExtensionContext) {
			const record = getFrameCommandContext(params.identityKey);
			if (!record) {
				return blockedResult("BLOCKED: 이 /frame 실행의 command context를 찾지 못해 실제 worktree session fork를 시작할 수 없습니다. worktree를 만들지 않았고, 현재 세션에서 절대경로로 이어가지 않습니다.", {
					action: FRAME_FORK_TOOL_NAME,
					identityKey: params.identityKey,
					reason: "missing frame command context",
				});
			}

			const currentSessionFile = toolCtx.sessionManager.getSessionFile?.();
			if (currentSessionFile && record.sessionFile && currentSessionFile !== record.sessionFile) {
				return blockedResult("BLOCKED: 현재 tool session과 저장된 /frame command session이 달라 실제 forked context 연속성을 보장할 수 없습니다. worktree를 만들지 않습니다.", {
					action: FRAME_FORK_TOOL_NAME,
					identityKey: record.key,
					currentSessionFile,
					frameSessionFile: record.sessionFile,
					reason: "session mismatch",
				});
			}

			const args = buildFrameWorktreeForkArgs(params, record.frameIdentity);
			const result = await runWorktreeForkFromCommandContext(pi, args, record.ctx, {
				afterSwitchFollowUp: {
					customType: FRAME_FORK_CONTINUATION_TYPE,
					content: buildFrameForkContinuationPrompt(record.frameIdentity),
					display: false,
					details: { frameIdentityKey: record.key, frameDisplayTitle: record.frameIdentity.displayTitle },
				},
			});

			if (result.status !== "switched") {
				return blockedResult(`BLOCKED: /frame fork를 command context로 실행했지만 worktree session 전환이 완료되지 않았습니다. 사유: ${result.reason}. 현재 세션에서 이어서 작업하지 않습니다.`, {
					action: FRAME_FORK_TOOL_NAME,
					identityKey: record.key,
					result,
				});
			}

			return {
				content: [{ type: "text", text: `✓ /frame fork가 command context에서 완료됐습니다. ${result.name} (${result.branch}) worktree session으로 전환했고, 새 세션에서 구현 follow-up을 시작했습니다.` }],
				details: { action: FRAME_FORK_TOOL_NAME, identityKey: record.key, result, autoStarted: true },
			};
		},
	});
}

function registerTftCommand(pi: ExtensionAPI, command: TftCommandName): void {
	pi.registerCommand(command, {
		description: COMMANDS[command].description,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				const frameIdentity = command === "frame" ? buildFrameIdentity(ctx, args) : undefined;
				const cwd = frameIdentity?.cwd ?? resolveEffectiveCwd(ctx).cwd;
				if (command === "frame" && frameIdentity) rememberFrameCommandContext(ctx, args, cwd, frameIdentity);
				const prompt = buildPileeTftPrompt(command, args, cwd, frameIdentity);
				ctx.ui.notify(`pilee /${command}: SKILL.md를 인라인해 실행합니다.`, "info");
				pi.sendMessage(
					{
						customType: SHIM_CUSTOM_TYPE,
						content: prompt,
						display: false,
						details: {
							command,
							args,
							skillPath: skillPath(command),
							prerequisiteSkillPaths: PREREQUISITE_SKILLS.map((name) => skillPath(name)),
						},
					},
					{ deliverAs: "followUp", triggerTurn: true },
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`pilee /${command} shim failed: ${message}`, "error");
			}
		},
	});
}

export default function (pi: ExtensionAPI) {
	registerFrameWorktreeForkTool(pi);
	registerTftCommand(pi, "frame");
	registerTftCommand(pi, "decide");
	registerTftCommand(pi, "verify");
}
