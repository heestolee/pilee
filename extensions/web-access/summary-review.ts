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
		"You are writing the final web search summary for a Korean-speaking coding assistant user.",
		"Write the entire summary in Korean, even when the query, source titles, or source snippets are in English.",
		"Requirements:",
		"- 모든 설명 문장은 한국어로 작성한다.",
		"- 고유명사, API 이름, 코드 식별자는 원문을 유지하되 필요한 경우 한국어 설명을 붙인다.",
		"- Keep it readable and skimmable.",
		"- Include key findings and caveats.",
		"- Do not invent sources or claims.",
		"- If evidence is weak or conflicting, say so explicitly in Korean.",
		'- End with a short "출처" section listing the most relevant URLs.',
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
	const lines: string[] = ["선택된 Tavily 검색 결과를 바탕으로 한 요약입니다.", ""];
	const sourceUrls: string[] = [];
	let successful = 0;
	let failed = 0;

	for (const result of results) {
		if (result.error) {
			failed += 1;
			lines.push(`- ${result.query}: 실패 (${result.error})`);
			continue;
		}
		successful += 1;
		const preview = buildDeterministicAnswerPreview(result.answer);
		lines.push(`- ${result.query}: ${preview || `답변 텍스트 없이 출처 ${result.results.length}개가 반환되었습니다.`}`);
		for (const source of result.results) {
			if (!sourceUrls.includes(source.url)) sourceUrls.push(source.url);
		}
	}

	lines.push("", `완료된 쿼리: ${results.length}`, `성공: ${successful}`, `실패: ${failed}`, "", "출처");
	if (sourceUrls.length === 0) lines.push("- 없음");
	else for (const url of sourceUrls.slice(0, 12)) lines.push(`- ${url}`);
	if (sourceUrls.length > 12) lines.push(`- ... 외 ${sourceUrls.length - 12}개`);

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

async function completeTextPrompt(
	ctx: SummaryGenerationContext,
	prompt: string,
	signal?: AbortSignal,
	modelOverride?: string,
): Promise<{ text: string; model: Model<Api>; durationMs: number }> {
	const startedAt = Date.now();
	const { model, apiKey } = await resolveSummaryModel(ctx, modelOverride);
	const userMessage: Message = {
		role: "user",
		content: [{ type: "text", text: prompt }],
		timestamp: Date.now(),
	};

	const response = await complete(model, { messages: [userMessage] }, { apiKey, signal });
	if (response.stopReason === "aborted") throw new Error("Aborted");

	const contentParts = Array.isArray(response.content) ? response.content : [];
	const text = contentParts.map(getTextFromContentPart).filter((partText) => partText.trim().length > 0).join("\n").trim();
	if (text.length === 0) throw new Error("Model returned empty response");

	return { text, model, durationMs: Math.max(0, Date.now() - startedAt) };
}

export async function generateSummaryDraft(
	results: QueryResultData[],
	ctx: SummaryGenerationContext,
	signal?: AbortSignal,
	modelOverride?: string,
	feedback?: string,
): Promise<{ summary: string; meta: SummaryMeta }> {
	const prompt = buildSummaryPrompt(results, feedback);
	const { text: summary, model, durationMs } = await completeTextPrompt(ctx, prompt, signal, modelOverride);

	return {
		summary,
		meta: {
			model: `${model.provider}/${model.id}`,
			durationMs,
			tokenEstimate: estimateTokens(summary),
			fallbackUsed: false,
			edited: false,
		},
	};
}

export async function rewriteSearchQuery(
	query: string,
	ctx: SummaryGenerationContext,
	signal?: AbortSignal,
): Promise<string> {
	const prompt = [
		"Rewrite this web search query in Korean to get better, more specific Tavily results.",
		"Add relevant year qualifiers, precise technical terms, and useful specificity.",
		"Return ONLY the improved Korean query text, nothing else.",
		"If an English technical term is important, keep it alongside the Korean words.",
		"",
		`Query: ${query}`,
	].join("\n");
	const { text } = await completeTextPrompt(ctx, prompt, signal);
	return text.replace(/^['\"]|['\"]$/g, "").trim();
}
