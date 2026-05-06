import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { buildFrameIdentity, type FrameIdentity } from "../tft-commands/frame-identity.ts";

type StudioStatus = "running" | "awaiting" | "done" | "aborted";
type AskStatus = "answered" | "cancelled" | "timeout" | "unavailable";

type StudioQuestion = {
	id: string;
	question: string;
	markdown?: string;
	options: string[];
	multiSelect: boolean;
	allowText: boolean;
	placeholder?: string;
	submitLabel?: string;
	createdAt: number;
};

type StudioAnswer = {
	status: AskStatus;
	questionId?: string;
	selectedIndices: number[];
	selectedOptions: string[];
	text?: string;
	submittedAt: number;
};

type FrameStudioState = {
	runId: string;
	identity: FrameIdentity;
	title: string;
	markdown: string;
	step?: string;
	status: StudioStatus;
	url: string;
	createdAt: number;
	updatedAt: number;
	question?: StudioQuestion;
	lastAnswer?: StudioAnswer;
	logs: Array<{ time: number; message: string }>;
};

type PendingAsk = {
	questionId: string;
	resolve: (answer: StudioAnswer) => void;
	timer: ReturnType<typeof setTimeout>;
};

interface GlimpseWindow {
	on(event: "closed", handler: () => void): void;
	on(event: "message", handler: (data: unknown) => void): void;
	close(): void;
	_write?(message: Record<string, unknown>): void;
}

type FrameStudioHandle = {
	state: FrameStudioState;
	server: Server;
	clients: Set<ServerResponse>;
	pending?: PendingAsk;
	window?: GlimpseWindow;
	pingInterval: ReturnType<typeof setInterval>;
	closed: boolean;
};

const STATE_DIR = join(homedir(), ".pi", "agent", "frame-studio");
const ASK_TIMEOUT_MS = 30 * 60 * 1000;

const runsById = new Map<string, FrameStudioHandle>();
const runsByIdentity = new Map<string, FrameStudioHandle>();
let latestRunId: string | undefined;
let glimpseOpen: ((html: string, opts: Record<string, unknown>) => GlimpseWindow) | null | undefined;

function resultText(text: string, details?: Record<string, unknown>) {
	return { content: [{ type: "text" as const, text }], details };
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

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function sendJson(res: ServerResponse, value: unknown, status = 200) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(value));
}

function readBody(req: IncomingMessage): Promise<string> {
	return new Promise((resolve, reject) => {
		let body = "";
		req.setEncoding("utf8");
		req.on("data", (chunk) => { body += chunk; });
		req.on("end", () => resolve(body));
		req.on("error", reject);
	});
}

function serializeState(state: FrameStudioState) {
	return {
		runId: state.runId,
		identity: state.identity,
		title: state.title,
		markdown: state.markdown,
		step: state.step,
		status: state.status,
		url: state.url,
		createdAt: state.createdAt,
		updatedAt: state.updatedAt,
		question: state.question,
		lastAnswer: state.lastAnswer,
		logs: state.logs.slice(-30),
	};
}

function pushState(handle: FrameStudioHandle) {
	const payload = `data: ${JSON.stringify(serializeState(handle.state))}\n\n`;
	for (const client of [...handle.clients]) {
		try { client.write(payload); } catch { handle.clients.delete(client); }
	}
}

function addLog(handle: FrameStudioHandle, message: string) {
	handle.state.logs.push({ time: Date.now(), message });
	handle.state.updatedAt = Date.now();
}

function listenOnLoopback(server: Server): Promise<string> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") return reject(new Error("Failed to bind Frame Studio server."));
			resolve(`http://127.0.0.1:${address.port}/`);
		});
	});
}

function buildPageHtml(): string {
	return String.raw`<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Frame Studio</title>
<style>
:root {
  color-scheme: light;
  --bg:#fafaf9; --panel:#ffffff; --panel2:#f5f5f4; --line:#e7e5e4;
  --text:#292524; --muted:#78716c; --accent:#7c3aed; --accent-soft:#ede9fe;
  --green:#166534; --red:#991b1b; --amber:#92400e;
}
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--text); font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
.app { max-width: 980px; margin:0 auto; padding:24px; }
.hero { padding:22px 24px; border:1px solid var(--line); border-radius:22px; background:linear-gradient(135deg,#fff,#f5f3ff); box-shadow:0 20px 50px rgba(41,37,36,.08); }
.kicker { display:flex; gap:8px; align-items:center; color:var(--accent); font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
h1 { margin:8px 0 6px; font-size:28px; line-height:1.18; }
.meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; color:var(--muted); }
.badge { border:1px solid var(--line); background:rgba(255,255,255,.75); border-radius:999px; padding:4px 10px; font-size:12px; }
.layout { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; margin-top:18px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:18px; padding:18px 20px; box-shadow:0 10px 30px rgba(41,37,36,.05); }
.card h2 { margin:0 0 10px; font-size:17px; }
.markdown h1 { font-size:23px; border-bottom:1px solid var(--line); padding-bottom:8px; }
.markdown h2 { font-size:19px; margin-top:22px; }
.markdown h3 { font-size:16px; margin-top:18px; }
.markdown p { margin:8px 0; }
.markdown ul, .markdown ol { padding-left:24px; }
.markdown code { background:rgba(120,113,108,.13); border-radius:6px; padding:1px 5px; }
.markdown pre { background:#292524; color:#fafaf9; border-radius:12px; padding:14px; overflow:auto; }
.question { border-color:#ddd6fe; background:linear-gradient(180deg,#fff,#faf9ff); }
.question-title { font-size:18px; font-weight:800; margin:0 0 12px; }
.options { display:grid; gap:10px; margin:14px 0; }
.option { display:flex; gap:10px; align-items:flex-start; padding:12px; border:1px solid var(--line); border-radius:14px; background:#fff; cursor:pointer; }
.option:hover { border-color:#c4b5fd; background:#faf9ff; }
.option input { margin-top:3px; }
.option-number { min-width:24px; height:24px; border-radius:8px; display:inline-grid; place-items:center; background:var(--accent-soft); color:var(--accent); font-weight:800; }
textarea { width:100%; min-height:92px; resize:vertical; border:1px solid var(--line); border-radius:14px; padding:12px; font:inherit; }
.actions { display:flex; gap:10px; align-items:center; margin-top:14px; }
button { border:0; border-radius:12px; padding:10px 15px; font-weight:800; cursor:pointer; }
.primary { background:var(--accent); color:white; }
.secondary { background:var(--panel2); color:var(--text); }
.status { color:var(--muted); font-size:13px; }
.logs { color:var(--muted); font-size:12px; max-height:160px; overflow:auto; }
.empty { color:var(--muted); padding:24px; text-align:center; }
</style>
</head>
<body>
<div class="app">
  <section class="hero">
    <div class="kicker">🔥 Frame Studio</div>
    <h1 id="title">Frame Studio</h1>
    <div class="meta" id="meta"></div>
  </section>
  <main class="layout">
    <section class="card markdown" id="markdown"><div class="empty">Frame markdown을 기다리는 중...</div></section>
    <section class="card question" id="questionCard" hidden></section>
    <section class="card"><h2>로그</h2><div class="logs" id="logs"></div></section>
  </main>
</div>
<script>
var state = null;
function esc(s) { return String(s || '').replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
function inline(s) { var tick = String.fromCharCode(96); return esc(s).replace(new RegExp(tick + '([^' + tick + ']+)' + tick, 'g'), '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
function renderMarkdown(md) {
  var lines = String(md || '').split(/\r?\n/);
  var html = []; var inCode = false; var list = null;
  function closeList() { if (list) { html.push('</' + list + '>'); list = null; } }
  lines.forEach(function(line) {
    if (/^\s*/.test(line) && line.trim().indexOf(String.fromCharCode(96).repeat(3)) === 0) { closeList(); if (inCode) html.push('</code></pre>'); else html.push('<pre><code>'); inCode = !inCode; return; }
    if (inCode) { html.push(esc(line) + '\n'); return; }
    if (/^###\s+/.test(line)) { closeList(); html.push('<h3>' + inline(line.replace(/^###\s+/, '')) + '</h3>'); return; }
    if (/^##\s+/.test(line)) { closeList(); html.push('<h2>' + inline(line.replace(/^##\s+/, '')) + '</h2>'); return; }
    if (/^#\s+/.test(line)) { closeList(); html.push('<h1>' + inline(line.replace(/^#\s+/, '')) + '</h1>'); return; }
    var ol = line.match(/^\s*(\d+)\.\s+(.*)$/); if (ol) { if (list !== 'ol') { closeList(); list = 'ol'; html.push('<ol>'); } html.push('<li>' + inline(ol[2]) + '</li>'); return; }
    var ul = line.match(/^\s*[-*]\s+(.*)$/); if (ul) { if (list !== 'ul') { closeList(); list = 'ul'; html.push('<ul>'); } html.push('<li>' + inline(ul[1]) + '</li>'); return; }
    closeList();
    if (!line.trim()) html.push('<br/>'); else html.push('<p>' + inline(line) + '</p>');
  });
  closeList(); if (inCode) html.push('</code></pre>');
  return html.join('');
}
function setStatus(text) { var el = document.getElementById('submitStatus'); if (el) el.textContent = text; }
function render(s) {
  state = s;
  document.title = s.title || 'Frame Studio';
  document.getElementById('title').textContent = s.title || 'Frame Studio';
  var ident = s.identity || {};
  document.getElementById('meta').innerHTML = [
    '<span class="badge">' + esc(ident.mode || 'unknown') + '</span>',
    '<span class="badge">' + esc(ident.displayTitle || '') + '</span>',
    s.step ? '<span class="badge">' + esc(s.step) + '</span>' : '',
    '<span class="badge">' + esc(s.status || '') + '</span>'
  ].filter(Boolean).join('');
  document.getElementById('markdown').innerHTML = s.markdown ? renderMarkdown(s.markdown) : '<div class="empty">Frame markdown을 기다리는 중...</div>';
  var q = s.question;
  var qc = document.getElementById('questionCard');
  if (!q || s.status !== 'awaiting') { qc.hidden = true; }
  else {
    qc.hidden = false;
    var type = q.multiSelect ? 'checkbox' : 'radio';
    qc.innerHTML = '<div class="question-title">' + esc(q.question) + '</div>'
      + (q.markdown ? '<div class="markdown">' + renderMarkdown(q.markdown) + '</div>' : '')
      + '<div class="options">' + q.options.map(function(opt, i) {
        return '<label class="option"><input name="frameOption" type="' + type + '" value="' + i + '"><span class="option-number">' + (i + 1) + '</span><span>' + inline(opt) + '</span></label>';
      }).join('') + '</div>'
      + (q.allowText ? '<textarea id="answerText" placeholder="' + esc(q.placeholder || '직접 입력') + '"></textarea>' : '')
      + '<div class="actions"><button class="primary" onclick="submitAnswer()">' + esc(q.submitLabel || '선택 완료') + '</button><button class="secondary" onclick="cancelAnswer()">취소</button><span class="status" id="submitStatus"></span></div>';
  }
  document.getElementById('logs').innerHTML = (s.logs || []).slice().reverse().map(function(log) {
    return '<div>' + new Date(log.time).toLocaleTimeString() + ' · ' + esc(log.message) + '</div>';
  }).join('') || '<span class="status">로그 없음</span>';
}
async function submitAnswer(cancelled) {
  if (!state || !state.question) return;
  var checked = Array.prototype.slice.call(document.querySelectorAll('input[name="frameOption"]:checked')).map(function(el) { return Number(el.value); });
  var textEl = document.getElementById('answerText');
  setStatus('전송 중...');
  try {
    var res = await fetch('/submit', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ questionId: state.question.id, cancelled: !!cancelled, selectedIndices: checked, text: textEl ? textEl.value : '' }) });
    if (!res.ok) throw new Error(await res.text());
    setStatus('Pi로 전송됨');
  } catch (e) { setStatus('전송 실패: ' + e.message); }
}
function cancelAnswer() { submitAnswer(true); }
var es = new EventSource('/events');
es.onmessage = function(ev) { render(JSON.parse(ev.data)); };
es.onerror = function() { setTimeout(function(){ location.reload(); }, 2000); };
fetch('/state').then(function(r){ return r.json(); }).then(render).catch(function(){});
</script>
</body>
</html>`;
}

function createServerFor(state: FrameStudioState): FrameStudioHandle {
	const handle: FrameStudioHandle = {
		state,
		server: createServer(),
		clients: new Set(),
		pingInterval: setInterval(() => {
			for (const client of [...handle.clients]) {
				try { client.write(`: ping ${Date.now()}\n\n`); } catch { handle.clients.delete(client); }
			}
		}, 15000),
		closed: false,
	};

	handle.server.on("request", async (req, res) => {
		try {
			const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
			if (req.method === "GET" && url.pathname === "/") {
				res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
				res.end(buildPageHtml());
				return;
			}
			if (req.method === "GET" && url.pathname === "/state") {
				sendJson(res, serializeState(handle.state));
				return;
			}
			if (req.method === "GET" && url.pathname === "/events") {
				res.writeHead(200, {
					"content-type": "text/event-stream; charset=utf-8",
					"cache-control": "no-cache, no-transform",
					connection: "keep-alive",
				});
				handle.clients.add(res);
				res.write(`data: ${JSON.stringify(serializeState(handle.state))}\n\n`);
				req.on("close", () => handle.clients.delete(res));
				return;
			}
			if (req.method === "POST" && url.pathname === "/submit") {
				const body = JSON.parse(await readBody(req) || "{}");
				const pending = handle.pending;
				if (!pending || body.questionId !== pending.questionId) {
					sendJson(res, { ok: false, error: "No matching pending question." }, 409);
					return;
				}
				const selectedIndices = Array.isArray(body.selectedIndices)
					? body.selectedIndices.map((n: unknown) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n < (handle.state.question?.options.length ?? 0))
					: [];
				const options = handle.state.question?.options ?? [];
				const answer: StudioAnswer = {
					status: body.cancelled ? "cancelled" : "answered",
					questionId: pending.questionId,
					selectedIndices,
					selectedOptions: selectedIndices.map((i) => options[i]).filter(Boolean),
					text: typeof body.text === "string" && body.text.trim() ? body.text.trim() : undefined,
					submittedAt: Date.now(),
				};
				clearTimeout(pending.timer);
				handle.pending = undefined;
				handle.state.lastAnswer = answer;
				handle.state.question = undefined;
				handle.state.status = "running";
				addLog(handle, answer.status === "cancelled" ? "Question cancelled by user." : "Question answered in Frame Studio.");
				pushState(handle);
				pending.resolve(answer);
				sendJson(res, { ok: true });
				return;
			}
			sendJson(res, { error: "Not found" }, 404);
		} catch (error) {
			sendJson(res, { error: error instanceof Error ? error.message : String(error) }, 500);
		}
	});

	return handle;
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

function openGlimpseUrl(open: (html: string, opts: Record<string, unknown>) => GlimpseWindow, url: string, title: string): GlimpseWindow {
	const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#fafaf9"><script>window.location.replace(${JSON.stringify(url)});</script></body></html>`;
	const win = open(html, { width: 980, height: 900, title, openLinks: true });
	win.on("message", (data: unknown) => {
		if (!data || typeof data !== "object") return;
		const msg = data as Record<string, unknown>;
		if (msg.type !== "resize" || typeof msg.height !== "number") return;
		win._write?.({ type: "resize", width: 980, height: Math.max(560, Math.min(Math.round(msg.height), 1200)) });
	});
	return win;
}

async function openStudio(pi: ExtensionAPI, ctx: ExtensionContext, handle: FrameStudioHandle): Promise<"glimpse" | "browser" | "none"> {
	if (!ctx.hasUI) return "none";
	if (platform() === "darwin") {
		const open = await getGlimpseOpen();
		if (open) {
			try {
				handle.window = openGlimpseUrl(open, handle.state.url, handle.state.title);
				handle.window.on("closed", () => { handle.window = undefined; });
				return "glimpse";
			} catch {}
		}
	}
	await openInBrowser(pi, handle.state.url);
	return "browser";
}

async function ensureRun(pi: ExtensionAPI, ctx: ExtensionContext, params: { title?: string; markdown?: string; step?: string; identityKey?: string; displayTitle?: string; args?: string }): Promise<{ handle: FrameStudioHandle; opened: "glimpse" | "browser" | "none" | "reused" }> {
	mkdirSync(STATE_DIR, { recursive: true });
	const inferred = buildFrameIdentity(ctx as any, params.args ?? "");
	const identity = params.identityKey || params.displayTitle
		? { ...inferred, key: params.identityKey || inferred.key, displayTitle: params.displayTitle || inferred.displayTitle }
		: inferred;
	let handle = runsByIdentity.get(identity.key);
	if (handle && !handle.closed) {
		if (params.title) handle.state.title = params.title;
		if (params.markdown !== undefined) handle.state.markdown = params.markdown;
		if (params.step) handle.state.step = params.step;
		handle.state.updatedAt = Date.now();
		pushState(handle);
		latestRunId = handle.state.runId;
		return { handle, opened: "reused" };
	}

	const runId = randomUUID().slice(0, 8);
	const state: FrameStudioState = {
		runId,
		identity,
		title: params.title || identity.displayTitle || "Frame Studio",
		markdown: params.markdown || "",
		step: params.step,
		status: "running",
		url: "",
		createdAt: Date.now(),
		updatedAt: Date.now(),
		logs: [],
	};
	handle = createServerFor(state);
	state.url = await listenOnLoopback(handle.server);
	addLog(handle, "Frame Studio started.");
	runsById.set(runId, handle);
	runsByIdentity.set(identity.key, handle);
	latestRunId = runId;
	const opened = await openStudio(pi, ctx, handle);
	return { handle, opened };
}

function latestHandle(): FrameStudioHandle | undefined {
	return latestRunId ? runsById.get(latestRunId) : undefined;
}

function closeHandle(handle: FrameStudioHandle) {
	if (handle.closed) return;
	handle.closed = true;
	try { handle.server.close(); } catch {}
	try { clearInterval(handle.pingInterval); } catch {}
	try { handle.window?.close(); } catch {}
	if (handle.pending) {
		clearTimeout(handle.pending.timer);
		handle.pending.resolve({ status: "cancelled", selectedIndices: [], selectedOptions: [], submittedAt: Date.now() });
		handle.pending = undefined;
	}
	runsById.delete(handle.state.runId);
	runsByIdentity.delete(handle.state.identity.key);
}

function ask(handle: FrameStudioHandle, question: StudioQuestion, signal?: AbortSignal): Promise<StudioAnswer> {
	if (handle.pending) {
		clearTimeout(handle.pending.timer);
		handle.pending.resolve({ status: "cancelled", questionId: handle.pending.questionId, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() });
	}
	handle.state.question = question;
	handle.state.status = "awaiting";
	if (question.markdown) handle.state.markdown = question.markdown;
	addLog(handle, `Awaiting answer: ${question.question}`);
	pushState(handle);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			if (handle.pending?.questionId !== question.id) return;
			handle.pending = undefined;
			const answer: StudioAnswer = { status: "timeout", questionId: question.id, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() };
			handle.state.lastAnswer = answer;
			handle.state.question = undefined;
			handle.state.status = "running";
			addLog(handle, "Question timed out.");
			pushState(handle);
			resolve(answer);
		}, ASK_TIMEOUT_MS);
		handle.pending = { questionId: question.id, resolve, timer };
		if (signal) {
			signal.addEventListener("abort", () => {
				if (handle.pending?.questionId !== question.id) return;
				clearTimeout(timer);
				handle.pending = undefined;
				const answer: StudioAnswer = { status: "cancelled", questionId: question.id, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() };
				handle.state.lastAnswer = answer;
				handle.state.question = undefined;
				handle.state.status = "running";
				addLog(handle, "Question cancelled by abort signal.");
				pushState(handle);
				resolve(answer);
			}, { once: true });
		}
	});
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "frame_studio",
		label: "Frame Studio",
		description: "Open/update a Glimpse Frame Studio for /frame co-thinking. Supports markdown rendering and interactive option/text answers scoped to worktree/ticket/session identity.",
		parameters: Type.Object({
			action: Type.String({ description: "start|update|ask|open|finish|abort" }),
			runId: Type.Optional(Type.String({ description: "Existing Frame Studio run id. Omit to use identity/latest run." })),
			identityKey: Type.Optional(Type.String({ description: "Override identity key. Usually use Frame identity hint key." })),
			displayTitle: Type.Optional(Type.String({ description: "Override display title." })),
			args: Type.Optional(Type.String({ description: "Original /frame args used for identity inference." })),
			title: Type.Optional(Type.String({ description: "Window/report title." })),
			step: Type.Optional(Type.String({ description: "Current frame step label." })),
			markdown: Type.Optional(Type.String({ description: "Markdown to render in the Frame Studio." })),
			question: Type.Optional(Type.String({ description: "Question to ask for action=ask." })),
			options: Type.Optional(Type.Array(Type.String(), { description: "Options for action=ask." })),
			multiSelect: Type.Optional(Type.Boolean({ description: "Allow multiple option selection." })),
			allowText: Type.Optional(Type.Boolean({ description: "Allow direct text input." })),
			placeholder: Type.Optional(Type.String({ description: "Text input placeholder." })),
			submitLabel: Type.Optional(Type.String({ description: "Submit button label." })),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
			const action = String(params.action || "").trim().toLowerCase();
			if (!action) throw new Error("frame_studio action is required.");

			if (action === "start") {
				const { handle, opened } = await ensureRun(pi, ctx, params);
				return resultText(`Frame Studio started (${handle.state.runId}). ${handle.state.url}. Opened: ${opened}.`, { runId: handle.state.runId, url: handle.state.url, identity: handle.state.identity, opened });
			}

			let handle = params.runId ? runsById.get(params.runId) : undefined;
			if (!handle && (params.identityKey || params.displayTitle || params.args)) {
				const ensured = await ensureRun(pi, ctx, params);
				handle = ensured.handle;
			} else if (!handle) {
				handle = latestHandle();
			}

			if (!handle && ["update", "ask", "open"].includes(action)) {
				const ensured = await ensureRun(pi, ctx, params);
				handle = ensured.handle;
			}
			if (!handle) throw new Error("No active Frame Studio run. Call action=start first.");

			if (action === "open") {
				const opened = await openStudio(pi, ctx, handle);
				return resultText(`Frame Studio opened (${handle.state.runId}). ${handle.state.url}. Opened: ${opened}.`, { runId: handle.state.runId, url: handle.state.url, opened });
			}

			if (action === "update") {
				if (params.title) handle.state.title = params.title;
				if (params.step) handle.state.step = params.step;
				if (params.markdown !== undefined) handle.state.markdown = params.markdown;
				addLog(handle, `Updated${params.step ? `: ${params.step}` : ""}.`);
				pushState(handle);
				return resultText(`Frame Studio updated (${handle.state.runId}).`, { runId: handle.state.runId, url: handle.state.url });
			}

			if (action === "ask") {
				if (!ctx.hasUI) {
					return resultText("Frame Studio UI is unavailable in this context. Use numbered text-mode AskUserQuestion fallback.", { status: "unavailable" });
				}
				if (params.title) handle.state.title = params.title;
				if (params.step) handle.state.step = params.step;
				if (params.markdown !== undefined) handle.state.markdown = params.markdown;
				if (!handle.window) await openStudio(pi, ctx, handle);
				const question: StudioQuestion = {
					id: randomUUID().slice(0, 8),
					question: params.question || "선택해주세요.",
					markdown: params.markdown,
					options: Array.isArray(params.options) ? params.options : [],
					multiSelect: Boolean(params.multiSelect),
					allowText: Boolean(params.allowText),
					placeholder: params.placeholder,
					submitLabel: params.submitLabel,
					createdAt: Date.now(),
				};
				const answer = await ask(handle, question, signal);
				return resultText(
					answer.status === "answered"
						? `Frame Studio answer: ${answer.selectedOptions.join(", ") || "(no option)"}${answer.text ? `; text: ${answer.text}` : ""}`
						: `Frame Studio ask ended: ${answer.status}.`,
					{ runId: handle.state.runId, url: handle.state.url, answer },
				);
			}

			if (action === "finish") {
				if (params.markdown !== undefined) handle.state.markdown = params.markdown;
				handle.state.status = "done";
				addLog(handle, "Frame Studio finished.");
				pushState(handle);
				return resultText(`Frame Studio finished (${handle.state.runId}).`, { runId: handle.state.runId, url: handle.state.url });
			}

			if (action === "abort") {
				handle.state.status = "aborted";
				addLog(handle, "Frame Studio aborted.");
				pushState(handle);
				return resultText(`Frame Studio aborted (${handle.state.runId}).`, { runId: handle.state.runId, url: handle.state.url });
			}

			throw new Error(`Unknown frame_studio action: ${params.action}`);
		},
	});

	pi.on("session_shutdown", () => {
		for (const handle of [...runsById.values()]) closeHandle(handle);
	});
}
