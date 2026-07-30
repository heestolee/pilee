export interface ModelFallbackConfig {
	model?: string;
	modelFallback?: string;
	modelFallbacks?: string[];
}

export function parseModelFallbacks(
	rawFallbacks: string | undefined,
	legacyFallback: string | undefined,
	normalize: (model: string) => string | undefined,
): string[] | undefined {
	const raw = rawFallbacks || legacyFallback;
	if (!raw) return undefined;
	const normalized = raw
		.split(",")
		.map((model) => normalize(model))
		.filter((model): model is string => Boolean(model));
	const unique = Array.from(new Set(normalized));
	return unique.length > 0 ? unique : undefined;
}

export function resolveModelFallbackChain(agent: ModelFallbackConfig): string[] {
	const configured = agent.modelFallbacks?.length ? agent.modelFallbacks : agent.modelFallback ? [agent.modelFallback] : [];
	return Array.from(new Set(configured)).filter((model) => model !== agent.model);
}
