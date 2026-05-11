import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
const WEB_ACCESS_ARCHIVE_DIR = join(homedir(), "Documents", "agent-history", "web-search");
const WEB_SEARCH_SIGNATURE = "Web Search Review";
const DIGEST_PREVIEW_CHARS = 520;

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
	artifactPath?: string;
	rawJsonPath?: string;
	fullMarkdownPath?: string;
}

interface WebAccessArtifactRef {
	path: string;
	rawJsonPath: string;
	fullMarkdownPath: string;
	openCommand: string;
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

function truncateText(value: string | undefined, maxChars = DIGEST_PREVIEW_CHARS): string {
	const text = (value ?? "").replace(/\s+/g, " ").trim();
	if (text.length <= maxChars) return text;
	return `${text.slice(0, maxChars - 1).trim()}…`;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/https?:\/\//g, "")
		.replace(/[^a-z0-9가-힣_-]+/gi, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 72) || "web-access";
}

function quoteArchivePath(filePath: string): string {
	return `/archive "${filePath.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function renderPlainMarkdownHtml(markdown: string): string {
	return `<pre>${escapeHtml(markdown)}</pre>`;
}

function buildArtifactHtml(args: {
	title: string;
	kind: "web_search" | "fetch_content";
	responseId: string;
	workflow?: string;
	queries?: string[];
	urls?: string[];
	digest: string;
	fullText: string;
	createdAt: Date;
}): string {
	const items = args.queries?.length ? args.queries : args.urls ?? [];
	return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${WEB_SEARCH_SIGNATURE} — ${escapeHtml(args.title)}</title>
<style>
	:root { color-scheme: light dark; --bg:#111827; --panel:#1f2937; --panel2:#0f172a; --text:#f9fafb; --muted:#9ca3af; --line:#374151; --accent:#60a5fa; }
	body { margin:0; padding:28px; background:var(--bg); color:var(--text); font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
	main { max-width:1080px; margin:0 auto; }
	header { border-bottom:1px solid var(--line); margin-bottom:24px; padding-bottom:18px; }
	h1 { margin:0 0 8px; font-size:28px; }
	.meta { display:flex; flex-wrap:wrap; gap:8px; color:var(--muted); font-size:13px; }
	.badge { border:1px solid var(--line); border-radius:999px; padding:4px 9px; background:rgba(255,255,255,.04); }
	section { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:20px; margin-bottom:18px; }
	a { color:var(--accent); }
	pre { white-space:pre-wrap; overflow:auto; background:var(--panel2); border:1px solid var(--line); border-radius:12px; padding:16px; line-height:1.55; }
	li { margin:7px 0; }
	details summary { cursor:pointer; color:var(--accent); font-weight:700; }
</style>
</head>
<body>
<main>
<header>
	<h1>${WEB_SEARCH_SIGNATURE}</h1>
	<div class="meta">
		<span class="badge">${escapeHtml(args.createdAt.toLocaleString())}</span>
		<span class="badge">kind=${escapeHtml(args.kind)}</span>
		<span class="badge">responseId=${escapeHtml(args.responseId)}</span>
		${args.workflow ? `<span class="badge">workflow=${escapeHtml(args.workflow)}</span>` : ""}
	</div>
</header>
<section>
	<h2>${args.queries?.length ? "Queries" : "URLs"}</h2>
	<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("\n")}</ul>
</section>
<section>
	<h2>Digest returned to Pi</h2>
	${renderPlainMarkdownHtml(args.digest)}
</section>
<section>
	<details open>
		<summary>Full stored content / raw-readable text</summary>
		${renderPlainMarkdownHtml(args.fullText)}
	</details>
</section>
</main>
</body>
</html>`;
}

function writeWebAccessArtifact(args: {
	responseId: string;
	kind: "web_search" | "fetch_content";
	title: string;
	queries?: string[];
	urls?: string[];
	workflow?: string;
	digest: string;
	fullText: string;
	rawData: unknown;
}): WebAccessArtifactRef | undefined {
	try {
		const createdAt = new Date();
		const timestamp = createdAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const safeSlug = slugify(args.title || args.responseId);
		const baseName = `${timestamp}_${args.responseId}_${safeSlug}`;
		const rawDir = join(WEB_ACCESS_ARCHIVE_DIR, `${baseName}.raw`);
		mkdirSync(rawDir, { recursive: true });
		mkdirSync(WEB_ACCESS_ARCHIVE_DIR, { recursive: true });
		const rawJsonPath = join(rawDir, "raw.json");
		const fullMarkdownPath = join(rawDir, "full.md");
		const htmlPath = join(WEB_ACCESS_ARCHIVE_DIR, `${baseName}.html`);
		writeFileSync(rawJsonPath, `${JSON.stringify(args.rawData, null, 2)}\n`, "utf8");
		writeFileSync(fullMarkdownPath, args.fullText.endsWith("\n") ? args.fullText : `${args.fullText}\n`, "utf8");
		writeFileSync(htmlPath, buildArtifactHtml({ ...args, createdAt }), "utf8");
		return { path: htmlPath, rawJsonPath, fullMarkdownPath, openCommand: quoteArchivePath(htmlPath) };
	} catch {
		return undefined;
	}
}

function artifactLines(artifact: WebAccessArtifactRef | undefined): string[] {
	if (!artifact) return ["원문 artifact 저장 실패: 메모리 저장 결과는 이번 세션의 get_search_content로만 조회할 수 있습니다."];
	return [
		`원문 artifact: ${artifact.openCommand}`,
		`raw json: ${artifact.rawJsonPath}`,
		`full markdown: ${artifact.fullMarkdownPath}`,
	];
}

function attachArtifact(responseId: string, artifact: WebAccessArtifactRef | undefined): void {
	if (!artifact) return;
	for (const [key, value] of storedResults.entries()) {
		if (!key.startsWith(`${responseId}:`)) continue;
		storedResults.set(key, { ...value, artifactPath: artifact.path, rawJsonPath: artifact.rawJsonPath, fullMarkdownPath: artifact.fullMarkdownPath });
	}
}

function formatQueryDigest(queryResults: QueryResultData[], responseId: string, artifact?: WebAccessArtifactRef): string {
	const lines: string[] = ["🔎 웹 검색 완료 — digest-first", `responseId: ${responseId}`, ""];
	for (const result of queryResults) {
		lines.push(`### ${result.query}`);
		if (result.error) {
			lines.push(`- 오류: ${result.error}`, "");
			continue;
		}
		const preview = truncateText(result.answer);
		if (preview) lines.push(`- 요약: ${preview}`);
		else lines.push(`- 요약: Tavily answer 없이 출처 ${result.results.length}개가 반환되었습니다.`);
		const sources = result.results.slice(0, 6);
		if (sources.length > 0) {
			lines.push("- 출처:");
			for (const source of sources) lines.push(`  - ${source.title} — ${source.url}`);
			if (result.results.length > sources.length) lines.push(`  - … 외 ${result.results.length - sources.length}개`);
		}
		lines.push("");
	}
	lines.push("원문/스니펫은 대화 context에 넣지 않고 artifact로 저장했습니다.");
	lines.push(...artifactLines(artifact));
	lines.push(`필요 시: get_search_content(responseId="${responseId}", query="...")`);
	return lines.join("\n").trim();
}

function formatFetchDigest(results: ExtractedContent[], responseId: string, artifact?: WebAccessArtifactRef): string {
	const lines: string[] = ["📄 URL fetch 완료 — digest-first", `responseId: ${responseId}`, ""];
	for (const result of results) {
		const content = result.content ?? "";
		const isError = content.startsWith("(fetch error:");
		lines.push(`### ${result.title ?? result.url}`);
		lines.push(`- URL: ${result.url}`);
		lines.push(`- 상태: ${isError ? content : `readable markdown ${content.length.toLocaleString()} chars 저장됨`}`);
		if (!isError) lines.push(`- 미리보기: ${truncateText(content, 360) || "(본문 없음)"}`);
		lines.push("");
	}
	lines.push("전체 본문은 대화 context에 넣지 않고 artifact로 저장했습니다.");
	lines.push(...artifactLines(artifact));
	lines.push(`필요 시: get_search_content(responseId="${responseId}", url="...")`);
	return lines.join("\n").trim();
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
					const selected = curated.selectedResults ?? [];
					const fullText = [curated.summary, "", "---", "", formatQueryResults(selected)].join("\n");
					const artifact = writeWebAccessArtifact({
						responseId,
						kind: "web_search",
						title: queries.join(" ") || responseId,
						queries,
						workflow,
						digest: curated.summary,
						fullText,
						rawData: { status: curated.status, selected: curated.selected, summaryMeta: curated.summaryMeta, results: selected },
					});
					attachArtifact(responseId, artifact);
					const summaryWithArtifact = `${curated.summary}\n\n---\n${artifactLines(artifact).join("\n")}\n필요 시: get_search_content(responseId="${responseId}", query="...")`;
					return text(summaryWithArtifact, {
						responseId,
						provider: "tavily",
						workflow,
						summaryMeta: curated.summaryMeta,
						selectedCount: curated.selected.length,
						artifactPath: artifact?.path,
						rawJsonPath: artifact?.rawJsonPath,
						fullMarkdownPath: artifact?.fullMarkdownPath,
					});
				}

				if (curated.status === "raw") {
					const selected = curated.selectedResults ?? [];
					const digest = formatQueryDigest(selected, responseId);
					const artifact = writeWebAccessArtifact({
						responseId,
						kind: "web_search",
						title: queries.join(" ") || responseId,
						queries,
						workflow,
						digest,
						fullText: formatQueryResults(selected),
						rawData: { status: curated.status, selected: curated.selected, results: selected },
					});
					attachArtifact(responseId, artifact);
					return text(formatQueryDigest(selected, responseId, artifact), {
						responseId,
						totalResults: flattenSources(selected).length,
						provider: "tavily",
						workflow,
						selectedCount: selected.length,
						artifactPath: artifact?.path,
						rawJsonPath: artifact?.rawJsonPath,
						fullMarkdownPath: artifact?.fullMarkdownPath,
					});
				}

				const completedResults = curated.selectedResults ?? [];
				const digest = `Curator ${curated.status}; 완료된 Tavily 결과 digest입니다.\n\n${formatQueryDigest(completedResults, responseId)}`;
				const artifact = writeWebAccessArtifact({
					responseId,
					kind: "web_search",
					title: queries.join(" ") || responseId,
					queries,
					workflow,
					digest,
					fullText: formatQueryResults(completedResults),
					rawData: { status: curated.status, results: completedResults },
				});
				attachArtifact(responseId, artifact);
				return text(`Curator ${curated.status}; 완료된 Tavily 결과 digest를 반환합니다.\n\n${formatQueryDigest(completedResults, responseId, artifact)}`, {
					responseId,
					totalResults: flattenSources(completedResults).length,
					provider: "tavily",
					workflow,
					artifactPath: artifact?.path,
					rawJsonPath: artifact?.rawJsonPath,
					fullMarkdownPath: artifact?.fullMarkdownPath,
				});
			}

			const queryResults: QueryResultData[] = [];
			for (const q of queries) queryResults.push(await executeSearch(q));
			const digest = formatQueryDigest(queryResults, responseId);
			const artifact = writeWebAccessArtifact({
				responseId,
				kind: "web_search",
				title: queries.join(" ") || responseId,
				queries,
				workflow: "none",
				digest,
				fullText: formatQueryResults(queryResults),
				rawData: { results: queryResults },
			});
			attachArtifact(responseId, artifact);
			return text(formatQueryDigest(queryResults, responseId, artifact), {
				responseId,
				totalResults: flattenSources(queryResults).length,
				provider: "tavily",
				workflow: "none",
				artifactPath: artifact?.path,
				rawJsonPath: artifact?.rawJsonPath,
				fullMarkdownPath: artifact?.fullMarkdownPath,
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
			for (const r of results) {
				storedResults.set(`${responseId}:${r.url}`, { id: responseId, url: r.url, timestamp: Date.now(), content: r });
				sections.push(`## ${r.title ?? r.url}\nURL: ${r.url}\n\n${r.content}`);
			}
			const digest = formatFetchDigest(results, responseId);
			const artifact = writeWebAccessArtifact({
				responseId,
				kind: "fetch_content",
				title: urls.join(" ") || responseId,
				urls,
				digest,
				fullText: sections.join("\n\n---\n\n"),
				rawData: { results },
			});
			attachArtifact(responseId, artifact);
			return text(formatFetchDigest(results, responseId, artifact), {
				responseId,
				urlCount: urls.length,
				artifactPath: artifact?.path,
				rawJsonPath: artifact?.rawJsonPath,
				fullMarkdownPath: artifact?.fullMarkdownPath,
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
