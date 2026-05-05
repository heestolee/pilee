import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { runCuratedSearchReview } from "./curator.js";
import type { ExtractedContent, QueryResultData, SearchResponse, SearchResult } from "./types.js";

const TAVILY_SEARCH = "https://api.tavily.com/search";
const FETCH_TIMEOUT_MS = 30000;
const CONFIG_PATH = join(homedir(), ".pi", "web-search.json");

type SearchWorkflow = "none" | "summary-review";

interface Config {
	tavilyApiKey?: string;
	workflow?: SearchWorkflow;
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

function loadConfig(): Config {
	if (!existsSync(CONFIG_PATH)) return {};
	try { return JSON.parse(readFileSync(CONFIG_PATH, "utf8")); } catch { return {}; }
}

function getApiKey(envName: string, configKey?: string): string | undefined {
	return configKey || process.env[envName];
}

function text(msg: string, details?: any) {
	return { content: [{ type: "text" as const, text: msg }], details };
}

function normalizeWorkflow(value: unknown, fallback: SearchWorkflow): SearchWorkflow {
	return value === "summary-review" || value === "none" ? value : fallback;
}

function withKoreanAnswerInstruction(query: string): string {
	const trimmed = query.trim();
	if (/한국어|한글|korean/i.test(trimmed)) return trimmed;
	return `${trimmed}\n\n한국어로 답변하고, 설명은 항상 한국어로 작성해 주세요.`;
}

function queryResultFromSearch(query: string, response: SearchResponse): QueryResultData {
	return { query, answer: response.answer, results: response.results, error: null, provider: "tavily" };
}

function queryResultFromError(query: string, error: unknown): QueryResultData {
	return {
		query,
		answer: "",
		results: [],
		error: error instanceof Error ? error.message : String(error),
		provider: "tavily",
	};
}

function formatQueryResults(queryResults: QueryResultData[]): string {
	const sections: string[] = [];
	for (const result of queryResults) {
		if (result.error) {
			sections.push(`### ${result.query}\n(오류: ${result.error})`);
			continue;
		}
		sections.push(`### ${result.query}`);
		if (result.answer) sections.push(result.answer);
		if (result.results.length > 0) {
			sections.push("\n**출처:**");
			for (const r of result.results) {
				sections.push(`- [${r.title}](${r.url})`);
			}
		}
	}
	return sections.join("\n\n");
}

function flattenSources(queryResults: QueryResultData[]): SearchResult[] {
	return queryResults.flatMap((result) => result.results);
}

async function searchTavily(
	query: string,
	options: { numResults?: number; recencyFilter?: string; signal?: AbortSignal },
	apiKey: string,
): Promise<SearchResponse> {
	const body: any = {
		api_key: apiKey,
		query: withKoreanAnswerInstruction(query),
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
		description: "Search the web using Tavily. With workflow='summary-review' in interactive Pi, opens a curator/preview modal before returning the approved summary.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Single search query." })),
			queries: Type.Optional(Type.Array(Type.String(), { description: "Multiple queries searched in sequence, each returning its own synthesized answer." })),
			numResults: Type.Optional(Type.Number({ description: "Results per query (default: 5, max: 20)" })),
			recencyFilter: Type.Optional(Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month"), Type.Literal("year")])),
			includeContent: Type.Optional(Type.Boolean({ description: "Fetch full page content for each result" })),
			workflow: Type.Optional(Type.Union([Type.Literal("none"), Type.Literal("summary-review")], { description: "Interactive workflow. Default: config.workflow or 'none'." })),
		}),
		async execute(_id, params, signal, onUpdate, ctx) {
			const config = loadConfig();
			const queries = params.queries ?? (params.query ? [params.query] : []);
			if (queries.length === 0) return text("Provide either query or queries[].");

			const apiKey = getApiKey("TAVILY_API_KEY", config.tavilyApiKey);
			if (!apiKey) return text("Tavily API key not found. Configure ~/.pi/web-search.json or set TAVILY_API_KEY env var.");

			const numResults = Math.min(params.numResults ?? 5, 20);
			const responseId = randomUUID().slice(0, 8);

			const executeSearch = async (q: string, searchSignal: AbortSignal | undefined = signal): Promise<QueryResultData> => {
				try {
					const response = await searchTavily(q, { numResults, recencyFilter: params.recencyFilter, signal: searchSignal }, apiKey);
					storedResults.set(`${responseId}:${q}`, { id: responseId, query: q, timestamp: Date.now(), response });
					return queryResultFromSearch(q, response);
				} catch (error) {
					return queryResultFromError(q, error);
				}
			};

			const workflow = normalizeWorkflow(params.workflow, config.workflow ?? "none");
			if (workflow === "summary-review" && ctx?.hasUI) {
				const curated = await runCuratedSearchReview({
					pi,
					ctx,
					queries,
					signal,
					onSearch: executeSearch,
					onUpdate: (message) => onUpdate?.(text(message)),
				});

				if (curated.status === "approved" && curated.summary) {
					return text(curated.summary, {
						responseId,
						provider: "tavily",
						workflow,
						summaryMeta: curated.summaryMeta,
						selectedCount: curated.selected.length,
					});
				}

				if (curated.status === "raw") {
					const selected = curated.selectedResults ?? [];
					return text(formatQueryResults(selected), {
						responseId,
						totalResults: flattenSources(selected).length,
						provider: "tavily",
						workflow,
						selectedCount: selected.length,
					});
				}

				const completedResults = curated.selectedResults ?? [];
				return text(`Curator ${curated.status}; 완료된 Tavily 결과를 반환합니다.\n\n${formatQueryResults(completedResults)}`, {
					responseId,
					totalResults: flattenSources(completedResults).length,
					provider: "tavily",
					workflow,
				});
			}

			const queryResults: QueryResultData[] = [];
			for (const q of queries) queryResults.push(await executeSearch(q));
			return text(formatQueryResults(queryResults), { responseId, totalResults: flattenSources(queryResults).length, provider: "tavily", workflow: "none" });
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
