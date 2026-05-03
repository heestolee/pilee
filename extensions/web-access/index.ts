import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const TAVILY_SEARCH = "https://api.tavily.com/search";
const FETCH_TIMEOUT_MS = 30000;
const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

interface Config {
	tavilyApiKey?: string;
}

function loadConfig(): Config {
	if (!existsSync(CONFIG_PATH)) return {};
	try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

function getApiKey(envName: string, configKey?: string): string | undefined {
	return configKey || process.env[envName];
}

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface SearchResponse {
	answer: string;
	results: SearchResult[];
}

interface ExtractedContent {
	url: string;
	title?: string;
	content: string;
}

interface StoredQuery {
	id: string;
	query?: string;
	url?: string;
	timestamp: number;
	response?: SearchResponse;
	content?: ExtractedContent;
}

const storedResults = new Map<string, StoredQuery>();

function text(msg: string, details?: any) {
	return { content: [{ type: "text" as const, text: msg }], details };
}

async function searchTavily(
	query: string,
	options: { numResults?: number; recencyFilter?: string; signal?: AbortSignal },
	apiKey: string,
): Promise<SearchResponse> {
	const body: any = {
		api_key: apiKey,
		query,
		max_results: options.numResults ?? 10,
		include_answer: true,
		...(options.recencyFilter
			? { days: options.recencyFilter === "day" ? 1 : options.recencyFilter === "week" ? 7 : options.recencyFilter === "month" ? 30 : 365 }
			: {}),
	};
	const response = await fetch(TAVILY_SEARCH, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: options.signal,
	});
	if (!response.ok) {
		const txt = await response.text().catch(() => "");
		throw new Error(`Tavily ${response.status}: ${txt.slice(0, 200)}`);
	}
	const data = await response.json() as any;
	const results: SearchResult[] = (data.results ?? []).map((r: any) => ({
		title: r.title ?? r.url,
		url: r.url,
		snippet: r.content ?? r.snippet ?? "",
	}));
	return { answer: data.answer ?? "", results };
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			signal: signal ?? controller.signal,
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; pi-web-access/1.0)",
				Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
			},
			redirect: "follow",
		});
		if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
		return await response.text();
	} finally {
		clearTimeout(timeout);
	}
}

function htmlToMarkdown(html: string, url: string): { title: string; content: string } {
	const { document } = parseHTML(html);
	const reader = new Readability(document as any);
	const article = reader.parse();
	const body = article?.content ?? html;
	const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
	return {
		title: article?.title ?? url,
		content: td.turndown(body),
	};
}

async function extractContent(url: string, signal?: AbortSignal): Promise<ExtractedContent> {
	try {
		const html = await fetchHtml(url, signal);
		const { title, content } = htmlToMarkdown(html, url);
		return { url, title, content };
	} catch (e) {
		return { url, content: `(fetch error: ${e instanceof Error ? e.message : e})` };
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web using Tavily. Returns an AI-synthesized answer with source citations. Prefer queries (plural) with 2-4 varied angles over a single query for broader coverage.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Single search query." })),
			queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple queries searched in sequence, each returning its own synthesized answer." })),
			numResults: Type.Optional(Type.Number({ description: "Results per query (default: 5, max: 20)" })),
			provider: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("perplexity"), Type.Literal("exa")], { description: "Search provider (default: auto)" })),
			recencyFilter: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")])),
			includeContent: Type.Optional(Type.Boolean({ description: "Fetch full page content for each result" })),
		}),
		async execute(_id, params, signal) {
			const config = loadConfig();
			const queries = params.queries ?? (params.query ? [params.query] : []);
			if (queries.length === 0) return text("Provide either query or queries[].");

			const apiKey = getApiKey("TAVILY_API_KEY", config.tavilyApiKey);
			if (!apiKey) return text("Tavily API key not found. Configure ~/.pi/web-search.json or set TAVILY_API_KEY env var.");

			const numResults = Math.min(params.numResults ?? 5, 20);
			const sections: string[] = [];
			const totalResults: SearchResult[] = [];
			const responseId = randomUUID().slice(0, 8);

			for (const q of queries) {
				try {
					const result = await searchTavily(q, { numResults, recencyFilter: params.recencyFilter, signal }, apiKey);
					storedResults.set(`${responseId}:${q}`, { id: responseId, query: q, timestamp: Date.now(), response: result });
					sections.push(`### ${q}`);
					if (result.answer) sections.push(result.answer);
					if (result.results.length > 0) {
						sections.push("\n**Sources:**");
						for (const r of result.results) {
							sections.push(`- [${r.title}](${r.url})${r.snippet ? `\n  ${r.snippet.slice(0, 200)}` : ""}`);
							totalResults.push(r);
						}
					}
				} catch (e) {
					sections.push(`### ${q}\n(error: ${e instanceof Error ? e.message : e})`);
				}
			}

			return text(sections.join("\n\n"), { responseId, totalResults: totalResults.length, provider: "tavily" });
		},
	});

	pi.registerTool({
		name: "fetch_content",
		label: "Fetch URL",
		description: "Fetch URL(s) and extract readable content as markdown.",
		parameters: Type.Object({
			url: Type.Optional(Type.String({ description: "Single URL to fetch" })),
			urls: Type.Optional(Type.Array(Type.String(), { description: "Multiple URLs (parallel)" })),
		}),
		async execute(_id, params, signal) {
			const urls = params.urls ?? (params.url ? [params.url] : []);
			if (urls.length === 0) return text("Provide either url or urls[].");

			const responseId = randomUUID().slice(0, 8);
			const results = await Promise.all(urls.map((u) => extractContent(u, signal)));
			const sections: string[] = [];
			for (const r of results) {
				storedResults.set(`${responseId}:${r.url}`, { id: responseId, url: r.url, timestamp: Date.now(), content: r });
				sections.push(`## ${r.title ?? r.url}\nURL: ${r.url}\n\n${r.content}`);
			}
			return text(sections.join("\n\n---\n\n"), { responseId, urlCount: urls.length });
		},
	});

	pi.registerTool({
		name: "get_search_content",
		label: "Get Stored Result",
		description: "Retrieve full content from a previous web_search or fetch_content call.",
		parameters: Type.Object({
			responseId: Type.String({ description: "The responseId from web_search or fetch_content" }),
			query: Type.Optional(Type.String({ description: "Get content for this query (web_search)" })),
			url: Type.Optional(Type.String({ description: "Get content for this URL (fetch_content)" })),
		}),
		async execute(_id, params) {
			if (params.query) {
				const stored = storedResults.get(`${params.responseId}:${params.query}`);
				if (!stored?.response) return text(`No stored result for query "${params.query}" in response ${params.responseId}.`);
				const r = stored.response;
				const lines = [`Query: ${stored.query}`, "", "Answer:", r.answer, "", "Sources:"];
				for (const s of r.results) lines.push(`- [${s.title}](${s.url})\n  ${s.snippet}`);
				return text(lines.join("\n"));
			}
			if (params.url) {
				const stored = storedResults.get(`${params.responseId}:${params.url}`);
				if (!stored?.content) return text(`No stored content for URL "${params.url}" in response ${params.responseId}.`);
				return text(`URL: ${stored.content.url}\nTitle: ${stored.content.title ?? "(none)"}\n\n${stored.content.content}`);
			}
			const matching = [...storedResults.entries()].filter(([k]) => k.startsWith(`${params.responseId}:`));
			if (matching.length === 0) return text(`No stored results for response ${params.responseId}.`);
			const lines = [`Stored items for response ${params.responseId}:`];
			for (const [k, v] of matching) {
				const sub = k.slice(params.responseId.length + 1);
				lines.push(`- ${v.query ? `query: "${sub}"` : `url: ${sub}`}`);
			}
			return text(lines.join("\n"));
		},
	});

	pi.on("session_shutdown", async () => { storedResults.clear(); });
}
