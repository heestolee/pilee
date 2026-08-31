import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrReviewRunState } from "./run.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(__dirname, "../..");

export const META_REVIEW_SKILL_PATH = join(PACKAGE_ROOT, "skills", "meta-review", "SKILL.md");
export const META_REVIEW_COMMAND_CUSTOM_TYPE = "pilee-meta-review-command";

function inlinedSkill(): string {
	const content = readFileSync(META_REVIEW_SKILL_PATH, "utf8").trimEnd();
	return [
		"----- BEGIN INLINED PILEE SKILL: meta-review -----",
		`Location: ${META_REVIEW_SKILL_PATH}`,
		`References are relative to: ${dirname(META_REVIEW_SKILL_PATH)}`,
		"",
		content,
		"----- END INLINED PILEE SKILL: meta-review -----",
	].join("\n");
}

export function buildPrReviewPrompt(state: PrReviewRunState): string {
	return [
		"# pilee /meta-review command",
		"",
		`Review target: ${state.target.url}`,
		`Run id: ${state.runId}`,
		`Run directory: ${state.runDir}`,
		`Head SHA: ${state.target.headSha ?? "unknown"}`,
		"",
		"Execution rules:",
		"- Follow the inlined meta-review skill as the authoritative workflow.",
		"- Start with meta_review_run action=status, then inspect every pending chunk.",
		"- Explain every changed file and every addition/deletion evidence before final submission.",
		"- Submit a document overview plus structured changed-file relationships and a complete reading order. Choose flowchart for static layer/data dependencies and sequence for ordered runtime calls.",
		"- Do not use historical review corpus before producing blind findings. After blind findings exist, use meta_review_run action=search per candidate when a corpus is configured.",
		"- Do not modify the target repository or post GitHub comments.",
		"- Submit complete guides and final cards through meta_review_run action=submit. Empty finding cards are valid, empty guides are not.",
		"- After submit, read the generated review.md and report its path and coverage to the user.",
		"",
		"## Target PR body",
		state.target.body?.trim() || "(PR body 없음)",
		"",
		"## Inlined skill",
		inlinedSkill(),
	].join("\n");
}
