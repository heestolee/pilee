import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { platform } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { startCuratorServer, type CuratorServerHandle } from "./curator-server.js";
import { buildDeterministicSummary, generateSummaryDraft, rewriteSearchQuery } from "./summary-review.js";
import type { QueryResultData, SummaryMeta } from "./types.js";

const CURATOR_TIMEOUT_SECONDS = 10 * 60;
const DEFAULT_PROVIDER = "tavily";

export interface CuratorResult {
	status: "approved" | "raw" | "cancelled" | "timeout" | "stale";
	selected: number[];
	selectedResults?: QueryResultData[];
	summary?: string;
	summaryMeta?: SummaryMeta;
}

interface GlimpseWindow {
	on(event: "closed", handler: () => void): void;
	on(event: "message", handler: (data: unknown) => void): void;
	on(event: "ready", handler: (info: { screen?: { visibleHeight?: number } }) => void): void;
	close(): void;
	_write(obj: Record<string, unknown>): void;
}

let glimpseOpen: ((html: string, opts: Record<string, unknown>) => GlimpseWindow) | null | undefined;

function extractDomain(url: string): string {
	try {
		return new URL(url).hostname;
	} catch {
		return url;
	}
}

function toServerResult(result: QueryResultData): {
	answer: string;
	results: Array<{ title: string; url: string; domain: string }>;
	provider: string;
} {
	return {
		answer: result.answer,
		results: result.results.map((source) => ({ title: source.title, url: source.url, domain: extractDomain(source.url) })),
		provider: result.provider || DEFAULT_PROVIDER,
	};
}

function selectedResults(resultsByIndex: Map<number, QueryResultData>, indices: number[]): QueryResultData[] {
	return indices.map((index) => resultsByIndex.get(index)).filter((result): result is QueryResultData => !!result);
}

function allCompletedResults(resultsByIndex: Map<number, QueryResultData>): QueryResultData[] {
	return [...resultsByIndex.entries()]
		.sort(([left], [right]) => left - right)
		.map(([, result]) => result);
}

function defaultSummaryModels(): Array<{ value: string; label: string }> {
	return [
		{ value: "openai-codex/gpt-5.4", label: "Codex GPT-5.4" },
		{ value: "openai-codex/gpt-5.5", label: "Codex GPT-5.5" },
	];
}

function findGlimpseMjs(): string | null {
	try {
		const req = createRequire(import.meta.url);
		return req.resolve("glimpseui");
	} catch {}
	try {
		const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim();
		const entry = join(globalRoot, "glimpseui", "src", "glimpse.mjs");
		if (existsSync(entry)) return entry;
	} catch {}
	return null;
}

async function getGlimpseOpen() {
	if (glimpseOpen !== undefined) return glimpseOpen;
	const resolved = findGlimpseMjs();
	if (resolved) {
		try {
			glimpseOpen = (await import(resolved)).open;
			return glimpseOpen;
		} catch {}
	}
	glimpseOpen = null;
	return glimpseOpen;
}

function openInGlimpse(open: (html: string, opts: Record<string, unknown>) => GlimpseWindow, url: string): GlimpseWindow {
	const shellHTML = `<!doctype html><html><head><meta charset="utf-8"><title>Search Curator</title></head><body style="margin:0;background:#111"><script>window.location.replace(${JSON.stringify(url)});</script></body></html>`;
	const win = open(shellHTML, { width: 860, height: 900, title: "Search Curator", openLinks: true });
	let maxHeight = 1200;
	win.on("ready", (info) => {
		const visibleHeight = info?.screen?.visibleHeight;
		if (typeof visibleHeight === "number" && visibleHeight > 0) maxHeight = Math.floor(visibleHeight * 0.85);
	});
	win.on("message", (data) => {
		if (!data || typeof data !== "object") return;
		const msg = data as Record<string, unknown>;
		if (msg.type !== "resize" || typeof msg.height !== "number") return;
		win._write({ type: "resize", width: 860, height: Math.max(500, Math.min(Math.round(msg.height), maxHeight)) });
	});
	return win;
}

async function openInBrowser(pi: ExtensionAPI, url: string): Promise<void> {
	const plat = platform();
	const result = plat === "darwin"
		? await pi.exec("open", [url])
		: plat === "win32"
			? await pi.exec("cmd", ["/c", "start", "", url])
			: await pi.exec("xdg-open", [url]);
	if (result.code !== 0) throw new Error(result.stderr || `Failed to open browser (${result.code})`);
}

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
	const activeSignals = signals.filter((signal): signal is AbortSignal => !!signal);
	if (activeSignals.length === 0) return undefined;
	if (activeSignals.length === 1) return activeSignals[0];
	if (typeof AbortSignal.any === "function") return AbortSignal.any(activeSignals);
	const controller = new AbortController();
	for (const signal of activeSignals) {
		if (signal.aborted) {
			controller.abort();
			break;
		}
		signal.addEventListener("abort", () => controller.abort(), { once: true });
	}
	return controller.signal;
}

export async function runCuratedSearchReview(args: {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	queries: string[];
	signal?: AbortSignal;
	onSearch: (query: string, signal?: AbortSignal) => Promise<QueryResultData>;
	onUpdate?: (message: string) => void | Promise<void>;
}): Promise<CuratorResult> {
	const sessionToken = randomUUID();
	const searchAbort = new AbortController();
	const resultsByIndex = new Map<number, QueryResultData>();
	let completed = false;
	let handle: CuratorServerHandle | null = null;
	let glimpseWin: GlimpseWindow | null = null;
	let resolveResult: (value: CuratorResult) => void = () => {};
	const resultPromise = new Promise<CuratorResult>((resolve) => {
		resolveResult = resolve;
	});

	const finish = (value: CuratorResult) => {
		if (completed) return;
		completed = true;
		searchAbort.abort();
		resolveResult(value);
	};

	const summarizeSelected = async (
		selected: number[],
		signal: AbortSignal,
		model?: string,
		feedback?: string,
	): Promise<{ summary: string; meta: SummaryMeta }> => {
		const picked = selectedResults(resultsByIndex, selected);
		try {
			return await generateSummaryDraft(picked, args.ctx, signal, model, feedback);
		} catch (err) {
			const fallback = buildDeterministicSummary(picked);
			fallback.meta.fallbackReason = err instanceof Error ? err.message : "summary-generation-failed";
			return fallback;
		}
	};

	const runSearchIntoIndex = async (query: string, queryIndex: number, pushToClient: boolean): Promise<QueryResultData> => {
		const combinedSignal = combineSignals([args.signal, searchAbort.signal]);
		const result = await args.onSearch(query, combinedSignal);
		if (completed) return result;
		resultsByIndex.set(queryIndex, result);
		if (pushToClient && handle) {
			if (result.error) handle.pushError(queryIndex, result.error, result.provider);
			else handle.pushResult(queryIndex, toServerResult(result));
		}
		return result;
	};

	try {
		handle = await startCuratorServer(
			{
				queries: args.queries,
				sessionToken,
				timeout: CURATOR_TIMEOUT_SECONDS,
				availableProviders: { tavily: true },
				defaultProvider: DEFAULT_PROVIDER,
				summaryModels: defaultSummaryModels(),
				defaultSummaryModel: "openai-codex/gpt-5.4",
			},
			{
				onSubmit(payload) {
					const picked = selectedResults(resultsByIndex, payload.selectedQueryIndices);
					finish({
						status: payload.rawResults ? "raw" : "approved",
						selected: payload.selectedQueryIndices,
						selectedResults: picked,
						summary: payload.summary,
						summaryMeta: payload.summaryMeta,
					});
				},
				onCancel(reason) {
					finish({
						status: reason === "timeout" ? "timeout" : reason === "stale" ? "stale" : "cancelled",
						selected: [],
						selectedResults: allCompletedResults(resultsByIndex),
					});
				},
				onProviderChange() {},
				async onAddSearch(query, queryIndex) {
					const result = await runSearchIntoIndex(query, queryIndex, false);
					if (result.error) throw new Error(result.error);
					return toServerResult(result);
				},
				onSummarize: summarizeSelected,
				onRewriteQuery(query, rewriteSignal) {
					return rewriteSearchQuery(query, args.ctx, combineSignals([args.signal, rewriteSignal]));
				},
			},
		);

		if (args.signal?.aborted) {
			finish({ status: "cancelled", selected: [], selectedResults: [] });
			return await resultPromise;
		}
		args.signal?.addEventListener(
			"abort",
			() => {
				finish({ status: "cancelled", selected: [], selectedResults: allCompletedResults(resultsByIndex) });
				handle?.close();
			},
			{ once: true },
		);

		if (platform() === "darwin") {
			const open = await getGlimpseOpen();
			if (open) {
				try {
					glimpseWin = openInGlimpse(open, handle.url);
					glimpseWin.on("closed", () => handle?.close());
					await args.onUpdate?.("Opened Tavily search curator in Glimpse. Searches are streaming in.");
				} catch (err) {
					await openInBrowser(args.pi, handle.url);
					const reason = err instanceof Error ? err.message : String(err);
					await args.onUpdate?.(`Glimpse unavailable (${reason}); opened Tavily search curator in browser.`);
				}
			} else {
				await openInBrowser(args.pi, handle.url);
				await args.onUpdate?.("Opened Tavily search curator in browser. Searches are streaming in.");
			}
		} else {
			await openInBrowser(args.pi, handle.url);
			await args.onUpdate?.("Opened Tavily search curator in browser. Searches are streaming in.");
		}

		void Promise.allSettled(
			args.queries.map(async (query, index) => {
				try {
					await runSearchIntoIndex(query, index, true);
				} catch (err) {
					const message = err instanceof Error ? err.message : String(err);
					resultsByIndex.set(index, { query, answer: "", results: [], error: message, provider: DEFAULT_PROVIDER });
					handle?.pushError(index, message, DEFAULT_PROVIDER);
				}
			}),
		).then(() => {
			if (!completed) handle?.searchesDone();
		});

		return await resultPromise;
	} finally {
		try { glimpseWin?.close(); } catch {}
		try { handle?.close(); } catch {}
	}
}
