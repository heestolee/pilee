import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@mariozechner/pi-ai";
import { agentInputText, isAgentStatusText, readAgentStartInput } from "../utils/agent-start-input.ts";

const MAX_TITLE_CHARS = 48;
const MAX_PROMPT_CHARS = 800;
const EVAL_MARKER = "session-title-evaluated";
const MIN_PROMPTS_FOR_REEVAL = 2;

const SYSTEM_PROMPT = [
	"You write short, explicit session titles for a coding task.",
	"Preserve the user's language. If the request contains Korean, write the title in Korean.",
	"Rewrite the request as an organized summary title instead of copying verbatim.",
	"Keep the core task, but drop URLs, politeness, and logistics unless central.",
	"Make the title concrete and action-oriented.",
	"Return only the title text with no labels, quotes, or markdown.",
	`Keep it to one line and under ${MAX_TITLE_CHARS} characters.`,
].join(" ");

const RENAME_SYSTEM_PROMPT = [
	"You update a session title based on how a coding session evolved.",
	"You receive multiple user messages from the session chronologically.",
	"Summarize what was actually discussed/built, not just what was asked first.",
	"If the session pivoted from the initial topic, reflect the final direction.",
	"Preserve the user's language. If messages contain Korean, write in Korean; keep code identifiers as-is.",
	"Return only the title text with no labels, quotes, or markdown.",
	`Keep it to one line and under ${MAX_TITLE_CHARS} characters.`,
].join(" ");

function normalizeTitle(raw: string): string {
	let t = raw.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? "";
	t = t.replace(/^[-*•]\s*/, "").replace(/^(title|session title|제목|세션 제목)\s*[:：-]\s*/iu, "").trim();
	for (const [o, c] of [["\"", "\""], ["'", "'"], ["`", "`"], ["\u201C", "\u201D"], ["\u2018", "\u2019"]]) {
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

function extractUserPrompts(entries: { type: string; message?: { role: string; content: unknown } }[]): string[] {
	const prompts: string[] = [];
	for (const e of entries) {
		if (e.type !== "message" || e.message?.role !== "user") continue;
		const text = agentInputText(e.message.content).trim();
		if (text && !isAgentStatusText(text)) prompts.push(text);
	}
	return prompts;
}

function buildRenameInput(prompts: string[]): string {
	const MAX_EACH = 200;
	const MAX_SELECTED = 8;
	let selected: string[];
	if (prompts.length <= MAX_SELECTED) {
		selected = prompts;
	} else {
		selected = [
			...prompts.slice(0, 3).map(p => p.slice(0, MAX_EACH)),
			`... (${prompts.length - 6} more messages) ...`,
			...prompts.slice(-3).map(p => p.slice(0, MAX_EACH)),
		];
	}
	return selected.map((p, i) => `[${i + 1}] ${p.slice(0, MAX_EACH)}`).join("\n");
}

export default function (pi: ExtensionAPI) {
	let naming = false;
	let selfHasSet = false;
	let sessionGeneration = 0;
	const isForkChild = !!process.env.PI_FORK_ID;
	const collectedPrompts: string[] = [];

	function getSessionName(): string | undefined {
		try {
			return pi.getSessionName()?.trim() || undefined;
		} catch {
			return undefined;
		}
	}

	function setSessionName(title: string): boolean {
		try {
			pi.setSessionName(title);
			return true;
		} catch {
			return false;
		}
	}

	function appendMarker(value: Record<string, unknown>) {
		try {
			pi.appendEntry(EVAL_MARKER, value);
		} catch {
			// The session may already be shutting down or replaced.
		}
	}

	function syncUi(ctx: ExtensionContext) {
		try {
			if (!ctx.hasUI) return;
			ctx.ui.setTitle(formatTerminalTitle(getSessionName(), ctx.cwd));
		} catch {
			// Ignore stale extension contexts after session replacement/reload.
		}
	}

	async function autoName(prompt: string, ctx: ExtensionContext) {
		if (naming || !prompt.trim()) return;
		const current = getSessionName();
		if (current && selfHasSet) return;
		if (current && !isForkChild) return;

		naming = true;
		const generation = sessionGeneration;
		try {
			const raw = await callLLMForTitle(`User request:\n${prompt.slice(0, MAX_PROMPT_CHARS)}`, SYSTEM_PROMPT, ctx);
			const title = normalizeTitle(raw || prompt.slice(0, MAX_TITLE_CHARS));
			if (generation === sessionGeneration && title && setSessionName(title)) {
				selfHasSet = true;
			}
		} finally {
			if (generation === sessionGeneration) {
				naming = false;
				syncUi(ctx);
			}
		}
	}

	async function callLLMForTitle(prompt: string, systemPrompt: string, ctx: ExtensionContext): Promise<string | undefined> {
		if (!ctx.model || !ctx.modelRegistry) return undefined;
		const lang = prefersKorean(prompt)
			? "Title language: Korean. Write the summary in Korean; keep product names and code identifiers as-is."
			: "Title language: Preserve the user's language.";

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 8000);
		const context = {
			systemPrompt,
			messages: [{ role: "user" as const, content: [{ type: "text" as const, text: `${lang}\n\n${prompt}` }], timestamp: Date.now() }],
		};
		const options = { signal: controller.signal, reasoning: "minimal" as const, maxTokens: 80 };
		const result = await (async () => {
			if (typeof ctx.modelRegistry.streamSimple === "function") {
				return ctx.modelRegistry.streamSimple(ctx.model!, context, options).result();
			}
			// Legacy hosts require explicit auth; current hosts resolve it once inside streamSimple.
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model!);
			if (!auth?.ok) return undefined;
			return completeSimple(ctx.model!, context, { ...options, apiKey: auth.apiKey, headers: auth.headers });
		})().catch(() => undefined).finally(() => clearTimeout(timeout));

		if (result?.stopReason !== "stop") return undefined;
		return result.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map(c => c.text).join("").trim();
	}

	async function reevaluateAtShutdown(ctx: ExtensionContext) {
		if (collectedPrompts.length < MIN_PROMPTS_FOR_REEVAL) return;
		try {
			const generation = sessionGeneration;
			const prompts = [...collectedPrompts];
			const input = buildRenameInput(prompts);
			const raw = await callLLMForTitle(`User messages:\n${input}`, RENAME_SYSTEM_PROMPT, ctx);
			if (generation !== sessionGeneration) return;
			const title = normalizeTitle(raw || "");
			if (title) setSessionName(title);
			appendMarker({ ts: Date.now(), promptCount: prompts.length });
		} catch { /* don't block shutdown */ }
	}

	async function safetyNetOnStartup(ctx: ExtensionContext) {
		const generation = sessionGeneration;
		try {
			const entries = ctx.sessionManager.getBranch?.() ?? ctx.sessionManager.getEntries?.();
			if (!entries) return;
			const allEntries = Array.isArray(entries) ? entries : [...entries];

			const hasMarker = allEntries.some((e: any) => e.type === "custom" && e.customType === EVAL_MARKER);
			if (hasMarker) return;

			const prompts = extractUserPrompts(allEntries);
			if (prompts.length < MIN_PROMPTS_FOR_REEVAL) return;

			const input = buildRenameInput(prompts);
			const raw = await callLLMForTitle(`User messages:\n${input}`, RENAME_SYSTEM_PROMPT, ctx);
			if (generation !== sessionGeneration) return;
			const title = normalizeTitle(raw || "");
			if (title && setSessionName(title)) {
				selfHasSet = true;
			}
			appendMarker({ ts: Date.now(), promptCount: prompts.length, fromSafetyNet: true });
		} catch { /* don't block startup */ }
	}

	pi.on("session_start", async (e: any, ctx) => {
		sessionGeneration += 1;
		collectedPrompts.length = 0;
		naming = false;
		selfHasSet = false;
		syncUi(ctx);
		if (e.reason === "startup" || e.reason === "resume") {
			void safetyNetOnStartup(ctx).then(() => syncUi(ctx)).catch(() => {});
		}
	});
	pi.on("before_agent_start", async (e, ctx) => {
		const input = readAgentStartInput(e);
		if ((input.kind !== "user" && input.kind !== "command") || !input.request?.trim()) return;
		collectedPrompts.push(input.request);
		void autoName(input.request, ctx).catch(() => syncUi(ctx));
	});
	pi.on("session_tree", async (_e, ctx) => syncUi(ctx));
	pi.on("agent_end", async (_e, ctx) => syncUi(ctx));
	pi.on("session_shutdown", async (e: any, ctx) => {
		sessionGeneration += 1;
		if (e.reason !== "reload") {
			await reevaluateAtShutdown(ctx);
		}
		try {
			if (ctx.hasUI) ctx.ui.setTitle(formatTerminalTitle(undefined, ctx.cwd));
		} catch {
			// Ignore stale extension contexts after session replacement/reload.
		}
	});
}
