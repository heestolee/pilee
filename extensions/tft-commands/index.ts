import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { buildFrameIdentity, type FrameIdentity, formatFrameIdentityHint, resolveEffectiveCwd } from "./frame-identity.ts";

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

function registerTftCommand(pi: ExtensionAPI, command: TftCommandName): void {
	pi.registerCommand(command, {
		description: COMMANDS[command].description,
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			try {
				const frameIdentity = command === "frame" ? buildFrameIdentity(ctx, args) : undefined;
				const cwd = frameIdentity?.cwd ?? resolveEffectiveCwd(ctx).cwd;
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
	registerTftCommand(pi, "frame");
	registerTftCommand(pi, "decide");
	registerTftCommand(pi, "verify");
}
