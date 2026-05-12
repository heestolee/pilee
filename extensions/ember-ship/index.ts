import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");
const SKILLS_DIR = join(PACKAGE_ROOT, "skills");
const SHIM_CUSTOM_TYPE = "pilee-ember-ship-command";

const PREREQUISITE_SKILLS = [
	"git-workflow-and-versioning",
	"pilee-knowledge",
	"pilee-final-check",
] as const;

const HELP = `Ember Ship — pilee knowledge maintenance release train

Usage:
  /ember-ship                 stale 해소 → generated 갱신 → history/Notion → push/merge
  /ember-ship --limit 8       batch당 stale 문서 수 지정 (기본 8)
  /ember-ship --no-merge      검증 후 PR 링크만 만들고 main merge 보류
  /ember-ship --dry-run       worktree/branch 계획과 freshness 상태만 점검
  /ember-ship help            도움말

Default: 안전 조건이 모두 충족되면 main merge + push까지 진행한다. BLOCKED면 branch/PR URL을 남기고 멈춘다.`;

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

export function buildEmberShipPrompt(args: string, cwd: string): string {
	const targetSkill = readSkill("ember-ship");
	const prerequisiteSkills = PREREQUISITE_SKILLS.map((name) => readSkill(name));
	const commandLine = `/ember-ship${args.trim() ? ` ${args.trim()}` : ""}`;

	return [
		"# pilee Ember Ship command shim",
		"",
		`You are executing \`${commandLine}\` through pilee's extension command shim.`,
		"",
		"Hard routing rules:",
		"- Use the inlined pilee `ember-ship` SKILL.md below as the authoritative workflow for this invocation.",
		"- Treat the inlined prerequisite skills as already loaded/read.",
		"- Do not ask the user to re-invoke `/skill:ember-ship`; continue now using the inlined instructions.",
		"- If a referenced helper file is not inlined, resolve relative paths from the listed pilee skill directory only.",
		"- User explicitly invoked a merge-capable maintenance train. Follow the skill's SAFE vs BLOCKED gates before merging.",
		"",
		`Current cwd: ${cwd}`,
		"",
		"Original user command arguments:",
		"----- BEGIN ORIGINAL ARGUMENTS -----",
		args.trim() || "(none)",
		"----- END ORIGINAL ARGUMENTS -----",
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

export default function (pi: ExtensionAPI) {
	pi.registerCommand("ember-ship", {
		description: "Ember Ship — stale knowledge 해소부터 generated/history/merge까지 한 번에 처리",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const trimmed = args.trim();
			if (trimmed === "help" || trimmed === "--help" || trimmed === "-h") {
				ctx.ui.notify(HELP, "info");
				return;
			}

			try {
				const cwd = ctx.cwd ?? process.cwd();
				const prompt = buildEmberShipPrompt(args, cwd);
				ctx.ui.notify("🔥 Ember Ship을 시작합니다. stale→sync→검증→merge gate를 한 턴으로 실행합니다.", "info");
				pi.sendMessage(
					{
						customType: SHIM_CUSTOM_TYPE,
						content: prompt,
						display: false,
						details: {
							command: "ember-ship",
							args,
							skillPath: skillPath("ember-ship"),
							prerequisiteSkillPaths: PREREQUISITE_SKILLS.map((name) => skillPath(name)),
						},
					},
					{ deliverAs: "followUp", triggerTurn: true },
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`pilee /ember-ship shim failed: ${message}`, "error");
			}
		},
	});
}
