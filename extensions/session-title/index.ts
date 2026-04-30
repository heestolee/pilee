import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@mariozechner/pi-ai";

const MAX_TITLE_CHARS = 48;
const MAX_PROMPT_CHARS = 800;

const SYSTEM_PROMPT = [
	"You write short, explicit session titles for a coding task.",
	"Preserve the user's language. If the request contains Korean, write the title in Korean.",
	"Rewrite the request as an organized summary title instead of copying verbatim.",
	"Keep the core task, but drop URLs, politeness, and logistics unless central.",
	"Make the title concrete and action-oriented.",
	"Return only the title text with no labels, quotes, or markdown.",
	`Keep it to one line and under ${MAX_TITLE_CHARS} characters.`,
].join(" ");

function normalizeTitle(raw: string): string {
	let t = raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
	t = t.replace(/^[-*•]\s*/, "").replace(/^(title|session title|제목|세션 제목)\s*[:：-]\s*/iu, "").trim();
	for (const [o, c] of [["\"", "\""], ["'", "'"], ["`", "`"], [""", """]]) {
		if (t.startsWith(o) && t.endsWith(c) && t.length > 2) t = t.slice(1, -1).trim();
	}
	t = t.replace(/\s+/g, " ").replace(/[.。!！?？:：;；,，\-–—\s]+$/, "").trim();
	return t.length > MAX_TITLE_CHARS ? `${t.slice(0, MAX_TITLE_CHARS - 1)}…` : t;
}

function prefersKorean(text: string): boolean {
	return /[가-힣]/u.test(text);
}

function formatTerminalTitle(title: string | undefined, cwd: string): string {
	const project = path.basename(cwd) || "pi";
	return title ? `π - ${title} - ${project}` : `π - ${project}`;
}

export default function (pi: ExtensionAPI) {
	let naming = false;

	function syncUi(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		ctx.ui.setTitle(formatTerminalTitle(pi.getSessionName()?.trim() || undefined, ctx.cwd));
	}

	async function autoName(prompt: string, ctx: ExtensionContext) {
		if (naming || !prompt.trim()) return;
		const current = pi.getSessionName()?.trim();
		if (current) return;

		naming = true;
		try {
			if (!ctx.model || !ctx.modelRegistry) {
				pi.setSessionName(normalizeTitle(prompt.slice(0, MAX_TITLE_CHARS)));
				return;
			}

			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model).catch(() => undefined);
			if (!auth?.ok) {
				pi.setSessionName(normalizeTitle(prompt.slice(0, MAX_TITLE_CHARS)));
				return;
			}

			const lang = prefersKorean(prompt)
				? "Title language: Korean. Write the summary in Korean; keep product names and code identifiers as-is."
				: "Title language: Preserve the user's language.";

			const controller = new AbortController();
			const timeout = setTimeout(() => controller.abort(), 10000);
			const result = await completeSimple(
				ctx.model,
				{
					systemPrompt: SYSTEM_PROMPT,
					messages: [{ role: "user", content: [{ type: "text", text: `${lang}\n\nUser request:\n${prompt.slice(0, MAX_PROMPT_CHARS)}` }], timestamp: Date.now() }],
				},
				{ apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal, reasoning: "minimal", maxTokens: 80 },
			).catch(() => undefined);
			clearTimeout(timeout);

			const text = result?.stopReason === "stop"
				? result.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("").trim()
				: "";

			const title = normalizeTitle(text || prompt.slice(0, MAX_TITLE_CHARS));
			if (title) pi.setSessionName(title);
		} finally {
			naming = false;
			syncUi(ctx);
		}
	}

	pi.on("session_start", async (_e, ctx) => syncUi(ctx));
	pi.on("before_agent_start", async (e, ctx) => void autoName(e.prompt, ctx).catch(() => syncUi(ctx)));
	pi.on("session_tree", async (_e, ctx) => syncUi(ctx));
	pi.on("agent_end", async (_e, ctx) => syncUi(ctx));
	pi.on("session_shutdown", async (_e, ctx) => {
		if (ctx.hasUI) ctx.ui.setTitle(formatTerminalTitle(undefined, ctx.cwd));
	});
}
