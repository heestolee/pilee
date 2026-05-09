import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { buildFrameIdentity, type FrameIdentity } from "../tft-commands/frame-identity.ts";

type StudioStatus = "running" | "awaiting" | "done" | "aborted";
type AskStatus = "answered" | "cancelled" | "timeout" | "unavailable";
type StudioTabKey = "frame" | "decide" | "verify" | "verify-report";

type StudioTabState = {
	markdown: string;
	step?: string;
	updatedAt?: number;
};

type StudioQuestion = {
	id: string;
	tab: StudioTabKey;
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
	question?: string;
	selectedIndices: number[];
	selectedOptions: string[];
	text?: string;
	submittedAt: number;
};

type StudioTimelineEntry = {
	id: string;
	time: number;
	kind: "start" | "update" | "question" | "answer" | "finish" | "abort" | "restore";
	tab?: StudioTabKey;
	step?: string;
	title?: string;
	markdown?: string;
	question?: StudioQuestion;
	answer?: StudioAnswer;
	message?: string;
};

type FrameStudioState = {
	runId: string;
	identity: FrameIdentity;
	title: string;
	markdown: string;
	step?: string;
	activeTab: StudioTabKey;
	tabs: Record<StudioTabKey, StudioTabState>;
	status: StudioStatus;
	url: string;
	transcriptPath: string;
	createdAt: number;
	updatedAt: number;
	question?: StudioQuestion;
	lastAnswer?: StudioAnswer;
	timeline: StudioTimelineEntry[];
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
const TRANSCRIPTS_DIR = join(STATE_DIR, "transcripts");
const ASK_TIMEOUT_MS = 8 * 60 * 60 * 1000;

const STUDIO_TABS: Array<{ key: StudioTabKey; label: string; subtitle: string }> = [
	{ key: "frame", label: "Frame", subtitle: "목표·범위·성공 기준" },
	{ key: "decide", label: "Decide", subtitle: "대안·challenge·mitigation" },
	{ key: "verify", label: "Verify", subtitle: "success criteria 판정" },
	{ key: "verify-report", label: "Verify Report", subtitle: "증거 리포트·artifact" },
];

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

function safeIdentityFileName(key: string): string {
	return key
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 120) || "untitled";
}

function transcriptPathForIdentity(key: string): string {
	return join(TRANSCRIPTS_DIR, `${safeIdentityFileName(key)}.json`);
}

function normalizeTab(value: unknown): StudioTabKey | undefined {
	const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
	if (!raw) return undefined;
	if (raw === "frame") return "frame";
	if (raw === "decide" || raw === "decision" || raw === "decisions") return "decide";
	if (raw === "verify" || raw === "verification") return "verify";
	if (raw === "verify-report" || raw === "report" || raw === "verify_report") return "verify-report";
	return undefined;
}

function makeDefaultTabs(markdown = "", step?: string): Record<StudioTabKey, StudioTabState> {
	return {
		frame: { markdown, step, updatedAt: Date.now() },
		decide: { markdown: "" },
		verify: { markdown: "" },
		"verify-report": { markdown: "" },
	};
}

function normalizeTabs(value: unknown, markdown = "", step?: string): Record<StudioTabKey, StudioTabState> {
	const defaults = makeDefaultTabs(markdown, step);
	if (!value || typeof value !== "object") return defaults;
	const parsed = value as Partial<Record<StudioTabKey, Partial<StudioTabState>>>;
	for (const tab of STUDIO_TABS) {
		const source = parsed[tab.key];
		if (!source || typeof source !== "object") continue;
		defaults[tab.key] = {
			markdown: typeof source.markdown === "string" ? source.markdown : defaults[tab.key].markdown,
			step: typeof source.step === "string" ? source.step : defaults[tab.key].step,
			updatedAt: typeof source.updatedAt === "number" ? source.updatedAt : defaults[tab.key].updatedAt,
		};
	}
	return defaults;
}

function updateTab(state: FrameStudioState, tab: StudioTabKey, params: { markdown?: string; step?: string }) {
	state.activeTab = tab;
	state.tabs = normalizeTabs(state.tabs, state.markdown, state.step);
	const current = state.tabs[tab] ?? { markdown: "" };
	state.tabs[tab] = {
		...current,
		markdown: params.markdown !== undefined ? params.markdown : current.markdown,
		step: params.step ?? current.step,
		updatedAt: Date.now(),
	};
	if (tab === "frame") {
		if (params.markdown !== undefined) state.markdown = params.markdown;
		if (params.step) state.step = params.step;
	}
}

function persistState(state: FrameStudioState): void {
	try {
		mkdirSync(TRANSCRIPTS_DIR, { recursive: true });
		writeFileSync(state.transcriptPath, JSON.stringify({ ...state, url: "" }, null, 2));
	} catch {}
}

function loadPersistedState(identity: FrameIdentity): FrameStudioState | null {
	const transcriptPath = transcriptPathForIdentity(identity.key);
	try {
		if (!existsSync(transcriptPath)) return null;
		const parsed = JSON.parse(readFileSync(transcriptPath, "utf8")) as Partial<FrameStudioState>;
		const markdown = parsed.markdown || "";
		const step = parsed.step;
		return {
			runId: randomUUID().slice(0, 8),
			identity: parsed.identity ?? identity,
			title: parsed.title || identity.displayTitle || "TFT Studio",
			markdown,
			step,
			activeTab: normalizeTab(parsed.activeTab) ?? "frame",
			tabs: normalizeTabs(parsed.tabs, markdown, step),
			status: parsed.status === "done" || parsed.status === "aborted" ? parsed.status : "running",
			url: "",
			transcriptPath,
			createdAt: parsed.createdAt || Date.now(),
			updatedAt: Date.now(),
			question: undefined,
			lastAnswer: parsed.lastAnswer,
			timeline: Array.isArray(parsed.timeline) ? parsed.timeline : [],
			logs: Array.isArray(parsed.logs) ? parsed.logs : [],
		};
	} catch {
		return null;
	}
}

function appendTimeline(state: FrameStudioState, entry: Omit<StudioTimelineEntry, "id" | "time">): void {
	state.timeline.push({ id: randomUUID().slice(0, 8), time: Date.now(), ...entry });
	state.updatedAt = Date.now();
	persistState(state);
}


function serializeState(state: FrameStudioState) {
	return {
		runId: state.runId,
		identity: state.identity,
		title: state.title,
		markdown: state.markdown,
		step: state.step,
		activeTab: state.activeTab,
		tabs: normalizeTabs(state.tabs, state.markdown, state.step),
		status: state.status,
		url: state.url,
		transcriptPath: state.transcriptPath,
		createdAt: state.createdAt,
		updatedAt: state.updatedAt,
		question: state.question,
		lastAnswer: state.lastAnswer,
		timeline: state.timeline,
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
	persistState(handle.state);
}

function listenOnLoopback(server: Server): Promise<string> {
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") return reject(new Error("Failed to bind TFT Studio server."));
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
<title>TFT Studio</title>
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
.hero { padding:22px 24px; border:1px solid var(--line); border-radius:18px; background:var(--panel); }
.kicker { display:flex; gap:8px; align-items:center; color:var(--accent); font-weight:700; font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
h1 { margin:8px 0 6px; font-size:28px; line-height:1.18; }
.meta { display:flex; flex-wrap:wrap; gap:8px; margin-top:12px; color:var(--muted); }
.badge { border:1px solid var(--line); background:rgba(255,255,255,.75); border-radius:999px; padding:4px 10px; font-size:12px; }
.tabs { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin-top:16px; }
.tab { text-align:left; border:1px solid var(--line); background:var(--panel); border-radius:14px; padding:12px 14px; color:var(--text); cursor:pointer; }
.tab:hover { border-color:#c4b5fd; background:#faf9ff; }
.tab.active { border-color:var(--accent); background:var(--accent-soft); box-shadow:0 0 0 1px rgba(124,58,237,.15) inset; }
.tab-label { display:block; font-size:14px; font-weight:900; }
.tab-subtitle { display:block; margin-top:2px; color:var(--muted); font-size:11px; font-weight:650; }
.tab-status { display:inline-block; margin-top:7px; border:1px solid rgba(120,113,108,.25); border-radius:999px; padding:1px 7px; color:var(--muted); font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
.layout { display:grid; grid-template-columns:minmax(0,1fr); gap:16px; margin-top:18px; }
.card { background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:18px 20px; }
.stage-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; margin-bottom:12px; }
.stage-title { margin:0; font-size:18px; font-weight:900; }
.stage-subtitle { color:var(--muted); font-size:12px; margin-top:2px; }
.card h2 { margin:0 0 10px; font-size:17px; }
.markdown h1 { font-size:23px; border-bottom:1px solid var(--line); padding-bottom:8px; }
.markdown h2 { font-size:19px; margin-top:22px; }
.markdown h3 { font-size:16px; margin-top:18px; }
.markdown p { margin:8px 0; }
.markdown ul, .markdown ol { padding-left:24px; }
.markdown table { width:100%; border-collapse:collapse; margin:14px 0; display:block; overflow-x:auto; white-space:normal; }
.markdown th, .markdown td { border:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top; }
.markdown th { background:var(--panel2); font-weight:800; }
.markdown tr:nth-child(even) td { background:#fafaf9; }
.markdown code { background:rgba(120,113,108,.13); border-radius:6px; padding:1px 5px; }
.markdown pre { background:#292524; color:#fafaf9; border-radius:12px; padding:14px; overflow:auto; }
.question { border-color:#ddd6fe; background:#faf9ff; }
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
.answer { border-color:#bbf7d0; background:#f0fdf4; }
.answer-title { display:flex; gap:8px; align-items:center; font-size:18px; font-weight:850; margin:0 0 12px; color:var(--green); }
.answer-row { margin:8px 0; }
.answer-label { color:var(--muted); font-size:12px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
.answer-value { margin-top:3px; }
.timeline { display:grid; gap:12px; }
.timeline-item { border:1px solid var(--line); border-radius:14px; padding:12px; background:#fff; }
.timeline-head { display:flex; gap:8px; flex-wrap:wrap; align-items:center; color:var(--muted); font-size:12px; font-weight:800; margin-bottom:8px; }
.timeline-kind { color:var(--accent); text-transform:uppercase; letter-spacing:.04em; }
.timeline details { margin-top:8px; }
.timeline summary { cursor:pointer; font-weight:800; color:var(--text); }
.logs { color:var(--muted); font-size:12px; max-height:160px; overflow:auto; }
.empty { color:var(--muted); padding:24px; text-align:center; }
</style>
</head>
<body>
<div class="app">
  <section class="hero">
    <div class="kicker">TFT Studio</div>
    <h1 id="title">TFT Studio</h1>
    <div class="meta" id="meta"></div>
    <nav class="tabs" id="tabs"></nav>
  </section>
  <main class="layout">
    <section class="card markdown" id="stagePanel"><div class="empty">TFT stage markdown을 기다리는 중...</div></section>
    <section class="card question" id="questionCard" hidden></section>
    <section class="card"><h2>TFT 전문</h2><div class="timeline" id="timeline"></div></section>
    <section class="card"><h2>로그</h2><div class="logs" id="logs"></div></section>
  </main>
</div>
<script>
var state = null;
var selectedTab = null;
var STUDIO_TABS = [
  { key:'frame', label:'Frame', subtitle:'목표·범위·성공 기준', empty:'Frame markdown을 기다리는 중...' },
  { key:'decide', label:'Decide', subtitle:'대안·challenge·mitigation', empty:'아직 Decide stage가 연결되지 않았습니다. /decide가 같은 identity에 decision table과 challenge를 기록하면 이 탭에서 보여줄 자리입니다.' },
  { key:'verify', label:'Verify', subtitle:'success criteria 판정', empty:'아직 Verify stage가 연결되지 않았습니다. /verify가 frame success criteria별 판정을 기록하면 이 탭에서 보여줄 자리입니다.' },
  { key:'verify-report', label:'Verify Report', subtitle:'증거 리포트·artifact', empty:'아직 Verify Report stage가 연결되지 않았습니다. /verify-report가 생성한 report.html과 evidence artifact refs를 보여줄 자리입니다.' }
];
function esc(s) { return String(s || '').replace(/[&<>"']/g, function(c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]); }); }
function inline(s) { var tick = String.fromCharCode(96); return esc(s).replace(new RegExp(tick + '([^' + tick + ']+)' + tick, 'g'), '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>'); }
function renderMarkdown(md) {
  var lines = String(md || '').split(/\r?\n/);
  var html = []; var inCode = false; var list = null;
  function closeList() { if (list) { html.push('</' + list + '>'); list = null; } }
  function splitTableRow(line) {
    var trimmed = String(line || '').trim();
    if (trimmed.indexOf('|') < 0) return null;
    if (trimmed.charAt(0) === '|') trimmed = trimmed.slice(1);
    if (trimmed.charAt(trimmed.length - 1) === '|') trimmed = trimmed.slice(0, -1);
    var cells = []; var current = ''; var inInlineCode = false;
    for (var i = 0; i < trimmed.length; i++) {
      var ch = trimmed.charAt(i);
      if (ch === '\\' && trimmed.charAt(i + 1) === '|') { current += '|'; i++; continue; }
      if (ch === String.fromCharCode(96)) inInlineCode = !inInlineCode;
      if (ch === '|' && !inInlineCode) { cells.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    cells.push(current.trim());
    return cells.length > 1 ? cells : null;
  }
  function isTableDivider(line) {
    var cells = splitTableRow(line);
    return !!cells && cells.every(function(cell) { return /^:?-{3,}:?$/.test(cell.replace(/\s+/g, '')); });
  }
  function renderTable(start) {
    var header = splitTableRow(lines[start]);
    if (!header || !isTableDivider(lines[start + 1] || '')) return null;
    var rows = []; var i = start + 2;
    while (i < lines.length) {
      if (!lines[i].trim()) break;
      var cells = splitTableRow(lines[i]);
      if (!cells || isTableDivider(lines[i])) break;
      rows.push(cells); i++;
    }
    var colCount = header.length;
    var out = '<table><thead><tr>' + header.map(function(cell) { return '<th>' + inline(cell) + '</th>'; }).join('') + '</tr></thead><tbody>';
    rows.forEach(function(row) {
      out += '<tr>';
      for (var c = 0; c < colCount; c++) out += '<td>' + inline(row[c] || '') + '</td>';
      out += '</tr>';
    });
    out += '</tbody></table>';
    return { html: out, next: i };
  }
  for (var idx = 0; idx < lines.length; idx++) {
    var line = lines[idx];
    if (/^\s*/.test(line) && line.trim().indexOf(String.fromCharCode(96).repeat(3)) === 0) { closeList(); if (inCode) html.push('</code></pre>'); else html.push('<pre><code>'); inCode = !inCode; continue; }
    if (inCode) { html.push(esc(line) + '\n'); continue; }
    var table = renderTable(idx); if (table) { closeList(); html.push(table.html); idx = table.next - 1; continue; }
    if (/^###\s+/.test(line)) { closeList(); html.push('<h3>' + inline(line.replace(/^###\s+/, '')) + '</h3>'); continue; }
    if (/^##\s+/.test(line)) { closeList(); html.push('<h2>' + inline(line.replace(/^##\s+/, '')) + '</h2>'); continue; }
    if (/^#\s+/.test(line)) { closeList(); html.push('<h1>' + inline(line.replace(/^#\s+/, '')) + '</h1>'); continue; }
    var ol = line.match(/^\s*(\d+)\.\s+(.*)$/); if (ol) { if (list !== 'ol') { closeList(); list = 'ol'; html.push('<ol>'); } html.push('<li>' + inline(ol[2]) + '</li>'); continue; }
    var ul = line.match(/^\s*[-*]\s+(.*)$/); if (ul) { if (list !== 'ul') { closeList(); list = 'ul'; html.push('<ul>'); } html.push('<li>' + inline(ul[1]) + '</li>'); continue; }
    closeList();
    if (!line.trim()) html.push('<br/>'); else html.push('<p>' + inline(line) + '</p>');
  }
  closeList(); if (inCode) html.push('</code></pre>');
  return html.join('');
}
function setStatus(text) { var el = document.getElementById('submitStatus'); if (el) el.textContent = text; }
function answerStatusLabel(status) {
  if (status === 'answered') return '선택 완료됨';
  if (status === 'cancelled') return '선택 취소됨';
  if (status === 'timeout') return '응답 시간 초과';
  return '응답 상태: ' + esc(status || 'unknown');
}
function renderAnswerCard(answer) {
  var optionHtml = (answer.selectedOptions || []).length
    ? '<ol>' + answer.selectedOptions.map(function(opt) { return '<li>' + inline(opt) + '</li>'; }).join('') + '</ol>'
    : '<div class="status">선택한 옵션 없음</div>';
  var textHtml = answer.text ? '<div class="answer-row"><div class="answer-label">직접 입력</div><div class="answer-value">' + inline(answer.text) + '</div></div>' : '';
  return '<div class="answer-title">✅ ' + answerStatusLabel(answer.status) + '</div>'
    + (answer.question ? '<div class="answer-row"><div class="answer-label">질문</div><div class="answer-value">' + inline(answer.question) + '</div></div>' : '')
    + '<div class="answer-row"><div class="answer-label">선택값</div><div class="answer-value">' + optionHtml + '</div></div>'
    + textHtml
    + '<div class="status">Pi가 다음 단계를 준비 중입니다. 다음 markdown update가 오면 이 카드가 교체됩니다.</div>';
}
function renderTimelineEntry(entry) {
  var head = '<div class="timeline-head"><span>' + new Date(entry.time).toLocaleTimeString() + '</span><span class="timeline-kind">' + esc(entry.kind || '') + '</span>' + (entry.tab ? '<span>' + esc(entry.tab) + '</span>' : '') + (entry.step ? '<span>' + esc(entry.step) + '</span>' : '') + '</div>';
  var body = '';
  if (entry.message) body += '<p>' + inline(entry.message) + '</p>';
  if (entry.markdown) body += '<details><summary>Markdown 전문</summary><div class="markdown">' + renderMarkdown(entry.markdown) + '</div></details>';
  if (entry.question) {
    body += '<div class="answer-row"><div class="answer-label">질문</div><div class="answer-value">' + inline(entry.question.question) + '</div></div>';
    if ((entry.question.options || []).length) {
      body += '<div class="answer-row"><div class="answer-label">옵션</div><ol>' + entry.question.options.map(function(opt) { return '<li>' + inline(opt) + '</li>'; }).join('') + '</ol></div>';
    }
  }
  if (entry.answer) body += renderAnswerCard(entry.answer);
  return '<div class="timeline-item">' + head + (body || '<span class="status">내용 없음</span>') + '</div>';
}
function renderTimeline(entries) {
  if (!entries || !entries.length) return '<span class="status">아직 기록된 TFT 전문이 없습니다.</span>';
  return entries.map(renderTimelineEntry).join('');
}
function tabData(s, key) {
  var tabs = s.tabs || {};
  var data = tabs[key] || {};
  if (key === 'frame' && !data.markdown && s.markdown) data = { markdown:s.markdown, step:s.step, updatedAt:s.updatedAt };
  return data;
}
function activeTabKey(s) {
  var key = selectedTab || s.activeTab || 'frame';
  return STUDIO_TABS.some(function(tab) { return tab.key === key; }) ? key : 'frame';
}
function tabStatus(s, key) {
  var data = tabData(s, key);
  if (s.status === 'awaiting' && s.question && s.question.tab === key) return 'awaiting';
  if (key === 'frame' && s.status === 'done') return 'done';
  if (data.markdown) return 'active';
  return 'idle';
}
function renderTabs(s) {
  var active = activeTabKey(s);
  return STUDIO_TABS.map(function(tab) {
    var status = tabStatus(s, tab.key);
    return '<button class="tab ' + (tab.key === active ? 'active' : '') + '" onclick="selectTab(\'' + tab.key + '\')">'
      + '<span class="tab-label">' + esc(tab.label) + '</span>'
      + '<span class="tab-subtitle">' + esc(tab.subtitle) + '</span>'
      + '<span class="tab-status">' + esc(status) + '</span>'
      + '</button>';
  }).join('');
}
function renderStagePanel(s) {
  var active = activeTabKey(s);
  var meta = STUDIO_TABS.find(function(tab) { return tab.key === active; }) || STUDIO_TABS[0];
  var data = tabData(s, active);
  var body = data.markdown ? renderMarkdown(data.markdown) : '<div class="empty">' + inline(meta.empty) + '</div>';
  return '<div class="stage-head"><div><div class="stage-title">' + esc(meta.label) + '</div><div class="stage-subtitle">' + esc(meta.subtitle) + '</div></div>'
    + '<span class="badge">' + esc(tabStatus(s, active)) + '</span></div>' + body;
}
function selectTab(key) { selectedTab = key; if (state) render(state); }
function render(s) {
  state = s;
  if (s.status === 'awaiting' && s.question && !selectedTab) selectedTab = s.question.tab || s.activeTab || 'frame';
  document.title = s.title || 'TFT Studio';
  document.getElementById('title').textContent = s.title || 'TFT Studio';
  var ident = s.identity || {};
  document.getElementById('meta').innerHTML = [
    '<span class="badge">TFT Studio</span>',
    '<span class="badge">' + esc(ident.mode || 'unknown') + '</span>',
    '<span class="badge">' + esc(ident.displayTitle || '') + '</span>',
    s.step ? '<span class="badge">' + esc(s.step) + '</span>' : '',
    '<span class="badge">' + esc(s.status || '') + '</span>'
  ].filter(Boolean).join('');
  document.getElementById('tabs').innerHTML = renderTabs(s);
  document.getElementById('stagePanel').innerHTML = renderStagePanel(s);
  var q = s.question;
  var qc = document.getElementById('questionCard');
  if (!q || s.status !== 'awaiting') {
    if (s.lastAnswer) {
      qc.hidden = false;
      qc.className = 'card answer';
      qc.innerHTML = renderAnswerCard(s.lastAnswer);
    } else {
      qc.hidden = true;
    }
  }
  else {
    qc.hidden = false;
    qc.className = 'card question';
    var type = q.multiSelect ? 'checkbox' : 'radio';
    qc.innerHTML = '<div class="question-title">' + esc(q.question) + '</div>'
      + '<div class="status">stage: ' + esc(q.tab || 'frame') + '</div>'
      + (q.markdown ? '<div class="markdown">' + renderMarkdown(q.markdown) + '</div>' : '')
      + '<div class="options">' + q.options.map(function(opt, i) {
        return '<label class="option"><input name="frameOption" type="' + type + '" value="' + i + '"><span class="option-number">' + (i + 1) + '</span><span>' + inline(opt) + '</span></label>';
      }).join('') + '</div>'
      + (q.allowText ? '<textarea id="answerText" placeholder="' + esc(q.placeholder || '직접 입력') + '"></textarea>' : '')
      + '<div class="actions"><button class="primary" onclick="submitAnswer()">' + esc(q.submitLabel || '선택 완료') + '</button><button class="secondary" onclick="cancelAnswer()">취소</button><span class="status" id="submitStatus"></span></div>';
  }
  document.getElementById('timeline').innerHTML = renderTimeline(s.timeline || []);
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
				const questionTab = handle.state.question?.tab ?? handle.state.activeTab;
				const options = handle.state.question?.options ?? [];
				const answer: StudioAnswer = {
					status: body.cancelled ? "cancelled" : "answered",
					questionId: pending.questionId,
					question: handle.state.question?.question,
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
				appendTimeline(handle.state, { kind: "answer", tab: questionTab, step: handle.state.step, answer });
				addLog(handle, answer.status === "cancelled" ? "Question cancelled by user." : "Question answered in TFT Studio.");
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

async function ensureRun(pi: ExtensionAPI, ctx: ExtensionContext, params: { title?: string; markdown?: string; step?: string; tab?: string; identityKey?: string; displayTitle?: string; args?: string }): Promise<{ handle: FrameStudioHandle; opened: "glimpse" | "browser" | "none" | "reused" }> {
	mkdirSync(STATE_DIR, { recursive: true });
	const inferred = buildFrameIdentity(ctx as any, params.args ?? "");
	const identity = params.identityKey || params.displayTitle
		? { ...inferred, key: params.identityKey || inferred.key, displayTitle: params.displayTitle || inferred.displayTitle }
		: inferred;
	const tab = normalizeTab(params.tab) ?? "frame";
	let handle = runsByIdentity.get(identity.key);
	if (handle && !handle.closed) {
		if (params.title) handle.state.title = params.title;
		updateTab(handle.state, tab, { markdown: params.markdown, step: params.step });
		if (params.markdown !== undefined || params.step) handle.state.lastAnswer = undefined;
		if (params.markdown !== undefined || params.step || params.title || params.tab) {
			appendTimeline(handle.state, { kind: "update", tab, title: params.title, step: params.step, markdown: params.markdown });
		}
		handle.state.updatedAt = Date.now();
		pushState(handle);
		latestRunId = handle.state.runId;
		return { handle, opened: "reused" };
	}

	const restored = loadPersistedState(identity);
	const runId = restored?.runId ?? randomUUID().slice(0, 8);
	const state: FrameStudioState = restored ?? {
		runId,
		identity,
		title: params.title || identity.displayTitle || "TFT Studio",
		markdown: params.markdown || "",
		step: params.step,
		activeTab: tab,
		tabs: makeDefaultTabs(params.markdown || "", params.step),
		status: "running",
		url: "",
		transcriptPath: transcriptPathForIdentity(identity.key),
		createdAt: Date.now(),
		updatedAt: Date.now(),
		timeline: [],
		logs: [],
	};
	if (params.title) state.title = params.title;
	updateTab(state, tab, { markdown: params.markdown, step: params.step });
	handle = createServerFor(state);
	state.url = await listenOnLoopback(handle.server);
	if (restored) appendTimeline(state, { kind: "restore", tab, step: params.step, markdown: params.markdown, message: "Saved TFT Studio transcript restored." });
	else appendTimeline(state, { kind: "start", tab, title: state.title, step: state.step, markdown: state.markdown, message: "TFT Studio started." });
	addLog(handle, restored ? "Saved TFT Studio transcript restored." : "TFT Studio started.");
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
		const questionTab = handle.state.question?.tab ?? handle.state.activeTab;
		const answer: StudioAnswer = { status: "cancelled", questionId: handle.pending.questionId, question: handle.state.question?.question, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() };
		handle.state.lastAnswer = answer;
		handle.state.question = undefined;
		handle.state.status = "running";
		appendTimeline(handle.state, { kind: "answer", tab: questionTab, step: handle.state.step, answer });
		handle.pending.resolve(answer);
		handle.pending = undefined;
	}
	runsById.delete(handle.state.runId);
	runsByIdentity.delete(handle.state.identity.key);
}

function ask(handle: FrameStudioHandle, question: StudioQuestion, signal?: AbortSignal): Promise<StudioAnswer> {
	if (handle.pending) {
		clearTimeout(handle.pending.timer);
		handle.pending.resolve({ status: "cancelled", questionId: handle.pending.questionId, question: handle.state.question?.question, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() });
	}
	handle.state.lastAnswer = undefined;
	handle.state.question = question;
	handle.state.status = "awaiting";
	updateTab(handle.state, question.tab, { markdown: question.markdown, step: handle.state.step });
	appendTimeline(handle.state, { kind: "question", tab: question.tab, step: handle.state.step, markdown: question.markdown, question });
	addLog(handle, `Awaiting answer: ${question.question}`);
	pushState(handle);
	return new Promise((resolve) => {
		const timer = setTimeout(() => {
			if (handle.pending?.questionId !== question.id) return;
			handle.pending = undefined;
			const answer: StudioAnswer = { status: "timeout", questionId: question.id, question: question.question, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() };
			handle.state.lastAnswer = answer;
			handle.state.question = undefined;
			handle.state.status = "running";
			appendTimeline(handle.state, { kind: "answer", tab: question.tab, step: handle.state.step, answer });
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
				const answer: StudioAnswer = { status: "cancelled", questionId: question.id, question: question.question, selectedIndices: [], selectedOptions: [], submittedAt: Date.now() };
				handle.state.lastAnswer = answer;
				handle.state.question = undefined;
				handle.state.status = "running";
				appendTimeline(handle.state, { kind: "answer", tab: question.tab, step: handle.state.step, answer });
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
		label: "TFT Studio",
		description: "Open/update a Glimpse TFT Studio shell for Frame/Decide/Verify/Verify Report work-unit flow. The tool name remains frame_studio for compatibility.",
		parameters: Type.Object({
			action: Type.String({ description: "start|update|ask|open|finish|abort" }),
			runId: Type.Optional(Type.String({ description: "Existing TFT Studio run id. Omit to use identity/latest run." })),
			identityKey: Type.Optional(Type.String({ description: "Override identity key. Usually use Frame identity hint key. Also reopens the saved transcript for that identity." })),
			displayTitle: Type.Optional(Type.String({ description: "Override display title." })),
			args: Type.Optional(Type.String({ description: "Original /frame args used for identity inference." })),
			title: Type.Optional(Type.String({ description: "Window/report title." })),
			tab: Type.Optional(Type.String({ description: "TFT Studio tab: frame|decide|verify|verify-report. Defaults to frame." })),
			step: Type.Optional(Type.String({ description: "Current stage step label." })),
			markdown: Type.Optional(Type.String({ description: "Markdown to render in the selected TFT Studio tab." })),
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
				return resultText(`TFT Studio started (${handle.state.runId}). ${handle.state.url}. Transcript: ${handle.state.transcriptPath}. Opened: ${opened}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, identity: handle.state.identity, activeTab: handle.state.activeTab, opened });
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
			if (!handle) throw new Error("No active TFT Studio run. Call action=start first.");

			if (action === "open") {
				const opened = await openStudio(pi, ctx, handle);
				return resultText(`TFT Studio opened (${handle.state.runId}). ${handle.state.url}. Transcript: ${handle.state.transcriptPath}. Opened: ${opened}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, opened });
			}

			if (action === "update") {
				const tab = normalizeTab(params.tab) ?? handle.state.activeTab ?? "frame";
				if (params.title) handle.state.title = params.title;
				updateTab(handle.state, tab, { markdown: params.markdown, step: params.step });
				if (params.markdown !== undefined || params.step) handle.state.lastAnswer = undefined;
				appendTimeline(handle.state, { kind: "update", tab, title: params.title, step: params.step, markdown: params.markdown });
				addLog(handle, `Updated ${tab}${params.step ? `: ${params.step}` : ""}.`);
				pushState(handle);
				return resultText(`TFT Studio updated (${handle.state.runId}). Transcript: ${handle.state.transcriptPath}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab });
			}

			if (action === "ask") {
				if (!ctx.hasUI) {
					return resultText("TFT Studio UI is unavailable in this context. Use numbered text-mode AskUserQuestion fallback.", { status: "unavailable", transcriptPath: handle.state.transcriptPath });
				}
				const tab = normalizeTab(params.tab) ?? handle.state.activeTab ?? "frame";
				if (params.title) handle.state.title = params.title;
				if (params.step) handle.state.step = params.step;
				updateTab(handle.state, tab, { markdown: params.markdown, step: params.step });
				if (!handle.window) await openStudio(pi, ctx, handle);
				const question: StudioQuestion = {
					id: randomUUID().slice(0, 8),
					tab,
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
						? `TFT Studio answer: ${answer.selectedOptions.join(", ") || "(no option)"}${answer.text ? `; text: ${answer.text}` : ""}`
						: `TFT Studio ask ended: ${answer.status}.`,
					{ runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab, answer },
				);
			}

			if (action === "finish") {
				const tab = normalizeTab(params.tab) ?? handle.state.activeTab ?? "frame";
				updateTab(handle.state, tab, { markdown: params.markdown, step: params.step });
				handle.state.status = "done";
				appendTimeline(handle.state, { kind: "finish", tab, step: params.step ?? handle.state.step, markdown: params.markdown, message: "TFT Studio finished." });
				addLog(handle, "TFT Studio finished.");
				pushState(handle);
				return resultText(`TFT Studio finished (${handle.state.runId}). Transcript: ${handle.state.transcriptPath}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab });
			}

			if (action === "abort") {
				handle.state.status = "aborted";
				appendTimeline(handle.state, { kind: "abort", tab: handle.state.activeTab, step: handle.state.step, message: "TFT Studio aborted." });
				addLog(handle, "TFT Studio aborted.");
				pushState(handle);
				return resultText(`TFT Studio aborted (${handle.state.runId}). Transcript: ${handle.state.transcriptPath}.`, { runId: handle.state.runId, url: handle.state.url, transcriptPath: handle.state.transcriptPath, activeTab: handle.state.activeTab });
			}

			throw new Error(`Unknown frame_studio action: ${params.action}`);
		},
	});

	pi.on("session_shutdown", () => {
		for (const handle of [...runsById.values()]) closeHandle(handle);
	});
}
