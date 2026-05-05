import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { homedir, platform } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

const REPORT_SIGNATURE = "Verify Report";
const DEFAULT_WORKSPACE_PREFIX = ".context/work";
const REPORTS_ARCHIVE_DIR = join(homedir(), "Documents", "agent-history", "reports");

const REPORT_SURFACE_TONES = [50, 100, 200, 300] as const;
const REPORT_SURFACE_SCALE: Record<(typeof REPORT_SURFACE_TONES)[number], string> = {
	50: "#fafaf9",
	100: "#f5f5f4",
	200: "#e7e5e4",
	300: "#d6d3d1",
};

function distributeReportSurfaceTones<T extends readonly string[]>(tokens: T): Record<T[number], string> {
	const maxToneIndex = REPORT_SURFACE_TONES.length - 1;
	const maxTokenIndex = Math.max(tokens.length - 1, 1);
	return Object.fromEntries(
		tokens.map((token, index) => {
			const toneIndex = Math.round((index / maxTokenIndex) * maxToneIndex);
			return [token, REPORT_SURFACE_SCALE[REPORT_SURFACE_TONES[toneIndex]]];
		}),
	) as Record<T[number], string>;
}

const REPORT_SURFACE = distributeReportSurfaceTones(["bg", "panel", "panel2", "line"] as const);
const REPORT_COLORS = {
	text: "#292524",
	detail: "#44403c",
	muted: "#78716c",
	accent: "#a78bfa",
	accentText: "#6d28d9",
	green: "#166534",
	red: "#991b1b",
	yellow: "#854d0e",
	badgeBg: "rgba(231,229,228,.62)",
	inlineCodeBg: "rgba(120,113,108,.14)",
	logLine: "rgba(41,37,36,.08)",
	imageBg: "#fff",
} as const;

function reportRootVariablesCss(): string {
	return [
		"color-scheme: light",
		`--bg:${REPORT_SURFACE.bg}`,
		`--panel:${REPORT_SURFACE.panel}`,
		`--panel2:${REPORT_SURFACE.panel2}`,
		`--codeBg:${REPORT_SURFACE.panel2}`,
		`--line:${REPORT_SURFACE.line}`,
		`--text:${REPORT_COLORS.text}`,
		`--detail:${REPORT_COLORS.detail}`,
		`--muted:${REPORT_COLORS.muted}`,
		`--accent:${REPORT_COLORS.accent}`,
		`--accentText:${REPORT_COLORS.accentText}`,
		`--green:${REPORT_COLORS.green}`,
		`--red:${REPORT_COLORS.red}`,
		`--yellow:${REPORT_COLORS.yellow}`,
		`--badgeBg:${REPORT_COLORS.badgeBg}`,
		`--inlineCodeBg:${REPORT_COLORS.inlineCodeBg}`,
		`--logLine:${REPORT_COLORS.logLine}`,
		`--imageBg:${REPORT_COLORS.imageBg}`,
	].join("; ");
}

type ReportStatus = "draft" | "running" | "done" | "aborted";
type ItemStatus = "pending" | "running" | "pass" | "fail" | "skip" | "blocked" | "unverified";

type EvidenceKind = "image" | "gif" | "json" | "text" | "network" | "console" | "diff" | "link";

interface Evidence {
	label?: string;
	kind?: EvidenceKind;
	path?: string;
	url?: string;
	text?: string;
}

interface ReportItem {
	id: string;
	title: string;
	type?: string;
	status: ItemStatus;
	detail?: string;
	evidence: Evidence[];
	updatedAt: number;
}

interface VerifyReportState {
	runId: string;
	title: string;
	ticket?: string;
	workspaceName: string;
	cwd: string;
	capturesDir: string;
	reportPath: string;
	archivePath?: string;
	url: string;
	status: ReportStatus;
	summary?: string;
	finalSummary?: string;
	createdAt: number;
	updatedAt: number;
	items: ReportItem[];
	logs: Array<{ time: number; message: string }>;
}

interface GlimpseWindow {
	on(event: "closed", handler: () => void): void;
	close(): void;
}

interface LiveHandle {
	state: VerifyReportState;
	server: Server;
	clients: Set<ServerResponse>;
	pingInterval: ReturnType<typeof setInterval>;
	window?: GlimpseWindow;
	closed: boolean;
}

const liveRuns = new Map<string, LiveHandle>();
let glimpseOpen: ((html: string, opts: Record<string, unknown>) => GlimpseWindow) | null | undefined;

const evidenceSchema = Type.Object({
	label: Type.Optional(Type.String()),
	kind: Type.Optional(Type.String({ description: "image|gif|json|text|network|console|diff|link" })),
	path: Type.Optional(Type.String({ description: "Local evidence file path, relative to cwd or absolute." })),
	url: Type.Optional(Type.String({ description: "Remote evidence URL." })),
	text: Type.Optional(Type.String({ description: "Inline evidence text or short excerpt." })),
});

const itemSchema = Type.Object({
	id: Type.String({ description: "Stable item id, e.g. V1 or A1." }),
	title: Type.String({ description: "Verification criterion/title." }),
	type: Type.Optional(Type.String({ description: "UI_CAPTURE|NETWORK|CONSOLE|CODE_DIFF|BE|SKIP" })),
	status: Type.Optional(Type.String({ description: "pending|running|pass|fail|skip|blocked|unverified" })),
	detail: Type.Optional(Type.String({ description: "What was checked and what happened." })),
	evidence: Type.Optional(Type.Array(evidenceSchema)),
});

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
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function mimeFor(filePath: string): string {
	const ext = extname(filePath).toLowerCase();
	if (ext === ".png") return "image/png";
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".gif") return "image/gif";
	if (ext === ".webp") return "image/webp";
	if (ext === ".svg") return "image/svg+xml";
	if (ext === ".json") return "application/json; charset=utf-8";
	if (ext === ".html") return "text/html; charset=utf-8";
	return "text/plain; charset=utf-8";
}

function normalizeWorkspaceName(cwd: string, requested?: string): string {
	const trimmed = requested?.trim();
	if (trimmed) return trimmed.replace(/[^a-zA-Z0-9가-힣._-]/g, "-");
	return basename(cwd) || "workspace";
}

function capturesDirFor(cwd: string, workspaceName: string): string {
	return resolve(cwd, DEFAULT_WORKSPACE_PREFIX, workspaceName, "captures");
}

function normalizeLocalPath(rawPath: string, cwd: string): string {
	return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
}

function isPathAllowed(filePath: string, state: VerifyReportState): boolean {
	const resolved = resolve(filePath);
	const roots = [resolve(state.cwd), resolve(state.capturesDir)];
	return roots.some((root) => {
		const rel = relative(root, resolved);
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	});
}

function evidenceWithNormalizedPath(evidence: Evidence, state: VerifyReportState): Evidence {
	if (!evidence.path) return evidence;
	return { ...evidence, path: normalizeLocalPath(evidence.path, state.cwd) };
}

function statusLabel(status: ItemStatus | ReportStatus): string {
	const labels: Record<string, string> = {
		draft: "준비",
		running: "진행 중",
		done: "완료",
		aborted: "중단",
		pending: "대기",
		pass: "PASS",
		fail: "FAIL",
		skip: "SKIP",
		blocked: "BLOCKED",
		unverified: "미검증",
	};
	return labels[status] ?? status;
}

function statusClass(status: string): string {
	if (status === "pass" || status === "done") return "pass";
	if (status === "fail" || status === "aborted") return "fail";
	if (status === "skip" || status === "blocked" || status === "unverified") return "skip";
	if (status === "running") return "running";
	return "pending";
}

function addLog(state: VerifyReportState, message: string): void {
	state.logs.push({ time: Date.now(), message });
	state.logs = state.logs.slice(-80);
}

function pushState(handle: LiveHandle): void {
	handle.state.updatedAt = Date.now();
	const data = `event: state\ndata: ${JSON.stringify(publicState(handle.state))}\n\n`;
	for (const client of handle.clients) {
		try { client.write(data); } catch {}
	}
}

function publicState(state: VerifyReportState) {
	return {
		runId: state.runId,
		title: state.title,
		ticket: state.ticket,
		workspaceName: state.workspaceName,
		status: state.status,
		summary: state.summary,
		finalSummary: state.finalSummary,
		createdAt: state.createdAt,
		updatedAt: state.updatedAt,
		reportPath: state.reportPath,
		archivePath: state.archivePath,
		items: state.items,
		logs: state.logs,
	};
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(value));
}

function serveFile(res: ServerResponse, filePath: string): void {
	try {
		const stat = statSync(filePath);
		if (!stat.isFile()) {
			res.writeHead(404);
			res.end("not found");
			return;
		}
		res.writeHead(200, { "content-type": mimeFor(filePath), "cache-control": "no-store" });
		createReadStream(filePath).pipe(res);
	} catch {
		res.writeHead(404);
		res.end("not found");
	}
}

function createLiveServer(state: VerifyReportState): LiveHandle {
	const clients = new Set<ServerResponse>();
	let handle: LiveHandle;
	const server = createServer((req, res) => {
		const host = req.headers.host ?? "127.0.0.1";
		const url = new URL(req.url ?? "/", `http://${host}`);
		if (url.pathname === "/") {
			res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
			res.end(generateLivePage(publicState(state)));
			return;
		}
		if (url.pathname === "/state") {
			sendJson(res, 200, publicState(state));
			return;
		}
		if (url.pathname === "/events") {
			res.writeHead(200, {
				"content-type": "text/event-stream; charset=utf-8",
				"cache-control": "no-cache, no-transform",
				connection: "keep-alive",
			});
			res.write(`event: state\ndata: ${JSON.stringify(publicState(state))}\n\n`);
			clients.add(res);
			req.on("close", () => clients.delete(res));
			return;
		}
		if (url.pathname === "/file") {
			const rawPath = url.searchParams.get("path");
			if (!rawPath) {
				res.writeHead(400);
				res.end("missing path");
				return;
			}
			const filePath = normalizeLocalPath(rawPath, state.cwd);
			if (!isPathAllowed(filePath, state)) {
				res.writeHead(403);
				res.end("forbidden");
				return;
			}
			serveFile(res, filePath);
			return;
		}
		res.writeHead(404);
		res.end("not found");
	});
	const pingInterval = setInterval(() => {
		for (const client of clients) {
			try { client.write(": ping\n\n"); } catch {}
		}
	}, 15000);
	pingInterval.unref?.();
	handle = { state, server, clients, pingInterval, closed: false };
	return handle;
}

async function listenOnLoopback(server: Server): Promise<string> {
	return await new Promise((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			server.off("error", reject);
			const address = server.address();
			if (!address || typeof address === "string") {
				reject(new Error("invalid server address"));
				return;
			}
			resolveListen(`http://127.0.0.1:${address.port}`);
		});
	});
}

function openGlimpseUrl(open: (html: string, opts: Record<string, unknown>) => GlimpseWindow, url: string, title: string): GlimpseWindow {
	const shellHtml = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:${REPORT_SURFACE.bg}"><script>window.location.replace(${JSON.stringify(url)});</script></body></html>`;
	return open(shellHtml, { width: 1180, height: 920, title, openLinks: true });
}

async function openUrlInBrowser(pi: ExtensionAPI, url: string): Promise<void> {
	const plat = platform();
	const result = plat === "darwin"
		? await pi.exec("open", [url])
		: plat === "win32"
			? await pi.exec("cmd", ["/c", "start", "", url])
			: await pi.exec("xdg-open", [url]);
	if (result.code !== 0) throw new Error(result.stderr || `Failed to open browser (${result.code})`);
}

async function openLivePreview(pi: ExtensionAPI, handle: LiveHandle): Promise<"glimpse" | "browser" | "none"> {
	const open = await getGlimpseOpen();
	if (open) {
		try {
			const win = openGlimpseUrl(open, handle.state.url, handle.state.title);
			handle.window = win;
			win.on("closed", () => {
				handle.window = undefined;
			});
			return "glimpse";
		} catch {}
	}
	try {
		await openUrlInBrowser(pi, handle.state.url);
		return "browser";
	} catch {}
	return "none";
}

function mergeItem(state: VerifyReportState, itemInput: Partial<ReportItem> & { id: string; title: string }): ReportItem {
	const existing = state.items.find((item) => item.id === itemInput.id);
	const nextEvidence = (itemInput.evidence ?? existing?.evidence ?? []).map((evidence) => evidenceWithNormalizedPath(evidence, state));
	if (existing) {
		existing.title = itemInput.title ?? existing.title;
		existing.type = itemInput.type ?? existing.type;
		existing.status = itemInput.status ?? existing.status;
		existing.detail = itemInput.detail ?? existing.detail;
		existing.evidence = nextEvidence;
		existing.updatedAt = Date.now();
		return existing;
	}
	const item: ReportItem = {
		id: itemInput.id,
		title: itemInput.title,
		type: itemInput.type,
		status: itemInput.status ?? "pending",
		detail: itemInput.detail,
		evidence: nextEvidence,
		updatedAt: Date.now(),
	};
	state.items.push(item);
	return item;
}

function normalizeItemInput(raw: unknown): Array<Partial<ReportItem> & { id: string; title: string }> {
	const raws = Array.isArray(raw) ? raw : raw ? [raw] : [];
	return raws.filter((value): value is Partial<ReportItem> & { id: string; title: string } => {
		if (!value || typeof value !== "object") return false;
		const item = value as Record<string, unknown>;
		return typeof item.id === "string" && typeof item.title === "string";
	});
}

function evidenceKind(evidence: Evidence): EvidenceKind {
	if (evidence.kind) return evidence.kind;
	if (evidence.url) return "link";
	if (!evidence.path) return "text";
	const ext = extname(evidence.path).toLowerCase();
	if ([".png", ".jpg", ".jpeg", ".webp", ".svg"].includes(ext)) return "image";
	if (ext === ".gif") return "gif";
	if (ext === ".json") return "json";
	return "text";
}

function relativeEvidencePath(evidence: Evidence, state: VerifyReportState): string | null {
	if (!evidence.path) return null;
	const rel = relative(dirname(state.reportPath), evidence.path);
	return rel.startsWith("..") || isAbsolute(rel) ? evidence.path : rel;
}

function renderEvidenceStatic(evidence: Evidence, state: VerifyReportState): string {
	const kind = evidenceKind(evidence);
	const label = evidence.label || kind;
	if (evidence.url) return `<a href="${escapeHtml(evidence.url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
	if (evidence.path && ["image", "gif"].includes(kind)) {
		const src = relativeEvidencePath(evidence, state) ?? evidence.path;
		return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)} · ${escapeHtml(basename(evidence.path))}</figcaption></figure>`;
	}
	if (evidence.path) return `<p><strong>${escapeHtml(label)}</strong>: <code>${escapeHtml(relativeEvidencePath(evidence, state) ?? evidence.path)}</code></p>`;
	if (evidence.text) return `<pre><code>${escapeHtml(evidence.text)}</code></pre>`;
	return "";
}

function generateLivePage(initialState: unknown): string {
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Verify Report Live</title>
<style>
	:root { ${reportRootVariablesCss()} }
	* { box-sizing: border-box; }
	body { margin: 0; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	.header { position: sticky; top: 0; z-index: 2; background: rgba(250,250,249,.94); border-bottom: 1px solid var(--line); padding: 16px 22px; backdrop-filter: blur(8px); }
	.header-row { display:flex; justify-content:space-between; gap:16px; align-items:flex-start; }
	h1 { margin:0 0 8px; font-size:24px; }
	.meta { display:flex; flex-wrap:wrap; gap:7px; color:var(--muted); font-size:12px; }
	.badge { border:1px solid var(--line); border-radius:999px; padding:4px 8px; background:var(--badgeBg); }
	.badge.running { border-color: var(--accent); color: var(--accentText); }
	.badge.pass, .badge.done { border-color: var(--green); color: var(--green); }
	.badge.fail, .badge.aborted { border-color: var(--red); color: var(--red); }
	main { max-width: 1100px; margin: 0 auto; padding: 22px; }
	.summary, .item, .logs { background: var(--panel); border:1px solid var(--line); border-radius:16px; padding:18px; margin-bottom:16px; }
	.summary h2, .logs h2 { margin:0 0 10px; font-size:18px; }
	.grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap:10px; margin:14px 0; }
	.stat { background:var(--panel2); border:1px solid var(--line); border-radius:12px; padding:12px; }
	.stat strong { display:block; font-size:22px; }
	.item-head { display:flex; align-items:flex-start; justify-content:space-between; gap:14px; }
	.item h3 { margin:0; font-size:18px; }
	.item .type { color:var(--muted); font-size:12px; margin-top:4px; }
	.status { border-radius:999px; padding:5px 9px; font-size:12px; border:1px solid var(--line); white-space:nowrap; }
	.status.pass { color:var(--green); border-color:var(--green); }
	.status.fail { color:var(--red); border-color:var(--red); }
	.status.running { color:var(--accentText); border-color:var(--accent); }
	.status.skip, .status.blocked, .status.unverified { color:var(--yellow); border-color:var(--yellow); }
	.detail { color:var(--detail); line-height:1.55; white-space:pre-wrap; }
	.evidence { display:grid; gap:12px; margin-top:12px; }
	figure { margin:0; }
	img { display:block; max-width:100%; border:1px solid var(--line); border-radius:12px; background:var(--imageBg); }
	figcaption { color:var(--muted); font-size:12px; margin-top:6px; }
	pre { white-space:pre-wrap; overflow:auto; background:var(--codeBg); border:1px solid var(--line); border-radius:10px; padding:12px; color:var(--text); }
	code { background:var(--inlineCodeBg); border-radius:4px; padding:1px 4px; }
	a { color:var(--accentText); }
	.log { color:var(--muted); font-size:12px; padding:5px 0; border-bottom:1px solid var(--logLine); }
	.pulse { width:9px; height:9px; display:inline-block; border-radius:50%; background:var(--accentText); margin-right:7px; animation:pulse 1.2s infinite; }
	@keyframes pulse { 0%,100%{opacity:.25} 50%{opacity:1} }
</style>
</head>
<body>
<div id="app"></div>
<script>
var state = ${JSON.stringify(initialState)};
function esc(v) { return String(v == null ? '' : v).replace(/[&<>\"]/g, function(ch) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]; }); }
function statusLabel(s) { return ({draft:'준비',running:'진행 중',done:'완료',aborted:'중단',pending:'대기',pass:'PASS',fail:'FAIL',skip:'SKIP',blocked:'BLOCKED',unverified:'미검증'})[s] || s; }
function count(status) { return (state.items || []).filter(function(i){ return i.status === status; }).length; }
function evKind(ev) { if (ev.kind) return ev.kind; if (ev.url) return 'link'; if (!ev.path) return 'text'; var p=ev.path.toLowerCase(); if (/\.(png|jpg|jpeg|webp|svg)$/.test(p)) return 'image'; if (/\.gif$/.test(p)) return 'gif'; if (/\.json$/.test(p)) return 'json'; return 'text'; }
function evHtml(ev) {
  var kind = evKind(ev); var label = ev.label || kind;
  if (ev.url) return '<a href="' + esc(ev.url) + '" target="_blank" rel="noreferrer">' + esc(label) + '</a>';
  if (ev.path && (kind === 'image' || kind === 'gif')) return '<figure><img src="/file?path=' + encodeURIComponent(ev.path) + '" alt="' + esc(label) + '"><figcaption>' + esc(label) + ' · ' + esc(ev.path.split('/').pop()) + '</figcaption></figure>';
  if (ev.path) return '<p><strong>' + esc(label) + '</strong>: <code>' + esc(ev.path) + '</code></p>';
  if (ev.text) return '<pre><code>' + esc(ev.text) + '</code></pre>';
  return '';
}
function render() {
  var items = state.items || [];
  var html = '<div class="header"><div class="header-row"><div><h1>' + esc(state.title || 'Verify Report Live') + '</h1><div class="meta">' +
    '<span class="badge ' + esc(state.status) + '">' + (state.status === 'running' ? '<span class="pulse"></span>' : '') + statusLabel(state.status) + '</span>' +
    (state.ticket ? '<span class="badge">' + esc(state.ticket) + '</span>' : '') +
    '<span class="badge">workspace=' + esc(state.workspaceName || '') + '</span>' +
    '<span class="badge">runId=' + esc(state.runId || '') + '</span>' +
    '</div></div><div class="meta"><span class="badge">updated ' + new Date(state.updatedAt || Date.now()).toLocaleTimeString() + '</span></div></div></div>';
  html += '<main><section class="summary"><h2>요약</h2>' + (state.summary ? '<p class="detail">' + esc(state.summary) + '</p>' : '') + (state.finalSummary ? '<p class="detail">' + esc(state.finalSummary) + '</p>' : '') +
    '<div class="grid"><div class="stat"><strong>' + items.length + '</strong>전체</div><div class="stat"><strong>' + count('pass') + '</strong>PASS</div><div class="stat"><strong>' + count('fail') + '</strong>FAIL</div><div class="stat"><strong>' + (count('skip') + count('blocked') + count('unverified')) + '</strong>SKIP/미검증</div></div>' +
    (state.reportPath ? '<p><strong>report.html</strong>: <code>' + esc(state.reportPath) + '</code></p>' : '') + '</section>';
  for (var i=0; i<items.length; i++) { var item = items[i];
    html += '<section class="item"><div class="item-head"><div><h3>' + esc(item.id) + '. ' + esc(item.title) + '</h3>' + (item.type ? '<div class="type">' + esc(item.type) + '</div>' : '') + '</div><span class="status ' + esc(item.status || 'pending') + '">' + statusLabel(item.status || 'pending') + '</span></div>' +
      (item.detail ? '<p class="detail">' + esc(item.detail) + '</p>' : '') +
      '<div class="evidence">' + (item.evidence || []).map(evHtml).join('') + '</div></section>';
  }
  if (state.logs && state.logs.length) {
    html += '<section class="logs"><h2>Live Log</h2>' + state.logs.slice().reverse().map(function(log){ return '<div class="log">' + new Date(log.time).toLocaleTimeString() + ' · ' + esc(log.message) + '</div>'; }).join('') + '</section>';
  }
  html += '</main>';
  document.getElementById('app').innerHTML = html;
}
render();
var events = new EventSource('/events');
events.addEventListener('state', function(e) { state = JSON.parse(e.data); render(); });
events.onerror = function() { var el = document.querySelector('.header .meta'); if (el) el.insertAdjacentHTML('beforeend', '<span class="badge fail">연결 끊김</span>'); };
</script>
</body>
</html>`;
}

function generateStaticReportHtml(state: VerifyReportState): string {
	const counts = {
		pass: state.items.filter((item) => item.status === "pass").length,
		fail: state.items.filter((item) => item.status === "fail").length,
		skipped: state.items.filter((item) => ["skip", "blocked", "unverified"].includes(item.status)).length,
	};
	return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${REPORT_SIGNATURE} — ${escapeHtml(state.ticket || state.title)}</title>
<style>
	:root { ${reportRootVariablesCss()} }
	body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 1120px; margin: 0 auto; padding: 24px; background: var(--bg); color: var(--text); }
	h1 { border-bottom: 2px solid var(--line); padding-bottom: 12px; }
	.meta { color: var(--muted); font-size: 13px; display: flex; gap: 8px; flex-wrap: wrap; }
	.badge { border: 1px solid var(--line); border-radius: 999px; padding: 3px 8px; background: var(--panel); }
	table { border-collapse: collapse; width: 100%; margin: 20px 0 28px; }
	th, td { padding: 8px 10px; border: 1px solid var(--panel2); text-align: left; vertical-align: top; }
	th { background: var(--panel); }
	.item { margin-bottom: 34px; }
	.item h3 { margin-bottom: 6px; }
	.pass { color: var(--green); font-weight: 700; }
	.fail { color: var(--red); font-weight: 700; }
	.skip { color: var(--yellow); font-weight: 700; }
	.running, .pending { color: var(--accentText); font-weight: 700; }
	.detail { white-space: pre-wrap; line-height: 1.55; }
	img { max-width: 100%; border: 1px solid var(--line); border-radius: 10px; box-shadow: 0 2px 8px var(--logLine); }
	figcaption { color: var(--muted); font-size: 12px; margin-top: 4px; }
	pre { white-space: pre-wrap; overflow: auto; background: var(--panel); border: 1px solid var(--panel2); border-radius: 8px; padding: 12px; }
	code { background: var(--panel2); border-radius: 4px; padding: 1px 4px; }
</style>
</head>
<body>
<h1>${REPORT_SIGNATURE} — ${escapeHtml(state.ticket || state.title)}</h1>
<p class="meta">
	<span class="badge">${escapeHtml(new Date(state.createdAt).toLocaleString())}</span>
	<span class="badge">workspace=${escapeHtml(state.workspaceName)}</span>
	<span class="badge">status=${escapeHtml(statusLabel(state.status))}</span>
	<span class="badge">PASS ${counts.pass}</span>
	<span class="badge">FAIL ${counts.fail}</span>
	<span class="badge">SKIP/미검증 ${counts.skipped}</span>
</p>
${state.summary ? `<h2>요약</h2><p class="detail">${escapeHtml(state.summary)}</p>` : ""}
${state.finalSummary ? `<h2>최종 메모</h2><p class="detail">${escapeHtml(state.finalSummary)}</p>` : ""}
<h2>검증 항목</h2>
<table>
<thead><tr><th>#</th><th>항목</th><th>분류</th><th>결과</th><th>상세</th></tr></thead>
<tbody>
${state.items.map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.type || "")}</td><td class="${escapeHtml(statusClass(item.status))}">${escapeHtml(statusLabel(item.status))}</td><td>${escapeHtml(item.detail || "")}</td></tr>`).join("\n")}
</tbody>
</table>
<h2>상세 증거</h2>
${state.items.map((item) => `<section class="item"><h3>${escapeHtml(item.id)}. ${escapeHtml(item.title)}</h3><p><strong>분류</strong>: ${escapeHtml(item.type || "-")} · <strong>결과</strong>: <span class="${escapeHtml(statusClass(item.status))}">${escapeHtml(statusLabel(item.status))}</span></p>${item.detail ? `<p class="detail">${escapeHtml(item.detail)}</p>` : ""}${item.evidence.map((evidence) => renderEvidenceStatic(evidence, state)).join("\n")}</section>`).join("\n")}
</body>
</html>`;
}

function archiveReport(state: VerifyReportState): string {
	mkdirSync(REPORTS_ARCHIVE_DIR, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const filename = `${ts}_${state.workspaceName}${state.ticket ? `_${state.ticket}` : ""}.html`;
	const dest = join(REPORTS_ARCHIVE_DIR, filename);
	copyFileSync(state.reportPath, dest);
	return dest;
}

function closeHandle(handle: LiveHandle): void {
	if (handle.closed) return;
	handle.closed = true;
	try { clearInterval(handle.pingInterval); } catch {}
	try { handle.window?.close(); } catch {}
	for (const client of handle.clients) {
		try { client.end(); } catch {}
	}
	try { handle.server.close(); } catch {}
	liveRuns.delete(handle.state.runId);
}

function latestHandle(): LiveHandle | undefined {
	return [...liveRuns.values()].sort((a, b) => b.state.updatedAt - a.state.updatedAt)[0];
}

export function registerVerifyReportLive(pi: ExtensionAPI) {
	pi.registerTool({
		name: "verify_report_live",
		label: "Verify Report Live",
		description: "Create and update a live Glimpse Verify Report. Use action=start before capture/verification, update after each item, and finish to export report.html.",
		promptSnippet: "Start/update/finalize a live Glimpse Verify Report for capture/verification evidence.",
		promptGuidelines: [
			"Use verify_report_live for /verify-report workflows: start before executing verification items, update after each item with status/evidence, then finish to export report.html.",
			"Do not use verify_report_live to upload reports or modify PRs; upload remains opt-in via the verify-report skill.",
		],
		parameters: Type.Object({
			action: Type.String({ description: "start|update|finish|abort|open" }),
			runId: Type.Optional(Type.String({ description: "Run id returned by action=start. Omit to use latest active run for update/finish/open." })),
			workspace: Type.Optional(Type.String({ description: "Workspace name for .context/work/{workspace}/captures. Defaults to cwd basename." })),
			title: Type.Optional(Type.String({ description: "Report title." })),
			ticket: Type.Optional(Type.String({ description: "Jira ticket or PR identifier." })),
			summary: Type.Optional(Type.String({ description: "Short report summary or update summary." })),
			finalSummary: Type.Optional(Type.String({ description: "Final report summary written on finish." })),
			item: Type.Optional(itemSchema),
			items: Type.Optional(Type.Array(itemSchema)),
		}),
		async execute(_toolCallId, params, signal, _onUpdate, ctx: ExtensionContext) {
			if (signal?.aborted) return { content: [{ type: "text", text: "Cancelled." }] };
			const action = params.action.trim().toLowerCase();
			if (action === "start") {
				const cwd = ctx.cwd ?? process.cwd();
				const workspaceName = normalizeWorkspaceName(cwd, params.workspace);
				const capturesDir = capturesDirFor(cwd, workspaceName);
				mkdirSync(capturesDir, { recursive: true });
				const runId = randomUUID().slice(0, 8);
				const reportPath = join(capturesDir, "report.html");
				const state: VerifyReportState = {
					runId,
					title: params.title || "Verify Report Live",
					ticket: params.ticket,
					workspaceName,
					cwd,
					capturesDir,
					reportPath,
					url: "",
					status: "running",
					summary: params.summary,
					createdAt: Date.now(),
					updatedAt: Date.now(),
					items: [],
					logs: [],
				};
				for (const item of normalizeItemInput(params.items)) mergeItem(state, item);
				if (params.item) for (const item of normalizeItemInput(params.item)) mergeItem(state, item);
				addLog(state, "Live verify report started.");
				const handle = createLiveServer(state);
				state.url = await listenOnLoopback(handle.server);
				liveRuns.set(runId, handle);
				let opened: "glimpse" | "browser" | "none" = "none";
				if (ctx.hasUI) opened = await openLivePreview(pi, handle);
				return {
					content: [{ type: "text", text: `Started live Verify Report (${runId}). Preview: ${state.url}. Captures: ${capturesDir}. report.html: ${reportPath}. Opened: ${opened}.` }],
					details: { runId, url: state.url, capturesDir, reportPath, opened },
				};
			}

			const handle = (params.runId ? liveRuns.get(params.runId) : latestHandle());
			if (!handle) throw new Error("No active verify_report_live run. Call action=start first.");
			const { state } = handle;

			if (action === "open") {
				const opened = ctx.hasUI ? await openLivePreview(pi, handle) : "none";
				return { content: [{ type: "text", text: `Opened live Verify Report (${state.runId}): ${state.url} (${opened}).` }], details: { runId: state.runId, url: state.url, opened } };
			}

			if (action === "update") {
				if (params.title) state.title = params.title;
				if (params.ticket) state.ticket = params.ticket;
				if (params.summary) state.summary = params.summary;
				for (const item of normalizeItemInput(params.items)) {
					const merged = mergeItem(state, item);
					addLog(state, `${merged.id} ${statusLabel(merged.status)} — ${merged.title}`);
				}
				if (params.item) {
					for (const item of normalizeItemInput(params.item)) {
						const merged = mergeItem(state, item);
						addLog(state, `${merged.id} ${statusLabel(merged.status)} — ${merged.title}`);
					}
				}
				pushState(handle);
				return { content: [{ type: "text", text: `Updated live Verify Report (${state.runId}). Items: ${state.items.length}.` }], details: { runId: state.runId, url: state.url, items: state.items.length } };
			}

			if (action === "finish") {
				if (params.summary) state.summary = params.summary;
				if (params.finalSummary) state.finalSummary = params.finalSummary;
				state.status = "done";
				addLog(state, "Static report.html exported.");
				mkdirSync(dirname(state.reportPath), { recursive: true });
				writeFileSync(state.reportPath, generateStaticReportHtml(state), "utf-8");
				try { state.archivePath = archiveReport(state); } catch {}
				pushState(handle);
				return { content: [{ type: "text", text: `Finished live Verify Report (${state.runId}). Exported: ${state.reportPath}${state.archivePath ? `; archived: ${state.archivePath}` : ""}.` }], details: { runId: state.runId, reportPath: state.reportPath, archivePath: state.archivePath, url: state.url } };
			}

			if (action === "abort") {
				state.status = "aborted";
				addLog(state, "Live verify report aborted.");
				pushState(handle);
				return { content: [{ type: "text", text: `Aborted live Verify Report (${state.runId}).` }], details: { runId: state.runId, url: state.url } };
			}

			throw new Error(`Unknown action: ${params.action}`);
		},
	});

	pi.on("session_shutdown", () => {
		for (const handle of [...liveRuns.values()]) closeHandle(handle);
	});
}
