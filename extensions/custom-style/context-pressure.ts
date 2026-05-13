import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@mariozechner/pi-coding-agent";

const DEFAULT_COMPACTION_ENABLED = true;
const DEFAULT_COMPACTION_RESERVE_TOKENS = 16_384;
const SETTINGS_CACHE_MS = 1_000;

const KNOWN_EFFECTIVE_CONTEXT_WINDOWS = new Map<string, number>([
	["openai-codex/gpt-5.5", 272_000],
	["openai-codex/gpt-5.4", 272_000],
]);

type ContextModelSnapshot = {
	provider?: string;
	id?: string;
	contextWindow?: number;
};

export type ContextUsageSnapshot = {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
};

export type CompactionDisplaySettings = {
	enabled: boolean;
	reserveTokens: number;
};

export type ContextPressure = {
	label: "압축" | "ctx";
	percent: number | null;
	thresholdTokens: number | null;
	reserveTokens: number;
	contextWindow: number;
};

type SettingsCacheEntry = {
	expiresAt: number;
	settings: CompactionDisplaySettings;
};

const settingsCache = new Map<string, SettingsCacheEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSettingsFile(path: string): Record<string, unknown> {
	try {
		if (!existsSync(path)) return {};
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function readCompactionSettingsObject(path: string): Partial<CompactionDisplaySettings> {
	const settings = readSettingsFile(path);
	const compaction = settings.compaction;
	if (!isRecord(compaction)) return {};
	return {
		...(typeof compaction.enabled === "boolean" ? { enabled: compaction.enabled } : {}),
		...(typeof compaction.reserveTokens === "number" && Number.isFinite(compaction.reserveTokens)
			? { reserveTokens: compaction.reserveTokens }
			: {}),
	};
}

export function readCompactionDisplaySettings(cwd: string): CompactionDisplaySettings {
	const now = Date.now();
	const cached = settingsCache.get(cwd);
	if (cached && cached.expiresAt > now) return cached.settings;

	const globalSettings = readCompactionSettingsObject(join(getAgentDir(), "settings.json"));
	const projectSettings = readCompactionSettingsObject(join(cwd, ".pi", "settings.json"));
	const settings = {
		enabled: projectSettings.enabled ?? globalSettings.enabled ?? DEFAULT_COMPACTION_ENABLED,
		reserveTokens: Math.max(
			0,
			projectSettings.reserveTokens ?? globalSettings.reserveTokens ?? DEFAULT_COMPACTION_RESERVE_TOKENS,
		),
	};
	settingsCache.set(cwd, { expiresAt: now + SETTINGS_CACHE_MS, settings });
	return settings;
}

function getKnownEffectiveContextWindow(model: ContextModelSnapshot | undefined): number | undefined {
	if (!model?.provider || !model.id) return undefined;
	return KNOWN_EFFECTIVE_CONTEXT_WINDOWS.get(`${model.provider}/${model.id}`);
}

export function getEffectiveContextWindow(
	reportedContextWindow: number,
	model?: ContextModelSnapshot,
): number {
	const knownEffectiveContextWindow = getKnownEffectiveContextWindow(model);
	if (!knownEffectiveContextWindow) return reportedContextWindow;
	if (!Number.isFinite(reportedContextWindow) || reportedContextWindow <= 0) return knownEffectiveContextWindow;
	return Math.min(reportedContextWindow, knownEffectiveContextWindow);
}

export function getCompactionThresholdTokens(contextWindow: number, reserveTokens: number): number | null {
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
	return Math.max(1, contextWindow - Math.max(0, reserveTokens));
}

function getContextUsagePercent(tokens: number | null | undefined, contextWindow: number): number | null {
	if (tokens === null || tokens === undefined || !Number.isFinite(tokens) || tokens < 0) return null;
	if (!Number.isFinite(contextWindow) || contextWindow <= 0) return null;
	return Math.max(0, Math.min(100, (tokens / contextWindow) * 100));
}

export function getCompactionPressurePercent(
	tokens: number | null | undefined,
	contextWindow: number,
	reserveTokens: number,
): number | null {
	if (tokens === null || tokens === undefined || !Number.isFinite(tokens) || tokens < 0) return null;
	const thresholdTokens = getCompactionThresholdTokens(contextWindow, reserveTokens);
	if (!thresholdTokens) return null;
	return Math.max(0, Math.min(100, (tokens / thresholdTokens) * 100));
}

export function buildContextPressure(
	usage: ContextUsageSnapshot | undefined,
	cwd: string,
	model?: ContextModelSnapshot,
): ContextPressure {
	const settings = readCompactionDisplaySettings(cwd);
	const reportedContextWindow = usage?.contextWindow ?? model?.contextWindow ?? 0;
	const contextWindow = getEffectiveContextWindow(reportedContextWindow, model);
	const thresholdTokens = getCompactionThresholdTokens(contextWindow, settings.reserveTokens);
	if (!usage) {
		return {
			label: settings.enabled ? "압축" : "ctx",
			percent: null,
			thresholdTokens,
			reserveTokens: settings.reserveTokens,
			contextWindow,
		};
	}

	if (!settings.enabled) {
		return {
			label: "ctx",
			percent: getContextUsagePercent(usage.tokens, contextWindow) ?? usage.percent,
			thresholdTokens,
			reserveTokens: settings.reserveTokens,
			contextWindow,
		};
	}

	return {
		label: "압축",
		percent: getCompactionPressurePercent(usage.tokens, contextWindow, settings.reserveTokens),
		thresholdTokens,
		reserveTokens: settings.reserveTokens,
		contextWindow,
	};
}

export function formatCompactionStatus(
	tokensBefore: number,
	contextWindow: number | undefined,
	reserveTokens: number,
	model?: ContextModelSnapshot,
): string {
	const effectiveContextWindow = getEffectiveContextWindow(contextWindow ?? 0, model);
	const percent = getCompactionPressurePercent(tokensBefore, effectiveContextWindow, reserveTokens);
	return percent === null ? "직전 ?%" : `직전 ${Math.round(percent)}%`;
}
