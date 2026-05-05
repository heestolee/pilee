import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { platform } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { buildDeterministicSummary, generateSummaryDraft } from "./summary-review.js";
import type { QueryResultData, SummaryMeta } from "./types.js";

const MAX_BODY_SIZE = 128 * 1024;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

export interface CuratorResult {
	status: "approved" | "raw" | "cancelled" | "timeout";
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

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
	res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
	res.end(JSON.stringify(payload));
}

function parseJSONBody(req: IncomingMessage): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let body = "";
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > MAX_BODY_SIZE) {
				req.destroy();
				reject(new Error("Request body too large"));
				return;
			}
			body += chunk.toString();
		});
		req.on("end", () => {
			try { resolve(JSON.parse(body || "{}")); } catch (err) { reject(err); }
		});
		req.on("error", reject);
	});
}

function normalizeSelected(value: unknown, maxExclusive: number): number[] | null {
	if (!Array.isArray(value)) return null;
	const result: number[] = [];
	const seen = new Set<number>();
	for (const item of value) {
		if (typeof item !== "number" || !Number.isInteger(item) || item < 0 || item >= maxExclusive) return null;
		if (!seen.has(item)) {
			seen.add(item);
			result.push(item);
		}
	}
	return result;
}

function normalizeSummaryMeta(value: unknown): SummaryMeta | undefined {
	if (!value || typeof value !== "object") return undefined;
	const meta = value as Record<string, unknown>;
	if ((meta.model !== null && typeof meta.model !== "string") || typeof meta.durationMs !== "number" || typeof meta.tokenEstimate !== "number" || typeof meta.fallbackUsed !== "boolean") return undefined;
	return {
		model: meta.model as string | null,
		durationMs: meta.durationMs,
		tokenEstimate: meta.tokenEstimate,
		fallbackUsed: meta.fallbackUsed,
		fallbackReason: typeof meta.fallbackReason === "string" ? meta.fallbackReason : undefined,
		edited: typeof meta.edited === "boolean" ? meta.edited : undefined,
	};
}

function extractDomain(url: string): string {
	try { return new URL(url).hostname; } catch { return url; }
}

function resultForClient(result: QueryResultData, index: number) {
	return {
		index,
		query: result.query,
		answer: result.answer,
		error: result.error,
		provider: result.provider,
		results: result.results.map((r) => ({ title: r.title, url: r.url, snippet: r.snippet, domain: extractDomain(r.url) })),
	};
}

function generateCuratorHtml(data: { token: string; results: QueryResultData[]; summaryModels: Array<{ value: string; label: string }>; defaultSummaryModel: string | null; timeoutMs: number }): string {
	const inline = JSON.stringify({
		token: data.token,
		results: data.results.map(resultForClient),
		summaryModels: data.summaryModels,
		defaultSummaryModel: data.defaultSummaryModel,
		timeoutMs: data.timeoutMs,
	});
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Tavily Search Curator</title>
<style>
:root{--bg:#111217;--panel:#181a22;--panel2:#20232d;--fg:#f5f5f5;--muted:#a7adbb;--border:#343847;--accent:#7c9cff;--success:#48d17d;--danger:#ff6b7a}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:920px;margin:0 auto;padding:28px 24px 96px}.hero{margin-bottom:20px}.eyebrow{color:var(--accent);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.12em}.title{font-size:28px;font-weight:800;margin:6px 0}.desc{color:var(--muted);margin:0}.card{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px;margin:12px 0}.card-head{display:flex;gap:12px;align-items:flex-start}.check{margin-top:5px;transform:scale(1.15)}.query{font-weight:700}.answer{color:#d9ddea;white-space:pre-wrap;line-height:1.45;margin:10px 0}.source{font-size:13px;color:var(--muted);padding:6px 0;border-top:1px solid rgba(255,255,255,.06)}a{color:#9db5ff}.error{color:var(--danger)}.add{display:flex;gap:8px;margin:18px 0}.add input,.summary-input,.feedback,select{background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:10px;padding:10px}.add input{flex:1}.actions{position:fixed;left:0;right:0;bottom:0;background:rgba(17,18,23,.95);backdrop-filter:blur(8px);border-top:1px solid var(--border);padding:12px 24px;display:flex;gap:10px;justify-content:center}.btn{border:1px solid var(--border);background:var(--panel2);color:var(--fg);border-radius:10px;padding:10px 14px;cursor:pointer;font-weight:650}.btn:hover{border-color:var(--accent)}.btn.primary{background:var(--accent);border-color:var(--accent);color:#10121a}.btn.success{background:var(--success);border-color:var(--success);color:#0d1911}.btn:disabled{opacity:.45;cursor:not-allowed}.summary{display:none}.summary.visible{display:block}.summary-input{width:100%;height:220px;line-height:1.45}.feedback{width:100%;margin-top:8px}.summary-row{display:flex;gap:8px;align-items:center;margin:10px 0}.status{color:var(--muted);font-size:13px}.modal{position:fixed;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px;z-index:10}.modal.hidden{display:none}.modal-inner{width:min(840px,100%);max-height:90vh;background:var(--panel);border:1px solid var(--border);border-radius:16px;display:flex;flex-direction:column;overflow:hidden}.modal-head,.modal-foot{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:14px 16px;border-bottom:1px solid var(--border)}.modal-foot{border-top:1px solid var(--border);border-bottom:0}.modal-body{padding:18px;overflow:auto;line-height:1.55}.modal-body pre{background:#0d0e13;padding:12px;border-radius:10px;overflow:auto}.modal-body blockquote{border-left:3px solid var(--border);padding-left:12px;color:var(--muted)}.close{font-size:22px;line-height:1;background:transparent;border:0;color:var(--muted);cursor:pointer}.popover{position:absolute;background:#0e1016;border:1px solid var(--border);border-radius:12px;padding:10px;width:280px;box-shadow:0 12px 40px rgba(0,0,0,.35);z-index:11}.popover.hidden{display:none}.popover textarea{width:100%;background:var(--panel2);color:var(--fg);border:1px solid var(--border);border-radius:8px;padding:8px}.quote{font-size:12px;color:var(--muted);margin-bottom:6px}
</style>
</head>
<body>
<main>
  <section class="hero"><div class="eyebrow">Tavily Search Curator</div><h1 class="title">Review search results</h1><p class="desc">Select the results to keep, generate a summary draft, preview it, then approve.</p><p class="status" id="status"></p></section>
  <section id="cards"></section>
  <div class="add"><input id="add-input" placeholder="Add a Tavily search…" /><button class="btn" id="add-btn">Search</button></div>
  <section class="summary" id="summary"><h2>Summary draft</h2><div class="summary-row"><select id="model"></select><button class="btn" id="regenerate">Regenerate</button><button class="btn" id="preview">Preview</button></div><textarea class="summary-input" id="summary-input"></textarea><input class="feedback" id="feedback" placeholder="Optional feedback for regeneration…" /></section>
</main>
<div class="actions"><button class="btn" id="cancel">Cancel</button><button class="btn" id="raw">Send selected raw results</button><button class="btn primary" id="generate">Generate summary</button><button class="btn success" id="approve" disabled>Approve summary</button></div>
<div class="modal hidden" id="preview-modal"><div class="modal-inner"><div class="modal-head"><strong>Summary Preview</strong><button class="close" id="modal-close">×</button></div><div class="modal-body" id="modal-body"></div><div class="popover hidden" id="popover"><div class="quote" id="popover-quote"></div><textarea id="popover-input" rows="3" placeholder="Feedback…"></textarea><button class="btn primary" id="popover-regen">Regenerate</button></div><div class="modal-foot"><span class="status">Select text to regenerate with focused feedback.</span><div><button class="btn" id="modal-regenerate">Regenerate</button><button class="btn success" id="modal-approve">Approve</button></div></div></div></div>
<script>window.__CURATOR_DATA__=${inline};</script>
<script>
(function(){
const DATA=window.__CURATOR_DATA__; let results=DATA.results.slice(); let summaryMeta=null; let submitted=false; let selectedText="";
const $=id=>document.getElementById(id); const cards=$("cards"), status=$("status"), summary=$("summary"), summaryInput=$("summary-input"), feedback=$("feedback"), approve=$("approve"), model=$("model"), modal=$("preview-modal"), modalBody=$("modal-body"), pop=$("popover");
function esc(s){return String(s||'').replace(/[&<>"]/g,function(c){return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':'&quot;';});}
function markdownToHtml(md){let html="";let inCode=false;const nl=String.fromCharCode(10);for(const raw of String(md||"").split(nl)){const line=raw.trimEnd();if(line.charCodeAt(0)===96&&line.charCodeAt(1)===96&&line.charCodeAt(2)===96){html+=inCode?"</code></pre>":"<pre><code>";inCode=!inCode;continue;}if(inCode){html+=esc(line)+nl;continue;}if(line.startsWith("### ")) html+="<h3>"+esc(line.slice(4))+"</h3>";else if(line.startsWith("## ")) html+="<h2>"+esc(line.slice(3))+"</h2>";else if(line.startsWith("# ")) html+="<h1>"+esc(line.slice(2))+"</h1>";else if(line.startsWith("- ")||line.startsWith("* ")) html+="<li>"+esc(line.slice(2))+"</li>";else if(line.trim()==="") html+="<br>";else html+="<p>"+esc(line).replace(new RegExp('https?://[^ ]+','g'),'<a href="$&" target="_blank">$&</a>')+"</p>";}if(inCode)html+="</code></pre>";return html;}
async function post(path, body){const res=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:DATA.token,...body})});const data=await res.json().catch(()=>({ok:false,error:"Invalid JSON"}));if(!res.ok||data.ok===false) throw new Error(data.error||res.statusText);return data;}
function selected(){return Array.from(document.querySelectorAll('.check:checked')).map(el=>Number(el.dataset.index));}
function render(){cards.innerHTML=results.map(r=>'<article class="card"><div class="card-head"><input class="check" type="checkbox" checked data-index="'+r.index+'"><div><div class="query">'+esc(r.query)+' <span class="status">Tavily</span></div>'+(r.error?'<div class="error">'+esc(r.error)+'</div>':'<div class="answer">'+esc(r.answer||'(no answer)')+'</div>'+r.results.map(s=>'<div class="source"><a target="_blank" href="'+esc(s.url)+'">'+esc(s.title||s.url)+'</a><br>'+esc(s.snippet||'')+'</div>').join(''))+'</div></div></article>').join('');status.textContent=results.length+' result set(s).';}
function fillModels(){model.innerHTML='<option value="">Auto</option>'+DATA.summaryModels.map(m=>'<option value="'+esc(m.value)+'">'+esc(m.label)+'</option>').join('');if(DATA.defaultSummaryModel)model.value=DATA.defaultSummaryModel;}
async function generate(extraFeedback){const sel=selected();if(sel.length===0){status.textContent='Select at least one result.';return;}status.textContent='Generating summary…';approve.disabled=true;try{const data=await post('/summarize',{selected:sel,model:model.value||undefined,feedback:extraFeedback||feedback.value||undefined});summaryInput.value=data.summary;summaryMeta=data.meta;summary.classList.add('visible');approve.disabled=false;status.textContent='Summary ready.';}catch(e){status.textContent='Summary failed: '+(e&&e.message?e.message:e);}}
async function submit(raw){if(submitted)return;submitted=true;try{await post('/submit',{selected:selected(),summary:raw?undefined:summaryInput.value,summaryMeta:raw?undefined:{...(summaryMeta||{}),edited:true},rawResults:raw});status.textContent='Sent to agent. You can close this window.';setTimeout(()=>window.close(),700);}catch(e){submitted=false;status.textContent='Submit failed: '+(e&&e.message?e.message:e);}}
function openPreview(){if(!summaryInput.value.trim())return;modalBody.innerHTML=markdownToHtml(summaryInput.value);modal.classList.remove('hidden');}
function closePreview(){modal.classList.add('hidden');modalBody.innerHTML='';pop.classList.add('hidden');}
$('generate').onclick=()=>generate(); $('regenerate').onclick=()=>generate(); $('preview').onclick=openPreview; approve.onclick=()=>submit(false); $('raw').onclick=()=>submit(true); $('cancel').onclick=async()=>{try{await post('/cancel',{});}catch{} window.close();}; $('modal-close').onclick=closePreview; $('modal-regenerate').onclick=()=>{closePreview();generate();}; $('modal-approve').onclick=()=>{closePreview();submit(false);}; modal.onclick=e=>{if(e.target===modal)closePreview();};
$('add-btn').onclick=async()=>{const q=$('add-input').value.trim();if(!q)return;status.textContent='Searching…';try{const data=await post('/search',{query:q});results.push(data.result);$('add-input').value='';render();status.textContent='Added search result.';}catch(e){status.textContent='Search failed: '+(e&&e.message?e.message:e);}};
modalBody.addEventListener('mouseup',()=>{const sel=window.getSelection();if(!sel||sel.isCollapsed)return;selectedText=sel.toString().trim();if(!selectedText)return;const range=sel.getRangeAt(0);const rect=range.getBoundingClientRect();$('popover-quote').textContent='“'+(selectedText.length>100?selectedText.slice(0,97)+'…':selectedText)+'”';pop.classList.remove('hidden');pop.style.left=Math.max(8,Math.min(rect.left,window.innerWidth-300))+'px';pop.style.top=Math.max(8,Math.min(rect.bottom+8,window.innerHeight-180))+'px';$('popover-input').focus();});
$('popover-regen').onclick=()=>{const note=$('popover-input').value.trim();const fb='Regarding: "'+selectedText+'"'+(note?' — '+note:'');closePreview();generate(fb);};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.classList.contains('hidden')){e.preventDefault();closePreview();}});
setInterval(()=>{post('/heartbeat',{}).catch(()=>{});},5000);
fillModels();render();
})();
</script>
</body>
</html>`;
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
	const win = open(shellHTML, { width: 860, height: 900, title: "Search Curator" });
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

function startServer(args: {
	initialResults: QueryResultData[];
	summaryModels: Array<{ value: string; label: string }>;
	defaultSummaryModel: string | null;
	onSearch: (query: string) => Promise<QueryResultData>;
	onSummarize: (selected: number[], signal: AbortSignal, model?: string, feedback?: string) => Promise<{ summary: string; meta: SummaryMeta }>;
}): Promise<{ url: string; close: () => void; result: Promise<CuratorResult> }> {
	const token = randomUUID();
	const results = args.initialResults.slice();
	let completed = false;
	let browserConnected = false;
	let lastHeartbeatAt = Date.now();
	let timeout: NodeJS.Timeout | null = null;
	let staleWatchdog: NodeJS.Timeout | null = null;
	let resolveResult: (value: CuratorResult) => void = () => {};
	const result = new Promise<CuratorResult>((resolve) => { resolveResult = resolve; });

	const complete = (value: CuratorResult) => {
		if (completed) return;
		completed = true;
		if (timeout) clearTimeout(timeout);
		if (staleWatchdog) clearInterval(staleWatchdog);
		resolveResult(value);
		setTimeout(() => server.close(), 250);
	};

	const touchHeartbeat = () => {
		browserConnected = true;
		lastHeartbeatAt = Date.now();
	};

	const validate = (body: unknown, res: ServerResponse): body is Record<string, unknown> => {
		if (!body || typeof body !== "object" || (body as Record<string, unknown>).token !== token) {
			sendJson(res, 403, { ok: false, error: "Invalid session" });
			return false;
		}
		return true;
	};

	const server = http.createServer(async (req, res) => {
		try {
			const method = req.method || "GET";
			const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
			if (method === "GET" && url.pathname === "/") {
				if (url.searchParams.get("session") !== token) { res.writeHead(403).end("Invalid session"); return; }
				touchHeartbeat();
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
				res.end(generateCuratorHtml({ token, results, summaryModels: args.summaryModels, defaultSummaryModel: args.defaultSummaryModel, timeoutMs: DEFAULT_TIMEOUT_MS }));
				return;
			}
			if (method !== "POST") { res.writeHead(404).end("Not found"); return; }
			const body = await parseJSONBody(req);
			if (!validate(body, res)) return;
			if (url.pathname === "/heartbeat") { touchHeartbeat(); sendJson(res, 200, { ok: true }); return; }
			if (url.pathname === "/search") {
				const query = typeof body.query === "string" ? body.query.trim() : "";
				if (!query) { sendJson(res, 400, { ok: false, error: "Invalid query" }); return; }
				const newResult = await args.onSearch(query);
				results.push(newResult);
				sendJson(res, 200, { ok: true, result: resultForClient(newResult, results.length - 1) });
				return;
			}
			if (url.pathname === "/summarize") {
				const selected = normalizeSelected(body.selected, results.length);
				if (!selected || selected.length === 0) { sendJson(res, 400, { ok: false, error: "Invalid selection" }); return; }
				const controller = new AbortController();
				const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
				const feedback = typeof body.feedback === "string" && body.feedback.trim() ? body.feedback.trim() : undefined;
				const summary = await args.onSummarize(selected, controller.signal, model, feedback);
				sendJson(res, 200, { ok: true, summary: summary.summary, meta: summary.meta });
				return;
			}
			if (url.pathname === "/submit") {
				const selected = normalizeSelected(body.selected, results.length);
				if (!selected) { sendJson(res, 400, { ok: false, error: "Invalid selection" }); return; }
				const summary = typeof body.summary === "string" && body.summary.trim() ? body.summary.trim() : undefined;
				const summaryMeta = normalizeSummaryMeta(body.summaryMeta);
				const rawResults = body.rawResults === true;
				if (!rawResults && !summary) { sendJson(res, 400, { ok: false, error: "Summary required" }); return; }
				sendJson(res, 200, { ok: true });
				complete({ status: rawResults ? "raw" : "approved", selected, summary, summaryMeta });
				return;
			}
			if (url.pathname === "/cancel") {
				sendJson(res, 200, { ok: true });
				complete({ status: "cancelled", selected: [] });
				return;
			}
			res.writeHead(404, { "Content-Type": "text/plain" });
			res.end("Not found");
		} catch (err) {
			const message = err instanceof Error ? err.message : "Server error";
			sendJson(res, 500, { ok: false, error: message });
		}
	});

	return new Promise((resolve, reject) => {
		server.once("error", (err) => reject(new Error(`Curator server failed to start: ${(err as Error).message}`)));
		server.listen(0, "127.0.0.1", () => {
			const addr = server.address();
			if (!addr || typeof addr === "string") {
				reject(new Error("Curator server: invalid address"));
				return;
			}
			timeout = setTimeout(() => complete({ status: "timeout", selected: [] }), DEFAULT_TIMEOUT_MS);
			staleWatchdog = setInterval(() => {
				if (!browserConnected || completed) return;
				if (Date.now() - lastHeartbeatAt > 30000) complete({ status: "cancelled", selected: [] });
			}, 5000);
			resolve({
				url: `http://localhost:${addr.port}/?session=${token}`,
				close: () => {
					if (timeout) clearTimeout(timeout);
					if (staleWatchdog) clearInterval(staleWatchdog);
					try { server.close(); } catch {}
				},
				result,
			});
		});
	});
}

function defaultSummaryModels(): Array<{ value: string; label: string }> {
	return [
		{ value: "openai-codex/gpt-5.4", label: "Codex GPT-5.4" },
		{ value: "openai-codex/gpt-5.5", label: "Codex GPT-5.5" },
	];
}

function selectedResults(results: QueryResultData[], indices: number[]): QueryResultData[] {
	return indices.map((index) => results[index]).filter((result): result is QueryResultData => !!result);
}

export async function runCuratedSearchReview(args: {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	initialResults: QueryResultData[];
	onSearch: (query: string) => Promise<QueryResultData>;
	onUpdate?: (message: string) => void | Promise<void>;
}): Promise<CuratorResult> {
	const allResults = args.initialResults.slice();
	const server = await startServer({
		initialResults: allResults,
		summaryModels: defaultSummaryModels(),
		defaultSummaryModel: "openai-codex/gpt-5.4",
		onSearch: async (query) => {
			const result = await args.onSearch(query);
			allResults.push(result);
			return result;
		},
		onSummarize: async (selected, signal, model, feedback) => {
			const picked = selectedResults(allResults, selected);
			try {
				return await generateSummaryDraft(picked, args.ctx, signal, model, feedback);
			} catch (err) {
				const fallback = buildDeterministicSummary(picked);
				fallback.meta.fallbackReason = err instanceof Error ? err.message : "summary-generation-failed";
				return fallback;
			}
		},
	});

	let glimpseWin: GlimpseWindow | null = null;
	try {
		if (platform() === "darwin") {
			const open = await getGlimpseOpen();
			if (open) {
				try {
					glimpseWin = openInGlimpse(open, server.url);
					await args.onUpdate?.("Opened Tavily search curator in Glimpse. Approve the summary to continue.");
				} catch (err) {
					await openInBrowser(args.pi, server.url);
					const reason = err instanceof Error ? err.message : String(err);
					await args.onUpdate?.(`Glimpse unavailable (${reason}); opened Tavily search curator in browser.`);
				}
			} else {
				await openInBrowser(args.pi, server.url);
				await args.onUpdate?.("Opened Tavily search curator in browser. Approve the summary to continue.");
			}
		} else {
			await openInBrowser(args.pi, server.url);
			await args.onUpdate?.("Opened Tavily search curator in browser. Approve the summary to continue.");
		}

		const result = await server.result;
		return { ...result, selectedResults: selectedResults(allResults, result.selected) };
	} finally {
		try { glimpseWin?.close(); } catch {}
		server.close();
	}
}

export function applyCuratedSelection(results: QueryResultData[], selected: number[]): QueryResultData[] {
	return selectedResults(results, selected);
}
