import type { AgentRuntime } from "./agents.js";

export interface ModelFallbackConfig {
	model?: string;
	modelFallback?: string;
	modelFallbacks?: string[];
}

export interface ModelAttemptSpec {
	runtime: AgentRuntime;
	model?: string;
	fallbackIndex: number;
}

export interface ModelAttempt<T> {
	spec: ModelAttemptSpec;
	result: T;
}

interface ExecuteModelFallbackChainOptions<T extends { exitCode: number }> {
	primaryRuntime: AgentRuntime;
	primaryModel?: string;
	fallbackModels: string[];
	signal?: AbortSignal;
	execute: (spec: ModelAttemptSpec) => Promise<T>;
	onFallback?: (next: ModelAttempt<T>, previous: ModelAttempt<T>) => void;
}

function isClaudeRuntimeModel(model: string): boolean {
	const lower = model.toLowerCase();
	return lower.startsWith("anthropic/claude-") || lower.startsWith("claude-");
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

export function resolveFallbackRuntime(primaryRuntime: AgentRuntime, fallbackModel: string): AgentRuntime {
	if (primaryRuntime === "claude" && !isClaudeRuntimeModel(fallbackModel)) return "pi";
	return primaryRuntime;
}

export function makeCrossRuntimeFallbackSessionFile(
	sessionFile: string | undefined,
	fallbackIndex: number,
): string | undefined {
	if (!sessionFile) return undefined;
	const suffix = `.fallback-${fallbackIndex}`;
	return sessionFile.endsWith(".jsonl")
		? `${sessionFile.slice(0, -".jsonl".length)}${suffix}.jsonl`
		: `${sessionFile}${suffix}.jsonl`;
}

export async function executeModelFallbackChain<T extends { exitCode: number }>(
	options: ExecuteModelFallbackChainOptions<T>,
): Promise<ModelAttempt<T>> {
	const specs: ModelAttemptSpec[] = [
		{ runtime: options.primaryRuntime, model: options.primaryModel, fallbackIndex: 0 },
		...options.fallbackModels.map((model, index) => ({
			runtime: resolveFallbackRuntime(options.primaryRuntime, model),
			model,
			fallbackIndex: index + 1,
		})),
	];

	let previous: ModelAttempt<T> | undefined;
	for (const spec of specs) {
		if (options.signal?.aborted) throw new Error("Subagent was aborted");
		const current: ModelAttempt<T> = { spec, result: await options.execute(spec) };
		if (previous) options.onFallback?.(current, previous);
		if (current.result.exitCode === 0) return current;
		previous = current;
	}

	if (!previous) throw new Error("Subagent model attempt chain was empty");
	return previous;
}
