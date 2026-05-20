import { existsSync, readFileSync } from "node:fs";

export interface MessageEntryLike {
	type?: string;
	timestamp?: unknown;
	createdAt?: unknown;
	time?: unknown;
	message?: {
		role?: unknown;
	};
}

export interface LastInteractionOptions {
	entries?: unknown[];
	sessionFile?: string | null;
	fallbackMs?: number | null;
}

function asEntry(value: unknown): MessageEntryLike | null {
	return value && typeof value === "object" ? value as MessageEntryLike : null;
}

function isConversationMessage(entry: MessageEntryLike): boolean {
	const role = entry.message?.role;
	return entry.type === "message" && (role === "user" || role === "assistant");
}

export function entryTimestampMs(entry: MessageEntryLike): number {
	const raw = entry.timestamp ?? entry.createdAt ?? entry.time;
	if (!raw) return 0;
	const ms = new Date(raw as string | number | Date).getTime();
	return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export function latestInteractionFromEntries(entries: unknown[] | undefined): number | null {
	if (!Array.isArray(entries)) return null;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = asEntry(entries[i]);
		if (!entry || !isConversationMessage(entry)) continue;
		const ts = entryTimestampMs(entry);
		if (ts) return ts;
	}
	return null;
}

export function latestInteractionFromSessionFile(sessionFile: string | null | undefined): number | null {
	if (!sessionFile || !existsSync(sessionFile)) return null;
	try {
		const lines = readFileSync(sessionFile, "utf8").trimEnd().split(/\r?\n/);
		for (let i = lines.length - 1; i >= 0; i--) {
			const line = lines[i]?.trim();
			if (!line) continue;
			let parsed: unknown;
			try { parsed = JSON.parse(line); } catch { continue; }
			const entry = asEntry(parsed);
			if (!entry || !isConversationMessage(entry)) continue;
			const ts = entryTimestampMs(entry);
			if (ts) return ts;
		}
	} catch {}
	return null;
}

export function resolveLastInteractionAt(options: LastInteractionOptions): number | null {
	const candidates = [
		latestInteractionFromEntries(options.entries),
		latestInteractionFromSessionFile(options.sessionFile),
		options.fallbackMs && options.fallbackMs > 0 ? options.fallbackMs : null,
	].filter((ts): ts is number => typeof ts === "number" && Number.isFinite(ts) && ts > 0);
	return candidates.length > 0 ? Math.max(...candidates) : null;
}

export function nextRelativeTimeRefreshDelayMs(lastInteractionAt: number | null, now = Date.now()): number {
	if (!lastInteractionAt) return 60_000;
	const elapsedMs = Math.max(0, now - lastInteractionAt);
	return elapsedMs >= 30 * 60_000 ? 5 * 60_000 : 60_000;
}

export function formatLocalTime(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatRelativeTime(ts: number, now = Date.now()): string {
	const seconds = Math.max(0, Math.floor((now - ts) / 1000));
	if (seconds < 10) return "방금 전";
	if (seconds < 60) return `${seconds}초 전`;
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}분 전`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}시간 ${minutes % 60}분 전`;
	const days = Math.floor(hours / 24);
	return `${days}일 전`;
}

export function formatLastInteractionLine(ts: number | null, now = Date.now()): string | null {
	if (!ts) return null;
	return `🕘 마지막 인터랙션 ${formatLocalTime(ts)} · ${formatRelativeTime(ts, now)}`;
}
