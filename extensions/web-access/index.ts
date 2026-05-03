import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";

const PERPLEXITY_API = "https://api.perplexity.ai/chat/completions";
const EXA_SEARCH = "https://api.exa.ai/search";
const EXA_ANSWER = "https://api.exa.ai/answer";
const TAVILY_SEARCH = "https://api.tavily.com/search";
const FETCH_TIMEOUT_MS = 30000;
const MIN_USEFUL_CONTENT = 500;
const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

interface Config {
	provider?: "auto" | "perplexity" | "exa" | "gemini" | "tavily";
	perplexityApiKey?: string;
	exaApiKey?: string;
	geminiApiKey?: string;
	tavilyApiKey?: string;
}

function loadConfig(): Config {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
	} catch {
		return {};
	}
}

function getApiKey(name: string, configKey: string | undefined): string | undefined {
	if (configKey) return configKey;
	return process.env[name];
}

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

interface SearchResponse {
	answer: string;
	results: SearchResult[];
	provider: string;
}

interface ExtractedContent {
	url: string;
	title?: string;
	content: string;
	contentType?: string;
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

async function searchPerplexity(query: string, options: { numResults?: number; recencyFilter?: string; signal?: AbortSignal }, apiKey: string): Promise<SearchResponse> {
	const body = {
		model: "sonar",
		messages: [{ role: "user", content: query }],
		return_related_questions: false,
		...(options.recencyFilter ? { search_recency_filter: options.recencyFilter } : {}),
	};

	const response = await fetch(PERPLEXITY_API, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
		signal: options.signal,
	});

	if (!response.ok) {
		const txt = await response.text().catch(() => "");
		throw new Error(`Perplexity ${response.status}: ${txt.slice(0, 200)}`);
	}

	const data = await response.json() as any;
	const answer = data.choices?.[0]?.message?.content ?? "";
	const citations = data.citations ?? [];
	const searchResults = data.search_results ?? [];

	const results: SearchResult[] = searchResults.length > 0
		? searchResults.slice(0, options.numResults ?? 10).map((r: any) => ({
			title: r.title ?? r.url,
			url: r.url,
			snippet: r.snippet ?? r.text ?? "",
		}))
		: citations.slice(0, options.numResults ?? 10).map((url: string) => ({ title: url, url, snippet: "" }));

	return { answer, results, provider: "perplexity" };
}

async function searchExa(query: string, options: { numResults?: number; signal?: AbortSignal }, apiKey: string): Promise<SearchResponse> {
	const numResults = options.numResults ?? 10;

	// Try answer endpoint first
	try {
		const response = await fetch(EXA_ANSWER, {
			method: "POST",
			headers: { "Content-Type": "application/json", "x-api-key": apiKey },
			body: JSON.stringify({ query, stream: false }),
			signal: options.signal,
		});
		if (response.ok) {
			const data = await response.json() as any;
			const results = (data.citations ?? []).slice(0, numResults).map((c: any) => ({
				title: c.title ?? c.url,
				url: c.url,
				snippet: c.snippet ?? c.text ?? "",
			}));
			return { answer: data.answer ?? "", results, provider: "exa" };
		}
	} catch {}

	// Fallback to search endpoint
	const response = await fetch(EXA_SEARCH, {
		method: "POST",
		headers: { "Content-Type": "application/json", "x-api-key": apiKey },
		body: JSON.stringify({ query, numResults, contents: { text: { maxCharacters: 1000 } } }),
		signal: options.signal,
	});
	if (!response.ok) throw new Error(`Exa ${response.status}`);
	const data = await response.json() as any;
	const results = (data.results ?? []).map((r: any) => ({
		title: r.title ?? r.url,
		url: r.url,
		snippet: r.text ?? r.snippet ?? "",
	}));
	return { answer: "", results, provider: "exa" };
}

async function searchTavily(query: string, options: { numResults?: number; recencyFilter?: string; signal?: AbortSignal }, apiKey: string): Promise<SearchResponse> {
	const body: any = {
		api_key: apiKey,
		query,
		max_results: options.numResults ?? 10,
		include_answer: true,
		...(options.recencyFilter ? { days: options.recencyFilter === "day" ? 1 : options.recencyFilter === "week" ? 7 : options.recencyFilter === "month" ? 30 : 365 } : {}),
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
	return { answer: data.answer ?? "", results, provider: "tavily" };
}

async function fetchHtml(url: string, signal?: AbortSignal): Promise<{ html: string; contentType: string }> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	const sig = signal ?? controller.signal;

	try {
		const response = await fetch(url, {
			signal: sig,
			headers: {
				"User-Agent": "Mozilla/5.0 (compatible; pi-web-access/0.1)",
				Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
			},
			redirect: "follow",
		});

		if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);

		const contentType = response.headers.get("content-type") ?? "";
		const html = await response.text();
		return { html, contentType };
	} finally {
		clearTimeout(timeout);
	}
}

function htmlToMarkdown(html: string, url: string): { title: string; content: string } {
	const { document } = parseHTML(html);
	try {
		const reader = new Readability(document as any);
		const article = reader.parse();
		if (article && article.content) {
			const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
			const md = td.turndown(article.content);
			return { title: article.title || url, content: md };
		}
	} catch {}

	// Fallback: just turndown the body
	const body = document.body?.innerHTML ?? html;
	const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
	const md = td.turndown(body);
	const title = document.querySelector("title")?.textContent ?? url;
	return { title, content: md };
}

async function extractContent(url: string, signal?: AbortSignal): Promise<ExtractedContent> {
	try {
		const { html, contentType } = await fetchHtml(url, signal);

		if (contentType.includes("application/json")) {
			return { url, content: html, contentType };
		}

		if (!contentType.includes("html") && !contentType.includes("xml")) {
			return { url, content: `(unsupported content type: ${contentType})`, contentType };
		}

		const { title, content } = htmlToMarkdown(html, url);
		return { url, title, content, contentType };
	} catch (e) {
		return { url, content: `(fetch error: ${e instanceof Error ? e.message : e})` };
	}
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web using Perplexity AI or Exa. Returns an AI-synthesized answer with source citations. Prefer queries (plural) with 2-4 varied angles over a single query for broader coverage.",
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

			const provider = params.provider ?? config.provider ?? "auto";
			const perplexityKey = getApiKey("PERPLEXITY_API_KEY", config.perplexityApiKey);
			const exaKey = getApiKey("EXA_API_KEY", config.exaApiKey);
			const tavilyKey = getApiKey("TAVILY_API_KEY", config.tavilyApiKey);

			let useProvider: "perplexity" | "exa" | "tavily" | null = null;
			if (provider === "perplexity" && perplexityKey) useProvider = "perplexity";
			else if (provider === "exa" && exaKey) useProvider = "exa";
			else if (provider === "tavily" && tavilyKey) useProvider = "tavily";
			else if (provider === "auto") {
				if (tavilyKey) useProvider = "tavily";
				else if (perplexityKey) useProvider = "perplexity";
				else if (exaKey) useProvider = "exa";
			}

			if (!useProvider) {
				return text("No search provider available. Set TAVILY_API_KEY, PERPLEXITY_API_KEY, or EXA_API_KEY env var, or configure ~/.pi/web-search.json.");
			}

			const numResults = Math.min(params.numResults ?? 5, 20);
			const sections: string[] = [];
			const totalResults: SearchResult[] = [];
			const responseId = randomUUID().slice(0, 8);

			for (const q of queries) {
				try {
					const result = useProvider === "perplexity"
						? await searchPerplexity(q, { numResults, recencyFilter: params.recencyFilter, signal }, perplexityKey!)
						: useProvider === "tavily"
						? await searchTavily(q, { numResults, recencyFilter: params.recencyFilter, signal }, tavilyKey!)
						: await searchExa(q, { numResults, signal }, exaKey!);

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

			const output = sections.join("\n\n");
			return text(output, {
				responseId,
				totalResults: totalResults.length,
				provider: useProvider,
			});
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
			let successful = 0;
			let totalChars = 0;
			for (const r of results) {
				storedResults.set(`${responseId}:${r.url}`, { id: responseId, url: r.url, timestamp: Date.now(), content: r });
				sections.push(`## ${r.title ?? r.url}\nURL: ${r.url}\n\n${r.content}`);
				if (r.content && !r.content.startsWith("(")) {
					successful++;
					totalChars += r.content.length;
				}
			}

			return text(sections.join("\n\n---\n\n"), {
				responseId,
				urlCount: urls.length,
				successful,
				totalChars,
			});
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

			// List all stored items for this response
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

	// Cleanup old stored results (>1 hour old) periodically
	pi.on("session_shutdown", async () => {
		storedResults.clear();
	});
}
