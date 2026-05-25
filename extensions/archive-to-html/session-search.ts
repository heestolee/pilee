import * as fs from "node:fs";
import { createInterface } from "node:readline";

export interface ConversationSessionCandidate {
	path: string;
	title: string;
	workspace: string;
	cwd: string;
	sourceLabel: string;
	panelLabel: string;
	time: string;
	mtime: number;
}

export interface ConversationSearchMatch {
	role: "user" | "assistant";
	timestamp: string;
	index: number;
	snippetHtml: string;
}

export interface ConversationSearchResult {
	candidate: ConversationSessionCandidate;
	matches: ConversationSearchMatch[];
}

export interface ConversationSearchResponse {
	query: string;
	terms: string[];
	scanned: number;
	truncated: boolean;
	results: ConversationSearchResult[];
}

interface ConversationEntry {
	role: "user" | "assistant";
	text: string;
	timestamp: string;
}

export interface SearchOptions {
	maxResults?: number;
	maxMatchesPerSession?: number;
	snippetRadius?: number;
}

const DEFAULT_MAX_RESULTS = 60;
const DEFAULT_MAX_MATCHES_PER_SESSION = 3;
const DEFAULT_SNIPPET_RADIUS = 150;

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textBlocksOnly(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!block || typeof block !== "object") return "";
			const record = block as Record<string, unknown>;
			return record.type === "text" && typeof record.text === "string" ? record.text : "";
		})
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

function looksLikeSessionNoise(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return true;
	return trimmed.startsWith("<system")
		|| trimmed.startsWith("<local-command")
		|| trimmed.startsWith("<command-name>")
		|| trimmed.startsWith("Base directory for this skill:")
		|| trimmed.includes("<!--PI_DYNAMIC_SCOPE_START-->");
}

function conversationFromJsonlRecord(raw: unknown): ConversationEntry | null {
	if (!raw || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	const timestamp = typeof record.timestamp === "string" ? record.timestamp : "";
	if (record.type === "last-prompt" && typeof record.lastPrompt === "string") {
		const text = record.lastPrompt.trim();
		if (looksLikeSessionNoise(text)) return null;
		return { role: "user", text, timestamp };
	}
	let message: Record<string, unknown> = {};
	if (record.type === "message") {
		message = record.message && typeof record.message === "object" ? record.message as Record<string, unknown> : {};
	} else if (record.type === "user" || record.type === "assistant") {
		message = record.message && typeof record.message === "object" ? record.message as Record<string, unknown> : { role: record.type, content: record.content };
	} else {
		return null;
	}
	const role = String(message.role || record.type || "message");
	if (role !== "user" && role !== "assistant") return null;
	const text = textBlocksOnly(message.content);
	if (looksLikeSessionNoise(text)) return null;
	return { role, text, timestamp };
}

export function parseSearchTerms(query: string): string[] {
	return [...new Set(query
		.trim()
		.toLowerCase()
		.split(/\s+/)
		.map((term) => term.trim())
		.filter(Boolean))]
		.slice(0, 8);
}

function compactText(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function textMatchesTerms(text: string, terms: string[]): boolean {
	const lower = text.toLowerCase();
	return terms.every((term) => lower.includes(term));
}

function firstTermIndex(text: string, terms: string[]): number {
	const lower = text.toLowerCase();
	let best = Number.POSITIVE_INFINITY;
	for (const term of terms) {
		const index = lower.indexOf(term);
		if (index >= 0 && index < best) best = index;
	}
	return Number.isFinite(best) ? best : 0;
}

function highlightSnippet(snippet: string, terms: string[]): string {
	let html = escapeHtml(snippet);
	const escapedTerms = terms
		.map((term) => escapeHtml(term))
		.filter(Boolean)
		.sort((a, b) => b.length - a.length);
	if (!escapedTerms.length) return html;
	const pattern = escapedTerms.map(escapeRegExp).join("|");
	return html.replace(new RegExp(pattern, "gi"), (match) => `<mark>${match}</mark>`);
}

export function buildMatchingSnippetHtml(text: string, terms: string[], radius = DEFAULT_SNIPPET_RADIUS): string {
	const compact = compactText(text);
	if (!compact) return "";
	const index = firstTermIndex(compact, terms);
	const start = Math.max(0, index - radius);
	const end = Math.min(compact.length, index + Math.max(...terms.map((term) => term.length), 1) + radius);
	const snippet = `${start > 0 ? "…" : ""}${compact.slice(start, end)}${end < compact.length ? "…" : ""}`;
	return highlightSnippet(snippet, terms);
}

async function searchOneSession(candidate: ConversationSessionCandidate, terms: string[], options: Required<SearchOptions>): Promise<ConversationSearchResult | null> {
	const matches: ConversationSearchMatch[] = [];
	const seen = new Set<string>();
	let index = 0;
	let stream: fs.ReadStream | null = null;
	try {
		stream = fs.createReadStream(candidate.path, { encoding: "utf-8" });
		const lines = createInterface({ input: stream, crlfDelay: Infinity });
		for await (const line of lines) {
			if (!line.trim()) continue;
			let entry: ConversationEntry | null = null;
			try { entry = conversationFromJsonlRecord(JSON.parse(line)); } catch { continue; }
			if (!entry) continue;
			const key = `${entry.role}\n${entry.text}`;
			if (seen.has(key)) continue;
			seen.add(key);
			index += 1;
			if (!textMatchesTerms(entry.text, terms)) continue;
			matches.push({
				role: entry.role,
				timestamp: entry.timestamp,
				index,
				snippetHtml: buildMatchingSnippetHtml(entry.text, terms, options.snippetRadius),
			});
			if (matches.length >= options.maxMatchesPerSession) {
				lines.close();
				stream.destroy();
				break;
			}
		}
	} catch {
		return null;
	} finally {
		stream?.destroy();
	}
	return matches.length ? { candidate, matches } : null;
}

export async function searchSessionCandidates(
	candidates: ConversationSessionCandidate[],
	query: string,
	options: SearchOptions = {},
): Promise<ConversationSearchResponse> {
	const terms = parseSearchTerms(query);
	const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
	const mergedOptions: Required<SearchOptions> = {
		maxResults,
		maxMatchesPerSession: options.maxMatchesPerSession ?? DEFAULT_MAX_MATCHES_PER_SESSION,
		snippetRadius: options.snippetRadius ?? DEFAULT_SNIPPET_RADIUS,
	};
	if (!terms.length) return { query, terms, scanned: 0, truncated: false, results: [] };
	const sorted = [...candidates].sort((a, b) => b.mtime - a.mtime);
	const results: ConversationSearchResult[] = [];
	let scanned = 0;
	let truncated = false;
	for (const candidate of sorted) {
		scanned += 1;
		const result = await searchOneSession(candidate, terms, mergedOptions);
		if (result) results.push(result);
		if (results.length >= maxResults) {
			truncated = scanned < sorted.length;
			break;
		}
	}
	return { query, terms, scanned, truncated, results };
}
