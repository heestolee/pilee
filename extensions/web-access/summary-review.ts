import { complete, getModel, type Api, type Message, type Model } from "@mariozechner/pi-ai";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { QueryResultData, SummaryMeta } from "./types.js";

const PREFERRED_SUMMARY_MODELS = [
	{ provider: "openai-codex", id: "gpt-5.4" },
	{ provider: "openai-codex", id: "gpt-5.5" },
] as const;

export type SummaryGenerationContext = Pick<ExtensionContext, "model" | "modelRegistry">;

function estimateTokens(text: string): number {
	const trimmed = text.trim();
	if (trimmed.length === 0) return 0;
	return Math.max(1, Math.ceil(trimmed.length / 4));
}

function summarizeQueryResult(result: QueryResultData): string {
	if (result.error) {
		return `Query: ${result.query}\nStatus: Error\nError: ${result.error}`;
	}

	const lines = [
		`Query: ${result.query}`,
		`Provider: ${result.provider}`,
		`Answer: ${result.answer || "(no answer text returned)"}`,
	];

	if (result.results.length === 0) {
		lines.push("Sources: none");
		return lines.join("\n");
	}

	lines.push("Sources:");
	for (let i = 0; i < result.results.length; i++) {
		const source = result.results[i];
		lines.push(`${i + 1}. ${source.title} — ${source.url}\n   ${source.snippet || ""}`.trimEnd());
	}

	return lines.join("\n");
}

export function buildSummaryPrompt(results: QueryResultData[], feedback?: string): string {
	const sections = [
		"You are writing the final web search summary for a coding assistant.",
		"Write a concise, factual Korean summary using only the provided Tavily search results.",
		"Requirements:",
		"- Keep it readable and skimmable.",
		"- Include key findings and caveats.",
		"- Do not invent sources or claims.",
		"- If evidence is weak or conflicting, say so explicitly.",
		'- End with a short "Sources" section listing the most relevant URLs.',
	];

	if (feedback) sections.push("- Incorporate the user feedback provided below into the summary.");

	sections.push("", "<search_results>");
	for (let i = 0; i < results.length; i++) {
		sections.push(`\n[Result ${i + 1}]`);
		sections.push(summarizeQueryResult(results[i]));
	}
	sections.push("\n</search_results>");

	if (feedback) sections.push("", "<user_feedback>", feedback, "</user_feedback>");

	return sections.join("\n");
}

function buildDeterministicAnswerPreview(answer: string): string {
	let text = answer.replace(/\s+/g, " ").trim();
	if (text.length === 0) return "";
	const sourceMarker = text.search(/\bSources?\s*:/i);
	if (sourceMarker >= 0) text = text.slice(0, sourceMarker).trim();
	return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}

export function buildDeterministicSummary(results: QueryResultData[]): { summary: string; meta: SummaryMeta } {
	const lines: string[] = ["Summary based on the currently selected Tavily search results.", ""];
	const sourceUrls: string[] = [];
	let successful = 0;
	let failed = 0;

	for (const result of results) {
		if (result.error) {
			failed += 1;
			lines.push(`- ${result.query}: failed (${result.error})`);
			continue;
		}
		successful += 1;
		const preview = buildDeterministicAnswerPreview(result.answer);
		lines.push(`- ${result.query}: ${preview || `${result.results.length} source(s) returned without answer text.`}`);
		for (const source of result.results) {
			if (!sourceUrls.includes(source.url)) sourceUrls.push(source.url);
		}
	}

	lines.push("", `Completed queries: ${results.length}`, `Successful: ${successful}`, `Failed: ${failed}`, "", "Sources");
	if (sourceUrls.length === 0) lines.push("- None");
	else for (const url of sourceUrls.slice(0, 12)) lines.push(`- ${url}`);
	if (sourceUrls.length > 12) lines.push(`- ... and ${sourceUrls.length - 12} more`);

	const summary = lines.join("\n").trim();
	return {
		summary,
		meta: {
			model: null,
			durationMs: 0,
			tokenEstimate: estimateTokens(summary),
			fallbackUsed: true,
			fallbackReason: "deterministic-fallback",
			edited: false,
		},
	};
}

async function resolveSummaryModel(
	ctx: SummaryGenerationContext,
	modelOverride?: string,
): Promise<{ model: Model<Api>; apiKey: string }> {
	const normalizedOverride = typeof modelOverride === "string" ? modelOverride.trim() : "";
	if (normalizedOverride.length > 0) {
		const slashIndex = normalizedOverride.indexOf("/");
		if (slashIndex <= 0 || slashIndex >= normalizedOverride.length - 1) {
			throw new Error(`Invalid summary model: ${normalizedOverride}. Use provider/model-id.`);
		}
		const provider = normalizedOverride.slice(0, slashIndex);
		const modelId = normalizedOverride.slice(slashIndex + 1);
		const selectedModel = ctx.modelRegistry.find(provider, modelId);
		if (!selectedModel) throw new Error(`Summary model not found: ${normalizedOverride}`);
		const selectedAuth = await ctx.modelRegistry.getApiKeyAndHeaders(selectedModel);
		if (!selectedAuth.ok || !selectedAuth.apiKey) throw new Error(`No API key available for ${normalizedOverride}`);
		return { model: selectedModel, apiKey: selectedAuth.apiKey };
	}

	const lookupModel = getModel as (provider: string, modelId: string) => Model<Api> | undefined;
	for (const { provider, id } of PREFERRED_SUMMARY_MODELS) {
		const model = lookupModel(provider, id);
		if (!model) continue;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (auth.ok && auth.apiKey) return { model, apiKey: auth.apiKey };
	}

	const current = ctx.model;
	if (current) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(current);
		if (auth.ok && auth.apiKey) return { model: current as Model<Api>, apiKey: auth.apiKey };
	}

	throw new Error("No API key available for summary generation");
}

function getTextFromContentPart(part: unknown): string {
	if (!part || typeof part !== "object") return "";
	const value = part as Record<string, unknown>;
	if (typeof value.text === "string") return value.text;
	if (typeof value.refusal === "string") return value.refusal;
	return "";
}

export async function generateSummaryDraft(
	results: QueryResultData[],
	ctx: SummaryGenerationContext,
	signal?: AbortSignal,
	modelOverride?: string,
	feedback?: string,
): Promise<{ summary: string; meta: SummaryMeta }> {
	const startedAt = Date.now();
	const { model, apiKey } = await resolveSummaryModel(ctx, modelOverride);
	const prompt = buildSummaryPrompt(results, feedback);

	const userMessage: Message = {
		role: "user",
		content: [{ type: "text", text: prompt }],
		timestamp: Date.now(),
	};

	const response = await complete(model, { messages: [userMessage] }, { apiKey, signal });
	if (response.stopReason === "aborted") throw new Error("Aborted");

	const contentParts = Array.isArray(response.content) ? response.content : [];
	const summary = contentParts.map(getTextFromContentPart).filter((text) => text.trim().length > 0).join("\n").trim();
	if (summary.length === 0) throw new Error("Summary model returned empty response");

	return {
		summary,
		meta: {
			model: `${model.provider}/${model.id}`,
			durationMs: Math.max(0, Date.now() - startedAt),
			tokenEstimate: estimateTokens(summary),
			fallbackUsed: false,
			edited: false,
		},
	};
}
