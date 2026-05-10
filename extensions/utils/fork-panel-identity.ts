import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const RECENT_PATH = join(homedir(), ".pi", "agent", "fork-panel", "recent.json");

interface RecentForkRecord {
	forkId?: string;
	panelLabel?: string;
	parentSessionFile?: string;
	sessionFile?: string;
}

export interface ForkPanelIdentity {
	panelLabel: string;
	source: "env" | "recent" | "fallback";
	forkId?: string;
	parentSessionFile?: string;
}

function readRecent(): Record<string, RecentForkRecord> {
	try {
		if (!existsSync(RECENT_PATH)) return {};
		return JSON.parse(readFileSync(RECENT_PATH, "utf8")) as Record<string, RecentForkRecord>;
	} catch {
		return {};
	}
}

function realPathForCompare(path: string): string {
	try { return realpathSync.native(path); } catch { return path; }
}

function findRecentRecordBySessionFile(sessionFile: string | null | undefined): RecentForkRecord | null {
	if (!sessionFile) return null;
	const target = realPathForCompare(sessionFile);
	for (const [forkId, record] of Object.entries(readRecent())) {
		if (!record?.sessionFile || !record.panelLabel) continue;
		if (realPathForCompare(record.sessionFile) !== target) continue;
		return { ...record, forkId: record.forkId ?? forkId };
	}
	return null;
}

export function resolveForkPanelIdentity(options: {
	env?: Record<string, string | undefined>;
	sessionFile?: string | null;
} = {}): ForkPanelIdentity {
	const env = options.env ?? process.env;
	const envLabel = env.PI_FORK_PANEL_LABEL?.trim();
	if (envLabel) {
		return {
			panelLabel: envLabel,
			source: "env",
			forkId: env.PI_FORK_ID?.trim() || undefined,
			parentSessionFile: env.PI_FORK_PARENT?.trim() || undefined,
		};
	}

	const record = findRecentRecordBySessionFile(options.sessionFile);
	const panelLabel = record?.panelLabel?.trim();
	if (panelLabel) {
		return {
			panelLabel,
			source: "recent",
			forkId: record.forkId,
			parentSessionFile: record.parentSessionFile,
		};
	}

	return { panelLabel: "P0", source: "fallback" };
}

export function getForkPanelLabel(options: {
	env?: Record<string, string | undefined>;
	sessionFile?: string | null;
} = {}): string {
	return resolveForkPanelIdentity(options).panelLabel;
}
