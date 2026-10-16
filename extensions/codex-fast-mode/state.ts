import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CodexFastModeState = { enabled: boolean; priority: boolean };
export type SpeedMode = "off" | "fast" | "ultrafast";
export type FastConfiguration = {
	mode: SpeedMode;
	priority: boolean;
	legacyOnly: boolean;
	source: "legacy" | "settings";
	settingsPath: string;
	revision?: string;
};

const SETTINGS_KEY = "pi-codex-fast";
// jiti can instantiate this module separately for the entry point and footer.
// Only the active extension lifecycle owns a reader; stale shutdowns cannot
// remove a newer runtime's reader.
const EFFECTIVE_READERS = Symbol.for("pilee.codex-fast-mode.effective-readers.v1");
type ConfigurationReader = () => FastConfiguration;
type FastGlobal = typeof globalThis & { [EFFECTIVE_READERS]?: Map<string, ConfigurationReader> };

function readerKey(cwd: string): string {
	return JSON.stringify([agentDir(), stateFile(), cwd]);
}

export function registerFastConfigurationReader(cwd: string, reader: ConfigurationReader): () => void {
	const shared = globalThis as FastGlobal;
	const readers = shared[EFFECTIVE_READERS] ??= new Map();
	const key = readerKey(cwd);
	readers.set(key, reader);
	return () => {
		if (readers.get(key) === reader) readers.delete(key);
	};
}

export function loadEffectiveFastConfiguration(cwd: string): FastConfiguration {
	return (globalThis as FastGlobal)[EFFECTIVE_READERS]?.get(readerKey(cwd))?.() ?? loadFastConfiguration(cwd);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function agentDir(): string {
	return process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
}

function stateFile(): string {
	return process.env.PILEE_CODEX_FAST_STATE_FILE || join(agentDir(), "state", "codex-fast-mode.json");
}

function readObject(path: string): Record<string, unknown> {
	try {
		const value: unknown = JSON.parse(readFileSync(path, "utf8"));
		if (!isRecord(value)) throw new Error(`Invalid settings object: ${path}`);
		return value;
	} catch (error) {
		if (isRecord(error) && error.code === "ENOENT") return {};
		throw error;
	}
}

// A synchronous read/merge/rename is serialized within the Pi process. Never
// replace malformed settings with an empty object or expose a partial JSON file.
function mergeAtomic(path: string, merge: (current: Record<string, unknown>) => Record<string, unknown>): void {
	const next = merge(readObject(path));
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
		renameSync(temporary, path);
	} finally {
		rmSync(temporary, { force: true });
	}
}

export function loadCodexFastModeState(): CodexFastModeState {
	try {
		const value = readObject(stateFile());
		if (typeof value.enabled === "boolean") return { enabled: value.enabled, priority: value.priority === true };
	} catch {
		// Legacy missing/corrupt state remains opt-in, never priority by default.
	}
	return { enabled: false, priority: false };
}

export function isCodexFastModeEnabled(): boolean {
	return loadCodexFastModeState().enabled;
}

export function saveCodexFastModeState(state: CodexFastModeState): void {
	mergeAtomic(stateFile(), (current) => ({ ...current, ...state }));
}

function persistedMode(settings: Record<string, unknown>): SpeedMode | undefined {
	const value = settings[SETTINGS_KEY];
	if (!isRecord(value)) return undefined;
	if (value.mode === "off" || value.mode === "fast" || value.mode === "ultrafast") return value.mode;
	if (typeof value.enabled === "boolean") return value.enabled ? "fast" : "off";
	return undefined;
}

export function loadFastConfiguration(cwd: string): FastConfiguration {
	const globalPath = join(agentDir(), "settings.json");
	const projectPath = join(cwd, ".pi", "settings.json");
	const global = readObject(globalPath);
	const project = readObject(projectPath);
	const projectMode = persistedMode(project);
	const mode = projectMode ?? persistedMode(global);
	if (mode !== undefined) {
		const selected = (projectMode === undefined ? global : project)[SETTINGS_KEY];
		const settings = isRecord(selected) ? selected : {};
		return {
			mode,
			priority: typeof settings.priority === "boolean" ? settings.priority : true,
			legacyOnly: settings.legacyOnly === true,
			source: "settings",
			settingsPath: projectMode === undefined ? globalPath : projectPath,
			...(typeof settings.revision === "string" ? { revision: settings.revision } : {}),
		};
	}
	const legacy = loadCodexFastModeState();
	return { mode: legacy.enabled ? "fast" : "off", priority: legacy.priority, legacyOnly: true, source: "legacy", settingsPath: globalPath };
}

// Commands write one canonical store. The legacy state is read compatibility,
// not a second mode writer; merely loading either configuration never migrates it.
export function saveFastConfiguration(state: FastConfiguration): void {
	mergeAtomic(state.settingsPath, (current) => ({
		...current,
		[SETTINGS_KEY]: {
			...(isRecord(current[SETTINGS_KEY]) ? current[SETTINGS_KEY] : {}),
			mode: state.mode,
			enabled: state.mode !== "off",
			priority: state.priority,
			legacyOnly: state.legacyOnly,
			// Even OFF -> OFF is an explicit saved choice that supersedes a CLI
			// override in an already-running panel. Unrelated settings writes do not.
			revision: randomUUID(),
		},
	}));
}
