import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ToolResultEvent } from "@mariozechner/pi-coding-agent";
import { registerVerifyReportLive } from "./verify-report-live.js";

const ARCHIVE_DIR = path.join(os.homedir(), "Documents", "agent-history", "분류 전");
const FRAME_TRANSCRIPTS_DIR = path.join(os.homedir(), ".pi", "agent", "frame-studio", "transcripts");
const CONDUCTOR_DB = path.join(os.homedir(), "Library", "Application Support", "com.conductor.app", "conductor.db");
const FONT_SIGNATURE = "Noto+Serif+KR";
const REPORT_SIGNATURE = "Verify Report";
const WEB_SEARCH_SIGNATURE = "Web Search Review";
const MEDIA_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const MAX_INLINE_MEDIA_BYTES = 8 * 1024 * 1024;

const SVG_STYLES = `
:root {
  --p: #e0e0e0;
  --s: #a0a0a0;
  --t: #707070;
  --bg2: #2a2a2a;
  --b: #404040;
  --color-text-primary: #e0e0e0;
  --color-text-secondary: #a0a0a0;
  --color-text-tertiary: #707070;
  --color-text-info: #85B7EB;
  --color-text-danger: #F09595;
  --color-text-success: #97C459;
  --color-text-warning: #EF9F27;
  --color-background-primary: #1a1a1a;
  --color-background-secondary: #2a2a2a;
  --color-background-tertiary: #111111;
  --color-background-info: #0C447C;
  --color-background-danger: #791F1F;
  --color-background-success: #27500A;
  --color-background-warning: #633806;
  --color-border-primary: rgba(255,255,255,0.4);
  --color-border-secondary: rgba(255,255,255,0.3);
  --color-border-tertiary: rgba(255,255,255,0.15);
  --color-border-info: #85B7EB;
  --color-border-danger: #F09595;
  --color-border-success: #97C459;
  --color-border-warning: #EF9F27;
  --font-sans: system-ui, -apple-system, sans-serif;
  --font-serif: Georgia, serif;
  --font-mono: ui-monospace, monospace;
  --border-radius-md: 8px;
  --border-radius-lg: 12px;
  --border-radius-xl: 16px;
}
svg .t  { font-family: var(--font-sans); font-size: 14px; fill: var(--p); }
svg .ts { font-family: var(--font-sans); font-size: 12px; fill: var(--s); }
svg .th { font-family: var(--font-sans); font-size: 14px; font-weight: 500; fill: var(--p); }
svg .box { fill: var(--bg2); stroke: var(--b); }
svg .node { cursor: pointer; }
svg .node:hover { opacity: 0.8; }
svg .arr { stroke: var(--t); stroke-width: 1.5; fill: none; }
svg .leader { stroke: var(--t); stroke-width: 0.5; stroke-dasharray: 4 3; fill: none; }
svg .c-purple > rect, svg .c-purple > circle, svg .c-purple > ellipse { fill: #3C3489; stroke: #AFA9EC; }
svg .c-purple > .th, svg .c-purple > .t { fill: #CECBF6; }
svg .c-purple > .ts { fill: #AFA9EC; }
svg rect.c-purple, svg circle.c-purple, svg ellipse.c-purple { fill: #3C3489; stroke: #AFA9EC; }
svg .c-teal > rect, svg .c-teal > circle, svg .c-teal > ellipse { fill: #085041; stroke: #5DCAA5; }
svg .c-teal > .th, svg .c-teal > .t { fill: #9FE1CB; }
svg .c-teal > .ts { fill: #5DCAA5; }
svg rect.c-teal, svg circle.c-teal, svg ellipse.c-teal { fill: #085041; stroke: #5DCAA5; }
svg .c-coral > rect, svg .c-coral > circle, svg .c-coral > ellipse { fill: #712B13; stroke: #F0997B; }
svg .c-coral > .th, svg .c-coral > .t { fill: #F5C4B3; }
svg .c-coral > .ts { fill: #F0997B; }
svg rect.c-coral, svg circle.c-coral, svg ellipse.c-coral { fill: #712B13; stroke: #F0997B; }
svg .c-pink > rect, svg .c-pink > circle, svg .c-pink > ellipse { fill: #72243E; stroke: #ED93B1; }
svg .c-pink > .th, svg .c-pink > .t { fill: #F4C0D1; }
svg .c-pink > .ts { fill: #ED93B1; }
svg rect.c-pink, svg circle.c-pink, svg ellipse.c-pink { fill: #72243E; stroke: #ED93B1; }
svg .c-gray > rect, svg .c-gray > circle, svg .c-gray > ellipse { fill: #444441; stroke: #B4B2A9; }
svg .c-gray > .th, svg .c-gray > .t { fill: #D3D1C7; }
svg .c-gray > .ts { fill: #B4B2A9; }
svg rect.c-gray, svg circle.c-gray, svg ellipse.c-gray { fill: #444441; stroke: #B4B2A9; }
svg .c-blue > rect, svg .c-blue > circle, svg .c-blue > ellipse { fill: #0C447C; stroke: #85B7EB; }
svg .c-blue > .th, svg .c-blue > .t { fill: #B5D4F4; }
svg .c-blue > .ts { fill: #85B7EB; }
svg rect.c-blue, svg circle.c-blue, svg ellipse.c-blue { fill: #0C447C; stroke: #85B7EB; }
svg .c-green > rect, svg .c-green > circle, svg .c-green > ellipse { fill: #27500A; stroke: #97C459; }
svg .c-green > .th, svg .c-green > .t { fill: #C0DD97; }
svg .c-green > .ts { fill: #97C459; }
svg rect.c-green, svg circle.c-green, svg ellipse.c-green { fill: #27500A; stroke: #97C459; }
svg .c-amber > rect, svg .c-amber > circle, svg .c-amber > ellipse { fill: #633806; stroke: #EF9F27; }
svg .c-amber > .th, svg .c-amber > .t { fill: #FAC775; }
svg .c-amber > .ts { fill: #EF9F27; }
svg rect.c-amber, svg circle.c-amber, svg ellipse.c-amber { fill: #633806; stroke: #EF9F27; }
svg .c-red > rect, svg .c-red > circle, svg .c-red > ellipse { fill: #791F1F; stroke: #F09595; }
svg .c-red > .th, svg .c-red > .t { fill: #F7C1C1; }
svg .c-red > .ts { fill: #F09595; }
svg rect.c-red, svg circle.c-red, svg ellipse.c-red { fill: #791F1F; stroke: #F09595; }
button {
  background: transparent;
  border: 0.5px solid var(--color-border-secondary);
  border-radius: var(--border-radius-md);
  color: var(--color-text-primary);
  padding: 6px 14px;
  font-size: 14px;
  cursor: pointer;
  font-family: var(--font-sans);
}
button:hover { background: var(--color-background-secondary); }
button:active { transform: scale(0.98); }
input[type="range"] {
  -webkit-appearance: none;
  height: 4px;
  background: var(--color-border-secondary);
  border-radius: 2px;
  outline: none;
}
input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-text-primary);
  cursor: pointer;
}
input[type="text"], input[type="number"], textarea, select {
  height: 36px;
  background: var(--color-background-primary);
  border: 0.5px solid var(--color-border-tertiary);
  border-radius: var(--border-radius-md);
  color: var(--color-text-primary);
  padding: 0 10px;
  font-size: 14px;
  font-family: var(--font-sans);
  outline: none;
}
input[type="text"]:hover, input[type="number"]:hover, textarea:hover, select:hover {
  border-color: var(--color-border-secondary);
}
input[type="text"]:focus, input[type="number"]:focus, textarea:focus, select:focus {
  border-color: var(--color-border-primary);
  box-shadow: 0 0 0 2px rgba(255,255,255,0.1);
}
`;

interface GlimpseWindow {
	on(event: "closed", handler: () => void): void;
}

let glimpseOpen: ((html: string, opts: Record<string, unknown>) => GlimpseWindow) | null | undefined;
const artifactWindows = new Set<GlimpseWindow>();
const artifactBrowserServers = new Set<Server>();

function findGlimpseMjs(): string | null {
	try {
		const req = createRequire(import.meta.url);
		return req.resolve("glimpseui");
	} catch {}
	try {
		const globalRoot = execFileSync("npm", ["root", "-g"], { encoding: "utf-8" }).trim();
		const entry = path.join(globalRoot, "glimpseui", "src", "glimpse.mjs");
		if (fs.existsSync(entry)) return entry;
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

function escapeAttr(value: string): string {
	return escapeHtml(value);
}

function mimeFor(filePath: string): string {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".png") return "image/png";
	if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
	if (ext === ".gif") return "image/gif";
	if (ext === ".webp") return "image/webp";
	if (ext === ".svg") return "image/svg+xml";
	return "application/octet-stream";
}

function inlineLocalImageSrc(html: string, htmlDir: string): string {
	return html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, src, suffix) => {
		if (/^(https?:|data:|blob:|file:)/i.test(src)) return match;
		const assetPath = path.resolve(htmlDir, src);
		const relative = path.relative(htmlDir, assetPath);
		if (relative.startsWith("..") || path.isAbsolute(relative)) return match;
		if (!fs.existsSync(assetPath)) return match;
		const b64 = fs.readFileSync(assetPath).toString("base64");
		return `${prefix}data:${mimeFor(assetPath)};base64,${b64}${suffix}`;
	});
}

function artifactTitle(html: string, filePath: string): string {
	if (html.includes(WEB_SEARCH_SIGNATURE)) return "Web Search Review";
	if (html.includes(REPORT_SIGNATURE)) return "Verify Report";
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
	if (titleMatch?.[1]) return titleMatch[1].replace(/<[^>]*>/g, "").trim() || path.basename(filePath);
	return path.basename(filePath);
}

function buildGlimpseArtifactHtml(artifactHtml: string, artifactPath: string): string {
	const artifactDataUri = `data:text/html;base64,${Buffer.from(artifactHtml, "utf8").toString("base64")}`;
	const title = artifactTitle(artifactHtml, artifactPath);
	const fileUrl = pathToFileURL(artifactPath).href;

	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} Preview</title>
<style>
	:root { color-scheme: light dark; --bar: rgba(20,20,24,.94); --text: #f5f5f5; --muted: #b8b8b8; }
	* { box-sizing: border-box; }
	html, body { width: 100%; height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	body { display: grid; grid-template-rows: auto 1fr; background: #111; }
	.bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 14px; background: var(--bar); color: var(--text); border-bottom: 1px solid rgba(255,255,255,.12); }
	.title { min-width: 0; }
	.title strong { display: block; font-size: 14px; line-height: 1.2; }
	.title span { display: block; font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 66vw; }
	.actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
	a.button, button { border: 1px solid rgba(255,255,255,.18); border-radius: 8px; padding: 7px 10px; background: rgba(255,255,255,.08); color: var(--text); font-size: 12px; text-decoration: none; cursor: pointer; }
	a.button:hover, button:hover { background: rgba(255,255,255,.15); }
	iframe { width: 100%; height: 100%; border: 0; background: white; }
</style>
</head>
<body>
	<div class="bar">
		<div class="title">
			<strong>${escapeHtml(title)}</strong>
			<span>${escapeHtml(artifactPath)}</span>
		</div>
		<div class="actions">
			<a class="button" href="${escapeAttr(fileUrl)}" target="_blank" rel="noreferrer">Open in Browser</a>
			<button onclick="window.close()">Close</button>
		</div>
	</div>
	<iframe src="${artifactDataUri}" title="${escapeAttr(title)}"></iframe>
</body>
</html>`;
}

function openHtmlStringInGlimpse(open: (html: string, opts: Record<string, unknown>) => GlimpseWindow, html: string, title: string, width = 1280, height = 900): void {
	const win = open(html, { width, height, title, openLinks: true });
	artifactWindows.add(win);
	win.on("closed", () => artifactWindows.delete(win));
}

function openHtmlInGlimpse(open: (html: string, opts: Record<string, unknown>) => GlimpseWindow, filePath: string): void {
	const resolved = fs.realpathSync(filePath);
	const htmlDir = path.dirname(resolved);
	const html = inlineLocalImageSrc(fs.readFileSync(resolved, "utf-8"), htmlDir);
	const title = artifactTitle(html, resolved);
	openHtmlStringInGlimpse(open, buildGlimpseArtifactHtml(html, resolved), title);
}

function isSessionJsonlPath(filePath: string): boolean {
	return filePath.endsWith(".jsonl") && (
		filePath.includes(`${path.sep}.pi${path.sep}agent${path.sep}sessions${path.sep}`) ||
		filePath.includes(`${path.sep}.claude${path.sep}projects${path.sep}`)
	);
}

function truncatePreviewText(value: string, max = 5000): string {
	return value.length > max ? `${value.slice(0, max)}\n…` : value;
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

function sessionPreviewEntry(raw: unknown): string {
	if (!raw || typeof raw !== "object") return "";
	const record = raw as Record<string, unknown>;
	if (record.type !== "message") return "";
	const timestamp = typeof record.timestamp === "string" ? record.timestamp : "";
	const message = record.message && typeof record.message === "object" ? record.message as Record<string, unknown> : {};
	const role = String(message.role || "message");
	if (role !== "user" && role !== "assistant") return "";
	const text = textBlocksOnly(message.content);
	if (!text) return "";
	const roleClass = role === "user" ? "user" : "assistant";
	const speaker = role === "user" ? "나" : "pilee";
	return `<article class="chat-row ${escapeAttr(roleClass)}"><div class="chat-meta"><span>${escapeHtml(speaker)}</span>${timestamp ? `<time>${escapeHtml(timestamp)}</time>` : ""}</div><div class="chat-bubble">${escapeHtml(truncatePreviewText(text, 8000))}</div></article>`;
}

function buildJsonlSessionPreviewHtml(filePath: string, full = false): string {
	const preview = readTextPreview(filePath, full ? 8 * 1024 * 1024 : 1024 * 1024);
	const lines = preview.text.split(/\r?\n/);
	if (preview.truncated && !preview.text.endsWith("\n")) lines.pop();
	const entries: string[] = [];
	let parsed = 0;
	const maxEntries = full ? 1000 : 160;
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const html = sessionPreviewEntry(JSON.parse(line));
			parsed++;
			if (html) entries.push(html);
		} catch {}
		if (entries.length >= maxEntries) break;
	}
	const notice = preview.truncated
		? `<p class="session-notice">세션 JSONL 앞부분 ${escapeHtml(formatBytes(preview.text.length))}만 대화로 미리보기합니다. 더 크게 보려면 브라우저에서 여세요. 전체 크기: ${escapeHtml(formatBytes(preview.size))}</p>`
		: "";
	return `<style>body{margin:0;padding:18px;background:#fafaf9;color:#292524;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.session-preview{max-width:980px;margin:0 auto}.session-notice{border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:12px;padding:10px 12px}.chat-row{display:flex;flex-direction:column;margin:14px 0}.chat-row.user{align-items:flex-end}.chat-row.assistant{align-items:flex-start}.chat-meta{display:flex;gap:8px;align-items:center;color:#78716c;font-size:12px;margin:0 8px 4px}.chat-meta span{font-weight:800;color:#57534e}.chat-bubble{max-width:min(780px,92%);white-space:pre-wrap;word-break:break-word;border:1px solid #e7e5e4;border-radius:18px;padding:12px 14px;background:#fff;box-shadow:0 8px 24px rgba(41,37,36,.05)}.user .chat-bubble{background:#eff6ff;border-color:#bfdbfe}.assistant .chat-bubble{background:#fff}</style><main class="session-preview"><h1>${escapeHtml(path.basename(filePath))}</h1><p class="session-notice">원본 JSONL에서 실제 대화만 추려 보여줍니다. system/model/session/tool/thinking/encrypted payload는 숨기고, 사용자 메시지와 assistant의 실제 답변 text만 표시합니다.</p>${notice}${entries.length ? entries.join("\n") : `<p class="session-notice">표시할 user/assistant text 대화를 찾지 못했습니다.</p>`}<p class="session-notice">parsed lines: ${parsed}, rendered conversation entries: ${entries.length}</p></main>`;
}

function artifactPreviewInnerHtml(filePath: string, options: { full?: boolean } = {}): { title: string; html: string } {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".html" || ext === ".htm") {
		const htmlDir = path.dirname(filePath);
		const html = inlineLocalImageSrc(fs.readFileSync(filePath, "utf-8"), htmlDir);
		return { title: artifactTitle(html, filePath), html };
	}
	if (ext === ".json" && filePath.startsWith(FRAME_TRANSCRIPTS_DIR)) {
		return { title: path.basename(filePath), html: buildFrameTranscriptStandaloneHtml(filePath) };
	}
	if (MEDIA_EXTENSIONS.has(ext)) {
		return { title: path.basename(filePath), html: buildMediaPreviewHtml(filePath) };
	}
	if (isSessionJsonlPath(filePath)) {
		return { title: path.basename(filePath), html: buildJsonlSessionPreviewHtml(filePath, Boolean(options.full)) };
	}
	const preview = readTextPreview(filePath);
	const notice = preview.truncated ? `<p class="muted">파일이 커서 앞부분 ${escapeHtml(formatBytes(preview.text.length))}만 미리보기합니다. 전체 원본은 브라우저에서 여세요. 전체 크기: ${escapeHtml(formatBytes(preview.size))}</p>` : "";
	return { title: path.basename(filePath), html: `${notice}<pre>${escapeHtml(preview.text)}</pre>` };
}

function buildArtifactPreviewHtml(filePath: string, options: { full?: boolean } = {}): string {
	const { title, html } = artifactPreviewInnerHtml(filePath, options);
	const artifactDataUri = `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;
	return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)} Preview</title>
<style>
	:root { color-scheme: light dark; --bar: rgba(20,20,24,.94); --text: #f5f5f5; --muted: #b8b8b8; }
	* { box-sizing: border-box; }
	html, body { width: 100%; height: 100%; margin: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	body { display: grid; grid-template-rows: auto 1fr; background: #111; }
	.bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 10px 14px; background: var(--bar); color: var(--text); border-bottom: 1px solid rgba(255,255,255,.12); }
	.title { min-width: 0; }
	.title strong { display: block; font-size: 14px; line-height: 1.2; }
	.title span { display: block; font-size: 11px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 60vw; }
	.actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
	button { border: 1px solid rgba(255,255,255,.18); border-radius: 8px; padding: 7px 10px; background: rgba(255,255,255,.08); color: var(--text); font-size: 12px; text-decoration: none; cursor: pointer; }
	button:hover { background: rgba(255,255,255,.15); }
	button[disabled] { opacity: .55; cursor: wait; }
	iframe { width: 100%; height: 100%; border: 0; background: white; }
</style>
</head>
<body>
	<div class="bar">
		<div class="title">
			<strong>${escapeHtml(title)}</strong>
			<span>${escapeHtml(filePath)}</span>
		</div>
		<div class="actions">
			<button type="button" onclick="location.href='/'">이전</button>
			<button type="button" data-path="${escapeAttr(filePath)}" onclick="openOriginal(this)">브라우저에서 열기</button>
			<button type="button" onclick="window.close()">닫기</button>
		</div>
	</div>
	<iframe src="${artifactDataUri}" title="${escapeAttr(title)}"></iframe>
<script>
async function openOriginal(button){var label=button.textContent;button.disabled=true;button.textContent='브라우저 여는 중...';try{var res=await fetch('/open?target=browser&path='+encodeURIComponent(button.dataset.path||''),{method:'POST'});if(!res.ok)throw new Error(await res.text());button.textContent='열기 요청됨';setTimeout(function(){button.textContent=label;button.disabled=false;},1400);}catch(e){button.textContent='열기 실패';button.title=String(e&&e.message||e);setTimeout(function(){button.textContent=label;button.disabled=false;},2200);}}
</script>
</body>
</html>`;
}

async function openInSystemBrowser(pi: ExtensionAPI, filePath: string): Promise<void> {
	const resolved = fs.realpathSync(filePath);
	await openUrlOrPathInSystem(pi, resolved);
}

async function openUrlOrPathInSystem(pi: ExtensionAPI, target: string): Promise<void> {
	const plat = os.platform();
	const result = plat === "darwin"
		? await pi.exec("open", [target])
		: plat === "win32"
			? await pi.exec("cmd", ["/c", "start", "", target])
			: await pi.exec("xdg-open", [target]);
	if (result.code !== 0) throw new Error(result.stderr || `Failed to open target (${result.code})`);
}

async function openHtmlStringArtifact(pi: ExtensionAPI, html: string, title: string, browserOnly = false): Promise<"glimpse" | "browser"> {
	if (!browserOnly) {
		const open = await getGlimpseOpen();
		if (open) {
			try {
				openHtmlStringInGlimpse(open, html, title);
				return "glimpse";
			} catch {}
		}
	}
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilee-artifact-browser-"));
	const tmpPath = path.join(tmpDir, `${slugify(title)}.html`);
	fs.writeFileSync(tmpPath, html, "utf-8");
	await openInSystemBrowser(pi, tmpPath);
	return "browser";
}

async function openHtmlArtifact(pi: ExtensionAPI, filePath: string, browserOnly = false): Promise<"glimpse" | "browser"> {
	if (!browserOnly) {
		const open = await getGlimpseOpen();
		if (open) {
			try {
				openHtmlInGlimpse(open, filePath);
				return "glimpse";
			} catch {}
		}
	}
	await openInSystemBrowser(pi, filePath);
	return "browser";
}

async function openMediaArtifact(pi: ExtensionAPI, filePath: string, browserOnly = false): Promise<"glimpse" | "browser"> {
	const resolved = fs.realpathSync(filePath);
	const title = path.basename(resolved);
	const html = buildMediaPreviewHtml(resolved, title);
	return openHtmlStringArtifact(pi, html, title, browserOnly);
}

async function openAnyArtifact(pi: ExtensionAPI, filePath: string, browserOnly = false): Promise<"glimpse" | "browser"> {
	const ext = path.extname(filePath).toLowerCase();
	if (ext === ".html" || ext === ".htm") return openHtmlArtifact(pi, filePath, browserOnly);
	if (ext === ".json" && filePath.startsWith(FRAME_TRANSCRIPTS_DIR)) {
		return openHtmlStringArtifact(pi, buildFrameTranscriptStandaloneHtml(filePath), path.basename(filePath), browserOnly);
	}
	if (MEDIA_EXTENSIONS.has(ext)) return openMediaArtifact(pi, filePath, browserOnly);
	await openInSystemBrowser(pi, filePath);
	return "browser";
}

function toAbsolutePath(filePath: string, cwd: string): string {
	return path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);
}

function parseShowReportArgs(args: string, cwd: string): { browserOnly: boolean; explicitPath: string } {
	const raw = (args ?? "").trim();
	if (!raw) return { browserOnly: false, explicitPath: "" };
	const browserOnly = /(^|\s)--browser(\s|$)/.test(raw);
	const withoutFlag = raw.replace(/(^|\s)--browser(?=\s|$)/g, " ").trim();
	const unquoted = withoutFlag.replace(/^['"]|['"]$/g, "");
	return { browserOnly, explicitPath: unquoted ? toAbsolutePath(unquoted, cwd) : "" };
}

function wrapArchivedWidgetHTML(code: string, isSVG = false): string {
	if (isSVG) {
		return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>*{-webkit-user-select:text;user-select:text}body{cursor:text}${SVG_STYLES}</style></head><body style="margin:0;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a1a;color:#e0e0e0;">${code}</body></html>`;
	}

	return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><style>*{box-sizing:border-box;-webkit-user-select:text;user-select:text}body{margin:0;padding:1rem;font-family:system-ui,-apple-system,sans-serif;background:#1a1a1a;color:#e0e0e0;cursor:text}${SVG_STYLES}</style></head><body>${code}</body></html>`;
}

export default function (pi: ExtensionAPI) {
	registerVerifyReportLive(pi);

	pi.registerCommand("show-report", {
		description: "Pi 이력·Conductor 이력·웹 검색·검증 리포트·Frame/기획·캡처 미디어를 Artifact Browser로 열기. Usage: /show-report [--browser] [path]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;

			const parsed = parseShowReportArgs(args, ctx.cwd);
			if (parsed.explicitPath) {
				if (!fs.existsSync(parsed.explicitPath)) {
					ctx.ui.notify(`artifact를 찾을 수 없습니다: ${parsed.explicitPath}`, "warning");
					return;
				}
				const mode = await openAnyArtifact(pi, parsed.explicitPath, parsed.browserOnly);
				ctx.ui.notify(`🗂️ ${mode === "glimpse" ? "Glimpse" : "브라우저"} 열기 → ${path.basename(parsed.explicitPath)}`, "info");
				return;
			}

			const artifacts = collectArtifactBrowserData(ctx.cwd);
			const total = artifacts.piUnits.length + artifacts.conductors.length + artifacts.webSearches.length + artifacts.reports.length + artifacts.planningDocs.length + artifacts.captures.length;
			if (total === 0) {
				ctx.ui.notify("표시할 artifact를 찾을 수 없습니다.", "warning");
				return;
			}

			const mode = await openArtifactBrowser(pi, artifacts, ctx.cwd, parsed.browserOnly);
			ctx.ui.notify(`🗂️ Artifact Browser ${mode === "glimpse" ? "Glimpse" : "브라우저"} 열기 · Pi ${artifacts.piUnits.length} · Conductor ${artifacts.conductors.length} · web ${artifacts.webSearches.length} · reports ${artifacts.reports.length}`, "info");
		},
	});

	pi.on("session_shutdown", () => {
		for (const server of [...artifactBrowserServers]) {
			try { server.close(); } catch {}
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.isError) return;

		if (event.toolName === "write") {
			archiveToHtmlSkill(event, ctx);
			await archiveVerifyReport(event, ctx, pi);
			return;
		}

		if (event.toolName === "web_search") {
			archiveWebSearchResult(event, ctx);
			return;
		}

		if (event.toolName === "show_widget") {
			archiveWidget(event, ctx);
			return;
		}
	});
}

function archiveToHtmlSkill(event: ToolResultEvent, ctx: ExtensionContext) {
	const filePath = typeof event.input?.path === "string" ? event.input.path : undefined;
	if (!filePath) return;

	const isTmp = filePath.startsWith("/tmp/") || filePath.startsWith("/private/tmp/");
	if (!isTmp || !filePath.endsWith(".html")) return;

	try {
		const resolved = fs.realpathSync(filePath);
		const content = fs.readFileSync(resolved, "utf-8");
		if (!content.includes(FONT_SIGNATURE)) return;

		fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
		const dest = path.join(ARCHIVE_DIR, path.basename(filePath));
		fs.copyFileSync(resolved, dest);

		if (ctx.hasUI) {
			ctx.ui.notify(`📚 아카이브 복사됨 → 분류 전/${path.basename(filePath)}`, "info");
		}
	} catch {
		// file read/copy failed — silently skip
	}
}

interface ReportEntry {
	path: string;
	name: string;
	time: string;
	ticket: string;
	workspace: string;
	source: "workspace" | "archive";
	mtime: number;
}

interface WebSearchEntry {
	path: string;
	name: string;
	time: string;
	queries: string[];
	workspace: string;
	ticket: string;
	mtime: number;
}

interface FrameTranscriptEntry {
	path: string;
	title: string;
	identity: string;
	mode: string;
	time: string;
	mtime: number;
	updatedAt: number;
	workspace: string;
	ticket: string;
	timeline: unknown[];
}

interface CaptureEntry {
	path: string;
	name: string;
	source: string;
	workspace: string;
	time: string;
	mtime: number;
	size: number;
	mime: string;
}

interface CaptureGroupEntry {
	key: string;
	label: string;
	fallbackLabel: string;
	workspace: string;
	ticket: string;
	title: string;
	source: "jira" | "session" | "frame" | "workspace" | "unclassified";
	captures: CaptureEntry[];
	latestMtime: number;
	latestTime: string;
}

interface PlanningDocEntry {
	path: string;
	name: string;
	title: string;
	workspace: string;
	ticket: string;
	source: "frame-studio" | "context" | "plan";
	time: string;
	mtime: number;
}

interface PiSessionEntry {
	path: string;
	title: string;
	workspace: string;
	restoredFromConductor: boolean;
	time: string;
	mtime: number;
}

interface PiWorkUnitEntry {
	key: string;
	repo: string;
	workspace: string;
	workspacePath: string;
	label: string;
	ticket: string;
	title: string;
	branch: string;
	contextPath: string;
	loadedByResume: boolean;
	originalConductorSessionPaths: string[];
	piRestoredSessions: PiSessionEntry[];
	piChatSessions: PiSessionEntry[];
	mtime: number;
	time: string;
}

interface ConductorHistoryEntry {
	key: string;
	repo: string;
	workspace: string;
	label: string;
	ticket: string;
	title: string;
	branch: string;
	pr: string;
	status: string;
	createdAt: string;
	sessionId: string;
	requests: string[];
	sourceSessionPaths: string[];
	mtime: number;
	time: string;
}

interface ArtifactBrowserData {
	piUnits: PiWorkUnitEntry[];
	conductors: ConductorHistoryEntry[];
	reports: ReportEntry[];
	webSearches: WebSearchEntry[];
	frames: FrameTranscriptEntry[];
	planningDocs: PlanningDocEntry[];
	captures: CaptureEntry[];
	generatedAt: Date;
}

interface WorktreeRootEntry {
	repo: string;
	workspace: string;
	workspacePath: string;
	piDir: string;
}

function formatMtime(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function existingRealDirs(dirs: Array<{ dir: string; source: string }>): Array<{ dir: string; source: string }> {
	const seen = new Set<string>();
	const results: Array<{ dir: string; source: string }> = [];
	for (const item of dirs) {
		try {
			if (!fs.existsSync(item.dir)) continue;
			const real = fs.realpathSync(item.dir);
			if (seen.has(real)) continue;
			seen.add(real);
			results.push({ dir: real, source: item.source });
		} catch {}
	}
	return results;
}

function collectWorktreeRoots(): WorktreeRootEntry[] {
	const roots: WorktreeRootEntry[] = [];
	for (const repo of ["product", "lambda"]) {
		const repoRoot = path.join(os.homedir(), "pilee-workspaces", repo);
		if (!fs.existsSync(repoRoot)) continue;
		try {
			for (const workspace of fs.readdirSync(repoRoot)) {
				const workspacePath = path.join(repoRoot, workspace);
				const piDir = path.join(workspacePath, ".pi");
				if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) continue;
				if (!fs.existsSync(piDir) && !fs.existsSync(path.join(workspacePath, ".context"))) continue;
				roots.push({ repo, workspace, workspacePath, piDir });
			}
		} catch {}
	}
	return roots;
}

function contextWorkRoots(cwd: string): Array<{ dir: string; source: string }> {
	return existingRealDirs([
		{ dir: path.join(cwd, ".context", "work"), source: "workspace" },
		{ dir: path.join(os.homedir(), ".context", "work"), source: "home" },
		...collectWorktreeRoots().map((root) => ({ dir: path.join(root.workspacePath, ".context", "work"), source: root.workspace })),
	]);
}

function collectReports(cwd: string): ReportEntry[] {
	const results: ReportEntry[] = [];
	for (const root of contextWorkRoots(cwd)) {
		try {
			for (const ws of fs.readdirSync(root.dir)) {
				const capturesDir = path.join(root.dir, ws, "captures");
				if (!fs.existsSync(capturesDir)) continue;
				for (const f of fs.readdirSync(capturesDir)) {
					if (!f.endsWith(".html")) continue;
					const fp = path.join(capturesDir, f);
					const content = fs.readFileSync(fp, "utf-8");
					if (content.includes(WEB_SEARCH_SIGNATURE)) continue;
					const stat = fs.statSync(fp);
					const ticket = extractTicket(content);
					results.push({ path: fp, name: `${ws}/${f}`, time: formatMtime(stat.mtimeMs), ticket, workspace: ws, source: "workspace", mtime: stat.mtimeMs });
				}
			}
		} catch {}
	}

	const reportDir = path.join(ARCHIVE_DIR, "..", "reports");
	if (fs.existsSync(reportDir)) {
		try {
			for (const f of fs.readdirSync(reportDir)) {
				if (!f.endsWith(".html")) continue;
				const fp = path.join(reportDir, f);
				const content = fs.readFileSync(fp, "utf-8");
				if (content.includes(WEB_SEARCH_SIGNATURE)) continue;
				const stat = fs.statSync(fp);
				const ticket = extractTicket(content);
				const workspace = extractWorkspaceHint(`${f} ${ticket}`);
				results.push({ path: fp, name: f, time: formatMtime(stat.mtimeMs), ticket, workspace, source: "archive", mtime: stat.mtimeMs });
			}
		} catch {}
	}

	return results.sort((a, b) => b.mtime - a.mtime).slice(0, 180);
}

function extractWebSearchQueries(html: string): string[] {
	const section = html.match(/<h2>Queries<\/h2>\s*<ul>([\s\S]*?)<\/ul>/i)?.[1] ?? "";
	return [...section.matchAll(/<li>([\s\S]*?)<\/li>/gi)].map((match) => match[1].replace(/<[^>]*>/g, "").trim()).filter(Boolean);
}

function collectWebSearchReviews(): WebSearchEntry[] {
	const results: WebSearchEntry[] = [];
	const webSearchDir = path.join(ARCHIVE_DIR, "..", "web-search");
	if (!fs.existsSync(webSearchDir)) return results;
	try {
		for (const f of fs.readdirSync(webSearchDir)) {
			if (!f.endsWith(".html")) continue;
			const fp = path.join(webSearchDir, f);
			const content = fs.readFileSync(fp, "utf-8");
			if (!content.includes(WEB_SEARCH_SIGNATURE)) continue;
			const stat = fs.statSync(fp);
			const queries = extractWebSearchQueries(content);
			const ticket = content.match(/\b[A-Z]+-\d+\b/)?.[0] ?? f.match(/\b[A-Z]+-\d+\b/)?.[0] ?? "";
			const workspace = extractWorkspaceHint(`${f} ${queries.join(" ")}`);
			results.push({ path: fp, name: f, time: formatMtime(stat.mtimeMs), queries, workspace, ticket, mtime: stat.mtimeMs });
		}
	} catch {}
	return results.sort((a, b) => b.mtime - a.mtime).slice(0, 120);
}

function collectArtifactBrowserData(cwd: string): ArtifactBrowserData {
	const reports = collectReports(cwd);
	const frames = collectFrameTranscripts();
	const captures = collectCaptureMedia(cwd);
	const webSearches = collectWebSearchReviews();
	const planningDocs = collectPlanningDocs(cwd, frames);
	return {
		piUnits: collectPiWorkUnits(reports, frames, planningDocs, captures, webSearches),
		conductors: collectConductorHistories(),
		reports,
		webSearches,
		frames,
		planningDocs,
		captures,
		generatedAt: new Date(),
	};
}

function artifactBrowserAllowedPaths(data: ArtifactBrowserData): Set<string> {
	const allowed = new Set<string>();
	for (const filePath of [
		...data.reports.map((item) => item.path),
		...data.webSearches.map((item) => item.path),
		...data.frames.map((item) => item.path),
		...data.planningDocs.map((item) => item.path),
		...data.captures.map((item) => item.path),
		...data.piUnits.flatMap((item) => [item.contextPath, ...item.originalConductorSessionPaths, ...item.piRestoredSessions.map((s) => s.path), ...item.piChatSessions.map((s) => s.path)]),
		...data.conductors.flatMap((item) => item.sourceSessionPaths),
	]) {
		try { if (filePath) allowed.add(fs.realpathSync(filePath)); } catch {}
	}
	return allowed;
}

function startArtifactBrowserServer(pi: ExtensionAPI, data: ArtifactBrowserData, cwd: string): Promise<string> {
	const allowedPaths = artifactBrowserAllowedPaths(data);
	const server = createServer(async (req, res) => {
		try {
			const url = new URL(req.url || "/", "http://127.0.0.1");
			if (req.method === "GET" && url.pathname === "/") {
				res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
				res.end(buildArtifactBrowserHtml(data, cwd));
				return;
			}
			if (req.method === "GET" && url.pathname === "/preview") {
				const requested = url.searchParams.get("path") || "";
				let resolved = "";
				try { resolved = fs.realpathSync(requested); } catch {}
				if (!resolved || !allowedPaths.has(resolved)) {
					res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
					res.end("Path is not in this Artifact Browser.");
					return;
				}
				res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
				res.end(buildArtifactPreviewHtml(resolved, { full: url.searchParams.get("full") === "1" }));
				return;
			}
			if (req.method === "POST" && url.pathname === "/open") {
				const requested = url.searchParams.get("path") || "";
				const target = url.searchParams.get("target") === "browser" ? "browser" : "glimpse";
				let resolved = "";
				try { resolved = fs.realpathSync(requested); } catch {}
				if (!resolved || !allowedPaths.has(resolved)) {
					res.writeHead(403, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ ok: false, error: "Path is not in this Artifact Browser." }));
					return;
				}
				const previewPath = `/preview?path=${encodeURIComponent(resolved)}`;
				if (target === "glimpse") {
					res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ ok: true, mode: "glimpse", previewUrl: previewPath }));
					return;
				}
				const host = typeof req.headers.host === "string" && req.headers.host ? req.headers.host : "127.0.0.1";
				const browserUrl = new URL(`${previewPath}&full=1`, `http://${host}`).toString();
				await openUrlOrPathInSystem(pi, browserUrl);
				res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ ok: true, mode: "browser", url: browserUrl }));
				return;
			}
			res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
			res.end("not found");
		} catch (error) {
			res.writeHead(500, { "content-type": "application/json; charset=utf-8" });
			res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
		}
	});
	artifactBrowserServers.add(server);
	server.on("close", () => artifactBrowserServers.delete(server));
	setTimeout(() => {
		try { server.close(); } catch {}
	}, 60 * 60 * 1000).unref?.();
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", () => {
			const address = server.address();
			if (!address || typeof address === "string") return reject(new Error("Failed to bind Artifact Browser server."));
			resolve(`http://127.0.0.1:${address.port}/`);
		});
	});
}

async function openArtifactBrowser(pi: ExtensionAPI, data: ArtifactBrowserData, cwd: string, browserOnly = false): Promise<"glimpse" | "browser"> {
	const url = await startArtifactBrowserServer(pi, data, cwd);
	if (!browserOnly) {
		const open = await getGlimpseOpen();
		if (open) {
			try {
				openHtmlStringInGlimpse(open, `<!doctype html><html><head><meta charset="utf-8"><title>pilee Artifact Browser</title></head><body><script>window.location.replace(${JSON.stringify(url)});</script></body></html>`, "pilee Artifact Browser");
				return "glimpse";
			} catch {}
		}
	}
	await openUrlOrPathInSystem(pi, url);
	return "browser";
}

function collectFrameTranscripts(): FrameTranscriptEntry[] {
	if (!fs.existsSync(FRAME_TRANSCRIPTS_DIR)) return [];
	const entries: FrameTranscriptEntry[] = [];
	try {
		for (const file of fs.readdirSync(FRAME_TRANSCRIPTS_DIR)) {
			if (!file.endsWith(".json")) continue;
			const fp = path.join(FRAME_TRANSCRIPTS_DIR, file);
			try {
				const stat = fs.statSync(fp);
				const parsed = JSON.parse(fs.readFileSync(fp, "utf-8")) as Record<string, unknown>;
				const identity = valueFromRecord(parsed, "identity") as Record<string, unknown> | undefined;
				const timeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
				const title = String(parsed.title || identity?.displayTitle || file.replace(/\.json$/, ""));
				const identityText = String(identity?.displayTitle || identity?.key || "Frame Studio");
				entries.push({
					path: fp,
					title,
					identity: identityText,
					mode: String(identity?.mode || "planning"),
					time: formatMtime(stat.mtimeMs),
					mtime: stat.mtimeMs,
					updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : stat.mtimeMs,
					workspace: extractWorkspaceHint(`${title} ${identityText} ${file}`),
					ticket: `${title} ${identityText}`.match(/\b[A-Z]+-\d+\b/)?.[0] ?? "",
					timeline,
				});
			} catch {}
		}
	} catch {}
	return entries.sort((a, b) => b.mtime - a.mtime).slice(0, 80);
}

function uniqueExistingDirs(dirs: Array<{ dir: string; source: string }>): Array<{ dir: string; source: string }> {
	const seen = new Set<string>();
	const results: Array<{ dir: string; source: string }> = [];
	for (const item of dirs) {
		try {
			if (!fs.existsSync(item.dir)) continue;
			const real = fs.realpathSync(item.dir);
			if (seen.has(real)) continue;
			seen.add(real);
			results.push({ dir: real, source: item.source });
		} catch {}
	}
	return results;
}

function workspaceFromCapturePath(root: string, filePath: string): string {
	const [first] = path.relative(root, filePath).split(path.sep).filter(Boolean);
	if (!first || first === path.basename(filePath)) return "";
	return first;
}

function walkMediaFiles(root: string, source: string, maxDepth = 8): CaptureEntry[] {
	const results: CaptureEntry[] = [];
	const visit = (dir: string, depth: number) => {
		if (depth > maxDepth) return;
		let entries: fs.Dirent[] = [];
		try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
		for (const entry of entries) {
			const fp = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if ([".git", "node_modules", ".next", "dist", "build"].includes(entry.name)) continue;
				visit(fp, depth + 1);
				continue;
			}
			if (!entry.isFile()) continue;
			const ext = path.extname(entry.name).toLowerCase();
			if (!MEDIA_EXTENSIONS.has(ext)) continue;
			try {
				const stat = fs.statSync(fp);
				results.push({
					path: fp,
					name: path.relative(root, fp) || entry.name,
					source,
					workspace: workspaceFromCapturePath(root, fp),
					time: formatMtime(stat.mtimeMs),
					mtime: stat.mtimeMs,
					size: stat.size,
					mime: mimeFor(fp),
				});
			} catch {}
		}
	};
	visit(root, 0);
	return results;
}

function collectCaptureMedia(cwd: string): CaptureEntry[] {
	const roots = uniqueExistingDirs([
		...contextWorkRoots(cwd),
		{ dir: path.join(ARCHIVE_DIR, "..", "captures"), source: "archive" },
	]);
	const byPath = new Map<string, CaptureEntry>();
	for (const root of roots) {
		for (const item of walkMediaFiles(root.dir, root.source)) {
			try { byPath.set(fs.realpathSync(item.path), item); } catch { byPath.set(item.path, item); }
		}
	}
	return [...byPath.values()].sort((a, b) => b.mtime - a.mtime).slice(0, 80);
}

function extractWorkspaceHint(value: string): string {
	const haystack = value.toLowerCase();
	for (const root of collectWorktreeRoots()) {
		const workspace = root.workspace.toLowerCase();
		if (workspace.length >= 2 && haystack.includes(workspace)) return root.workspace;
	}
	return "";
}

function parseTicketAndTitle(value: string): { ticket: string; title: string } {
	const ticket = value.match(/([A-Z]+-\d+)/)?.[1] ?? "";
	let title = value
		.replace(/^\s*\[[A-Z]+-\d+\]\s*/, "")
		.replace(/[()\[\]]/g, " ")
		.replace(/\b[A-Z]+-\d+\b/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (title === ticket) title = "";
	return { ticket, title };
}

function firstNonEmpty(...values: Array<string | undefined>): string {
	return values.find((value) => value && value.trim())?.trim() ?? "";
}

function isMeaningfulSessionTitle(value: string): boolean {
	const normalized = value.trim().toLowerCase();
	return Boolean(normalized) && !["untitled", "(untitled)", "새 세션"].includes(normalized);
}

function readJsonFile(filePath: string): Record<string, unknown> | null {
	try { return JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>; } catch { return null; }
}

function worktreeInfoForWorkspace(workspace: string): { ticket: string; title: string; note: string } {
	if (!workspace) return { ticket: "", title: "", note: "" };
	const candidates = [
		path.join(os.homedir(), "pilee-workspaces", "product", workspace, ".pi"),
		path.join(os.homedir(), "pilee-workspaces", "lambda", workspace, ".pi"),
		path.join(os.homedir(), "pilee-workspaces", workspace, ".pi"),
	];
	for (const dir of candidates) {
		if (!fs.existsSync(dir)) continue;
		const meta = readJsonFile(path.join(dir, "worktree-meta.json"));
		const note = typeof meta?.note === "string" ? meta.note : "";
		let parsed = parseTicketAndTitle(note);
		for (const contextName of ["conductor-context.loaded.md", "conductor-context.md"]) {
			const contextPath = path.join(dir, contextName);
			if (!fs.existsSync(contextPath)) continue;
			try {
				const content = fs.readFileSync(contextPath, "utf-8");
				const pr = content.match(/\|\s*PR\s*\|\s*\[([A-Z]+-\d+)\]\s*([^|`]+?)\s*\|/);
				if (pr) parsed = { ticket: pr[1], title: pr[2].trim() };
			} catch {}
		}
		return { ticket: parsed.ticket, title: parsed.title, note };
	}
	return { ticket: "", title: "", note: "" };
}

function latestSessionTitleForWorkspace(workspace: string): string {
	if (!workspace) return "";
	const sessionsRoot = path.join(os.homedir(), ".pi", "agent", "sessions");
	const candidates = [
		`--Users-changheelee-pilee-workspaces-product-${workspace}--`,
		`--Users-changheelee-pilee-workspaces-lambda-${workspace}--`,
	];
	for (const dirName of candidates) {
		const sessionsDir = path.join(sessionsRoot, dirName);
		if (!fs.existsSync(sessionsDir)) continue;
		try {
			const files = fs.readdirSync(sessionsDir)
				.filter((file) => file.endsWith(".jsonl"))
				.map((file) => path.join(sessionsDir, file))
				.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
				.slice(0, 12);
			for (const file of files) {
				const lines = fs.readFileSync(file, "utf-8").split(/\r?\n/).slice(0, 60);
				for (const line of lines) {
					if (!line.includes('"type":"session_info"')) continue;
					try {
						const parsed = JSON.parse(line) as { name?: string };
						const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
						if (isMeaningfulSessionTitle(name)) return name;
					} catch {}
				}
			}
		} catch {}
	}
	return "";
}

function frameTitleForWorkspace(workspace: string, frames: FrameTranscriptEntry[]): string {
	if (!workspace) return "";
	const lower = workspace.toLowerCase();
	const frame = frames.find((item) => `${item.title} ${item.identity}`.toLowerCase().includes(lower));
	return frame ? firstNonEmpty(frame.title, frame.identity) : "";
}

function buildCaptureGroups(captures: CaptureEntry[], frames: FrameTranscriptEntry[]): CaptureGroupEntry[] {
	const byWorkspace = new Map<string, CaptureEntry[]>();
	for (const capture of captures) {
		const key = capture.workspace || "__unclassified__";
		const list = byWorkspace.get(key) ?? [];
		list.push(capture);
		byWorkspace.set(key, list);
	}
	const groups: CaptureGroupEntry[] = [];
	for (const [key, groupCaptures] of byWorkspace) {
		const workspace = key === "__unclassified__" ? "" : key;
		const latestMtime = Math.max(...groupCaptures.map((item) => item.mtime));
		if (!workspace) {
			groups.push({ key, label: "미분류", fallbackLabel: "미분류", workspace: "", ticket: "", title: "", source: "unclassified", captures: groupCaptures.sort((a, b) => b.mtime - a.mtime), latestMtime, latestTime: formatMtime(latestMtime) });
			continue;
		}
		const worktree = worktreeInfoForWorkspace(workspace);
		const sessionTitle = latestSessionTitleForWorkspace(workspace);
		const frameTitle = frameTitleForWorkspace(workspace, frames);
		const ticket = worktree.ticket;
		const title = firstNonEmpty(worktree.title, sessionTitle, frameTitle);
		const label = ticket && title
			? `${ticket} · ${title}`
			: ticket
				? `${ticket} · ${workspace}`
				: title || workspace;
		const source: CaptureGroupEntry["source"] = ticket ? "jira" : sessionTitle ? "session" : frameTitle ? "frame" : "workspace";
		groups.push({ key, label, fallbackLabel: workspace, workspace, ticket, title, source, captures: groupCaptures.sort((a, b) => b.mtime - a.mtime), latestMtime, latestTime: formatMtime(latestMtime) });
	}
	return groups.sort((a, b) => {
		if (a.source === "unclassified" && b.source !== "unclassified") return 1;
		if (b.source === "unclassified" && a.source !== "unclassified") return -1;
		return b.latestMtime - a.latestMtime;
	});
}

function stripMarkdownCell(value: string): string {
	return value
		.replace(/`/g, "")
		.replace(/\[([^\]]+)\]\([^\)]+\)/g, "$1")
		.replace(/\s+/g, " ")
		.trim();
}

function markdownTableValue(markdown: string, label: string): string {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = markdown.match(new RegExp(`\\|\\s*${escaped}\\s*\\|\\s*([^|]+?)\\s*\\|`));
	return match ? stripMarkdownCell(match[1]) : "";
}

function extractConductorRequests(markdown: string): string[] {
	const marker = markdown.search(/^##\s+이전 대화/m);
	if (marker < 0) return [];
	const tail = markdown.slice(marker);
	const nextHeading = tail.slice(1).search(/^##\s+/m);
	const section = nextHeading >= 0 ? tail.slice(0, nextHeading + 1) : tail;
	const requests: string[] = [];
	for (const line of section.split(/\r?\n/)) {
		const match = line.match(/^\s*-\s+(.+)$/);
		if (match) requests.push(match[1].trim());
		if (requests.length >= 60) break;
	}
	return requests;
}

function conductorProjectDirs(repo: string, workspace: string): string[] {
	const base = path.join(os.homedir(), ".claude", "projects");
	return [
		path.join(base, `-Users-changheelee-conductor-workspaces-${repo}-${workspace}`),
		path.join(base, `-Users-changheelee-conductor-workspaces-${workspace}`),
		path.join(base, `-Users-changheelee-conductor-workspaces-product-${workspace}`),
		path.join(base, `-Users-changheelee-conductor-workspaces-lambda-${workspace}`),
	];
}

function findConductorSourceSessions(repo: string, workspace: string, sessionId: string): string[] {
	const found: string[] = [];
	const seen = new Set<string>();
	for (const dir of conductorProjectDirs(repo, workspace)) {
		if (!fs.existsSync(dir)) continue;
		const add = (filePath: string) => {
			try {
				const real = fs.realpathSync(filePath);
				if (!seen.has(real)) { seen.add(real); found.push(real); }
			} catch {}
		};
		if (sessionId) add(path.join(dir, `${sessionId}.jsonl`));
		try {
			const files = fs.readdirSync(dir)
				.filter((file) => file.endsWith(".jsonl"))
				.map((file) => path.join(dir, file))
				.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
				.slice(0, 3);
			for (const file of files) add(file);
		} catch {}
	}
	return found.slice(0, 3);
}

function readPiSessionsFromDir(sessionsDir: string, workspace: string, limit = 10): PiSessionEntry[] {
	if (!fs.existsSync(sessionsDir)) return [];
	try {
		return fs.readdirSync(sessionsDir)
			.filter((file) => file.endsWith(".jsonl"))
			.map((file) => path.join(sessionsDir, file))
			.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
			.slice(0, limit)
			.map((file) => readPiSessionEntry(file, workspace))
			.filter((entry): entry is PiSessionEntry => Boolean(entry));
	} catch { return []; }
}

function findPiSessionsForWorkspace(repo: string, workspace: string): PiSessionEntry[] {
	const sessionsDir = path.join(os.homedir(), ".pi", "agent", "sessions", `--Users-changheelee-pilee-workspaces-${repo}-${workspace}--`);
	return readPiSessionsFromDir(sessionsDir, workspace);
}

function readPiSessionEntry(filePath: string, workspace: string): PiSessionEntry | null {
	try {
		const stat = fs.statSync(filePath);
		let title = "Pi 대화 세션";
		let restoredFromConductor = false;
		const lines = fs.readFileSync(filePath, "utf-8").split(/\r?\n/).slice(0, 120);
		for (const line of lines) {
			if (line.includes('"customType":"conductor-resume"')) restoredFromConductor = true;
			if (!line.includes('"type":"session_info"')) continue;
			try {
				const parsed = JSON.parse(line) as { name?: string };
				const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
				if (isMeaningfulSessionTitle(name)) title = name;
			} catch {}
		}
		return { path: fs.realpathSync(filePath), title, workspace, restoredFromConductor, time: formatMtime(stat.mtimeMs), mtime: stat.mtimeMs };
	} catch { return null; }
}

function titleFromMarkdown(filePath: string): string {
	try {
		for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/).slice(0, 40)) {
			const heading = line.match(/^#\s+(.+)$/);
			if (heading) return heading[1].trim();
		}
	} catch {}
	return path.basename(filePath);
}

function collectPlanningDocs(cwd: string, frames: FrameTranscriptEntry[]): PlanningDocEntry[] {
	const byPath = new Map<string, PlanningDocEntry>();
	const roots = existingRealDirs([
		...contextWorkRoots(cwd),
		...collectWorktreeRoots().flatMap((root) => [
			{ dir: path.join(root.workspacePath, ".context", "plans"), source: root.workspace },
			{ dir: path.join(root.workspacePath, ".context", "work"), source: root.workspace },
		]),
	]);
	for (const root of roots) {
		const visit = (dir: string, depth: number) => {
			if (depth > 4) return;
			let entries: fs.Dirent[] = [];
			try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
			for (const entry of entries) {
				const fp = path.join(dir, entry.name);
				if (entry.isDirectory()) { if (!entry.name.startsWith(".")) visit(fp, depth + 1); continue; }
				if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
				try {
					const stat = fs.statSync(fp);
					const name = path.relative(root.dir, fp) || entry.name;
					const title = titleFromMarkdown(fp);
					const workspace = workspaceFromCapturePath(root.dir, fp) || extractWorkspaceHint(`${name} ${title}`) || root.source;
					const ticket = `${name} ${title}`.match(/\b[A-Z]+-\d+\b/)?.[0] ?? "";
					const source: PlanningDocEntry["source"] = fp.includes(`${path.sep}plans${path.sep}`) ? "plan" : "context";
					byPath.set(fs.realpathSync(fp), { path: fp, name, title, workspace, ticket, source, time: formatMtime(stat.mtimeMs), mtime: stat.mtimeMs });
				} catch {}
			}
		};
		visit(root.dir, 0);
	}
	for (const frame of frames) {
		byPath.set(frame.path, { path: frame.path, name: path.basename(frame.path), title: frame.title, workspace: frame.workspace, ticket: frame.ticket, source: "frame-studio", time: frame.time, mtime: frame.mtime });
	}
	return [...byPath.values()].sort((a, b) => b.mtime - a.mtime).slice(0, 180);
}

function collectPiWorkUnits(reports: ReportEntry[], frames: FrameTranscriptEntry[], planningDocs: PlanningDocEntry[], captures: CaptureEntry[], webSearches: WebSearchEntry[]): PiWorkUnitEntry[] {
	const units: PiWorkUnitEntry[] = [];
	for (const root of collectWorktreeRoots()) {
		const meta = readJsonFile(path.join(root.piDir, "worktree-meta.json"));
		const loadedPath = path.join(root.piDir, "conductor-context.loaded.md");
		const fallbackContextPath = path.join(root.piDir, "conductor-context.md");
		const contextPath = fs.existsSync(loadedPath) ? loadedPath : fs.existsSync(fallbackContextPath) ? fallbackContextPath : "";
		let markdown = "";
		try { if (contextPath) markdown = fs.readFileSync(contextPath, "utf-8"); } catch {}
		const branch = firstNonEmpty(markdownTableValue(markdown, "Branch"), typeof meta?.branch === "string" ? meta.branch : "");
		const pr = markdownTableValue(markdown, "PR");
		const note = typeof meta?.note === "string" ? meta.note : "";
		const parsedPr = parseTicketAndTitle(pr);
		const parsedNote = parseTicketAndTitle(note);
		const parsedBranch = parseTicketAndTitle(branch);
		const ticket = firstNonEmpty(parsedPr.ticket, parsedNote.ticket, parsedBranch.ticket);
		const title = firstNonEmpty(parsedPr.title, parsedNote.title, latestSessionTitleForWorkspace(root.workspace), root.workspace);
		const sessions = findPiSessionsForWorkspace(root.repo, root.workspace);
		const originalConductorSessionPaths = contextPath ? findConductorSourceSessions(root.repo, root.workspace, markdownTableValue(markdown, "Session")) : [];
		const relatedMtimes = [
			...reportsForUnit({ ticket, workspace: root.workspace, title }, reports).map((item) => item.mtime),
			...framesForUnit({ ticket, workspace: root.workspace, title }, frames).map((item) => item.mtime),
			...planningDocsForUnit({ ticket, workspace: root.workspace, title }, planningDocs).map((item) => item.mtime),
			...capturesForUnit({ ticket, workspace: root.workspace, title }, captures).map((item) => item.mtime),
			...webSearchesForUnit({ ticket, workspace: root.workspace, title }, webSearches).map((item) => item.mtime),
			...sessions.map((item) => item.mtime),
		];
		const statMtime = contextPath ? fs.statSync(contextPath).mtimeMs : fs.statSync(root.workspacePath).mtimeMs;
		const mtime = Math.max(statMtime, ...relatedMtimes, 0);
		units.push({
			key: `${root.repo}:${root.workspace}`,
			repo: root.repo,
			workspace: root.workspace,
			workspacePath: root.workspacePath,
			label: ticket ? `${ticket} · ${title}` : `${root.workspace} · ${title}`,
			ticket,
			title,
			branch,
			contextPath,
			loadedByResume: Boolean(contextPath && path.basename(contextPath) === "conductor-context.loaded.md"),
			originalConductorSessionPaths,
			piRestoredSessions: sessions.filter((session) => session.restoredFromConductor),
			piChatSessions: sessions.filter((session) => !session.restoredFromConductor),
			mtime,
			time: formatMtime(mtime),
		});
	}
	const sessionsRoot = path.join(os.homedir(), ".pi", "agent", "sessions");
	for (const special of [
		{ key: "pi:pilee", workspace: "pilee", title: "pilee Pi 대화 세션", workspacePath: path.join(os.homedir(), ".pi", "agent", "git", "github.com", "heestolee", "pilee"), sessionsDir: path.join(sessionsRoot, "--Users-changheelee-pilee--") },
		{ key: "pi:home", workspace: "home", title: "home Pi 대화 세션", workspacePath: os.homedir(), sessionsDir: path.join(sessionsRoot, "--Users-changheelee--") },
	]) {
		const sessions = readPiSessionsFromDir(special.sessionsDir, special.workspace, 12);
		if (!sessions.length) continue;
		const mtime = Math.max(...sessions.map((session) => session.mtime));
		units.push({
			key: special.key,
			repo: "pi",
			workspace: special.workspace,
			workspacePath: special.workspacePath,
			label: special.title,
			ticket: "",
			title: special.title,
			branch: "",
			contextPath: "",
			loadedByResume: false,
			originalConductorSessionPaths: [],
			piRestoredSessions: sessions.filter((session) => session.restoredFromConductor),
			piChatSessions: sessions.filter((session) => !session.restoredFromConductor),
			mtime,
			time: formatMtime(mtime),
		});
	}
	return units.sort((a, b) => b.mtime - a.mtime).slice(0, 80);
}

function queryConductorSync(sql: string): string {
	if (!fs.existsSync(CONDUCTOR_DB)) return "";
	try { return execFileSync("sqlite3", ["-separator", "§", CONDUCTOR_DB, sql], { encoding: "utf-8" }).trim(); } catch { return ""; }
}

function requestsFromConductorJsonl(filePath: string): string[] {
	const requests: string[] = [];
	try {
		for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
			if (!line.trim()) continue;
			let obj: any;
			try { obj = JSON.parse(line); } catch { continue; }
			if (obj.type !== "user") continue;
			const content = obj.message?.content;
			let text = typeof content === "string" ? content : Array.isArray(content) ? content.filter((block: any) => block?.type === "text").map((block: any) => block.text).join(" ") : "";
			text = text.replace(/\s+/g, " ").trim();
			if (!text || text.startsWith("<system") || text.startsWith("<local-command")) continue;
			requests.push(text.slice(0, 300));
			if (requests.length >= 30) break;
		}
	} catch {}
	return requests;
}

function collectConductorHistories(): ConductorHistoryEntry[] {
	const rows = queryConductorSync("SELECT w.directory_name, COALESCE(r.name,''), COALESCE(w.branch,''), COALESCE(w.state,''), COALESCE(w.pr_title,''), COALESCE(w.active_session_id,''), COALESCE(w.created_at,''), COALESCE(w.updated_at,'') FROM workspaces w LEFT JOIN repos r ON w.repository_id = r.id ORDER BY w.updated_at DESC LIMIT 160");
	if (!rows) return [];
	const entries: ConductorHistoryEntry[] = [];
	for (const line of rows.split("\n")) {
		const [workspace = "", repo = "", branch = "", status = "", pr = "", sessionId = "", createdAt = "", updatedAt = ""] = line.split("§");
		if (!workspace) continue;
		const parsedPr = parseTicketAndTitle(pr);
		const parsedBranch = parseTicketAndTitle(branch);
		const ticket = firstNonEmpty(parsedPr.ticket, parsedBranch.ticket);
		const title = firstNonEmpty(parsedPr.title, workspace);
		const sourceSessionPaths = findConductorSourceSessions(repo || "product", workspace, sessionId);
		const firstSession = sourceSessionPaths[0] ?? "";
		let mtime = Date.parse(updatedAt || createdAt);
		if (firstSession) { try { mtime = Math.max(mtime || 0, fs.statSync(firstSession).mtimeMs); } catch {} }
		entries.push({
			key: `${repo || "conductor"}:${workspace}`,
			repo: repo || "conductor",
			workspace,
			label: ticket ? `${ticket} · ${title}` : `${workspace} · ${title}`,
			ticket,
			title,
			branch,
			pr,
			status,
			createdAt,
			sessionId,
			requests: firstSession ? requestsFromConductorJsonl(firstSession) : [],
			sourceSessionPaths,
			mtime: Number.isFinite(mtime) && mtime > 0 ? mtime : Date.now(),
			time: formatMtime(Number.isFinite(mtime) && mtime > 0 ? mtime : Date.now()),
		});
	}
	return entries.sort((a, b) => b.mtime - a.mtime).slice(0, 120);
}

interface MatchableUnit { ticket: string; workspace: string; title: string; }

function unitMatches(unit: MatchableUnit, ...values: string[]): boolean {
	const haystack = values.join(" ").toLowerCase();
	if (!haystack) return false;
	const needles = [unit.ticket, unit.workspace, unit.title].filter((value) => value && value.length >= 2).map((value) => value.toLowerCase());
	return needles.some((needle) => haystack.includes(needle));
}

function reportsForUnit(unit: MatchableUnit, reports: ReportEntry[]): ReportEntry[] {
	return reports.filter((report) => report.workspace === unit.workspace || unitMatches(unit, report.name, report.path, report.ticket));
}

function framesForUnit(unit: MatchableUnit, frames: FrameTranscriptEntry[]): FrameTranscriptEntry[] {
	return frames.filter((frame) => frame.workspace === unit.workspace || unitMatches(unit, frame.title, frame.identity, frame.path, frame.ticket));
}

function planningDocsForUnit(unit: MatchableUnit, docs: PlanningDocEntry[]): PlanningDocEntry[] {
	return docs.filter((doc) => doc.workspace === unit.workspace || unitMatches(unit, doc.name, doc.title, doc.path, doc.ticket));
}

function capturesForUnit(unit: MatchableUnit, captures: CaptureEntry[]): CaptureEntry[] {
	return captures.filter((capture) => capture.workspace === unit.workspace || unitMatches(unit, capture.name, capture.path));
}

function webSearchesForUnit(unit: MatchableUnit, webSearches: WebSearchEntry[]): WebSearchEntry[] {
	return webSearches.filter((entry) => entry.workspace === unit.workspace || unitMatches(unit, entry.name, entry.path, entry.ticket, entry.queries.join(" ")));
}

function fileHref(filePath: string): string {
	try { return pathToFileURL(fs.realpathSync(filePath)).href; } catch { return pathToFileURL(filePath).href; }
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function mediaDataUri(filePath: string, maxBytes = MAX_INLINE_MEDIA_BYTES): string {
	try {
		const stat = fs.statSync(filePath);
		if (stat.size > maxBytes) return "";
		return `data:${mimeFor(filePath)};base64,${fs.readFileSync(filePath).toString("base64")}`;
	} catch { return ""; }
}

function readTextPreview(filePath: string, maxBytes = 256 * 1024): { text: string; truncated: boolean; size: number } {
	const stat = fs.statSync(filePath);
	const bytesToRead = Math.min(stat.size, maxBytes);
	const buffer = Buffer.alloc(bytesToRead);
	const fd = fs.openSync(filePath, "r");
	try {
		fs.readSync(fd, buffer, 0, bytesToRead, 0);
	} finally {
		fs.closeSync(fd);
	}
	return { text: buffer.toString("utf-8"), truncated: stat.size > bytesToRead, size: stat.size };
}

function buildMediaPreviewHtml(filePath: string, title = path.basename(filePath)): string {
	const src = mediaDataUri(filePath, 40 * 1024 * 1024);
	const fileUrl = fileHref(filePath);
	return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
		body{margin:0;background:#111;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;grid-template-rows:auto 1fr;min-height:100vh}.bar{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:12px 16px;background:#18181b;border-bottom:1px solid rgba(255,255,255,.12)}.path{color:#a1a1aa;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stage{display:grid;place-items:center;min-height:0;padding:18px}img{max-width:100%;max-height:calc(100vh - 92px);object-fit:contain;border-radius:12px;box-shadow:0 20px 80px rgba(0,0,0,.35)}a{color:#c4b5fd;text-decoration:none;border:1px solid rgba(255,255,255,.18);padding:7px 10px;border-radius:8px}
	</style></head><body><div class="bar"><div><strong>${escapeHtml(title)}</strong><div class="path">${escapeHtml(filePath)}</div></div><a href="${escapeAttr(fileUrl)}" target="_blank" rel="noreferrer">원본 열기</a></div><div class="stage">${src ? `<img src="${src}" alt="${escapeAttr(title)}">` : `<p>파일이 커서 inline preview를 만들지 않았습니다. <a href="${escapeAttr(fileUrl)}" target="_blank" rel="noreferrer">원본 열기</a></p>`}</div></body></html>`;
}

function transcriptValue(record: unknown, key: string): unknown {
	return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
}

function renderTranscriptMarkdownBlock(markdown: unknown): string {
	if (typeof markdown !== "string" || !markdown.trim()) return "";
	return `<details><summary>Markdown 전문</summary><pre>${escapeHtml(markdown)}</pre></details>`;
}

function renderFrameTimeline(timeline: unknown[]): string {
	if (!timeline.length) return `<p class="muted">기록된 timeline이 없습니다.</p>`;
	return timeline.map((raw) => {
		const kind = String(transcriptValue(raw, "kind") || "entry");
		const step = String(transcriptValue(raw, "step") || "");
		const time = typeof transcriptValue(raw, "time") === "number" ? new Date(transcriptValue(raw, "time") as number).toLocaleString() : "";
		const question = transcriptValue(raw, "question") as Record<string, unknown> | undefined;
		const answer = transcriptValue(raw, "answer") as Record<string, unknown> | undefined;
		const options = Array.isArray(question?.options) ? question.options : [];
		const selected = Array.isArray(answer?.selectedOptions) ? answer.selectedOptions : [];
		const text = typeof answer?.text === "string" ? answer.text : "";
		return `<article class="timeline-item">
			<div class="timeline-head"><span>${escapeHtml(time)}</span><strong>${escapeHtml(kind)}</strong>${step ? `<span>${escapeHtml(step)}</span>` : ""}</div>
			${transcriptValue(raw, "message") ? `<p>${escapeHtml(String(transcriptValue(raw, "message")))}</p>` : ""}
			${renderTranscriptMarkdownBlock(transcriptValue(raw, "markdown"))}
			${question?.question ? `<div class="qa"><div class="label">질문</div><div>${escapeHtml(String(question.question))}</div></div>` : ""}
			${options.length ? `<div class="qa"><div class="label">옵션</div><ol>${options.map((o) => `<li>${escapeHtml(String(o))}</li>`).join("")}</ol></div>` : ""}
			${answer ? `<div class="answer"><div class="label">답변</div>${selected.length ? `<ol>${selected.map((o) => `<li>${escapeHtml(String(o))}</li>`).join("")}</ol>` : `<p class="muted">선택값 없음</p>`}${text ? `<p><strong>직접 입력:</strong> ${escapeHtml(text)}</p>` : ""}</div>` : ""}
		</article>`;
	}).join("\n");
}

function buildFrameTranscriptStandaloneHtml(filePath: string): string {
	let parsed: Record<string, unknown> = {};
	try { parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Record<string, unknown>; } catch {}
	const identity = valueFromRecord(parsed, "identity") as Record<string, unknown> | undefined;
	const title = String(parsed.title || identity?.displayTitle || path.basename(filePath));
	const timeline = Array.isArray(parsed.timeline) ? parsed.timeline : [];
	return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>${artifactBrowserStyle()}</head><body><main class="shell"><header class="hero"><div class="kicker">🔥 Frame Transcript</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(filePath)}</p></header><section class="card"><h2>Frame 전문</h2><div class="timeline">${renderFrameTimeline(timeline)}</div></section></main></body></html>`;
}

function artifactBrowserStyle(): string {
	return `<style>
	:root{color-scheme:light;--bg:#fafaf9;--panel:#fff;--line:#e7e5e4;--text:#292524;--muted:#78716c;--accent:#7c3aed;--soft:#f5f3ff;--green:#166534;--amber:#92400e}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.shell{max-width:1180px;margin:0 auto;padding:24px}.hero{padding:24px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(135deg,#fff,#f5f3ff);box-shadow:0 20px 60px rgba(41,37,36,.08)}.kicker{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{margin:6px 0 8px;font-size:32px;line-height:1.15}.hero p,.muted{color:var(--muted)}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.tab{border:1px solid var(--line);border-radius:999px;background:#fff;padding:9px 13px;font-weight:800;cursor:pointer}.tab.active{background:var(--accent);border-color:var(--accent);color:#fff}.panel{display:none}.panel.active{display:block}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}.card{border:1px solid var(--line);border-radius:18px;background:var(--panel);padding:16px;box-shadow:0 10px 30px rgba(41,37,36,.05);overflow:hidden}.card h2,.card h3{margin:0 0 8px}.meta{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.badge{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 8px;background:#fff}.path{color:var(--muted);font-size:12px;word-break:break-all}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.button{border:1px solid var(--line);border-radius:10px;padding:7px 10px;text-decoration:none;color:var(--accent);font-weight:800;background:#fff;cursor:pointer;font:inherit}.button:hover{background:var(--soft)}.button[disabled]{opacity:.55;cursor:wait}.thumb{display:grid;place-items:center;aspect-ratio:16/10;background:#111;border-radius:14px;overflow:hidden;margin-bottom:10px}.thumb img{width:100%;height:100%;object-fit:contain}.empty{padding:40px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:18px;background:#fff}.timeline{display:grid;gap:12px}.timeline-item{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff}.timeline-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:12px}.timeline-head strong{color:var(--accent);text-transform:uppercase}.qa,.answer{margin-top:8px}.label{font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}pre{white-space:pre-wrap;word-break:break-word;background:#292524;color:#fafaf9;border-radius:12px;padding:12px;max-height:360px;overflow:auto}details{margin-top:8px}summary{cursor:pointer;font-weight:800}.search{width:100%;height:40px;border:1px solid var(--line);border-radius:12px;padding:0 12px;margin:16px 0;font:inherit}
	</style>`;
}

function reportSourceLabel(source: ReportEntry["source"]): string {
	return source === "workspace" ? "workspace" : "archive";
}

function planningSourceLabel(source: PlanningDocEntry["source"]): string {
	if (source === "frame-studio") return "Frame Studio";
	if (source === "plan") return ".context/plans";
	return ".context/work";
}

function artifactOpenButtons(filePath: string): string {
	const escapedPath = escapeAttr(filePath);
	return `<button class="button open-artifact" type="button" data-target="glimpse" data-path="${escapedPath}">열기</button><button class="button open-artifact" type="button" data-target="browser" data-path="${escapedPath}">브라우저에서 열기</button>`;
}

function renderReportCards(reports: ReportEntry[]): string {
	if (!reports.length) return `<div class="empty">검증 리포트가 없습니다.</div>`;
	return `<div class="grid">${reports.map((r) => `<article class="card searchable" data-search="${escapeAttr(`${r.name} ${r.ticket} ${r.workspace} ${r.source}`.toLowerCase())}"><h3>${escapeHtml(r.name)}</h3><div class="meta"><span class="badge">${escapeHtml(reportSourceLabel(r.source))}</span>${r.workspace ? `<span class="badge">${escapeHtml(r.workspace)}</span>` : ""}<span class="badge">${escapeHtml(r.time)}</span>${r.ticket ? `<span class="badge">${escapeHtml(r.ticket)}</span>` : ""}</div><div class="path">${escapeHtml(r.path)}</div><div class="actions">${artifactOpenButtons(r.path)}</div></article>`).join("\n")}</div>`;
}

function renderWebSearchCards(webSearches: WebSearchEntry[]): string {
	if (!webSearches.length) return `<div class="empty">웹 검색 review artifact가 없습니다.</div>`;
	return `<div class="grid">${webSearches.map((entry) => `<article class="card searchable" data-search="${escapeAttr(`${entry.name} ${entry.queries.join(" ")} ${entry.ticket} ${entry.workspace}`.toLowerCase())}"><div class="kicker">🔎 Web Search</div><h3>${escapeHtml(entry.queries[0] || entry.name)}</h3><div class="meta">${entry.workspace ? `<span class="badge">${escapeHtml(entry.workspace)}</span>` : `<span class="badge">미분류</span>`}${entry.ticket ? `<span class="badge">${escapeHtml(entry.ticket)}</span>` : ""}<span class="badge">${escapeHtml(entry.time)}</span></div>${entry.queries.length > 1 ? `<ol>${entry.queries.map((q) => `<li>${escapeHtml(q)}</li>`).join("\n")}</ol>` : ""}<div class="path">${escapeHtml(entry.path)}</div><div class="actions">${artifactOpenButtons(entry.path)}</div></article>`).join("\n")}</div>`;
}

function renderFrameCards(frames: FrameTranscriptEntry[]): string {
	if (!frames.length) return `<div class="empty">저장된 Frame Studio 전문이 없습니다.</div>`;
	return `<div class="grid">${frames.map((f) => `<article class="card searchable" data-search="${escapeAttr(`${f.title} ${f.identity} ${f.mode} ${f.workspace} ${f.ticket}`.toLowerCase())}"><h3>${escapeHtml(f.title)}</h3><div class="meta"><span class="badge">${escapeHtml(f.mode)}</span>${f.workspace ? `<span class="badge">${escapeHtml(f.workspace)}</span>` : ""}${f.ticket ? `<span class="badge">${escapeHtml(f.ticket)}</span>` : ""}<span class="badge">${escapeHtml(f.time)}</span><span class="badge">${f.timeline.length} entries</span></div><div class="path">${escapeHtml(f.identity)}</div><details><summary>Frame 전문 미리보기</summary><div class="timeline">${renderFrameTimeline(f.timeline)}</div></details><div class="actions">${artifactOpenButtons(f.path)}</div></article>`).join("\n")}</div>`;
}

function renderPlanningDocCards(docs: PlanningDocEntry[]): string {
	if (!docs.length) return `<div class="empty">기획/컨텍스트 markdown이 없습니다.</div>`;
	return `<div class="grid">${docs.map((doc) => `<article class="card searchable" data-search="${escapeAttr(`${doc.title} ${doc.name} ${doc.workspace} ${doc.ticket} ${doc.source}`.toLowerCase())}"><h3>${escapeHtml(doc.title)}</h3><div class="meta"><span class="badge">${escapeHtml(planningSourceLabel(doc.source))}</span>${doc.workspace ? `<span class="badge">${escapeHtml(doc.workspace)}</span>` : ""}${doc.ticket ? `<span class="badge">${escapeHtml(doc.ticket)}</span>` : ""}<span class="badge">${escapeHtml(doc.time)}</span></div><div class="path">${escapeHtml(doc.path)}</div><div class="actions">${artifactOpenButtons(doc.path)}</div></article>`).join("\n")}</div>`;
}

function renderSessionCards(title: string, sessions: PiSessionEntry[]): string {
	if (!sessions.length) return `<section><h3>${escapeHtml(title)} · 0</h3><div class="empty">세션이 없습니다.</div></section>`;
	return `<section><h3>${escapeHtml(title)} · ${sessions.length}</h3><div class="grid">${sessions.map((session) => `<article class="card searchable" data-search="${escapeAttr(`${session.title} ${session.workspace}`.toLowerCase())}"><h3>${escapeHtml(session.title)}</h3><div class="meta"><span class="badge">${session.restoredFromConductor ? "Conductor 복구" : "Pi 대화"}</span><span class="badge">${escapeHtml(session.time)}</span></div><div class="path">${escapeHtml(session.path)}</div><div class="actions">${artifactOpenButtons(session.path)}</div></article>`).join("\n")}</div></section>`;
}

function renderConductorSourceCards(title: string, paths: string[], restored = false): string {
	if (!paths.length) return "";
	return `<section><h3>${escapeHtml(title)} · ${paths.length}</h3><div class="grid">${paths.map((filePath) => `<article class="card searchable" data-search="${escapeAttr(filePath.toLowerCase())}"><h3>${escapeHtml(path.basename(filePath))}</h3><div class="meta"><span class="badge">원본 Conductor</span>${restored ? `<span class="badge">Pi 복구됨</span>` : ""}</div><div class="path">${escapeHtml(filePath)}</div><div class="actions">${artifactOpenButtons(filePath)}</div></article>`).join("\n")}</div></section>`;
}

function captureSourceLabel(source: CaptureGroupEntry["source"]): string {
	if (source === "jira") return "Jira / 작업 제목";
	if (source === "session") return "P0 / 세션 제목";
	if (source === "frame") return "Frame identity";
	if (source === "workspace") return "workspace fallback";
	return "미분류";
}

function renderCaptureFileCards(captures: CaptureEntry[]): string {
	return `<div class="grid">${captures.map((c) => { const src = mediaDataUri(c.path); return `<article class="card searchable" data-search="${escapeAttr(`${c.name} ${c.source} ${c.workspace}`.toLowerCase())}"><div class="thumb">${src ? `<img src="${src}" alt="${escapeAttr(c.name)}" loading="lazy">` : `<span class="muted">${escapeHtml(formatBytes(c.size))}</span>`}</div><h3>${escapeHtml(path.basename(c.path))}</h3><div class="meta"><span class="badge">${escapeHtml(c.source)}</span>${c.workspace ? `<span class="badge">${escapeHtml(c.workspace)}</span>` : ""}<span class="badge">${escapeHtml(c.time)}</span><span class="badge">${escapeHtml(formatBytes(c.size))}</span></div><div class="path">${escapeHtml(c.name)}</div><div class="actions">${artifactOpenButtons(c.path)}</div></article>`; }).join("\n")}</div>`;
}

function renderCaptureCards(captures: CaptureEntry[], frames: FrameTranscriptEntry[]): string {
	if (!captures.length) return `<div class="empty">캡처 이미지가 없습니다. 현재 cwd와 home의 .context/work/captures를 확인합니다.</div>`;
	const groups = buildCaptureGroups(captures, frames);
	const groupCards = groups.map((group) => `<article class="card searchable capture-folder-card" data-search="${escapeAttr(`${group.label} ${group.fallbackLabel} ${group.ticket} ${group.title} ${group.source}`.toLowerCase())}"><div class="kicker">📁 Capture group</div><h3>${escapeHtml(group.label)}</h3><div class="meta"><span class="badge">${escapeHtml(captureSourceLabel(group.source))}</span><span class="badge">${group.captures.length}개</span><span class="badge">최근 ${escapeHtml(group.latestTime)}</span>${group.workspace ? `<span class="badge">workspace: ${escapeHtml(group.workspace)}</span>` : ""}</div>${group.fallbackLabel && group.fallbackLabel !== group.label ? `<div class="path">fallback: ${escapeHtml(group.fallbackLabel)}</div>` : ""}<div class="actions"><button class="button open-capture-group" type="button" data-group="${escapeAttr(group.key)}">폴더 열기</button></div></article>`).join("\n");
	const groupPanels = groups.map((group) => `<section class="capture-group-panel" data-group-panel="${escapeAttr(group.key)}" hidden><div class="actions"><button class="button" type="button" onclick="showCaptureGroups()">← 그룹 목록</button></div><header class="card"><div class="kicker">캡처 / 미디어</div><h2>${escapeHtml(group.label)}</h2><div class="meta"><span class="badge">${escapeHtml(captureSourceLabel(group.source))}</span><span class="badge">${group.captures.length}개</span>${group.ticket ? `<span class="badge">${escapeHtml(group.ticket)}</span>` : ""}${group.workspace ? `<span class="badge">workspace: ${escapeHtml(group.workspace)}</span>` : ""}</div></header>${renderCaptureFileCards(group.captures)}</section>`).join("\n");
	return `<div id="capture-groups"><div class="grid">${groupCards}</div></div><div id="capture-files" hidden>${groupPanels}</div>`;
}

function renderPiWorkUnitCards(data: ArtifactBrowserData): string {
	if (!data.piUnits.length) return `<div class="empty">Pi worktree 이력이 없습니다.</div>`;
	const groupCards = data.piUnits.map((unit) => {
		const reports = reportsForUnit(unit, data.reports);
		const frames = framesForUnit(unit, data.frames);
		const planningDocs = planningDocsForUnit(unit, data.planningDocs);
		const captures = capturesForUnit(unit, data.captures);
		const webSearches = webSearchesForUnit(unit, data.webSearches);
		return `<article class="card searchable pi-work-card" data-search="${escapeAttr(`${unit.label} ${unit.workspace} ${unit.branch}`.toLowerCase())}"><div class="kicker">🔥 Pi history</div><h3>${escapeHtml(unit.label)}</h3><div class="meta"><span class="badge">${escapeHtml(unit.repo)}</span>${unit.loadedByResume ? `<span class="badge">/wt resume</span>` : ""}${unit.branch ? `<span class="badge">${escapeHtml(unit.branch)}</span>` : ""}</div><div class="meta"><span class="badge">원본 ${unit.originalConductorSessionPaths.length}</span><span class="badge">복구 세션 ${unit.piRestoredSessions.length}</span><span class="badge">Pi 대화 ${unit.piChatSessions.length}</span><span class="badge">리포트 ${reports.length}</span><span class="badge">Frame/기획 ${planningDocs.length}</span><span class="badge">캡처 ${captures.length}</span><span class="badge">웹검색 ${webSearches.length}</span></div><div class="path">${escapeHtml(unit.workspacePath)}</div><div class="actions"><button class="button open-pi-detail" type="button" data-pi="${escapeAttr(unit.key)}">이력 열기</button></div></article>`;
	}).join("\n");
	const detailPanels = data.piUnits.map((unit) => {
		const reports = reportsForUnit(unit, data.reports);
		const frames = framesForUnit(unit, data.frames);
		const planningDocs = planningDocsForUnit(unit, data.planningDocs);
		const captures = capturesForUnit(unit, data.captures);
		const webSearches = webSearchesForUnit(unit, data.webSearches);
		return `<section class="pi-detail-panel" data-pi-panel="${escapeAttr(unit.key)}" hidden><div class="actions"><button class="button" type="button" onclick="showPiGroups()">← Pi 이력 목록</button></div><header class="card"><div class="kicker">Pi 이력</div><h2>${escapeHtml(unit.label)}</h2><div class="meta"><span class="badge">${escapeHtml(unit.repo)}</span>${unit.ticket ? `<span class="badge">${escapeHtml(unit.ticket)}</span>` : ""}${unit.loadedByResume ? `<span class="badge">/wt resume 복구</span>` : ""}${unit.branch ? `<span class="badge">${escapeHtml(unit.branch)}</span>` : ""}</div><div class="path">${escapeHtml(unit.workspacePath)}</div></header>${renderConductorSourceCards("원본 Conductor 세션", unit.originalConductorSessionPaths, unit.piRestoredSessions.length > 0)}${renderSessionCards("Pi 복구 세션", unit.piRestoredSessions)}${renderSessionCards("Pi 대화 세션", unit.piChatSessions)}${unit.contextPath ? `<section><h3>복구 컨텍스트</h3><div class="grid"><article class="card"><h3>${escapeHtml(path.basename(unit.contextPath))}</h3><div class="path">${escapeHtml(unit.contextPath)}</div><div class="actions">${artifactOpenButtons(unit.contextPath)}</div></article></div></section>` : ""}<section><h3>검증 리포트 · ${reports.length}</h3>${renderReportCards(reports)}</section><section><h3>기획 / Frame · ${planningDocs.length}</h3>${renderPlanningDocCards(planningDocs)}</section><section><h3>캡처 / 미디어 · ${captures.length}</h3>${captures.length ? renderCaptureFileCards(captures) : `<div class="empty">연결된 캡처 미디어가 없습니다.</div>`}</section><section><h3>웹 검색 · ${webSearches.length}</h3>${renderWebSearchCards(webSearches)}</section></section>`;
	}).join("\n");
	return `<div id="pi-groups"><div class="grid">${groupCards}</div></div><div id="pi-details" hidden>${detailPanels}</div>`;
}

function renderRequestList(requests: string[]): string {
	if (!requests.length) return `<p class="muted">원본 요청 preview가 없습니다.</p>`;
	return `<ol>${requests.slice(0, 20).map((request) => `<li>${escapeHtml(request)}</li>`).join("\n")}</ol>`;
}

function conductorRestoredByPi(entry: ConductorHistoryEntry, units: PiWorkUnitEntry[]): boolean {
	const sourceSet = new Set(entry.sourceSessionPaths.map((item) => {
		try { return fs.realpathSync(item); } catch { return item; }
	}));
	return units.some((unit) => (unit.workspace === entry.workspace && unit.piRestoredSessions.length > 0) || unit.originalConductorSessionPaths.some((item) => {
		try { return sourceSet.has(fs.realpathSync(item)); } catch { return sourceSet.has(item); }
	}));
}

function renderConductorCards(data: ArtifactBrowserData): string {
	if (!data.conductors.length) return `<div class="empty">Conductor DB / 원본 JSONL 이력을 찾지 못했습니다.</div>`;
	const groupCards = data.conductors.map((entry) => {
		const reports = reportsForUnit(entry, data.reports);
		const frames = framesForUnit(entry, data.frames);
		const planningDocs = planningDocsForUnit(entry, data.planningDocs).filter((doc) => doc.source !== "frame-studio");
		const captures = capturesForUnit(entry, data.captures);
		const restored = conductorRestoredByPi(entry, data.piUnits);
		return `<article class="card searchable conductor-history-card" data-search="${escapeAttr(`${entry.label} ${entry.workspace} ${entry.branch} ${entry.status} ${entry.requests.slice(0, 10).join(" ")}`.toLowerCase())}"><div class="kicker">🧭 Conductor master</div><h3>${escapeHtml(entry.label)}</h3><div class="meta"><span class="badge">${escapeHtml(entry.repo)}</span>${restored ? `<span class="badge">Pi로 복구됨</span>` : ""}${entry.branch ? `<span class="badge">${escapeHtml(entry.branch)}</span>` : ""}${entry.status ? `<span class="badge">${escapeHtml(entry.status)}</span>` : ""}</div><div class="meta"><span class="badge">원본 세션 ${entry.sourceSessionPaths.length}</span><span class="badge">리포트 ${reports.length}</span><span class="badge">기획 ${planningDocs.length}</span><span class="badge">캡처 ${captures.length}</span></div><div class="path">workspace: ${escapeHtml(entry.workspace)}</div><div class="actions"><button class="button open-conductor-detail" type="button" data-conductor="${escapeAttr(entry.key)}">이력 열기</button></div></article>`;
	}).join("\n");
	const detailPanels = data.conductors.map((entry) => {
		const reports = reportsForUnit(entry, data.reports);
		const planningDocs = planningDocsForUnit(entry, data.planningDocs).filter((doc) => doc.source !== "frame-studio");
		const captures = capturesForUnit(entry, data.captures);
		const restored = conductorRestoredByPi(entry, data.piUnits);
		return `<section class="conductor-detail-panel" data-conductor-panel="${escapeAttr(entry.key)}" hidden><div class="actions"><button class="button" type="button" onclick="showConductorGroups()">← 컨덕터 이력 목록</button></div><header class="card"><div class="kicker">컨덕터 이력</div><h2>${escapeHtml(entry.label)}</h2><div class="meta"><span class="badge">Conductor master</span>${restored ? `<span class="badge">Pi로 복구됨</span>` : ""}<span class="badge">${escapeHtml(entry.repo)}</span>${entry.ticket ? `<span class="badge">${escapeHtml(entry.ticket)}</span>` : ""}${entry.createdAt ? `<span class="badge">생성 ${escapeHtml(entry.createdAt)}</span>` : ""}${entry.sessionId ? `<span class="badge">session ${escapeHtml(entry.sessionId.slice(0, 8))}</span>` : ""}</div><div class="path">${escapeHtml(entry.branch)}</div></header><section class="card"><h3>이전 요청</h3>${renderRequestList(entry.requests)}</section>${renderConductorSourceCards("원본 Conductor 세션", entry.sourceSessionPaths, restored)}<section><h3>검증 리포트 · ${reports.length}</h3>${renderReportCards(reports)}</section><section><h3>기획 / Frame · ${planningDocs.length}</h3>${renderPlanningDocCards(planningDocs)}</section><section><h3>캡처 / 미디어 · ${captures.length}</h3>${captures.length ? renderCaptureFileCards(captures) : `<div class="empty">연결된 캡처 미디어가 없습니다.</div>`}</section></section>`;
	}).join("\n");
	return `<div id="conductor-groups"><div class="grid">${groupCards}</div></div><div id="conductor-details" hidden>${detailPanels}</div>`;
}

function unassignedWebSearches(data: ArtifactBrowserData): WebSearchEntry[] {
	return data.webSearches.filter((entry) => !data.piUnits.some((unit) => webSearchesForUnit(unit, [entry]).length > 0) && !data.conductors.some((unit) => webSearchesForUnit(unit, [entry]).length > 0));
}

function renderWebSearchPanel(data: ArtifactBrowserData): string {
	const unassigned = unassignedWebSearches(data);
	return `<section><h2>웹 검색 기본 그룹</h2>${renderWebSearchCards(unassigned)}</section><section><h2>전체 웹 검색</h2>${renderWebSearchCards(data.webSearches)}</section>`;
}

function buildArtifactBrowserHtml(data: ArtifactBrowserData, cwd: string): string {
	const initialTab = data.piUnits.length ? "pi" : data.conductors.length ? "conductors" : "web-search";
	return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>pilee Artifact Browser</title>${artifactBrowserStyle()}</head><body><main class="shell"><header class="hero"><div class="kicker">🗂️ pilee Artifact Browser</div><h1>산출물 다시 보기</h1><p>Pi 작업 이력, Conductor master 이력, 웹 검색 review를 상위 단위로 분리해서 봅니다.</p><div class="meta"><span class="badge">cwd ${escapeHtml(cwd)}</span><span class="badge">generated ${escapeHtml(data.generatedAt.toLocaleString())}</span></div></header><input id="search" class="search" type="search" placeholder="현재 탭에서 검색: 이름, 티켓, workspace, session, source" oninput="filterCards()"><nav class="tabs"><button class="tab" data-tab="pi" onclick="showTab('pi')">Pi 이력 <strong>${data.piUnits.length}</strong></button><button class="tab" data-tab="conductors" onclick="showTab('conductors')">컨덕터 이력 <strong>${data.conductors.length}</strong></button><button class="tab" data-tab="web-search" onclick="showTab('web-search')">웹 검색 <strong>${data.webSearches.length}</strong></button><button class="tab" data-tab="reports" onclick="showTab('reports')">검증 리포트 <strong>${data.reports.length}</strong></button><button class="tab" data-tab="planning" onclick="showTab('planning')">기획 / Frame <strong>${data.planningDocs.length}</strong></button><button class="tab" data-tab="captures" onclick="showTab('captures')">캡처 / 미디어 <strong>${data.captures.length}</strong></button></nav><section id="tab-pi" class="panel">${renderPiWorkUnitCards(data)}</section><section id="tab-conductors" class="panel">${renderConductorCards(data)}</section><section id="tab-web-search" class="panel">${renderWebSearchPanel(data)}</section><section id="tab-reports" class="panel">${renderReportCards(data.reports)}</section><section id="tab-planning" class="panel">${renderPlanningDocCards(data.planningDocs)}</section><section id="tab-captures" class="panel">${renderCaptureCards(data.captures, data.frames)}</section></main><script>
(function(){
	function qs(selector, root=document){ return root.querySelector(selector); }
	function qsa(selector, root=document){ return Array.from(root.querySelectorAll(selector)); }
	window.showTab = function(tab){
		qsa('.tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
		qsa('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'tab-' + tab));
		const search = qs('#search'); if (search) search.value = '';
		filterCards();
	};
	window.filterCards = function(){
		const query = (qs('#search')?.value || '').toLowerCase().trim();
		qsa('.panel.active .searchable').forEach((card) => { card.style.display = !query || (card.dataset.search || '').includes(query) ? '' : 'none'; });
	};
	window.showCaptureGroups = function(){
		const groups = qs('#capture-groups'); const files = qs('#capture-files');
		if (groups) groups.hidden = false; if (files) files.hidden = true;
		qsa('.capture-group-panel').forEach((panel) => panel.hidden = true);
	};
	window.showCaptureGroup = function(key){
		const groups = qs('#capture-groups'); const files = qs('#capture-files');
		if (groups) groups.hidden = true; if (files) files.hidden = false;
		qsa('.capture-group-panel').forEach((panel) => panel.hidden = panel.dataset.groupPanel !== key);
	};
	window.showPiGroups = function(){
		const groups = qs('#pi-groups'); const details = qs('#pi-details');
		if (groups) groups.hidden = false; if (details) details.hidden = true;
		qsa('.pi-detail-panel').forEach((panel) => panel.hidden = true);
	};
	window.showPiDetail = function(key){
		const groups = qs('#pi-groups'); const details = qs('#pi-details');
		if (groups) groups.hidden = true; if (details) details.hidden = false;
		qsa('.pi-detail-panel').forEach((panel) => panel.hidden = panel.dataset.piPanel !== key);
	};
	window.showConductorGroups = function(){
		const groups = qs('#conductor-groups'); const details = qs('#conductor-details');
		if (groups) groups.hidden = false; if (details) details.hidden = true;
		qsa('.conductor-detail-panel').forEach((panel) => panel.hidden = true);
	};
	window.showConductorDetail = function(key){
		const groups = qs('#conductor-groups'); const details = qs('#conductor-details');
		if (groups) groups.hidden = true; if (details) details.hidden = false;
		qsa('.conductor-detail-panel').forEach((panel) => panel.hidden = panel.dataset.conductorPanel !== key);
	};
	async function requestOpen(button){
		const path = button.dataset.path;
		const target = button.dataset.target || 'glimpse';
		if (!path) return;
		const previous = button.textContent;
		button.disabled = true;
		button.textContent = target === 'browser' ? '브라우저 여는 중...' : 'Glimpse 여는 중...';
		try {
			const response = await fetch('/open?target=' + encodeURIComponent(target) + '&path=' + encodeURIComponent(path), { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok || !payload.ok) throw new Error(payload.error || 'open failed');
			if (payload.previewUrl && target !== 'browser') { window.location.href = payload.previewUrl; return; }
			button.textContent = target === 'browser' ? '브라우저 열기 요청됨' : '열기 요청됨';
			setTimeout(() => { button.textContent = previous; button.disabled = false; }, 1200);
		} catch (error) {
			button.textContent = '열기 실패';
			button.title = String(error && error.message || error);
			setTimeout(() => { button.textContent = previous; button.disabled = false; }, 2200);
		}
	}
	document.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const opener = target.closest('.open-artifact');
		if (opener) { requestOpen(opener); return; }
		const capture = target.closest('.open-capture-group');
		if (capture) { showCaptureGroup(capture.dataset.group || ''); return; }
		const pi = target.closest('.open-pi-detail');
		if (pi) { showPiDetail(pi.dataset.pi || ''); return; }
		const conductor = target.closest('.open-conductor-detail');
		if (conductor) { showConductorDetail(conductor.dataset.conductor || ''); return; }
	});
	showTab('${initialTab}');
})();
</script></body></html>`;
}

async function archiveVerifyReport(event: ToolResultEvent, ctx: ExtensionContext, pi: ExtensionAPI) {
	const filePath = typeof event.input?.path === "string" ? event.input.path : undefined;
	if (!filePath || !filePath.endsWith(".html")) return;

	try {
		const resolved = fs.realpathSync(filePath);
		const content = fs.readFileSync(resolved, "utf-8");
		if (!content.includes(REPORT_SIGNATURE)) return;

		const cwd = ctx.cwd ?? process.cwd();
		const workspaceName = path.basename(cwd);
		const ticket = extractTicket(content);
		const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

		const reportDir = path.join(ARCHIVE_DIR, "..", "reports");
		fs.mkdirSync(reportDir, { recursive: true });

		const filename = `${ts}_${workspaceName}${ticket ? `_${ticket}` : ""}.html`;
		fs.copyFileSync(resolved, path.join(reportDir, filename));

		if (ctx.hasUI) {
			let mode: "glimpse" | "browser" | "none" = "none";
			try {
				mode = await openHtmlArtifact(pi, resolved);
			} catch {}
			ctx.ui.notify(
				`📊 Verify Report 아카이브${mode !== "none" ? ` + ${mode === "glimpse" ? "Glimpse" : "브라우저"} 프리뷰` : ""} → reports/${filename}`,
				"info",
			);
		}
	} catch {}
}

function textContentFromToolResult(event: ToolResultEvent): string {
	return event.content
		.map((item) => (item?.type === "text" && typeof item.text === "string" ? item.text : ""))
		.filter(Boolean)
		.join("\n\n")
		.trim();
}

function stringArrayFromInput(input: unknown): string[] {
	if (!input || typeof input !== "object") return [];
	const obj = input as Record<string, unknown>;
	if (Array.isArray(obj.queries)) return obj.queries.filter((q): q is string => typeof q === "string" && q.trim().length > 0);
	return typeof obj.query === "string" && obj.query.trim().length > 0 ? [obj.query] : [];
}

function valueFromRecord(record: unknown, key: string): unknown {
	return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
}

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/https?:\/\//g, "")
		.replace(/[^a-z0-9가-힣_-]+/gi, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 60) || "web-search";
}

function renderInlineMarkdown(value: string): string {
	return escapeHtml(value)
		.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_m, label, url) => `<a href="${escapeAttr(url)}" target="_blank" rel="noreferrer">${label}</a>`)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function renderMarkdownLite(markdown: string): string {
	const lines = markdown.split(/\r?\n/);
	const out: string[] = [];
	let inList = false;
	let inCode = false;
	let codeLines: string[] = [];
	const closeList = () => {
		if (inList) {
			out.push("</ul>");
			inList = false;
		}
	};
	const closeCode = () => {
		if (inCode) {
			out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
			codeLines = [];
			inCode = false;
		}
	};

	for (const line of lines) {
		if (line.trim().startsWith("```")) {
			if (inCode) closeCode();
			else {
				closeList();
				inCode = true;
				codeLines = [];
			}
			continue;
		}
		if (inCode) {
			codeLines.push(line);
			continue;
		}
		if (!line.trim()) {
			closeList();
			continue;
		}
		const heading = line.match(/^(#{1,4})\s+(.+)$/);
		if (heading) {
			closeList();
			const level = Math.min(heading[1].length + 1, 5);
			out.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
			continue;
		}
		const bullet = line.match(/^\s*[-*]\s+(.+)$/);
		if (bullet) {
			if (!inList) {
				out.push("<ul>");
				inList = true;
			}
			out.push(`<li>${renderInlineMarkdown(bullet[1])}</li>`);
			continue;
		}
		closeList();
		out.push(`<p>${renderInlineMarkdown(line)}</p>`);
	}
	closeCode();
	closeList();
	return out.join("\n");
}

function buildWebSearchReviewHtml(args: {
	queries: string[];
	content: string;
	responseId: string;
	workflow: string;
	selectedCount: string;
	createdAt: Date;
}): string {
	const queryTitle = args.queries.length > 0 ? args.queries.join(" · ") : "web_search";
	return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${WEB_SEARCH_SIGNATURE} — ${escapeHtml(queryTitle)}</title>
<style>
	:root { color-scheme: light dark; --bg: #111827; --panel: #1f2937; --text: #f9fafb; --muted: #9ca3af; --line: #374151; --accent: #60a5fa; }
	body { margin: 0; padding: 28px; background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
	main { max-width: 960px; margin: 0 auto; }
	header { border-bottom: 1px solid var(--line); margin-bottom: 24px; padding-bottom: 18px; }
	h1 { margin: 0 0 8px; font-size: 28px; }
	.meta { display: flex; flex-wrap: wrap; gap: 8px; color: var(--muted); font-size: 13px; }
	.badge { border: 1px solid var(--line); border-radius: 999px; padding: 4px 9px; background: rgba(255,255,255,.04); }
	section { background: var(--panel); border: 1px solid var(--line); border-radius: 14px; padding: 20px; margin-bottom: 18px; }
	h2, h3, h4, h5 { margin-top: 1.2em; }
	a { color: var(--accent); }
	code { background: rgba(255,255,255,.08); border-radius: 5px; padding: 1px 5px; }
	pre { overflow: auto; background: #0b1020; border: 1px solid var(--line); border-radius: 10px; padding: 14px; }
	li { margin: 7px 0; }
</style>
</head>
<body>
<main>
<header>
	<h1>${WEB_SEARCH_SIGNATURE}</h1>
	<div class="meta">
		<span class="badge">${escapeHtml(args.createdAt.toLocaleString())}</span>
		<span class="badge">workflow=${escapeHtml(args.workflow)}</span>
		${args.responseId ? `<span class="badge">responseId=${escapeHtml(args.responseId)}</span>` : ""}
		${args.selectedCount ? `<span class="badge">selected=${escapeHtml(args.selectedCount)}</span>` : ""}
	</div>
</header>
<section>
	<h2>Queries</h2>
	<ul>${args.queries.map((query) => `<li>${escapeHtml(query)}</li>`).join("\n")}</ul>
</section>
<section>
	<h2>Result</h2>
	${renderMarkdownLite(args.content)}
</section>
</main>
</body>
</html>`;
}

function archiveWebSearchResult(event: ToolResultEvent, ctx: ExtensionContext) {
	const workflow = String(valueFromRecord(event.details, "workflow") ?? valueFromRecord(event.input, "workflow") ?? "none");
	if (workflow !== "summary-review") return;

	const content = textContentFromToolResult(event);
	if (!content) return;

	try {
		const queries = stringArrayFromInput(event.input);
		const createdAt = new Date();
		const ts = createdAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const responseId = String(valueFromRecord(event.details, "responseId") ?? "");
		const selectedCount = String(valueFromRecord(event.details, "selectedCount") ?? "");
		const title = queries.length > 0 ? queries.join(" ") : responseId || "web-search";
		const filename = `${ts}_${slugify(title)}.html`;
		const webSearchDir = path.join(ARCHIVE_DIR, "..", "web-search");
		fs.mkdirSync(webSearchDir, { recursive: true });
		fs.writeFileSync(
			path.join(webSearchDir, filename),
			buildWebSearchReviewHtml({ queries, content, responseId, workflow, selectedCount, createdAt }),
			"utf-8",
		);

		if (ctx.hasUI) {
			ctx.ui.notify(`🔎 Web Search Review 아카이브 → web-search/${filename}`, "info");
		}
	} catch {}
}

function extractTicket(html: string): string {
	const m = html.match(/Verify Report\s*[—–-]\s*([A-Z]+-\d+)/i);
	return m ? m[1] : "";
}

function findLatestReport(cwd: string): string | null {
	const capturesDir = path.join(cwd, ".context", "work");
	if (!fs.existsSync(capturesDir)) return null;
	try {
		for (const ws of fs.readdirSync(capturesDir)) {
			const report = path.join(capturesDir, ws, "captures", "report.html");
			if (fs.existsSync(report)) return report;
		}
	} catch {}
	return null;
}

function findLatestInDir(dir: string): string {
	if (!fs.existsSync(dir)) return "";
	try {
		const files = fs.readdirSync(dir)
			.filter((f: string) => f.endsWith(".html"))
			.sort()
			.reverse();
		return files[0] ?? "";
	} catch { return ""; }
}

function archiveWidget(event: ToolResultEvent, ctx: ExtensionContext) {
	const code = event.input?.widget_code;
	const title = event.input?.title;
	if (typeof code !== "string" || !code) return;

	try {
		const isSVG = code.trimStart().startsWith("<svg");
		const html = wrapArchivedWidgetHTML(code, isSVG);

		const safeName = (typeof title === "string" ? title : "widget").replace(/[^a-zA-Z0-9_-]/g, "_");
		const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const filename = `${ts}_${safeName}.html`;

		fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
		fs.writeFileSync(path.join(ARCHIVE_DIR, filename), html, "utf-8");

		if (ctx.hasUI) {
			ctx.ui.notify(`📚 위젯 아카이브 → 분류 전/${filename}`, "info");
		}
	} catch {
		// wrap/write failed — silently skip
	}
}
