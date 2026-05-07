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

function artifactPreviewInnerHtml(filePath: string): { title: string; html: string } {
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
	return { title: path.basename(filePath), html: `<pre>${escapeHtml(fs.readFileSync(filePath, "utf-8"))}</pre>` };
}

function buildArtifactPreviewHtml(filePath: string): string {
	const { title, html } = artifactPreviewInnerHtml(filePath);
	const artifactDataUri = `data:text/html;base64,${Buffer.from(html, "utf8").toString("base64")}`;
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
		description: "검증 리포트·Frame 기획 전문·캡처 미디어를 탭형 Artifact Browser로 열기. Usage: /show-report [--browser] [path]",
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
			const total = artifacts.reports.length + artifacts.frames.length + artifacts.captures.length;
			if (total === 0) {
				ctx.ui.notify("표시할 artifact를 찾을 수 없습니다.", "warning");
				return;
			}

			const mode = await openArtifactBrowser(pi, artifacts, ctx.cwd, parsed.browserOnly);
			ctx.ui.notify(`🗂️ Artifact Browser ${mode === "glimpse" ? "Glimpse" : "브라우저"} 열기 · reports ${artifacts.reports.length} · frame ${artifacts.frames.length} · captures ${artifacts.captures.length}`, "info");
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
	source: "workspace" | "archive" | "web-search";
	mtime: number;
}

function formatMtime(ms: number): string {
	const d = new Date(ms);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function collectReports(cwd: string): ReportEntry[] {
	const results: ReportEntry[] = [];

	// 1. 워크스페이스 captures 내 리포트
	const contextDir = path.join(cwd, ".context", "work");
	if (fs.existsSync(contextDir)) {
		try {
			for (const ws of fs.readdirSync(contextDir)) {
				const capturesDir = path.join(contextDir, ws, "captures");
				if (!fs.existsSync(capturesDir)) continue;
				for (const f of fs.readdirSync(capturesDir)) {
					if (!f.endsWith(".html")) continue;
					const fp = path.join(capturesDir, f);
					const stat = fs.statSync(fp);
					const ticket = extractTicket(fs.readFileSync(fp, "utf-8"));
					results.push({ path: fp, name: `${ws}/${f}`, time: formatMtime(stat.mtimeMs), ticket, source: "workspace", mtime: stat.mtimeMs });
				}
			}
		} catch {}
	}

	// 2. 아카이브 reports 디렉토리
	const reportDir = path.join(ARCHIVE_DIR, "..", "reports");
	if (fs.existsSync(reportDir)) {
		try {
			for (const f of fs.readdirSync(reportDir)) {
				if (!f.endsWith(".html")) continue;
				const fp = path.join(reportDir, f);
				const stat = fs.statSync(fp);
				const ticket = extractTicket(fs.readFileSync(fp, "utf-8"));
				results.push({ path: fp, name: f, time: formatMtime(stat.mtimeMs), ticket, source: "archive", mtime: stat.mtimeMs });
			}
		} catch {}
	}

	// 3. web_search summary-review 아카이브
	const webSearchDir = path.join(ARCHIVE_DIR, "..", "web-search");
	if (fs.existsSync(webSearchDir)) {
		try {
			for (const f of fs.readdirSync(webSearchDir)) {
				if (!f.endsWith(".html")) continue;
				const fp = path.join(webSearchDir, f);
				const stat = fs.statSync(fp);
				results.push({ path: fp, name: f, time: formatMtime(stat.mtimeMs), ticket: "", source: "web-search", mtime: stat.mtimeMs });
			}
		} catch {}
	}

	return results.sort((a, b) => b.mtime - a.mtime);
}

interface FrameTranscriptEntry {
	path: string;
	title: string;
	identity: string;
	mode: string;
	time: string;
	mtime: number;
	updatedAt: number;
	timeline: unknown[];
}

interface CaptureEntry {
	path: string;
	name: string;
	source: string;
	time: string;
	mtime: number;
	size: number;
	mime: string;
}

interface ArtifactBrowserData {
	reports: ReportEntry[];
	frames: FrameTranscriptEntry[];
	captures: CaptureEntry[];
	generatedAt: Date;
}

function collectArtifactBrowserData(cwd: string): ArtifactBrowserData {
	return {
		reports: collectReports(cwd),
		frames: collectFrameTranscripts(),
		captures: collectCaptureMedia(cwd),
		generatedAt: new Date(),
	};
}

function artifactBrowserAllowedPaths(data: ArtifactBrowserData): Set<string> {
	const allowed = new Set<string>();
	for (const filePath of [
		...data.reports.map((item) => item.path),
		...data.frames.map((item) => item.path),
		...data.captures.map((item) => item.path),
	]) {
		try { allowed.add(fs.realpathSync(filePath)); } catch {}
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
				res.end(buildArtifactPreviewHtml(resolved));
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
				if (target === "glimpse") {
					res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ ok: true, mode: "glimpse", url: `/preview?path=${encodeURIComponent(resolved)}` }));
					return;
				}
				const mode = await openAnyArtifact(pi, resolved, true);
				res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
				res.end(JSON.stringify({ ok: true, mode }));
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
				entries.push({
					path: fp,
					title: String(parsed.title || identity?.displayTitle || file.replace(/\.json$/, "")),
					identity: String(identity?.displayTitle || identity?.key || "Frame Studio"),
					mode: String(identity?.mode || "planning"),
					time: formatMtime(stat.mtimeMs),
					mtime: stat.mtimeMs,
					updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : stat.mtimeMs,
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
		{ dir: path.join(cwd, ".context", "work"), source: "workspace" },
		{ dir: path.join(os.homedir(), ".context", "work"), source: "home" },
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
	if (source === "workspace") return "workspace";
	if (source === "web-search") return "web-search";
	return "archive";
}

function artifactOpenButtons(filePath: string): string {
	const escapedPath = escapeAttr(filePath);
	return `<button class="button open-artifact" type="button" data-target="glimpse" data-path="${escapedPath}">열기</button><button class="button open-artifact" type="button" data-target="browser" data-path="${escapedPath}">브라우저에서 열기</button>`;
}

function renderReportCards(reports: ReportEntry[]): string {
	if (!reports.length) return `<div class="empty">검증 리포트나 web-search review가 없습니다.</div>`;
	return `<div class="grid">${reports.map((r) => `<article class="card searchable" data-search="${escapeAttr(`${r.name} ${r.ticket} ${r.source}`.toLowerCase())}"><h3>${escapeHtml(r.name)}</h3><div class="meta"><span class="badge">${escapeHtml(reportSourceLabel(r.source))}</span><span class="badge">${escapeHtml(r.time)}</span>${r.ticket ? `<span class="badge">${escapeHtml(r.ticket)}</span>` : ""}</div><div class="path">${escapeHtml(r.path)}</div><div class="actions">${artifactOpenButtons(r.path)}</div></article>`).join("\n")}</div>`;
}

function renderFrameCards(frames: FrameTranscriptEntry[]): string {
	if (!frames.length) return `<div class="empty">저장된 Frame Studio 전문이 없습니다.</div>`;
	return `<div class="grid">${frames.map((f) => `<article class="card searchable" data-search="${escapeAttr(`${f.title} ${f.identity} ${f.mode}`.toLowerCase())}"><h3>${escapeHtml(f.title)}</h3><div class="meta"><span class="badge">${escapeHtml(f.mode)}</span><span class="badge">${escapeHtml(f.time)}</span><span class="badge">${f.timeline.length} entries</span></div><div class="path">${escapeHtml(f.identity)}</div><details><summary>Frame 전문 미리보기</summary><div class="timeline">${renderFrameTimeline(f.timeline)}</div></details><div class="actions">${artifactOpenButtons(f.path)}</div></article>`).join("\n")}</div>`;
}

function renderCaptureCards(captures: CaptureEntry[]): string {
	if (!captures.length) return `<div class="empty">캡처 이미지가 없습니다. 현재 cwd와 home의 .context/work/captures를 확인합니다.</div>`;
	return `<div class="grid">${captures.map((c) => { const src = mediaDataUri(c.path); return `<article class="card searchable" data-search="${escapeAttr(`${c.name} ${c.source}`.toLowerCase())}"><div class="thumb">${src ? `<img src="${src}" alt="${escapeAttr(c.name)}" loading="lazy">` : `<span class="muted">${escapeHtml(formatBytes(c.size))}</span>`}</div><h3>${escapeHtml(path.basename(c.path))}</h3><div class="meta"><span class="badge">${escapeHtml(c.source)}</span><span class="badge">${escapeHtml(c.time)}</span><span class="badge">${escapeHtml(formatBytes(c.size))}</span></div><div class="path">${escapeHtml(c.name)}</div><div class="actions">${artifactOpenButtons(c.path)}</div></article>`; }).join("\n")}</div>`;
}

function buildArtifactBrowserHtml(data: ArtifactBrowserData, cwd: string): string {
	const initialTab = data.reports.length ? "reports" : data.frames.length ? "frames" : "captures";
	return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>pilee Artifact Browser</title>${artifactBrowserStyle()}</head><body><main class="shell"><header class="hero"><div class="kicker">🗂️ pilee Artifact Browser</div><h1>산출물 다시 보기</h1><p>검증 리포트, Frame 기획 전문, 캡처 미디어를 탭으로 분리해서 봅니다.</p><div class="meta"><span class="badge">cwd ${escapeHtml(cwd)}</span><span class="badge">generated ${escapeHtml(data.generatedAt.toLocaleString())}</span></div></header><input id="search" class="search" type="search" placeholder="현재 탭에서 검색: 이름, 티켓, identity, source" oninput="filterCards()"><nav class="tabs"><button class="tab" data-tab="reports" onclick="showTab('reports')">검증 리포트 <strong>${data.reports.length}</strong></button><button class="tab" data-tab="frames" onclick="showTab('frames')">기획 / Frame <strong>${data.frames.length}</strong></button><button class="tab" data-tab="captures" onclick="showTab('captures')">캡처 / 미디어 <strong>${data.captures.length}</strong></button></nav><section id="tab-reports" class="panel">${renderReportCards(data.reports)}</section><section id="tab-frames" class="panel">${renderFrameCards(data.frames)}</section><section id="tab-captures" class="panel">${renderCaptureCards(data.captures)}</section></main><script>
	function showTab(name){document.querySelectorAll('.tab').forEach(function(el){el.classList.toggle('active',el.dataset.tab===name)});document.querySelectorAll('.panel').forEach(function(el){el.classList.toggle('active',el.id==='tab-'+name)});window.currentTab=name;filterCards();}
	function filterCards(){var q=(document.getElementById('search').value||'').toLowerCase().trim();var panel=document.getElementById('tab-'+(window.currentTab||'${initialTab}'));if(!panel)return;panel.querySelectorAll('.searchable').forEach(function(card){card.style.display=!q||String(card.dataset.search||'').indexOf(q)>=0?'':'none';});}
	async function openArtifact(button){var path=button.dataset.path||'';var target=button.dataset.target||'glimpse';var label=button.textContent;button.disabled=true;button.textContent=target==='browser'?'브라우저 여는 중...':'Glimpse 여는 중...';try{var res=await fetch('/open?path='+encodeURIComponent(path)+'&target='+encodeURIComponent(target),{method:'POST'});if(!res.ok)throw new Error(await res.text());var payload=await res.json().catch(function(){return {}});if(payload&&payload.url){location.href=payload.url;return;}button.textContent='열기 요청됨';setTimeout(function(){button.textContent=label;button.disabled=false;},1400);}catch(e){button.textContent='열기 실패';button.title=String(e&&e.message||e);setTimeout(function(){button.textContent=label;button.disabled=false;},2200);}}
	document.addEventListener('click',function(ev){var button=ev.target&&ev.target.closest?ev.target.closest('.open-artifact'):null;if(button){ev.preventDefault();openArtifact(button);}});
	showTab('${initialTab}');
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
