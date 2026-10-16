import { completeSimple } from "@mariozechner/pi-ai";

type SummaryModel = Parameters<typeof completeSimple>[0];
type SummaryResult = Awaited<ReturnType<typeof completeSimple>>;

type AuthResult = {
	ok: boolean;
	apiKey?: string;
	headers?: Record<string, string>;
};

export type ShortLabelContext = {
	model?: SummaryModel;
	modelRegistry?: {
		getApiKeyAndHeaders: (model: SummaryModel) => Promise<AuthResult>;
		streamSimple?: (...args: Parameters<typeof completeSimple>) => { result(): ReturnType<typeof completeSimple> };
	};
	signal?: AbortSignal;
};

export type GenerateShortLabelOptions = {
	systemPrompt: string;
	prompt: string;
	maxTokens?: number;
	timeoutMs?: number;
	extractText?: (content: SummaryResult["content"]) => string;
};

function defaultExtractText(content: SummaryResult["content"]): string {
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("")
		.trim();
}

export async function generateShortLabel(ctx: ShortLabelContext, options: GenerateShortLabelOptions): Promise<string> {
	const model = ctx.model;
	if (!model || !ctx.modelRegistry) return "";

	if (ctx.signal?.aborted) return "";
	const controller = new AbortController();
	const abort = () => controller.abort(ctx.signal?.reason);
	ctx.signal?.addEventListener("abort", abort, { once: true });
	const timeoutMs = options.timeoutMs ?? 10000;
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		const context = {
			systemPrompt: options.systemPrompt,
			messages: [{ role: "user" as const, content: [{ type: "text" as const, text: options.prompt }], timestamp: Date.now() }],
		};
		const request = { signal: controller.signal, reasoning: "minimal" as const, maxTokens: options.maxTokens ?? 60 };
		let result: SummaryResult;
		if (ctx.modelRegistry.streamSimple) {
			result = await ctx.modelRegistry.streamSimple(model, context, request).result();
		} else {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok) return "";
			result = await completeSimple(model, context, { ...request, apiKey: auth.apiKey, headers: auth.headers });
		}

		if (result.stopReason !== "stop") return "";
		const extractText = options.extractText ?? defaultExtractText;
		return extractText(result.content);
	} catch {
		return "";
	} finally {
		clearTimeout(timer);
		ctx.signal?.removeEventListener("abort", abort);
	}
}
