import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// slash 명령이 pilee 스킬 본문을 프롬프트에 그대로 넣을 때 쓰는 공통 경로·형식
const SKILLS_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), "../.."), "skills");

export interface InlinedSkill {
	name: string;
	path: string;
	content: string;
}

export function pileeSkillPath(name: string): string {
	return join(SKILLS_DIR, name, "SKILL.md");
}

export function readPileeSkill(name: string): InlinedSkill {
	const path = pileeSkillPath(name);
	return { name, path, content: readFileSync(path, "utf8").trimEnd() };
}

export function formatInlinedSkill(skill: InlinedSkill): string {
	return [
		`----- BEGIN INLINED PILEE SKILL: ${skill.name} -----`,
		`Location: ${skill.path}`,
		`References are relative to: ${dirname(skill.path)}`,
		"",
		skill.content,
		`----- END INLINED PILEE SKILL: ${skill.name} -----`,
	].join("\n");
}
