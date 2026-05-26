import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const LANGUAGE_POLICY_MARKER = "<!-- pilee-user-facing-language-policy -->";

export function buildUserFacingLanguagePolicy(): string {
	return [
		LANGUAGE_POLICY_MARKER,
		"<user-facing-language-policy>",
		"User-visible prose MUST be Korean by default.",
		"- This includes final answers, progress notes, tool preambles, reasoning/progress summaries surfaced by the UI, generated review artifacts, and UI copy.",
		"- Do NOT expose English meta-reasoning paragraphs such as `Summarizing implementation`, `Checking files`, or `I need to...` when the user is using Korean.",
		"- Keep progress/reasoning summaries short. Prefer terse Korean labels such as `구현 요약 중`, `파일 확인 중`, `검증 실행 중` over paragraph-style self-talk.",
		"- If you are about to summarize your next step or implementation status, write it as a short Korean status line, not an English narrative.",
		"- When evidence sufficiently closes a verification/audit/result check, you SHOULD state the conclusion clearly first (e.g. `모두 맞습니다`, `적용됐습니다`) and separate caveats as `참고로`/`주의점`; avoid hedge wording like `대체로` when no mismatch remains.",
		"- Preserve commands, code, file paths, API names, identifiers, URLs, commit hashes, source titles, raw logs, and raw error messages in their original language/form.",
		"- Preserve machine-readable schemas and requested output formats. Do not translate JSON/YAML/SQL keys or code comments unless the user asks.",
		"- If the user switches language explicitly, follow the user's current language while keeping raw technical strings unchanged.",
		"</user-facing-language-policy>",
	].join("\n");
}

export function appendUserFacingLanguagePolicy(systemPrompt: string): string {
	if (systemPrompt.includes(LANGUAGE_POLICY_MARKER)) return systemPrompt;
	return `${systemPrompt.trimEnd()}\n\n${buildUserFacingLanguagePolicy()}`;
}

export default function userFacingLanguage(pi: ExtensionAPI) {
	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: appendUserFacingLanguagePolicy(event.systemPrompt),
		};
	});
}
