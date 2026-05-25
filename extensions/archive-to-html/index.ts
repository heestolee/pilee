import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext, ToolResultEvent } from "@mariozechner/pi-coding-agent";
import { complete, getModel, type Api, type Message, type Model } from "@mariozechner/pi-ai";
import { resumeTftStudioFromTranscript } from "../frame-studio/index.ts";
import { openCompanionHtml } from "../utils/companion-window.ts";
import { expandProfileTemplate, loadArtifactBrowserProfiles, loadConductorProfiles } from "../utils/private-profiles.ts";
import { webviewCopyCss, webviewCopyScript } from "../utils/webview-copy.ts";
import { exportSessionFileToHtml, isPiSessionFile, openFile, SESSION_EXPORT_DIR } from "../utils/session-export.js";
import { registerVerifyReportLive } from "./verify-report-live.js";

const ARCHIVE_DIR = path.join(os.homedir(), "Documents", "agent-history", "분류 전");
const FRAME_TRANSCRIPTS_DIR = path.join(os.homedir(), ".pi", "agent", "frame-studio", "transcripts");
const SHOW_REPORT_SESSION_EXPORT_DIR = path.join(SESSION_EXPORT_DIR, "show-report");
const NORMALIZED_CONDUCTOR_SESSION_DIR = path.join(SHOW_REPORT_SESSION_EXPORT_DIR, "normalized");
const FORK_PANEL_RECENT_PATH = path.join(os.homedir(), ".pi", "agent", "fork-panel", "recent.json");
const SESSION_CLASSIFICATION_DIR = path.join(os.homedir(), ".pi", "agent", "state", "session-classification");
const SESSION_CLASSIFICATION_CATEGORY_OPTIONS = [
	"pilee 개선",
	"제품 업무",
	"TFT / Frame",
	"Decide / 판단",
	"Verify / Report",
	"Knowledge / Ember",
	"Worktree / Session",
	"영상 분석",
	"문서 / 리포트",
	"Debugging",
	"잡담 / 방향성",
	"기타",
];
const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FONT_SIGNATURE = "Noto+Serif+KR";
const REPORT_SIGNATURE = "Verify Report";
const WEB_SEARCH_SIGNATURE = "Web Search Review";
const MCP_RESULT_SIGNATURE = "MCP Result";
const MEDIA_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg"]);
const MAX_INLINE_MEDIA_BYTES = 8 * 1024 * 1024;
const PREFERRED_CLASSIFICATION_MODELS = [
	{ provider: "openai-codex", id: "gpt-5.4" },
	{ provider: "openai-codex", id: "gpt-5.5" },
] as const;

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

const artifactBrowserServers = new Set<Server>();

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

function conductorDbPath(): string {
	for (const profile of loadConductorProfiles()) {
		if (profile.dbPath) return expandProfileTemplate(profile.dbPath);
	}
	return "";
}

function conductorProjectRoots(): string[] {
	const roots = new Set<string>();
	for (const profile of loadConductorProfiles()) {
		if (profile.projectRoot) roots.add(expandProfileTemplate(profile.projectRoot));
		for (const template of profile.projectDirTemplates ?? []) roots.add(path.dirname(expandProfileTemplate(template, { repo: "", workspace: "" })));
	}
	return [...roots];
}

function isConductorSessionJsonlPath(filePath: string): boolean {
	const resolved = path.resolve(filePath);
	return conductorProjectRoots().some((root) => {
		const rel = path.relative(root, resolved);
		return rel && !rel.startsWith("..") && !path.isAbsolute(rel);
	});
}

function conductorProjectDirNameFromPath(filePath: string): string | null {
	const resolved = path.resolve(filePath);
	for (const root of conductorProjectRoots()) {
		const rel = path.relative(root, resolved);
		if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel.split(path.sep)[0] ?? null;
	}
	return null;
}

function isSessionJsonlPath(filePath: string): boolean {
	return filePath.endsWith(".jsonl") && (
		filePath.includes(`${path.sep}.pi${path.sep}agent${path.sep}sessions${path.sep}`) ||
		isConductorSessionJsonlPath(filePath)
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

function looksLikeSessionNoise(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return true;
	return trimmed.startsWith("<system")
		|| trimmed.startsWith("<local-command")
		|| trimmed.startsWith("<command-name>")
		|| trimmed.startsWith("Base directory for this skill:")
		|| trimmed.includes("<!--PI_DYNAMIC_SCOPE_START-->");
}

function isPiSessionJsonl(filePath: string): boolean {
	return isPiSessionFile(filePath);
}

function stableHash(value: string): string {
	return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function sessionClassificationId(filePath: string): string {
	let resolved = filePath;
	try { resolved = fs.realpathSync(filePath); } catch {}
	return stableHash(resolved);
}

function sessionClassificationPath(filePath: string): string {
	return path.join(SESSION_CLASSIFICATION_DIR, `${sessionClassificationId(filePath)}.json`);
}

function safeText(value: unknown, max = 4000): string {
	return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function safeStringList(value: unknown, maxItems = 12): string[] {
	const raw = Array.isArray(value)
		? value
		: typeof value === "string"
			? value.split(/[,#]/)
			: [];
	return [...new Set(raw.map((item) => String(item).trim()).filter(Boolean))].slice(0, maxItems);
}

function sanitizeSegment(raw: unknown): SessionSegmentClassification | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	const title = safeText(obj.title, 120);
	const summary = safeText(obj.summary, 1200);
	const category = safeText(obj.category, 80);
	if (!title && !summary && !category) return null;
	const segment: SessionSegmentClassification = {
		title: title || category || "세션 구간",
		category: category || "미분류",
		tags: safeStringList(obj.tags, 10),
		summary,
	};
	if (Number.isFinite(Number(obj.startIndex))) segment.startIndex = Number(obj.startIndex);
	if (Number.isFinite(Number(obj.endIndex))) segment.endIndex = Number(obj.endIndex);
	if (typeof obj.startTime === "string" && obj.startTime.trim()) segment.startTime = obj.startTime.trim().slice(0, 80);
	if (typeof obj.endTime === "string" && obj.endTime.trim()) segment.endTime = obj.endTime.trim().slice(0, 80);
	if (obj.source === "ai" || obj.source === "user" || obj.source === "fallback") segment.source = obj.source;
	return segment;
}

function sanitizeClassification(raw: unknown, sessionPath: string, previous?: SessionClassification | null): SessionClassification {
	const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
	const now = new Date().toISOString();
	let resolved = sessionPath;
	try { resolved = fs.realpathSync(sessionPath); } catch {}
	const segments = Array.isArray(obj.segments) ? obj.segments.map(sanitizeSegment).filter((item): item is SessionSegmentClassification => Boolean(item)).slice(0, 20) : [];
	return {
		id: sessionClassificationId(sessionPath),
		sessionPath: resolved,
		title: safeText(obj.title, 160) || previous?.title || path.basename(sessionPath),
		category: safeText(obj.category, 80) || previous?.category || "미분류",
		tags: safeStringList(obj.tags, 20),
		summary: safeText(obj.summary, 3000),
		segments,
		source: obj.source === "ai-suggestion" || obj.source === "fallback" || obj.source === "user" ? obj.source : "user",
		createdAt: previous?.createdAt || (typeof obj.createdAt === "string" ? obj.createdAt : now),
		updatedAt: previous ? now : (typeof obj.updatedAt === "string" ? obj.updatedAt : now),
	};
}

function loadSessionClassification(filePath: string): SessionClassification | undefined {
	try {
		const fp = sessionClassificationPath(filePath);
		if (!fs.existsSync(fp)) return undefined;
		return sanitizeClassification(JSON.parse(fs.readFileSync(fp, "utf-8")), filePath, undefined);
	} catch { return undefined; }
}

function saveSessionClassification(filePath: string, raw: unknown): SessionClassification {
	fs.mkdirSync(SESSION_CLASSIFICATION_DIR, { recursive: true });
	const previous = loadSessionClassification(filePath);
	const classification = sanitizeClassification(raw, filePath, previous);
	fs.writeFileSync(sessionClassificationPath(filePath), `${JSON.stringify(classification, null, 2)}\n`, "utf-8");
	return classification;
}

function piEntryId(seed: string, index: number): string {
	return createHash("sha1").update(`${seed}:${index}`).digest("hex").slice(0, 8);
}

function firstTextFromUnknown(value: unknown): string {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.map((item) => {
		if (typeof item === "string") return item;
		if (!item || typeof item !== "object") return "";
		const record = item as Record<string, unknown>;
		if (typeof record.text === "string") return record.text;
		if (typeof record.content === "string") return record.content;
		return "";
	}).filter(Boolean).join("\n\n");
	return "";
}

function conductorCwdFromPath(filePath: string): string {
	const dirName = conductorProjectDirNameFromPath(filePath);
	if (!dirName) return os.homedir();
	for (const profile of loadArtifactBrowserProfiles()) {
		for (const mapping of profile.conductorCwdMappings ?? []) {
			try {
				const match = dirName.match(new RegExp(mapping.dirRegex));
				if (!match) continue;
				const vars = Object.fromEntries(match.map((value, index) => [String(index), value]));
				return expandProfileTemplate(mapping.cwdTemplate, vars);
			} catch {}
		}
	}
	return os.homedir();
}

interface NormalizeState {
	seed: string;
	counter: number;
	parentId: string;
	entries: Record<string, unknown>[];
	toolNames: Map<string, string>;
	userTexts: Set<string>;
}

function appendPiMessage(state: NormalizeState, role: string, content: unknown, timestamp: string, extra: Record<string, unknown> = {}) {
	const id = piEntryId(state.seed, state.counter++);
	state.entries.push({
		type: "message",
		id,
		parentId: state.parentId,
		timestamp,
		message: {
			role,
			content,
			timestamp: Date.parse(timestamp) || undefined,
			...extra,
		},
	});
	state.parentId = id;
}

function appendPiUserText(state: NormalizeState, text: string, timestamp: string, dedupe = false) {
	const normalized = text.trim();
	if (looksLikeSessionNoise(normalized)) return;
	if (dedupe && state.userTexts.has(normalized)) return;
	state.userTexts.add(normalized);
	appendPiMessage(state, "user", [{ type: "text", text: normalized }], timestamp);
}

function normalizeToolResultContent(content: unknown): Array<Record<string, unknown>> {
	const text = firstTextFromUnknown(content).trim();
	if (text) return [{ type: "text", text }];
	return [{ type: "text", text: typeof content === "undefined" ? "" : JSON.stringify(content, null, 2) }];
}

function appendConductorUserRecord(state: NormalizeState, record: Record<string, unknown>, timestamp: string) {
	const message = record.message && typeof record.message === "object" ? record.message as Record<string, unknown> : { content: record.content };
	const content = message.content;
	if (Array.isArray(content)) {
		const textParts: string[] = [];
		for (const block of content) {
			if (!block || typeof block !== "object") continue;
			const item = block as Record<string, unknown>;
			if (item.type === "text" && typeof item.text === "string") textParts.push(item.text);
			if (item.type === "tool_result") {
				const toolCallId = String(item.tool_use_id || "");
				appendPiMessage(state, "toolResult", normalizeToolResultContent(item.content), timestamp, {
					toolCallId,
					toolName: state.toolNames.get(toolCallId) || "",
					isError: Boolean(item.is_error),
				});
			}
		}
		const text = textParts.join("\n\n").trim();
		if (text) appendPiUserText(state, text, timestamp);
		return;
	}
	appendPiUserText(state, firstTextFromUnknown(content), timestamp);
}

function appendConductorAssistantRecord(state: NormalizeState, record: Record<string, unknown>, timestamp: string) {
	const message = record.message && typeof record.message === "object" ? record.message as Record<string, unknown> : { content: record.content };
	const rawContent = message.content;
	if (!Array.isArray(rawContent)) {
		const text = firstTextFromUnknown(rawContent).trim();
		if (text && !looksLikeSessionNoise(text)) appendPiMessage(state, "assistant", [{ type: "text", text }], timestamp, { model: message.model });
		return;
	}
	const content: Array<Record<string, unknown>> = [];
	for (const block of rawContent) {
		if (!block || typeof block !== "object") continue;
		const item = block as Record<string, unknown>;
		if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
			content.push({ type: "text", text: item.text });
		} else if (item.type === "thinking" && typeof item.thinking === "string" && item.thinking.trim()) {
			content.push({ type: "thinking", thinking: item.thinking });
		} else if (item.type === "tool_use") {
			const id = String(item.id || piEntryId(state.seed, state.counter));
			const name = String(item.name || "tool");
			state.toolNames.set(id, name);
			content.push({ type: "toolCall", id, name, arguments: item.input ?? {} });
		}
	}
	if (content.length) appendPiMessage(state, "assistant", content, timestamp, { model: message.model, stopReason: message.stop_reason });
}

function normalizeConductorJsonlForExport(filePath: string): string {
	const stat = fs.statSync(filePath);
	const seed = stableHash(`${filePath}:${stat.mtimeMs}:${stat.size}`);
	fs.mkdirSync(NORMALIZED_CONDUCTOR_SESSION_DIR, { recursive: true });
	const normalizedPath = path.join(NORMALIZED_CONDUCTOR_SESSION_DIR, `conductor-${path.basename(filePath, ".jsonl")}-${seed}.jsonl`);
	if (fs.existsSync(normalizedPath)) return normalizedPath;
	const header = {
		type: "session",
		version: 3,
		id: `conductor-${seed}`,
		timestamp: new Date(Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0 ? stat.birthtimeMs : stat.mtimeMs).toISOString(),
		cwd: conductorCwdFromPath(filePath),
		parentSession: filePath,
	};
	const state: NormalizeState = {
		seed,
		counter: 1,
		parentId: header.id,
		entries: [],
		toolNames: new Map<string, string>(),
		userTexts: new Set<string>(),
	};
	for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
		if (!line.trim()) continue;
		let record: Record<string, unknown>;
		try { record = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
		const timestamp = typeof record.timestamp === "string" ? record.timestamp : header.timestamp;
		if (record.type === "last-prompt" && typeof record.lastPrompt === "string") {
			appendPiUserText(state, record.lastPrompt, timestamp, true);
			continue;
		}
		const message = record.message && typeof record.message === "object" ? record.message as Record<string, unknown> : undefined;
		const role = String(message?.role || record.type || "");
		if (role === "user") appendConductorUserRecord(state, record, timestamp);
		else if (role === "assistant") appendConductorAssistantRecord(state, record, timestamp);
	}
	const lines = [header, ...state.entries].map((entry) => JSON.stringify(entry)).join("\n");
	fs.writeFileSync(normalizedPath, `${lines}\n`, "utf-8");
	return normalizedPath;
}

function sessionExportInputPath(filePath: string): string {
	return isPiSessionJsonl(filePath) ? filePath : normalizeConductorJsonlForExport(filePath);
}

async function exportSessionArtifactToHtml(pi: ExtensionAPI, filePath: string): Promise<string> {
	const exportInput = sessionExportInputPath(filePath);
	const prefix = isPiSessionJsonl(filePath) ? "pi-session" : "conductor-session";
	return exportSessionFileToHtml(pi, exportInput, { outputDir: SHOW_REPORT_SESSION_EXPORT_DIR, filenamePrefix: prefix });
}

function conversationFromSessionRecord(raw: unknown): ChatPreviewEntry | null {
	if (!raw || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;
	const timestamp = typeof record.timestamp === "string" ? record.timestamp : "";
	if (record.type === "last-prompt" && typeof record.lastPrompt === "string") {
		const text = record.lastPrompt.trim();
		if (looksLikeSessionNoise(text)) return null;
		return { role: "user", text, timestamp };
	}
	let message: Record<string, unknown> = {};
	if (record.type === "message") {
		message = record.message && typeof record.message === "object" ? record.message as Record<string, unknown> : {};
	} else if (record.type === "user" || record.type === "assistant") {
		message = record.message && typeof record.message === "object" ? record.message as Record<string, unknown> : { role: record.type, content: record.content };
	} else {
		return null;
	}
	const role = String(message.role || record.type || "message");
	if (role !== "user" && role !== "assistant") return null;
	const text = textBlocksOnly(message.content);
	if (looksLikeSessionNoise(text)) return null;
	return { role, text, timestamp };
}

function renderChatPreviewEntry(entry: ChatPreviewEntry): string {
	const speaker = entry.role === "user" ? "나" : "pilee";
	return `<article class="chat-row ${escapeAttr(entry.role)}"><div class="chat-meta"><span>${escapeHtml(speaker)}</span>${entry.timestamp ? `<time>${escapeHtml(entry.timestamp)}</time>` : ""}</div><div class="chat-bubble">${escapeHtml(truncatePreviewText(entry.text, 8000))}</div></article>`;
}

function sessionPreviewEntry(raw: unknown): string {
	const entry = conversationFromSessionRecord(raw);
	return entry ? renderChatPreviewEntry(entry) : "";
}

function buildJsonlSessionPreviewHtml(filePath: string, full = false): string {
	const preview = readTextPreview(filePath, full ? 8 * 1024 * 1024 : 1024 * 1024);
	const lines = preview.text.split(/\r?\n/);
	if (preview.truncated && !preview.text.endsWith("\n")) lines.pop();
	const entries: string[] = [];
	const seenEntries = new Set<string>();
	let parsed = 0;
	const maxEntries = full ? 1000 : 160;
	for (const line of lines) {
		if (!line.trim()) continue;
		try {
			const entry = conversationFromSessionRecord(JSON.parse(line));
			parsed++;
			if (entry) {
				const dedupeKey = `${entry.role}\n${entry.text}`;
				if (!seenEntries.has(dedupeKey)) {
					seenEntries.add(dedupeKey);
					entries.push(renderChatPreviewEntry(entry));
				}
			}
		} catch {}
		if (entries.length >= maxEntries) break;
	}
	const notice = preview.truncated
		? `<p class="session-notice">세션 JSONL 앞부분 ${escapeHtml(formatBytes(preview.text.length))}만 대화로 미리보기합니다. 더 크게 보려면 브라우저에서 여세요. 전체 크기: ${escapeHtml(formatBytes(preview.size))}</p>`
		: "";
	return `<style>body{margin:0;padding:18px;background:#fafaf9;color:#292524;font:15px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.session-preview{max-width:980px;margin:0 auto}.session-notice{border:1px solid #f59e0b;background:#fffbeb;color:#92400e;border-radius:12px;padding:10px 12px}.chat-row{display:flex;flex-direction:column;margin:14px 0}.chat-row.user{align-items:flex-end}.chat-row.assistant{align-items:flex-start}.chat-meta{display:flex;gap:8px;align-items:center;color:#78716c;font-size:12px;margin:0 8px 4px}.chat-meta span{font-weight:800;color:#57534e}.chat-bubble{max-width:min(780px,92%);white-space:pre-wrap;word-break:break-word;border:1px solid #e7e5e4;border-radius:18px;padding:12px 14px;background:#fff;box-shadow:0 8px 24px rgba(41,37,36,.05)}.user .chat-bubble{background:#eff6ff;border-color:#bfdbfe}.assistant .chat-bubble{background:#fff}</style><main class="session-preview"><h1>${escapeHtml(path.basename(filePath))}</h1><p class="session-notice">원본 JSONL에서 실제 대화만 추려 보여줍니다. system/model/session/tool/thinking/encrypted payload는 숨기고, 사용자 메시지와 assistant의 실제 답변 text만 표시합니다.</p>${notice}${entries.length ? entries.join("\n") : `<p class="session-notice">표시할 user/assistant text 대화를 찾지 못했습니다.</p>`}<p class="session-notice">parsed lines: ${parsed}, rendered conversation entries: ${entries.length}</p></main>`;
}

function readSessionConversationEntries(filePath: string, maxBytes = 3 * 1024 * 1024): SessionConversationEntry[] {
	let inputPath = filePath;
	try { inputPath = sessionExportInputPath(filePath); } catch {}
	const entries: SessionConversationEntry[] = [];
	try {
		const preview = readTextPreview(inputPath, maxBytes);
		const lines = preview.text.split(/\r?\n/);
		if (preview.truncated && !preview.text.endsWith("\n")) lines.pop();
		let index = 0;
		const seen = new Set<string>();
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const entry = conversationFromSessionRecord(JSON.parse(line));
				if (!entry) continue;
				const key = `${entry.role}\n${entry.text}`;
				if (seen.has(key)) continue;
				seen.add(key);
				entries.push({ ...entry, index: ++index });
				if (entries.length >= 240) break;
			} catch {}
		}
	} catch {}
	return entries;
}

function detectClassificationCategory(title: string, entries: SessionConversationEntry[]): { category: string; tags: string[] } {
	const haystack = `${title}\n${entries.map((entry) => entry.text).join("\n")}`.toLowerCase();
	const tags = new Set<string>();
	let category = "기타";
	if (/youtube|youtu\.be|유튜브|영상|video/.test(haystack)) { category = "영상 분석"; tags.add("youtube"); }
	if (/pilee|show-report|show report|archive|artifact browser/.test(haystack)) { category = "pilee 개선"; tags.add("pilee"); }
	if (/tft|frame studio|tft studio|\bframe\b/.test(haystack)) { category = "TFT / Frame"; tags.add("tft-studio"); }
	if (/decide|판단|tradeoff|challenge/.test(haystack)) { category = "Decide / 판단"; tags.add("decision"); }
	if (/verify-report|검증 리포트|evidence|capture|coverage|\bverify\b/.test(haystack)) { category = "Verify / Report"; tags.add("verification"); }
	if (/ember|knowledge|지식/.test(haystack)) { category = "Knowledge / Ember"; tags.add("knowledge"); }
	if (/worktree|session|revive|archive/.test(haystack)) { category = "Worktree / Session"; tags.add("session"); }
	if (/문서|docs?|report|리포트/.test(haystack)) { category = "문서 / 리포트"; tags.add("docs"); }
	if (/잡담|생각|느낌|방향성/.test(haystack)) { category = "잡담 / 방향성"; tags.add("thinking"); }
	if (/debug|error|stack trace|오류|버그|실패/.test(haystack)) { category = "Debugging"; tags.add("debugging"); }
	if (/jira|pr\b|hotfix|업무|product|lambda/.test(haystack)) { category = "제품 업무"; tags.add("work"); }
	return { category, tags: [...tags].slice(0, 8) };
}

function deterministicSessionClassification(filePath: string, reason = "deterministic-fallback"): SessionClassification {
	const entries = readSessionConversationEntries(filePath);
	const existing = loadSessionClassification(filePath);
	const title = existing?.title || path.basename(filePath);
	const detected = detectClassificationCategory(title, entries);
	const first = entries[0];
	const last = entries[entries.length - 1];
	const userText = entries.filter((entry) => entry.role === "user").map((entry) => entry.text.replace(/\s+/g, " ")).join(" / ");
	const summary = userText ? truncatePreviewText(userText, 420) : "대화 내용을 충분히 읽지 못해 단일 구간으로 분류했습니다.";
	return sanitizeClassification({
		title,
		category: detected.category,
		tags: [...detected.tags, reason].filter(Boolean),
		summary,
		source: "fallback",
		segments: [{
			title: detected.category,
			category: detected.category,
			tags: detected.tags,
			summary,
			startIndex: first?.index,
			endIndex: last?.index,
			startTime: first?.timestamp,
			endTime: last?.timestamp,
			source: "fallback",
		}],
	}, filePath, existing);
}

function buildClassificationPrompt(filePath: string, entries: SessionConversationEntry[]): string {
	const excerpts: string[] = [];
	let budget = 22000;
	for (const entry of entries) {
		const text = entry.text.replace(/\s+/g, " ").slice(0, 900);
		const line = `[#${entry.index} ${entry.role}${entry.timestamp ? ` ${entry.timestamp}` : ""}] ${text}`;
		if (budget - line.length < 0) break;
		budget -= line.length;
		excerpts.push(line);
	}
	return [
		"You classify Pi coding-agent conversation sessions for a Korean-speaking user.",
		"Return ONLY valid JSON. No markdown fence, no commentary.",
		"Do not copy private paths, secrets, raw company/customer context, or long verbatim excerpts into summaries.",
		`Use one primary category. Prefer one of: ${SESSION_CLASSIFICATION_CATEGORY_OPTIONS.join(", ")}. Use a short custom Korean category only when none fits.`,
		"Split the conversation into 1-8 meaningful segments when topic shifts are visible. A segment is a work-unit/topic range, not every message.",
		"Schema:",
		'{"title":"short session title","category":"primary category","tags":["tag"],"summary":"2-4 Korean sentences","segments":[{"title":"segment title","category":"category","tags":["tag"],"summary":"1-3 Korean sentences","startIndex":1,"endIndex":12,"startTime":"optional","endTime":"optional"}]}',
		"",
		`Session file basename: ${path.basename(filePath)}`,
		"Conversation excerpts:",
		...excerpts,
	].join("\n");
}

function extractJsonObject(text: string): unknown {
	const trimmed = text.trim().replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
	try { return JSON.parse(trimmed); } catch {}
	const start = trimmed.indexOf("{");
	const end = trimmed.lastIndexOf("}");
	if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
	throw new Error("Model did not return JSON object");
}

async function resolveClassificationModel(ctx: Pick<ExtensionContext, "model" | "modelRegistry">): Promise<{ model: Model<Api>; apiKey: string }> {
	const lookupModel = getModel as (provider: string, modelId: string) => Model<Api> | undefined;
	for (const { provider, id } of PREFERRED_CLASSIFICATION_MODELS) {
		const model = lookupModel(provider, id);
		if (!model) continue;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (auth.ok && auth.apiKey) return { model, apiKey: auth.apiKey };
	}
	if (ctx.model) {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
		if (auth.ok && auth.apiKey) return { model: ctx.model as Model<Api>, apiKey: auth.apiKey };
	}
	throw new Error("No model API key available for session classification");
}

function getTextFromModelContent(part: unknown): string {
	if (!part || typeof part !== "object") return "";
	const record = part as Record<string, unknown>;
	return typeof record.text === "string" ? record.text : typeof record.refusal === "string" ? record.refusal : "";
}

async function suggestSessionClassification(filePath: string, ctx?: Pick<ExtensionContext, "model" | "modelRegistry">): Promise<{ classification: SessionClassification; model: string | null; fallbackUsed: boolean; fallbackReason?: string }> {
	const entries = readSessionConversationEntries(filePath);
	if (!entries.length) return { classification: deterministicSessionClassification(filePath, "no-conversation-entries"), model: null, fallbackUsed: true, fallbackReason: "no-conversation-entries" };
	if (!ctx?.modelRegistry) return { classification: deterministicSessionClassification(filePath, "no-model-context"), model: null, fallbackUsed: true, fallbackReason: "no-model-context" };
	try {
		const { model, apiKey } = await resolveClassificationModel(ctx);
		const message: Message = { role: "user", content: [{ type: "text", text: buildClassificationPrompt(filePath, entries) }], timestamp: Date.now() };
		const response = await complete(model, { messages: [message] }, { apiKey });
		const rawText = (Array.isArray(response.content) ? response.content : []).map(getTextFromModelContent).filter(Boolean).join("\n").trim();
		const parsed = extractJsonObject(rawText);
		const classification = sanitizeClassification({ ...(parsed as Record<string, unknown>), source: "ai-suggestion" }, filePath, loadSessionClassification(filePath));
		classification.segments = classification.segments.map((segment) => ({ ...segment, source: segment.source || "ai" }));
		return { classification, model: `${model.provider}/${model.id}`, fallbackUsed: false };
	} catch (error) {
		const fallbackReason = error instanceof Error ? error.message : String(error);
		return { classification: deterministicSessionClassification(filePath, "ai-fallback"), model: null, fallbackUsed: true, fallbackReason };
	}
}

function artifactPreviewInnerHtml(filePath: string, options: { full?: boolean; intent?: EvidenceIntent } = {}): { title: string; html: string } {
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
		return { title: path.basename(filePath), html: buildMediaPreviewHtml(filePath, path.basename(filePath), options.intent) };
	}
	if (isSessionJsonlPath(filePath)) {
		return { title: path.basename(filePath), html: buildJsonlSessionPreviewHtml(filePath, Boolean(options.full)) };
	}
	const preview = readTextPreview(filePath);
	const notice = preview.truncated ? `<p class="muted">파일이 커서 앞부분 ${escapeHtml(formatBytes(preview.text.length))}만 미리보기합니다. 전체 원본은 브라우저에서 여세요. 전체 크기: ${escapeHtml(formatBytes(preview.size))}</p>` : "";
	return { title: path.basename(filePath), html: `${notice}<pre>${escapeHtml(preview.text)}</pre>` };
}

function sanitizePreviewReturnTo(value: string | null | undefined): string {
	if (!value) return "/";
	const trimmed = value.trim();
	if (!trimmed.startsWith("/") || trimmed.startsWith("//") || /[\r\n]/.test(trimmed)) return "/";
	return trimmed;
}

function buildArtifactPreviewHtml(filePath: string, options: { full?: boolean; returnTo?: string; intent?: EvidenceIntent } = {}): string {
	const { title, html } = artifactPreviewInnerHtml(filePath, options);
	const returnTo = sanitizePreviewReturnTo(options.returnTo);
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
			<button type="button" data-return-to="${escapeAttr(returnTo)}" onclick="location.href=this.dataset.returnTo||'/'">이전</button>
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

async function openHtmlStringArtifact(pi: ExtensionAPI, html: string, title: string, browserOnly = false, ctx?: ExtensionContext | ExtensionCommandContext): Promise<"glimpse" | "browser"> {
	if (!browserOnly && ctx) {
		const companion = await openCompanionHtml(pi, ctx, html, title, { width: 1280, height: 900 });
		if (companion.window) return "glimpse";
	}
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilee-artifact-browser-"));
	const tmpPath = path.join(tmpDir, `${slugify(title)}.html`);
	fs.writeFileSync(tmpPath, html, "utf-8");
	await openInSystemBrowser(pi, tmpPath);
	return "browser";
}

async function openHtmlArtifact(pi: ExtensionAPI, filePath: string, browserOnly = false, ctx?: ExtensionContext | ExtensionCommandContext): Promise<"glimpse" | "browser"> {
	if (!browserOnly && ctx) {
		try {
			const resolved = fs.realpathSync(filePath);
			const htmlDir = path.dirname(resolved);
			const html = inlineLocalImageSrc(fs.readFileSync(resolved, "utf-8"), htmlDir);
			const title = artifactTitle(html, resolved);
			return await openHtmlStringArtifact(pi, buildGlimpseArtifactHtml(html, resolved), title, false, ctx);
		} catch {}
	}
	await openInSystemBrowser(pi, filePath);
	return "browser";
}

async function openMediaArtifact(pi: ExtensionAPI, filePath: string, browserOnly = false, intent?: EvidenceIntent, ctx?: ExtensionContext | ExtensionCommandContext): Promise<"glimpse" | "browser"> {
	const resolved = fs.realpathSync(filePath);
	const title = path.basename(resolved);
	const html = buildMediaPreviewHtml(resolved, title, intent);
	return openHtmlStringArtifact(pi, html, title, browserOnly, ctx);
}

async function openAnyArtifact(pi: ExtensionAPI, filePath: string, browserOnly = false, cwd = process.cwd(), ctx?: ExtensionContext | ExtensionCommandContext): Promise<"glimpse" | "browser"> {
	const resolved = fs.realpathSync(filePath);
	const ext = path.extname(resolved).toLowerCase();
	if (ext === ".html" || ext === ".htm") return openHtmlArtifact(pi, resolved, browserOnly, ctx);
	if (ext === ".json" && resolved.startsWith(FRAME_TRANSCRIPTS_DIR)) {
		return openHtmlStringArtifact(pi, buildFrameTranscriptStandaloneHtml(resolved), path.basename(resolved), browserOnly, ctx);
	}
	if (MEDIA_EXTENSIONS.has(ext)) return openMediaArtifact(pi, resolved, browserOnly, collectEvidenceIntentIndex(cwd).get(resolved), ctx);
	if (ext === ".jsonl" || isSessionJsonlPath(resolved)) {
		const exportPath = await exportSessionArtifactToHtml(pi, resolved);
		if (browserOnly) {
			await openFile(pi, exportPath);
			return "browser";
		}
		return openHtmlArtifact(pi, exportPath, false, ctx);
	}
	await openInSystemBrowser(pi, resolved);
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

	const openArchiveCommand = async (args: string, ctx: ExtensionCommandContext) => {
		if (!ctx.hasUI) return;

		const parsed = parseShowReportArgs(args, ctx.cwd);
		if (parsed.explicitPath) {
			if (!fs.existsSync(parsed.explicitPath)) {
				ctx.ui.notify(`artifact를 찾을 수 없습니다: ${parsed.explicitPath}`, "warning");
				return;
			}
			const mode = await openAnyArtifact(pi, parsed.explicitPath, parsed.browserOnly, ctx.cwd, ctx);
			ctx.ui.notify(`🗂️ ${mode === "glimpse" ? "Glimpse" : "브라우저"} 열기 → ${path.basename(parsed.explicitPath)}`, "info");
			return;
		}

		const artifacts = collectArtifactBrowserData(ctx.cwd);
		const total = artifacts.piUnits.length + artifacts.conductors.length + artifacts.webSearches.length + artifacts.mcpArtifacts.length + artifacts.reports.length + artifacts.planningDocs.length + artifacts.captures.length;
		if (total === 0) {
			ctx.ui.notify("표시할 artifact를 찾을 수 없습니다.", "warning");
			return;
		}

		const mode = await openArtifactBrowser(pi, artifacts, ctx.cwd, parsed.browserOnly, ctx);
		ctx.ui.notify(`🗂️ Archive ${mode === "glimpse" ? "Glimpse" : "브라우저"} 열기 · Pi ${artifacts.piUnits.length} · Conductor ${artifacts.conductors.length} · web ${artifacts.webSearches.length} · MCP ${artifacts.mcpArtifacts.length} · reports ${artifacts.reports.length}`, "info");
	};

	pi.registerCommand("archive", {
		description: "Pi 이력·Conductor 이력·웹 검색·검증 리포트·TFT/기획·캡처 미디어를 Artifact Browser로 열기. Usage: /archive [--browser] [path]",
		handler: openArchiveCommand,
	});

	pi.registerCommand("show-report", {
		description: "Compatibility alias for /archive. Usage: /show-report [--browser] [path]",
		handler: openArchiveCommand,
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

interface McpArtifactEntry {
	path: string;
	name: string;
	time: string;
	server: string;
	tool: string;
	responseId: string;
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

interface EvidenceIntent {
	itemId?: string;
	label?: string;
	purpose?: string;
	inspectFor?: string[];
	expected?: string;
	observed?: string;
	role?: string;
	kind?: string;
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
	intent?: EvidenceIntent;
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

type PiSessionPanelSource = "p0" | "fork";

interface PiSessionEntry {
	path: string;
	title: string;
	workspace: string;
	cwd: string;
	restoredFromConductor: boolean;
	panelLabel: string;
	panelSource: PiSessionPanelSource;
	forkId?: string;
	classification?: SessionClassification;
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

interface ChatPreviewEntry {
	role: "user" | "assistant";
	text: string;
	timestamp: string;
}

interface SessionConversationEntry extends ChatPreviewEntry {
	index: number;
}

interface SessionSegmentClassification {
	title: string;
	category: string;
	tags: string[];
	summary: string;
	startIndex?: number;
	endIndex?: number;
	startTime?: string;
	endTime?: string;
	source?: "ai" | "user" | "fallback";
}

interface SessionClassification {
	id: string;
	sessionPath: string;
	title: string;
	category: string;
	tags: string[];
	summary: string;
	segments: SessionSegmentClassification[];
	source: "user" | "ai-suggestion" | "fallback";
	createdAt: string;
	updatedAt: string;
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
	dbConversation: ChatPreviewEntry[];
	sourceSessionPaths: string[];
	mtime: number;
	time: string;
}

interface ArtifactBrowserData {
	piUnits: PiWorkUnitEntry[];
	conductors: ConductorHistoryEntry[];
	reports: ReportEntry[];
	webSearches: WebSearchEntry[];
	mcpArtifacts: McpArtifactEntry[];
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
	const seen = new Set<string>();
	for (const profile of loadArtifactBrowserProfiles()) {
		for (const rootProfile of profile.worktreeRoots ?? []) {
			const repoRoot = expandProfileTemplate(rootProfile.path, { repo: rootProfile.repo });
			if (!fs.existsSync(repoRoot)) continue;
			try {
				for (const workspace of fs.readdirSync(repoRoot)) {
					const workspacePath = path.join(repoRoot, workspace);
					const piDir = path.join(workspacePath, ".pi");
					if (!fs.existsSync(workspacePath) || !fs.statSync(workspacePath).isDirectory()) continue;
					if (!fs.existsSync(piDir) && !fs.existsSync(path.join(workspacePath, ".context"))) continue;
					const key = fs.realpathSync(workspacePath);
					if (seen.has(key)) continue;
					seen.add(key);
					roots.push({ repo: rootProfile.repo, workspace, workspacePath, piDir });
				}
			} catch {}
		}
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

function collectHtmlFilesRecursive(dir: string, limit = 240): string[] {
	const files: string[] = [];
	const walk = (current: string) => {
		if (files.length >= limit) return;
		let entries: string[] = [];
		try { entries = fs.readdirSync(current); } catch { return; }
		for (const entry of entries) {
			if (files.length >= limit) return;
			const fp = path.join(current, entry);
			let stat: fs.Stats;
			try { stat = fs.statSync(fp); } catch { continue; }
			if (stat.isDirectory()) walk(fp);
			else if (entry.endsWith(".html")) files.push(fp);
		}
	};
	walk(dir);
	return files;
}

function extractBadgeValue(html: string, key: string): string {
	const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = html.match(new RegExp(`<span class="badge">${escapedKey}=([^<]+)<\\/span>`, "i"));
	return match?.[1]?.replace(/<[^>]*>/g, "").trim() ?? "";
}

function collectMcpArtifacts(): McpArtifactEntry[] {
	const results: McpArtifactEntry[] = [];
	const mcpDir = path.join(ARCHIVE_DIR, "..", "mcp");
	if (!fs.existsSync(mcpDir)) return results;
	try {
		for (const fp of collectHtmlFilesRecursive(mcpDir, 360)) {
			const content = fs.readFileSync(fp, "utf-8");
			if (!content.includes(MCP_RESULT_SIGNATURE)) continue;
			const stat = fs.statSync(fp);
			const server = extractBadgeValue(content, "server") || path.basename(path.dirname(path.dirname(fp)));
			const tool = extractBadgeValue(content, "tool") || path.basename(path.dirname(fp));
			const responseId = extractBadgeValue(content, "responseId") || path.basename(fp).match(/mcp_[a-f0-9]+/)?.[0] || "";
			const ticket = content.match(/\b[A-Z]+-\d+\b/)?.[0] ?? "";
			results.push({ path: fp, name: path.relative(mcpDir, fp), time: formatMtime(stat.mtimeMs), server, tool, responseId, ticket, mtime: stat.mtimeMs });
		}
	} catch {}
	return results.sort((a, b) => b.mtime - a.mtime).slice(0, 160);
}

function collectArtifactBrowserData(cwd: string): ArtifactBrowserData {
	const reports = collectReports(cwd);
	const frames = collectFrameTranscripts();
	const captures = collectCaptureMedia(cwd);
	const webSearches = collectWebSearchReviews();
	const mcpArtifacts = collectMcpArtifacts();
	const planningDocs = collectPlanningDocs(cwd, frames);
	return {
		piUnits: collectPiWorkUnits(reports, frames, planningDocs, captures, webSearches),
		conductors: collectConductorHistories(),
		reports,
		webSearches,
		mcpArtifacts,
		frames,
		planningDocs,
		captures,
		generatedAt: new Date(),
	};
}

function captureIntentByPath(captures: CaptureEntry[]): Map<string, EvidenceIntent> {
	const byPath = new Map<string, EvidenceIntent>();
	for (const capture of captures) {
		if (!capture.intent) continue;
		try { byPath.set(fs.realpathSync(capture.path), capture.intent); } catch { byPath.set(capture.path, capture.intent); }
	}
	return byPath;
}

function artifactBrowserAllowedPaths(data: ArtifactBrowserData): Set<string> {
	const allowed = new Set<string>();
	for (const filePath of [
		...data.reports.map((item) => item.path),
		...data.webSearches.map((item) => item.path),
		...data.mcpArtifacts.map((item) => item.path),
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

function readRequestJson(req: IncomingMessage, maxBytes = 256 * 1024): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		let size = 0;
		req.on("data", (chunk: Buffer) => {
			size += chunk.length;
			if (size > maxBytes) {
				reject(new Error("Request body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => {
			try {
				const text = Buffer.concat(chunks).toString("utf-8").trim();
				resolve(text ? JSON.parse(text) : {});
			} catch (error) { reject(error); }
		});
		req.on("error", reject);
	});
}

function resolveAllowedSessionPath(rawPath: string, allowedPaths: Set<string>): string {
	let resolved = "";
	try { resolved = fs.realpathSync(rawPath); } catch {}
	if (!resolved || !allowedPaths.has(resolved)) throw new Error("Path is not in this Artifact Browser.");
	if (!isSessionJsonlPath(resolved)) throw new Error("분류는 session JSONL artifact에만 저장할 수 있습니다.");
	return resolved;
}

function resolveAllowedFrameTranscriptPath(rawPath: string, allowedPaths: Set<string>): string {
	let resolved = "";
	try { resolved = fs.realpathSync(rawPath); } catch {}
	if (!resolved || !allowedPaths.has(resolved)) throw new Error("Path is not in this Artifact Browser.");
	const base = fs.realpathSync(FRAME_TRANSCRIPTS_DIR);
	if (path.extname(resolved).toLowerCase() !== ".json" || (resolved !== base && !resolved.startsWith(`${base}${path.sep}`))) {
		throw new Error("이어하기는 TFT Studio transcript artifact에서만 사용할 수 있습니다.");
	}
	return resolved;
}

function jsonResponse(res: ServerResponse, status: number, payload: unknown) {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
	res.end(JSON.stringify(payload));
}

function startArtifactBrowserServer(pi: ExtensionAPI, data: ArtifactBrowserData, cwd: string, ctx?: ExtensionCommandContext): Promise<string> {
	const allowedPaths = artifactBrowserAllowedPaths(data);
	const intentByPath = captureIntentByPath(data.captures);
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
				const returnTo = sanitizePreviewReturnTo(url.searchParams.get("return"));
				let resolved = "";
				try { resolved = fs.realpathSync(requested); } catch {}
				if (!resolved || !allowedPaths.has(resolved)) {
					res.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
					res.end("Path is not in this Artifact Browser.");
					return;
				}
				res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
				res.end(buildArtifactPreviewHtml(resolved, { full: url.searchParams.get("full") === "1", returnTo, intent: intentByPath.get(resolved) }));
				return;
			}
			if (req.method === "GET" && url.pathname === "/classification") {
				try {
					const resolved = resolveAllowedSessionPath(url.searchParams.get("path") || "", allowedPaths);
					jsonResponse(res, 200, { ok: true, classification: loadSessionClassification(resolved) ?? null });
				} catch (error) {
					jsonResponse(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
				}
				return;
			}
			if (req.method === "POST" && url.pathname === "/classification") {
				try {
					const body = await readRequestJson(req);
					const bodyPath = body && typeof body === "object" ? String((body as Record<string, unknown>).path || "") : "";
					const resolved = resolveAllowedSessionPath(bodyPath, allowedPaths);
					const raw = body && typeof body === "object" ? (body as Record<string, unknown>).classification : undefined;
					const classification = saveSessionClassification(resolved, raw ?? {});
					jsonResponse(res, 200, { ok: true, classification });
				} catch (error) {
					jsonResponse(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
				}
				return;
			}
			if (req.method === "POST" && url.pathname === "/classification/suggest") {
				try {
					const body = await readRequestJson(req, 64 * 1024);
					const bodyPath = body && typeof body === "object" ? String((body as Record<string, unknown>).path || "") : "";
					const resolved = resolveAllowedSessionPath(bodyPath, allowedPaths);
					const suggestion = await suggestSessionClassification(resolved, ctx);
					jsonResponse(res, 200, { ok: true, ...suggestion });
				} catch (error) {
					jsonResponse(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
				}
				return;
			}
			if (req.method === "POST" && url.pathname === "/resume-tft") {
				try {
					if (!ctx) throw new Error("Archive command context is unavailable.");
					const resolved = resolveAllowedFrameTranscriptPath(url.searchParams.get("path") || "", allowedPaths);
					const resumed = await resumeTftStudioFromTranscript(pi, ctx, resolved);
					jsonResponse(res, 200, { ok: true, ...resumed });
				} catch (error) {
					jsonResponse(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
				}
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
				const returnTo = sanitizePreviewReturnTo(url.searchParams.get("return"));
				const isSession = path.extname(resolved).toLowerCase() === ".jsonl" || isSessionJsonlPath(resolved);
				let previewResolved = resolved;
				if (isSession) {
					previewResolved = fs.realpathSync(await exportSessionArtifactToHtml(pi, resolved));
					allowedPaths.add(previewResolved);
				}
				const previewPath = `/preview?path=${encodeURIComponent(previewResolved)}&return=${encodeURIComponent(returnTo)}`;
				if (target === "glimpse") {
					res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ ok: true, mode: "glimpse", previewUrl: previewPath }));
					return;
				}
				if (isSession) {
					await openFile(pi, previewResolved);
					res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
					res.end(JSON.stringify({ ok: true, mode: "browser", path: previewResolved, url: pathToFileURL(previewResolved).href }));
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

async function openArtifactBrowser(pi: ExtensionAPI, data: ArtifactBrowserData, cwd: string, browserOnly = false, ctx?: ExtensionCommandContext): Promise<"glimpse" | "browser"> {
	const url = await startArtifactBrowserServer(pi, data, cwd, ctx);
	if (!browserOnly && ctx) {
		const html = `<!doctype html><html><head><meta charset="utf-8"><title>pilee Artifact Browser</title></head><body><script>window.location.replace(${JSON.stringify(url)});</script></body></html>`;
		const companion = await openCompanionHtml(pi, ctx, html, "pilee Artifact Browser", { width: 1280, height: 900 });
		if (companion.window) return "glimpse";
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
				const identityText = String(identity?.displayTitle || identity?.key || "TFT Studio");
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

function stringArray(value: unknown): string[] {
	if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
	if (typeof value === "string" && value.trim()) return [value.trim()];
	return [];
}

function valueString(record: Record<string, unknown>, ...keys: string[]): string {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return "";
}

function capturesDirForEvidenceResult(resultPath: string): string {
	const dir = path.dirname(resultPath);
	if (path.basename(resultPath) === "evidence-intent.json") return dir;
	if (path.basename(dir) === "results" && path.basename(path.dirname(dir)) === "verify-workers") return path.dirname(path.dirname(dir));
	return dir;
}

function resolveEvidencePathFromResult(rawPath: string, resultPath: string, cwd: string): string {
	const capturesDir = capturesDirForEvidenceResult(resultPath);
	const candidates = new Set<string>();
	if (path.isAbsolute(rawPath)) candidates.add(rawPath);
	else {
		candidates.add(path.resolve(cwd, rawPath));
		candidates.add(path.resolve(capturesDir, rawPath));
		candidates.add(path.resolve(path.dirname(resultPath), rawPath));
		const marker = `${path.sep}captures${path.sep}`;
		const idx = rawPath.indexOf(marker);
		if (idx >= 0) candidates.add(path.join(capturesDir, rawPath.slice(idx + marker.length)));
		const slashMarker = "/captures/";
		const slashIdx = rawPath.indexOf(slashMarker);
		if (slashIdx >= 0) candidates.add(path.join(capturesDir, rawPath.slice(slashIdx + slashMarker.length)));
	}
	for (const candidate of candidates) {
		try { if (fs.existsSync(candidate)) return fs.realpathSync(candidate); } catch {}
	}
	return path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
}

function collectEvidenceIntentIndex(cwd: string): Map<string, EvidenceIntent> {
	const index = new Map<string, EvidenceIntent>();
	const resultFiles: string[] = [];
	for (const root of contextWorkRoots(cwd)) {
		try {
			for (const ws of fs.readdirSync(root.dir)) {
				const capturesDir = path.join(root.dir, ws, "captures");
				const sidecar = path.join(capturesDir, "evidence-intent.json");
				if (fs.existsSync(sidecar)) resultFiles.push(sidecar);
				const resultsDir = path.join(capturesDir, "verify-workers", "results");
				if (!fs.existsSync(resultsDir)) continue;
				for (const file of fs.readdirSync(resultsDir)) {
					if (file.endsWith(".json")) resultFiles.push(path.join(resultsDir, file));
				}
			}
		} catch {}
	}
	for (const resultPath of resultFiles) {
		const data = readJsonFile(resultPath);
		if (!data) continue;
		const itemId = valueString(data, "itemId", "item_id", "relatedItem");
		const created = Array.isArray(data.evidence_created) ? data.evidence_created : [];
		for (const raw of created) {
			if (!raw || typeof raw !== "object") continue;
			const ev = raw as Record<string, unknown>;
			const rawPath = valueString(ev, "path");
			if (!rawPath) continue;
			const resolved = resolveEvidencePathFromResult(rawPath, resultPath, cwd);
			index.set(resolved, {
				itemId: valueString(ev, "relatedItem", "related_item") || itemId,
				label: valueString(ev, "label"),
				purpose: valueString(ev, "purpose"),
				inspectFor: stringArray(ev.inspectFor ?? ev.inspect_for),
				expected: valueString(ev, "expected"),
				observed: valueString(ev, "observed"),
				role: valueString(ev, "role"),
				kind: valueString(ev, "kind"),
			});
		}
	}
	return index;
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
	const intentIndex = collectEvidenceIntentIndex(cwd);
	const byPath = new Map<string, CaptureEntry>();
	for (const root of roots) {
		for (const item of walkMediaFiles(root.dir, root.source)) {
			try {
				const real = fs.realpathSync(item.path);
				byPath.set(real, { ...item, intent: intentIndex.get(real) });
			} catch {
				byPath.set(item.path, { ...item, intent: intentIndex.get(item.path) });
			}
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

function reposForWorkspace(workspace: string): string[] {
	const repos = new Set(collectWorktreeRoots().filter((root) => root.workspace === workspace).map((root) => root.repo));
	for (const repo of configuredArtifactRepos()) repos.add(repo);
	return [...repos];
}

function workspacePiDirs(workspace: string): string[] {
	const candidates = new Set<string>();
	for (const root of collectWorktreeRoots().filter((entry) => entry.workspace === workspace)) candidates.add(root.piDir);
	for (const profile of loadArtifactBrowserProfiles()) {
		for (const template of profile.workspacePiDirTemplates ?? []) {
			for (const repo of reposForWorkspace(workspace)) candidates.add(expandProfileTemplate(template, { repo, workspace }));
		}
	}
	return [...candidates];
}

function piSessionDirsForWorkspace(repo: string, workspace: string): string[] {
	const candidates = new Set<string>();
	for (const profile of loadArtifactBrowserProfiles()) {
		for (const template of profile.piSessionDirTemplates ?? []) {
			candidates.add(expandProfileTemplate(template, { repo, workspace }));
		}
	}
	return [...candidates];
}

function worktreeInfoForWorkspace(workspace: string): { ticket: string; title: string; note: string } {
	if (!workspace) return { ticket: "", title: "", note: "" };
	const candidates = workspacePiDirs(workspace);
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
	const candidates = reposForWorkspace(workspace).flatMap((repo) => piSessionDirsForWorkspace(repo, workspace));
	for (const sessionsDir of candidates) {
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

function configuredArtifactRepos(): string[] {
	const repos = new Set<string>();
	for (const profile of loadArtifactBrowserProfiles()) {
		for (const root of profile.worktreeRoots ?? []) repos.add(root.repo);
		if (profile.defaultRepo) repos.add(profile.defaultRepo);
	}
	return [...repos];
}

function defaultArtifactRepo(): string {
	for (const profile of loadArtifactBrowserProfiles()) {
		if (profile.defaultRepo) return profile.defaultRepo;
		const firstRoot = profile.worktreeRoots?.[0];
		if (firstRoot?.repo) return firstRoot.repo;
	}
	return "workspace";
}

function conductorProjectDirs(repo: string, workspace: string): string[] {
	const candidates = new Set<string>();
	for (const profile of loadConductorProfiles()) {
		for (const template of profile.projectDirTemplates ?? []) candidates.add(expandProfileTemplate(template, { repo, workspace }));
	}
	for (const profile of loadArtifactBrowserProfiles()) {
		for (const template of profile.conductorProjectDirTemplates ?? []) candidates.add(expandProfileTemplate(template, { repo, workspace }));
	}
	return [...candidates];
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

function readPiSessionsFromDir(sessionsDir: string, workspace: string, limit = Number.POSITIVE_INFINITY, panelIndex = loadForkPanelSessionIndex()): PiSessionEntry[] {
	if (!fs.existsSync(sessionsDir)) return [];
	try {
		const files = fs.readdirSync(sessionsDir)
			.filter((file) => file.endsWith(".jsonl"))
			.map((file) => path.join(sessionsDir, file))
			.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
		const selected = Number.isFinite(limit) ? files.slice(0, limit) : files;
		return selected
			.map((file) => readPiSessionEntry(file, workspace, panelIndex))
			.filter((entry): entry is PiSessionEntry => Boolean(entry));
	} catch { return []; }
}

function piSessionDirNameForPath(cwd: string): string {
	return `--${path.resolve(cwd).replace(/^\/+/, "").replace(/\//g, "-")}--`;
}

function piSessionDirsForPath(sessionsRoot: string, cwd: string, alias?: string): string[] {
	const candidates = new Set<string>([path.join(sessionsRoot, piSessionDirNameForPath(cwd))]);
	if (alias && fs.existsSync(sessionsRoot)) {
		try {
			for (const dirName of fs.readdirSync(sessionsRoot)) {
				if (dirName === `--${alias}--` || dirName.endsWith(`-${alias}--`)) {
					candidates.add(path.join(sessionsRoot, dirName));
				}
			}
		} catch {}
	}
	return [...candidates];
}

interface ForkPanelSessionInfo {
	panelLabel: string;
	forkId: string;
	parentSessionFile?: string;
}

function loadForkPanelSessionIndex(): Map<string, ForkPanelSessionInfo> {
	const index = new Map<string, ForkPanelSessionInfo>();
	try {
		const parsed = JSON.parse(fs.readFileSync(FORK_PANEL_RECENT_PATH, "utf-8")) as Record<string, { forkId?: string; panelLabel?: string; parentSessionFile?: string; sessionFile?: string }>;
		for (const [fallbackForkId, record] of Object.entries(parsed)) {
			if (!record?.sessionFile) continue;
			let real = record.sessionFile;
			try { real = fs.realpathSync(record.sessionFile); } catch {}
			index.set(real, {
				panelLabel: record.panelLabel || "P?",
				forkId: record.forkId || fallbackForkId,
				parentSessionFile: record.parentSessionFile,
			});
		}
	} catch {}
	return index;
}

function panelInfoForSession(filePath: string, panelIndex: Map<string, ForkPanelSessionInfo>): { panelLabel: string; panelSource: PiSessionPanelSource; forkId?: string } {
	let real = filePath;
	try { real = fs.realpathSync(filePath); } catch {}
	const fork = panelIndex.get(real);
	if (fork) return { panelLabel: fork.panelLabel, panelSource: "fork", forkId: fork.forkId };
	return { panelLabel: "P0", panelSource: "p0" };
}

function allPiSessionDirs(sessionsRoot: string): string[] {
	if (!fs.existsSync(sessionsRoot)) return [];
	try {
		return fs.readdirSync(sessionsRoot)
			.filter((dirName) => dirName !== "subagents")
			.map((dirName) => path.join(sessionsRoot, dirName))
			.filter((dir) => {
				try { return fs.statSync(dir).isDirectory(); } catch { return false; }
			});
	} catch { return []; }
}

function shortDisplayPath(filePath: string): string {
	const home = os.homedir();
	if (filePath === home) return "~";
	if (filePath.startsWith(`${home}/`)) return `~/${filePath.slice(home.length + 1)}`;
	return filePath;
}

function sessionUnitWorkspaceFromDir(sessionsDir: string, sessions: PiSessionEntry[]): { workspace: string; workspacePath: string; title: string } {
	const cwd = sessions.find((session) => session.cwd)?.cwd || "";
	if (cwd === os.homedir()) return { workspace: "home", workspacePath: cwd, title: "home Pi 대화 세션" };
	if (cwd && path.resolve(cwd) === PACKAGE_ROOT) return { workspace: "pilee", workspacePath: cwd, title: "pilee Pi 대화 세션" };
	const label = cwd ? shortDisplayPath(cwd) : path.basename(sessionsDir);
	return { workspace: label, workspacePath: cwd || sessionsDir, title: `${label} Pi 대화 세션` };
}

function readPiSessionsFromDirs(sessionDirs: string[], workspace: string, limit = Number.POSITIVE_INFINITY, panelIndex = loadForkPanelSessionIndex()): PiSessionEntry[] {
	const seen = new Set<string>();
	const sessions: PiSessionEntry[] = [];
	for (const sessionsDir of sessionDirs) {
		for (const session of readPiSessionsFromDir(sessionsDir, workspace, limit, panelIndex)) {
			try {
				const real = fs.realpathSync(session.path);
				if (seen.has(real)) continue;
				seen.add(real);
			} catch {}
			sessions.push(session);
		}
	}
	const sorted = sessions.sort((a, b) => b.mtime - a.mtime);
	return Number.isFinite(limit) ? sorted.slice(0, limit) : sorted;
}

function findPiSessionsForWorkspace(repo: string, workspace: string, panelIndex = loadForkPanelSessionIndex()): PiSessionEntry[] {
	const seen = new Set<string>();
	const sessions: PiSessionEntry[] = [];
	for (const sessionsDir of piSessionDirsForWorkspace(repo, workspace)) {
		for (const session of readPiSessionsFromDir(sessionsDir, workspace, Number.POSITIVE_INFINITY, panelIndex)) {
			try {
				const real = fs.realpathSync(session.path);
				if (seen.has(real)) continue;
				seen.add(real);
			} catch {}
			sessions.push(session);
		}
	}
	return sessions.sort((a, b) => b.mtime - a.mtime);
}

function readPiSessionEntry(filePath: string, workspace: string, panelIndex: Map<string, ForkPanelSessionInfo>): PiSessionEntry | null {
	try {
		const stat = fs.statSync(filePath);
		const realPath = fs.realpathSync(filePath);
		let title = "Pi 대화 세션";
		let restoredFromConductor = false;
		let cwd = "";
		const lines = readTextPreview(filePath, 256 * 1024).text.split(/\r?\n/).slice(0, 120);
		for (const line of lines) {
			if (line.includes('"customType":"conductor-resume"')) restoredFromConductor = true;
			if (line.includes('"type":"session"')) {
				try {
					const parsed = JSON.parse(line) as { cwd?: string };
					if (typeof parsed.cwd === "string" && parsed.cwd.trim()) cwd = parsed.cwd;
				} catch {}
			}
			if (!line.includes('"type":"session_info"')) continue;
			try {
				const parsed = JSON.parse(line) as { name?: string };
				const name = typeof parsed.name === "string" ? parsed.name.trim() : "";
				if (isMeaningfulSessionTitle(name)) title = name;
			} catch {}
		}
		const panel = panelInfoForSession(realPath, panelIndex);
		const classification = loadSessionClassification(realPath);
		return { path: realPath, title, workspace, cwd, restoredFromConductor, ...panel, classification, time: formatMtime(stat.mtimeMs), mtime: stat.mtimeMs };
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

function isSessionTranscriptMarkdown(filePath: string): boolean {
	try {
		const preview = fs.readFileSync(filePath, "utf-8").slice(0, 4096);
		return /^#\s+Session\s+[A-Za-z0-9_-]+/m.test(preview)
			&& /^Started:\s+\d{4}-\d{2}-\d{2}T/m.test(preview)
			&& /\*\*(User|Assistant)\*\*:/m.test(preview);
	} catch { return false; }
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
				if (isSessionTranscriptMarkdown(fp)) continue;
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
	const panelIndex = loadForkPanelSessionIndex();
	const seenSessionPaths = new Set<string>();
	const unseenSessions = (sessions: PiSessionEntry[]) => sessions.filter((session) => {
		let real = session.path;
		try { real = fs.realpathSync(session.path); } catch {}
		if (seenSessionPaths.has(real)) return false;
		return true;
	});
	const rememberSessions = (sessions: PiSessionEntry[]) => {
		for (const session of sessions) {
			try { seenSessionPaths.add(fs.realpathSync(session.path)); } catch { seenSessionPaths.add(session.path); }
		}
	};
	const pushUnit = (unit: PiWorkUnitEntry) => {
		units.push(unit);
		rememberSessions([...unit.piRestoredSessions, ...unit.piChatSessions]);
	};

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
		const sessions = unseenSessions(findPiSessionsForWorkspace(root.repo, root.workspace, panelIndex));
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
		pushUnit({
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
		{ key: "pi:pilee", workspace: "pilee", title: "pilee Pi 대화 세션", workspacePath: PACKAGE_ROOT, sessionDirs: piSessionDirsForPath(sessionsRoot, PACKAGE_ROOT, "pilee") },
		{ key: "pi:home", workspace: "home", title: "home Pi 대화 세션", workspacePath: os.homedir(), sessionDirs: piSessionDirsForPath(sessionsRoot, os.homedir()) },
	]) {
		const sessions = unseenSessions(readPiSessionsFromDirs(special.sessionDirs, special.workspace, Number.POSITIVE_INFINITY, panelIndex));
		if (!sessions.length) continue;
		const mtime = Math.max(...sessions.map((session) => session.mtime));
		pushUnit({
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

	for (const sessionsDir of allPiSessionDirs(sessionsRoot)) {
		const rawSessions = unseenSessions(readPiSessionsFromDir(sessionsDir, "", Number.POSITIVE_INFINITY, panelIndex));
		if (!rawSessions.length) continue;
		const info = sessionUnitWorkspaceFromDir(sessionsDir, rawSessions);
		const sessions = rawSessions.map((session) => ({ ...session, workspace: info.workspace }));
		const mtime = Math.max(...sessions.map((session) => session.mtime));
		pushUnit({
			key: `pi:session-dir:${stableHash(sessionsDir)}`,
			repo: "pi",
			workspace: info.workspace,
			workspacePath: info.workspacePath,
			label: info.title,
			ticket: "",
			title: info.title,
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

	return units.sort((a, b) => b.mtime - a.mtime);
}

function queryConductorSync(sql: string): string {
	const dbPath = conductorDbPath();
	if (!dbPath || !fs.existsSync(dbPath)) return "";
	try { return execFileSync("sqlite3", ["-separator", "§", dbPath, sql], { encoding: "utf-8" }).trim(); } catch { return ""; }
}

function queryConductorJsonSync<T extends Record<string, unknown>>(sql: string): T[] {
	const dbPath = conductorDbPath();
	if (!dbPath || !fs.existsSync(dbPath)) return [];
	try {
		const output = execFileSync("sqlite3", ["-json", dbPath, sql], { encoding: "utf-8", maxBuffer: 20 * 1024 * 1024 }).trim();
		return output ? JSON.parse(output) as T[] : [];
	} catch { return []; }
}

function sqlQuote(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}

function conversationFromDbContent(roleHint: string, content: string, timestamp: string): ChatPreviewEntry | null {
	const trimmed = content.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
		try {
			const parsed = JSON.parse(trimmed);
			const entry = conversationFromSessionRecord(parsed);
			if (entry) return { ...entry, timestamp: entry.timestamp || timestamp };
		} catch {}
	}
	if (roleHint !== "user" && roleHint !== "assistant") return null;
	if (looksLikeSessionNoise(trimmed)) return null;
	return { role: roleHint, text: trimmed, timestamp };
}

function conversationsFromConductorDb(sessionIds: string[]): Map<string, ChatPreviewEntry[]> {
	const ids = [...new Set(sessionIds.filter(Boolean))];
	const bySession = new Map<string, ChatPreviewEntry[]>();
	if (!ids.length) return bySession;
	const values = ids.map((id) => `(${sqlQuote(id)})`).join(",");
	const rows = queryConductorJsonSync<{ session_id?: string; role?: string; content?: string; created_at?: string }>(`WITH selected(session_id) AS (VALUES ${values}) SELECT sm.session_id, sm.role, sm.content, sm.created_at FROM session_messages sm JOIN selected s ON sm.session_id=s.session_id WHERE sm.role='user' ORDER BY sm.session_id, sm.created_at`);
	const seen = new Map<string, Set<string>>();
	for (const row of rows) {
		const sessionId = String(row.session_id || "");
		if (!sessionId) continue;
		const entry = conversationFromDbContent(String(row.role || ""), String(row.content || ""), String(row.created_at || ""));
		if (!entry) continue;
		const sessionSeen = seen.get(sessionId) ?? new Set<string>();
		if (sessionSeen.has(entry.text)) continue;
		sessionSeen.add(entry.text);
		seen.set(sessionId, sessionSeen);
		const list = bySession.get(sessionId) ?? [];
		if (list.length >= 80) continue;
		list.push(entry);
		bySession.set(sessionId, list);
	}
	return bySession;
}

function requestsFromConductorJsonl(filePath: string): string[] {
	const requests: string[] = [];
	try {
		for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
			if (!line.trim()) continue;
			let obj: unknown;
			try { obj = JSON.parse(line); } catch { continue; }
			const entry = conversationFromSessionRecord(obj);
			if (!entry || entry.role !== "user") continue;
			requests.push(entry.text.replace(/\s+/g, " ").slice(0, 300));
			if (requests.length >= 30) break;
		}
	} catch {}
	return requests;
}

function collectConductorHistories(): ConductorHistoryEntry[] {
	const rows = queryConductorSync("SELECT w.directory_name, COALESCE(r.name,''), COALESCE(w.branch,''), COALESCE(w.state,''), COALESCE(w.pr_title,''), COALESCE(w.active_session_id,''), COALESCE(w.created_at,''), COALESCE(w.updated_at,'') FROM workspaces w LEFT JOIN repos r ON w.repository_id = r.id ORDER BY w.updated_at DESC LIMIT 160");
	if (!rows) return [];
	const entries: ConductorHistoryEntry[] = [];
	const rawRows = rows.split("\n").map((line) => line.split("§"));
	const dbConversations = conversationsFromConductorDb(rawRows.map((row) => row[5] ?? ""));
	for (const row of rawRows) {
		const [workspace = "", repo = "", branch = "", status = "", pr = "", sessionId = "", createdAt = "", updatedAt = ""] = row;
		if (!workspace) continue;
		const parsedPr = parseTicketAndTitle(pr);
		const parsedBranch = parseTicketAndTitle(branch);
		const ticket = firstNonEmpty(parsedPr.ticket, parsedBranch.ticket);
		const title = firstNonEmpty(parsedPr.title, workspace);
		const sourceSessionPaths = findConductorSourceSessions(repo || defaultArtifactRepo(), workspace, sessionId);
		const dbConversation = dbConversations.get(sessionId) ?? [];
		const firstSession = sourceSessionPaths[0] ?? "";
		const jsonlRequests = firstSession ? requestsFromConductorJsonl(firstSession) : [];
		const dbRequests = dbConversation.filter((entry) => entry.role === "user").map((entry) => entry.text.replace(/\s+/g, " ").slice(0, 300));
		const requests = [...jsonlRequests, ...dbRequests].filter((request, index, array) => array.indexOf(request) === index).slice(0, 30);
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
			requests,
			dbConversation,
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

function renderEvidenceIntentBlock(intent?: EvidenceIntent): string {
	if (!intent) return "";
	const inspect = intent.inspectFor?.filter(Boolean) ?? [];
	const rows = [
		intent.itemId ? ["관련 기준", intent.itemId] : undefined,
		intent.role ? ["역할", intent.role] : undefined,
		intent.purpose ? ["왜 수집했나", intent.purpose] : undefined,
		inspect.length ? ["봐야 할 것", inspect.join(" / ")] : undefined,
		intent.expected ? ["기대 결과", intent.expected] : undefined,
		intent.observed ? ["실제 관찰", intent.observed] : undefined,
	].filter(Boolean) as string[][];
	if (!rows.length) return "";
	return `<aside class="intent"><div class="intent-title">관찰 가이드</div>${rows.map(([label, value]) => `<div class="intent-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`).join("")}</aside>`;
}

function buildMediaPreviewHtml(filePath: string, title = path.basename(filePath), intent?: EvidenceIntent): string {
	const src = mediaDataUri(filePath, 40 * 1024 * 1024);
	const fileUrl = fileHref(filePath);
	return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
		body{margin:0;background:#111;color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;display:grid;grid-template-rows:auto auto 1fr;min-height:100vh}.bar{display:flex;justify-content:space-between;gap:16px;align-items:center;padding:12px 16px;background:#18181b;border-bottom:1px solid rgba(255,255,255,.12)}.path{color:#a1a1aa;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stage{display:grid;place-items:center;min-height:0;padding:18px}.intent{margin:12px 16px 0;padding:12px 14px;border:1px solid rgba(255,255,255,.14);border-radius:12px;background:#18181b}.intent-title{color:#c4b5fd;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:8px}.intent-row{display:grid;grid-template-columns:120px 1fr;gap:10px;padding:5px 0;border-top:1px solid rgba(255,255,255,.08)}.intent-row:first-of-type{border-top:0}.intent-row strong{color:#a1a1aa;font-size:12px}.intent-row span{color:#f5f5f5;font-size:13px;line-height:1.45}img{max-width:100%;max-height:calc(100vh - 180px);object-fit:contain;border-radius:12px;box-shadow:0 20px 80px rgba(0,0,0,.35)}a{color:#c4b5fd;text-decoration:none;border:1px solid rgba(255,255,255,.18);padding:7px 10px;border-radius:8px}
	</style></head><body><div class="bar"><div><strong>${escapeHtml(intent?.label || title)}</strong><div class="path">${escapeHtml(filePath)}</div></div><a href="${escapeAttr(fileUrl)}" target="_blank" rel="noreferrer">원본 열기</a></div>${renderEvidenceIntentBlock(intent)}<div class="stage">${src ? `<img src="${src}" alt="${escapeAttr(title)}">` : `<p>파일이 커서 inline preview를 만들지 않았습니다. <a href="${escapeAttr(fileUrl)}" target="_blank" rel="noreferrer">원본 열기</a></p>`}</div></body></html>`;
}

function transcriptValue(record: unknown, key: string): unknown {
	return record && typeof record === "object" ? (record as Record<string, unknown>)[key] : undefined;
}

function renderTranscriptMarkdownBlock(markdown: unknown): string {
	if (typeof markdown !== "string" || !markdown.trim()) return "";
	return `<details><summary>Markdown 전문</summary><pre>${escapeHtml(markdown)}</pre></details>`;
}

function frameTimelineSignature(raw: unknown): string {
	return JSON.stringify({
		kind: transcriptValue(raw, "kind"),
		tab: transcriptValue(raw, "tab"),
		title: transcriptValue(raw, "title"),
		step: transcriptValue(raw, "step"),
		markdown: transcriptValue(raw, "markdown"),
		message: transcriptValue(raw, "message"),
		question: transcriptValue(raw, "question"),
		answer: transcriptValue(raw, "answer"),
	});
}

function normalizeFrameTimeline(timeline: unknown[]): unknown[] {
	const normalized: unknown[] = [];
	for (const raw of timeline) {
		const previous = normalized[normalized.length - 1];
		if (previous && transcriptValue(raw, "kind") === "update" && transcriptValue(previous, "kind") === "update" && frameTimelineSignature(previous) === frameTimelineSignature(raw)) continue;
		normalized.push(raw);
	}
	return normalized;
}

function frameTabLabel(tab: string): string {
	if (tab === "frame") return "Frame";
	if (tab === "decide") return "Decide";
	if (tab === "verify") return "Verify";
	if (tab === "verify-report") return "Verify Report";
	return tab || "TFT";
}

function renderFrameTimelineEntry(raw: unknown): string {
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
}

type FrameStageRun = {
	tab: string;
	index: number;
	status: "running" | "done" | "aborted";
	startedAt?: number;
	endedAt?: number;
	entries: unknown[];
};

function groupFrameTimelineRuns(timeline: unknown[]): FrameStageRun[] {
	const normalized = normalizeFrameTimeline(timeline);
	const runs: FrameStageRun[] = [];
	const currentByTab = new Map<string, FrameStageRun>();
	const countsByTab = new Map<string, number>();
	for (const raw of normalized) {
		const tab = String(transcriptValue(raw, "tab") || "frame");
		const kind = String(transcriptValue(raw, "kind") || "entry");
		let current = currentByTab.get(tab);
		if (!current || (current.entries.length > 0 && (kind === "start" || current.status !== "running"))) {
			const index = (countsByTab.get(tab) || 0) + 1;
			countsByTab.set(tab, index);
			current = { tab, index, status: "running", startedAt: transcriptValue(raw, "time") as number | undefined, entries: [] };
			currentByTab.set(tab, current);
			runs.push(current);
		}
		current.entries.push(raw);
		const time = transcriptValue(raw, "time");
		if (typeof time === "number" && (!current.startedAt || time < current.startedAt)) current.startedAt = time;
		if (kind === "finish") {
			current.status = "done";
			current.endedAt = typeof time === "number" ? time : undefined;
		} else if (kind === "abort") {
			current.status = "aborted";
			current.endedAt = typeof time === "number" ? time : undefined;
		}
	}
	return runs;
}

function renderFrameTimeline(timeline: unknown[]): string {
	const runs = groupFrameTimelineRuns(timeline);
	if (!runs.length) return `<p class="muted">기록된 timeline이 없습니다.</p>`;
	return `<div class="stage-runs">${runs.map((run) => {
		const start = run.startedAt ? new Date(run.startedAt).toLocaleString() : "시간 미상";
		const end = run.endedAt ? new Date(run.endedAt).toLocaleString() : "";
		const range = end ? `${start} → ${end}` : start;
		return `<article class="stage-run ${escapeAttr(run.status)}">
			<div class="stage-run-head"><div><h3>${escapeHtml(frameTabLabel(run.tab))} Run #${run.index}</h3><div class="meta"><span class="badge">${escapeHtml(run.status)}</span><span class="badge">${escapeHtml(range)}</span><span class="badge">${run.entries.length} entries</span></div></div></div>
			<div class="timeline">${run.entries.map(renderFrameTimelineEntry).join("\n")}</div>
		</article>`;
	}).join("\n")}</div>`;
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
	${webviewCopyCss()}
	:root{color-scheme:light;--bg:#fafaf9;--panel:#fff;--line:#e7e5e4;--text:#292524;--muted:#78716c;--accent:#7c3aed;--soft:#f5f3ff;--green:#166534;--amber:#92400e}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}.shell{max-width:1180px;margin:0 auto;padding:24px}.hero{padding:24px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(135deg,#fff,#f5f3ff);box-shadow:0 20px 60px rgba(41,37,36,.08)}.kicker{color:var(--accent);font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}h1{margin:6px 0 8px;font-size:32px;line-height:1.15}.hero p,.muted{color:var(--muted)}.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:18px 0}.tab{border:1px solid var(--line);border-radius:999px;background:#fff;padding:9px 13px;font-weight:800;cursor:pointer}.tab.active{background:var(--accent);border-color:var(--accent);color:#fff}.panel{display:none}.panel.active{display:block}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}.card{border:1px solid var(--line);border-radius:18px;background:var(--panel);padding:16px;box-shadow:0 10px 30px rgba(41,37,36,.05);overflow:hidden}.card h2,.card h3{margin:0 0 8px}.meta{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.badge{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:3px 8px;background:#fff}.path{color:var(--muted);font-size:12px;word-break:break-all}.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.button{border:1px solid var(--line);border-radius:10px;padding:7px 10px;text-decoration:none;color:var(--accent);font-weight:800;background:#fff;cursor:pointer;font:inherit}.button:hover{background:var(--soft)}.button[disabled]{opacity:.55;cursor:wait}.thumb{display:grid;place-items:center;aspect-ratio:16/10;background:#111;border-radius:14px;overflow:hidden;margin-bottom:10px}.thumb img{width:100%;height:100%;object-fit:contain}.intent-mini{border:1px solid var(--line);border-radius:12px;background:#fafaf9;padding:10px 11px;margin:10px 0;color:var(--text)}.intent-mini.missing{color:var(--muted);font-size:12px;border-style:dashed}.intent-mini-title{font-weight:800;color:var(--accent);font-size:12px;margin-bottom:5px}.intent-mini p{margin:4px 0;font-size:12px;line-height:1.45}.intent-mini strong{color:var(--muted);margin-right:4px}.empty{padding:40px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:18px;background:#fff}.chat-preview{display:grid;gap:10px}.chat-row{display:flex;flex-direction:column;margin:6px 0}.chat-row.user{align-items:flex-end}.chat-row.assistant{align-items:flex-start}.chat-meta{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:12px;margin:0 8px 4px}.chat-meta span{font-weight:800;color:var(--text)}.chat-bubble{max-width:min(780px,92%);white-space:pre-wrap;word-break:break-word;border:1px solid var(--line);border-radius:16px;padding:10px 12px;background:#fff;box-shadow:0 8px 22px rgba(41,37,36,.04)}.user .chat-bubble{background:#eff6ff;border-color:#bfdbfe}.stage-runs{display:grid;gap:16px}.stage-run{border:1px solid var(--line);border-radius:16px;padding:14px;background:#fafaf9}.stage-run.running{border-color:#c4b5fd;background:#faf9ff}.stage-run.done{border-color:#bbf7d0;background:#f0fdf4}.stage-run.aborted{border-color:#fecaca;background:#fef2f2}.stage-run-head{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start;margin-bottom:10px}.timeline{display:grid;gap:12px}.timeline-item{border:1px solid var(--line);border-radius:14px;padding:12px;background:#fff}.timeline-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap;color:var(--muted);font-size:12px}.timeline-head strong{color:var(--accent);text-transform:uppercase}.qa,.answer{margin-top:8px}.label{font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}pre{white-space:pre-wrap;word-break:break-word;background:#292524;color:#fafaf9;border-radius:12px;padding:12px;max-height:360px;overflow:auto}details{margin-top:8px}summary{cursor:pointer;font-weight:800}.filters{display:grid;grid-template-columns:minmax(0,1fr) 220px auto;gap:10px;margin:16px 0}.search,.category-filter{width:100%;height:40px;border:1px solid var(--line);border-radius:12px;padding:0 12px;font:inherit;background:#fff}.search-mode-button{height:40px;white-space:nowrap}.classification-mini{border:1px solid var(--line);border-radius:12px;background:#fafaf9;padding:10px 11px;margin:10px 0}.classification-mini.missing{border-style:dashed;color:var(--muted);font-size:12px}.classification-title{display:flex;gap:8px;justify-content:space-between;align-items:center;color:var(--accent);font-size:12px;font-weight:900;letter-spacing:.04em;text-transform:uppercase}.classification-mini p{margin:6px 0 0;font-size:12px;color:var(--text)}.modal{position:fixed;inset:0;background:rgba(41,37,36,.45);display:grid;place-items:center;z-index:999;padding:20px}.modal[hidden]{display:none}.modal-card{width:min(760px,96vw);max-height:92vh;overflow:auto;background:#fff;border:1px solid var(--line);border-radius:22px;padding:18px;box-shadow:0 30px 90px rgba(41,37,36,.25)}.modal-card header{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}.modal-card label{display:grid;gap:5px;margin:10px 0;font-size:12px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}.modal-card input,.modal-card textarea,.modal-card select{border:1px solid var(--line);border-radius:12px;padding:10px 11px;font:13px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--text);background:#fff;text-transform:none;letter-spacing:0}.modal-card textarea{resize:vertical}.field-help{font-size:12px;font-weight:500;color:var(--muted);text-transform:none;letter-spacing:0;line-height:1.45}.modal-card h2{margin:0 0 4px}@media(max-width:720px){.filters{grid-template-columns:1fr}.search-mode-button{width:100%}}
	</style>`;
}

function reportSourceLabel(source: ReportEntry["source"]): string {
	return source === "workspace" ? "workspace" : "archive";
}

function planningSourceLabel(source: PlanningDocEntry["source"]): string {
	if (source === "frame-studio") return "TFT Studio";
	if (source === "plan") return ".context/plans";
	return ".context/work";
}

function artifactOpenButtons(filePath: string): string {
	const escapedPath = escapeAttr(filePath);
	const session = filePath.endsWith(".jsonl") || isSessionJsonlPath(filePath);
	const primaryLabel = session ? "세션 전문 보기" : "열기";
	const browserLabel = session ? "브라우저에서 전문 보기" : "브라우저에서 열기";
	return `<button class="button open-artifact" type="button" data-target="glimpse" data-path="${escapedPath}">${primaryLabel}</button><button class="button open-artifact" type="button" data-target="browser" data-path="${escapedPath}">${browserLabel}</button>`;
}

function frameResumeButton(filePath: string): string {
	return `<button class="button resume-tft" type="button" data-path="${escapeAttr(filePath)}">이어하기</button>`;
}

function classificationButton(filePath: string): string {
	return `<button class="button classify-session" type="button" data-path="${escapeAttr(filePath)}">분류</button>`;
}

function classificationSearchText(classification?: SessionClassification): string {
	if (!classification) return "";
	return [
		classification.category,
		...classification.tags,
		classification.summary,
		...classification.segments.flatMap((segment) => [segment.title, segment.category, ...segment.tags, segment.summary]),
	].filter(Boolean).join(" ");
}

function classificationCategoryData(classification?: SessionClassification): string {
	if (!classification?.category) return "";
	return [classification.category, ...classification.segments.map((segment) => segment.category)].filter(Boolean).join("|");
}

function renderClassificationMini(classification?: SessionClassification): string {
	if (!classification) return `<div class="classification-mini missing">분류 metadata 없음</div>`;
	const segmentCount = classification.segments.length;
	return `<div class="classification-mini"><div class="classification-title"><span>${escapeHtml(classification.category)}</span>${segmentCount ? `<span>${segmentCount} segments</span>` : ""}</div>${classification.tags.length ? `<div class="meta">${classification.tags.slice(0, 6).map((tag) => `<span class="badge">#${escapeHtml(tag)}</span>`).join("")}</div>` : ""}${classification.summary ? `<p>${escapeHtml(truncatePreviewText(classification.summary, 260))}</p>` : ""}</div>`;
}

function sessionClassificationCategories(sessions: PiSessionEntry[]): string[] {
	const categories = new Set<string>();
	for (const session of sessions) {
		if (session.classification?.category) categories.add(session.classification.category);
		for (const segment of session.classification?.segments ?? []) if (segment.category) categories.add(segment.category);
	}
	return [...categories].sort((a, b) => a.localeCompare(b, "ko"));
}

function renderReportCards(reports: ReportEntry[]): string {
	if (!reports.length) return `<div class="empty">검증 리포트가 없습니다.</div>`;
	return `<div class="grid">${reports.map((r) => `<article class="card searchable" data-search="${escapeAttr(`${r.name} ${r.ticket} ${r.workspace} ${r.source}`.toLowerCase())}"><h3>${escapeHtml(r.name)}</h3><div class="meta"><span class="badge">${escapeHtml(reportSourceLabel(r.source))}</span>${r.workspace ? `<span class="badge">${escapeHtml(r.workspace)}</span>` : ""}<span class="badge">${escapeHtml(r.time)}</span>${r.ticket ? `<span class="badge">${escapeHtml(r.ticket)}</span>` : ""}</div><div class="path">${escapeHtml(r.path)}</div><div class="actions">${artifactOpenButtons(r.path)}</div></article>`).join("\n")}</div>`;
}

function renderWebSearchCards(webSearches: WebSearchEntry[]): string {
	if (!webSearches.length) return `<div class="empty">웹 검색 review artifact가 없습니다.</div>`;
	return `<div class="grid">${webSearches.map((entry) => `<article class="card searchable" data-search="${escapeAttr(`${entry.name} ${entry.queries.join(" ")} ${entry.ticket} ${entry.workspace}`.toLowerCase())}"><div class="kicker">🔎 Web Search</div><h3>${escapeHtml(entry.queries[0] || entry.name)}</h3><div class="meta">${entry.workspace ? `<span class="badge">${escapeHtml(entry.workspace)}</span>` : `<span class="badge">미분류</span>`}${entry.ticket ? `<span class="badge">${escapeHtml(entry.ticket)}</span>` : ""}<span class="badge">${escapeHtml(entry.time)}</span></div>${entry.queries.length > 1 ? `<ol>${entry.queries.map((q) => `<li>${escapeHtml(q)}</li>`).join("\n")}</ol>` : ""}<div class="path">${escapeHtml(entry.path)}</div><div class="actions">${artifactOpenButtons(entry.path)}</div></article>`).join("\n")}</div>`;
}

function renderMcpArtifactCards(items: McpArtifactEntry[]): string {
	if (!items.length) return `<div class="empty">MCP result artifact가 없습니다.</div>`;
	return `<div class="grid">${items.map((entry) => `<article class="card searchable" data-search="${escapeAttr(`${entry.name} ${entry.server} ${entry.tool} ${entry.responseId} ${entry.ticket}`.toLowerCase())}"><div class="kicker">🔌 MCP Result</div><h3>${escapeHtml(entry.tool || entry.name)}</h3><div class="meta"><span class="badge">${escapeHtml(entry.server || "server unknown")}</span>${entry.responseId ? `<span class="badge">${escapeHtml(entry.responseId)}</span>` : ""}${entry.ticket ? `<span class="badge">${escapeHtml(entry.ticket)}</span>` : ""}<span class="badge">${escapeHtml(entry.time)}</span></div><div class="path">${escapeHtml(entry.path)}</div><div class="actions">${artifactOpenButtons(entry.path)}</div></article>`).join("\n")}</div>`;
}

function renderFrameCards(frames: FrameTranscriptEntry[]): string {
	if (!frames.length) return `<div class="empty">저장된 TFT Studio 전문이 없습니다.</div>`;
	return `<div class="grid">${frames.map((f) => { const timeline = normalizeFrameTimeline(f.timeline); return `<article class="card searchable" data-search="${escapeAttr(`${f.title} ${f.identity} ${f.mode} ${f.workspace} ${f.ticket}`.toLowerCase())}"><h3>${escapeHtml(f.title)}</h3><div class="meta"><span class="badge">${escapeHtml(f.mode)}</span>${f.workspace ? `<span class="badge">${escapeHtml(f.workspace)}</span>` : ""}${f.ticket ? `<span class="badge">${escapeHtml(f.ticket)}</span>` : ""}<span class="badge">${escapeHtml(f.time)}</span><span class="badge">${timeline.length} entries</span></div><div class="path">${escapeHtml(f.identity)}</div><details><summary>Frame 전문 미리보기</summary><div class="timeline">${renderFrameTimeline(timeline)}</div></details><div class="actions">${artifactOpenButtons(f.path)}</div></article>`; }).join("\n")}</div>`;
}

function renderPlanningDocCards(docs: PlanningDocEntry[]): string {
	if (!docs.length) return `<div class="empty">기획/컨텍스트 markdown이 없습니다.</div>`;
	return `<div class="grid">${docs.map((doc) => `<article class="card searchable" data-search="${escapeAttr(`${doc.title} ${doc.name} ${doc.workspace} ${doc.ticket} ${doc.source}`.toLowerCase())}"><h3>${escapeHtml(doc.title)}</h3><div class="meta"><span class="badge">${escapeHtml(planningSourceLabel(doc.source))}</span>${doc.workspace ? `<span class="badge">${escapeHtml(doc.workspace)}</span>` : ""}${doc.ticket ? `<span class="badge">${escapeHtml(doc.ticket)}</span>` : ""}<span class="badge">${escapeHtml(doc.time)}</span></div><div class="path">${escapeHtml(doc.path)}</div><div class="actions">${doc.source === "frame-studio" ? frameResumeButton(doc.path) : ""}${artifactOpenButtons(doc.path)}</div></article>`).join("\n")}</div>`;
}

function sessionPanelSourceLabel(session: PiSessionEntry): string {
	return session.panelSource === "fork" ? "fork-panel" : "부모/P0";
}

function renderSessionCards(title: string, sessions: PiSessionEntry[]): string {
	if (!sessions.length) return `<section><h3>${escapeHtml(title)} · 0</h3><div class="empty">세션이 없습니다.</div></section>`;
	return `<section><h3>${escapeHtml(title)} · ${sessions.length}</h3><div class="grid">${sessions.map((session) => {
		const classificationText = classificationSearchText(session.classification);
		const search = `${session.title} ${session.workspace} ${session.panelLabel} ${session.panelSource} ${session.cwd} ${classificationText}`.toLowerCase();
		const categoryData = classificationCategoryData(session.classification);
		return `<article class="card searchable" data-category="${escapeAttr(categoryData)}" data-search="${escapeAttr(search)}"><h3>${escapeHtml(session.title)}</h3><div class="meta"><span class="badge">${escapeHtml(session.panelLabel)}</span><span class="badge">${escapeHtml(sessionPanelSourceLabel(session))}</span><span class="badge">${session.restoredFromConductor ? "Conductor 복구" : "Pi 대화"}</span><span class="badge">${escapeHtml(session.time)}</span>${session.classification?.category ? `<span class="badge">${escapeHtml(session.classification.category)}</span>` : ""}</div>${renderClassificationMini(session.classification)}${session.cwd ? `<div class="path">cwd: ${escapeHtml(shortDisplayPath(session.cwd))}</div>` : ""}<div class="path">${escapeHtml(session.path)}</div><div class="actions">${artifactOpenButtons(session.path)}${classificationButton(session.path)}</div></article>`;
	}).join("\n")}</div></section>`;
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

function renderCaptureIntentSummary(intent?: EvidenceIntent): string {
	if (!intent) return `<div class="intent-mini missing">검증 의도 metadata 없음</div>`;
	const inspect = intent.inspectFor?.filter(Boolean) ?? [];
	return `<div class="intent-mini"><div class="intent-mini-title">${escapeHtml(intent.itemId ? `${intent.itemId} · ${intent.label || "원자료 evidence"}` : intent.label || "원자료 evidence")}</div>${intent.purpose ? `<p><strong>왜</strong> ${escapeHtml(intent.purpose)}</p>` : ""}${inspect.length ? `<p><strong>봐야 할 것</strong> ${escapeHtml(inspect.join(" / "))}</p>` : ""}${intent.expected ? `<p><strong>기대</strong> ${escapeHtml(intent.expected)}</p>` : ""}${intent.observed ? `<p><strong>관찰</strong> ${escapeHtml(intent.observed)}</p>` : ""}</div>`;
}

function renderCaptureFileCards(captures: CaptureEntry[]): string {
	return `<div class="grid">${captures.map((c) => { const src = mediaDataUri(c.path); const search = `${c.name} ${c.source} ${c.workspace} ${c.intent?.itemId ?? ""} ${c.intent?.purpose ?? ""} ${(c.intent?.inspectFor ?? []).join(" ")}`.toLowerCase(); return `<article class="card searchable" data-search="${escapeAttr(search)}"><div class="thumb">${src ? `<img src="${src}" alt="${escapeAttr(c.name)}" loading="lazy">` : `<span class="muted">${escapeHtml(formatBytes(c.size))}</span>`}</div><h3>${escapeHtml(path.basename(c.path))}</h3><div class="meta"><span class="badge">${escapeHtml(c.source)}</span>${c.workspace ? `<span class="badge">${escapeHtml(c.workspace)}</span>` : ""}${c.intent?.itemId ? `<span class="badge">${escapeHtml(c.intent.itemId)}</span>` : ""}${c.intent?.role ? `<span class="badge">${escapeHtml(c.intent.role)}</span>` : ""}<span class="badge">${escapeHtml(c.time)}</span><span class="badge">${escapeHtml(formatBytes(c.size))}</span></div>${renderCaptureIntentSummary(c.intent)}<div class="path">${escapeHtml(c.name)}</div><div class="actions">${artifactOpenButtons(c.path)}</div></article>`; }).join("\n")}</div>`;
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
		const allSessions = [...unit.piRestoredSessions, ...unit.piChatSessions];
		const p0Count = allSessions.filter((session) => session.panelSource === "p0").length;
		const forkCount = allSessions.filter((session) => session.panelSource === "fork").length;
		const categories = sessionClassificationCategories(allSessions);
		const classificationText = allSessions.map((session) => classificationSearchText(session.classification)).join(" ");
		return `<article class="card searchable pi-work-card" data-category="${escapeAttr(categories.join("|"))}" data-search="${escapeAttr(`${unit.label} ${unit.workspace} ${unit.branch} ${classificationText}`.toLowerCase())}"><div class="kicker">🔥 Pi history</div><h3>${escapeHtml(unit.label)}</h3><div class="meta"><span class="badge">${escapeHtml(unit.repo)}</span>${unit.loadedByResume ? `<span class="badge">/wt resume</span>` : ""}${unit.branch ? `<span class="badge">${escapeHtml(unit.branch)}</span>` : ""}${categories.slice(0, 3).map((category) => `<span class="badge">${escapeHtml(category)}</span>`).join("")}</div><div class="meta"><span class="badge">P0 ${p0Count}</span><span class="badge">fork ${forkCount}</span><span class="badge">원본 ${unit.originalConductorSessionPaths.length}</span><span class="badge">복구 세션 ${unit.piRestoredSessions.length}</span><span class="badge">Pi 대화 ${unit.piChatSessions.length}</span><span class="badge">리포트 ${reports.length}</span><span class="badge">Frame/기획 ${planningDocs.length}</span><span class="badge">캡처 ${captures.length}</span><span class="badge">웹검색 ${webSearches.length}</span></div><div class="path">${escapeHtml(unit.workspacePath)}</div><div class="actions"><button class="button open-pi-detail" type="button" data-pi="${escapeAttr(unit.key)}">이력 열기</button></div></article>`;
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

function renderChatPreviewList(entries: ChatPreviewEntry[]): string {
	if (!entries.length) return `<p class="muted">Conductor DB에서 표시할 사용자 요청 text를 찾지 못했습니다.</p>`;
	return `<div class="chat-preview">${entries.slice(0, 40).map(renderChatPreviewEntry).join("\n")}</div>${entries.length > 40 ? `<p class="muted">앞 40개 요청만 표시합니다. 전체 원본은 원본 Conductor 세션에서 여세요.</p>` : ""}`;
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
		return `<article class="card searchable conductor-history-card" data-search="${escapeAttr(`${entry.label} ${entry.workspace} ${entry.branch} ${entry.status} ${entry.requests.slice(0, 10).join(" ")}`.toLowerCase())}"><div class="kicker">🧭 Conductor master</div><h3>${escapeHtml(entry.label)}</h3><div class="meta"><span class="badge">${escapeHtml(entry.repo)}</span>${restored ? `<span class="badge">Pi로 복구됨</span>` : ""}${entry.branch ? `<span class="badge">${escapeHtml(entry.branch)}</span>` : ""}${entry.status ? `<span class="badge">${escapeHtml(entry.status)}</span>` : ""}</div><div class="meta"><span class="badge">원본 세션 ${entry.sourceSessionPaths.length}</span><span class="badge">DB 요청 ${entry.dbConversation.length}</span><span class="badge">리포트 ${reports.length}</span><span class="badge">기획 ${planningDocs.length}</span><span class="badge">캡처 ${captures.length}</span></div><div class="path">workspace: ${escapeHtml(entry.workspace)}</div><div class="actions"><button class="button open-conductor-detail" type="button" data-conductor="${escapeAttr(entry.key)}">이력 열기</button></div></article>`;
	}).join("\n");
	const detailPanels = data.conductors.map((entry) => {
		const reports = reportsForUnit(entry, data.reports);
		const planningDocs = planningDocsForUnit(entry, data.planningDocs).filter((doc) => doc.source !== "frame-studio");
		const captures = capturesForUnit(entry, data.captures);
		const restored = conductorRestoredByPi(entry, data.piUnits);
		return `<section class="conductor-detail-panel" data-conductor-panel="${escapeAttr(entry.key)}" hidden><div class="actions"><button class="button" type="button" onclick="showConductorGroups()">← 컨덕터 이력 목록</button></div><header class="card"><div class="kicker">컨덕터 이력</div><h2>${escapeHtml(entry.label)}</h2><div class="meta"><span class="badge">Conductor master</span>${restored ? `<span class="badge">Pi로 복구됨</span>` : ""}<span class="badge">${escapeHtml(entry.repo)}</span>${entry.ticket ? `<span class="badge">${escapeHtml(entry.ticket)}</span>` : ""}${entry.createdAt ? `<span class="badge">생성 ${escapeHtml(entry.createdAt)}</span>` : ""}${entry.sessionId ? `<span class="badge">session ${escapeHtml(entry.sessionId.slice(0, 8))}</span>` : ""}</div><div class="path">${escapeHtml(entry.branch)}</div></header><section class="card"><h3>이전 요청</h3>${renderRequestList(entry.requests)}</section><section class="card"><h3>Conductor DB 요청 preview · ${entry.dbConversation.length}</h3>${renderChatPreviewList(entry.dbConversation)}</section>${renderConductorSourceCards("원본 Conductor 세션", entry.sourceSessionPaths, restored)}<section><h3>검증 리포트 · ${reports.length}</h3>${renderReportCards(reports)}</section><section><h3>기획 / Frame · ${planningDocs.length}</h3>${renderPlanningDocCards(planningDocs)}</section><section><h3>캡처 / 미디어 · ${captures.length}</h3>${captures.length ? renderCaptureFileCards(captures) : `<div class="empty">연결된 캡처 미디어가 없습니다.</div>`}</section></section>`;
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

function renderMcpPanel(data: ArtifactBrowserData): string {
	return `<section><h2>MCP 결과</h2>${renderMcpArtifactCards(data.mcpArtifacts)}</section>`;
}

function allClassificationCategories(data: ArtifactBrowserData): string[] {
	return sessionClassificationCategories(data.piUnits.flatMap((unit) => [...unit.piRestoredSessions, ...unit.piChatSessions]));
}

function renderClassificationOptions(data: ArtifactBrowserData): string {
	const categories = allClassificationCategories(data);
	return [`<option value="">모든 분류</option>`, `<option value="__none__">분류 없음</option>`, ...categories.map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`)].join("");
}

function renderSessionClassificationCategoryOptions(): string {
	return [
		`<option value="">분류 선택</option>`,
		...SESSION_CLASSIFICATION_CATEGORY_OPTIONS.map((category) => `<option value="${escapeAttr(category)}">${escapeHtml(category)}</option>`),
		`<option value="__custom__">직접 입력...</option>`,
	].join("");
}

function totalSessionCandidates(data: ArtifactBrowserData): number {
	return data.piUnits.reduce((sum, unit) => sum + unit.piRestoredSessions.length + unit.piChatSessions.length + unit.originalConductorSessionPaths.length, 0)
		+ data.conductors.reduce((sum, conductor) => sum + conductor.sourceSessionPaths.length, 0);
}

function renderSessionSearchPlaceholder(data: ArtifactBrowserData): string {
	const total = totalSessionCandidates(data);
	return `<section class="card"><div class="kicker">대화 내용 검색 준비</div><h2>대화 내용 검색</h2><p class="muted">지금 상단 검색은 카드 metadata(제목, workspace, tag, ticket)만 좁히는 필터입니다. 실제 user/assistant 대화 본문 검색은 다음 단계에서 이 탭에 붙입니다.</p><div class="meta"><span class="badge">후보 세션 ${total}</span><span class="badge">JSONL 본문 검색 예정</span><span class="badge">검색 결과 → 세션 복구 예정</span></div><ul><li>검색어 예: 부트스트랩, verify-report, worktree fork</li><li>결과에는 matching snippet과 세션/패널/cwd를 함께 표시합니다.</li><li>결과 액션은 보기, 현재 패널로 이어가기, 새 패널로 열기를 목표로 둡니다.</li></ul></section>`;
}

function buildArtifactBrowserHtml(data: ArtifactBrowserData, cwd: string): string {
	const initialTab = data.piUnits.length ? "pi" : data.conductors.length ? "conductors" : data.webSearches.length ? "web-search" : data.mcpArtifacts.length ? "mcp" : "reports";
	return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>pilee Artifact Browser</title>${artifactBrowserStyle()}</head><body><main class="shell"><header class="hero"><div class="kicker">🗂️ pilee Artifact Browser</div><h1>산출물 다시 보기</h1><p>Pi 작업 이력, Conductor master 이력, 웹 검색 review, MCP digest artifact를 상위 단위로 분리해서 봅니다.</p><div class="meta"><span class="badge">cwd ${escapeHtml(cwd)}</span><span class="badge">generated ${escapeHtml(data.generatedAt.toLocaleString())}</span></div></header><div class="filters"><input id="search" class="search" type="search" placeholder="카드 검색: 제목, 티켓, workspace, tag만 검색 (대화 내용 제외)" oninput="filterCards()"><select id="categoryFilter" class="category-filter" onchange="filterCards()">${renderClassificationOptions(data)}</select><button class="button search-mode-button" type="button" onclick="showTab('session-search')">대화 내용 검색 준비</button></div><nav class="tabs"><button class="tab" data-tab="pi" onclick="showTab('pi')">Pi 이력 <strong>${data.piUnits.length}</strong></button><button class="tab" data-tab="conductors" onclick="showTab('conductors')">컨덕터 이력 <strong>${data.conductors.length}</strong></button><button class="tab" data-tab="session-search" onclick="showTab('session-search')">대화 내용 검색 <strong>준비</strong></button><button class="tab" data-tab="web-search" onclick="showTab('web-search')">웹 검색 <strong>${data.webSearches.length}</strong></button><button class="tab" data-tab="mcp" onclick="showTab('mcp')">MCP <strong>${data.mcpArtifacts.length}</strong></button><button class="tab" data-tab="reports" onclick="showTab('reports')">검증 리포트 <strong>${data.reports.length}</strong></button><button class="tab" data-tab="planning" onclick="showTab('planning')">기획 / Frame <strong>${data.planningDocs.length}</strong></button><button class="tab" data-tab="captures" onclick="showTab('captures')">캡처 / 미디어 <strong>${data.captures.length}</strong></button></nav><section id="tab-pi" class="panel">${renderPiWorkUnitCards(data)}</section><section id="tab-conductors" class="panel">${renderConductorCards(data)}</section><section id="tab-session-search" class="panel">${renderSessionSearchPlaceholder(data)}</section><section id="tab-web-search" class="panel">${renderWebSearchPanel(data)}</section><section id="tab-mcp" class="panel">${renderMcpPanel(data)}</section><section id="tab-reports" class="panel">${renderReportCards(data.reports)}</section><section id="tab-planning" class="panel">${renderPlanningDocCards(data.planningDocs)}</section><section id="tab-captures" class="panel">${renderCaptureCards(data.captures, data.frames)}</section></main><div id="classificationModal" class="modal" hidden><div class="modal-card"><header><div><div class="kicker">Session classification</div><h2>대화 분류</h2><p class="muted" id="classificationPath"></p></div><button class="button" type="button" id="classificationClose">닫기</button></header><label>제목<input id="classificationTitle" type="text" placeholder="세션 제목"></label><label>분류<select id="classificationCategorySelect">${renderSessionClassificationCategoryOptions()}</select><input id="classificationCategoryCustom" type="text" placeholder="직접 입력할 분류" hidden><span class="field-help">1차 보관함입니다. /archive 상단 필터와 카드 그룹핑에 사용됩니다.</span></label><label>태그 / 검색 키워드<input id="classificationTags" type="text" placeholder="쉼표로 구분: tft-studio, ui-ux, verify-report"><span class="field-help">같은 분류 안에서 나중에 찾기 위한 보조 키워드입니다.</span></label><label>요약<textarea id="classificationSummary" rows="4" placeholder="나중에 찾기 위한 짧은 요약"></textarea></label><label>세그먼트 JSON<textarea id="classificationSegments" rows="10" placeholder="AI 추천 세그먼트를 JSON 배열로 저장합니다"></textarea></label><p class="muted" id="classificationStatus">원본 세션 JSONL은 수정하지 않고 sidecar metadata만 저장합니다.</p><div class="actions"><button class="button" type="button" id="classificationSuggest">AI 세그먼트 추천</button><button class="button" type="button" id="classificationSave">저장</button></div></div></div><script>
${webviewCopyScript()}
(function(){
	function qs(selector, root=document){ return root.querySelector(selector); }
	function qsa(selector, root=document){ return Array.from(root.querySelectorAll(selector)); }
	function hashParams(){ return new URLSearchParams((window.location.hash || '').replace(/^#/, '')); }
	function writeBrowserState(state){
		const params = new URLSearchParams();
		if (state.tab) params.set('tab', state.tab);
		if (state.pi) params.set('pi', state.pi);
		if (state.conductor) params.set('conductor', state.conductor);
		if (state.capture) params.set('capture', state.capture);
		const hash = params.toString();
		window.history.replaceState(null, '', window.location.pathname + window.location.search + (hash ? '#' + hash : ''));
	}
	function currentReturnPath(){ return window.location.pathname + window.location.search + (window.location.hash || ''); }
	window.showTab = function(tab, opts){
		qsa('.tab').forEach((btn) => btn.classList.toggle('active', btn.dataset.tab === tab));
		qsa('.panel').forEach((panel) => panel.classList.toggle('active', panel.id === 'tab-' + tab));
		const search = qs('#search'); if (search) search.value = '';
		filterCards();
		if (!(opts && opts.skipState)) writeBrowserState({ tab: tab });
	};
	window.filterCards = function(){
		const query = (qs('#search')?.value || '').toLowerCase().trim();
		const category = qs('#categoryFilter')?.value || '';
		qsa('.panel.active .searchable').forEach((card) => {
			const matchesQuery = !query || (card.dataset.search || '').includes(query);
			const categories = (card.dataset.category || '').split('|').filter(Boolean);
			const matchesCategory = !category || (category === '__none__' ? categories.length === 0 : categories.includes(category));
			card.style.display = matchesQuery && matchesCategory ? '' : 'none';
		});
	};
	window.showCaptureGroups = function(opts){
		const groups = qs('#capture-groups'); const files = qs('#capture-files');
		if (groups) groups.hidden = false; if (files) files.hidden = true;
		qsa('.capture-group-panel').forEach((panel) => panel.hidden = true);
		if (!(opts && opts.skipState)) writeBrowserState({ tab: 'captures' });
	};
	window.showCaptureGroup = function(key, opts){
		const groups = qs('#capture-groups'); const files = qs('#capture-files');
		if (groups) groups.hidden = true; if (files) files.hidden = false;
		qsa('.capture-group-panel').forEach((panel) => panel.hidden = panel.dataset.groupPanel !== key);
		if (!(opts && opts.skipState)) writeBrowserState({ tab: 'captures', capture: key });
	};
	window.showPiGroups = function(opts){
		const groups = qs('#pi-groups'); const details = qs('#pi-details');
		if (groups) groups.hidden = false; if (details) details.hidden = true;
		qsa('.pi-detail-panel').forEach((panel) => panel.hidden = true);
		if (!(opts && opts.skipState)) writeBrowserState({ tab: 'pi' });
	};
	window.showPiDetail = function(key, opts){
		const groups = qs('#pi-groups'); const details = qs('#pi-details');
		if (groups) groups.hidden = true; if (details) details.hidden = false;
		qsa('.pi-detail-panel').forEach((panel) => panel.hidden = panel.dataset.piPanel !== key);
		if (!(opts && opts.skipState)) writeBrowserState({ tab: 'pi', pi: key });
	};
	window.showConductorGroups = function(opts){
		const groups = qs('#conductor-groups'); const details = qs('#conductor-details');
		if (groups) groups.hidden = false; if (details) details.hidden = true;
		qsa('.conductor-detail-panel').forEach((panel) => panel.hidden = true);
		if (!(opts && opts.skipState)) writeBrowserState({ tab: 'conductors' });
	};
	window.showConductorDetail = function(key, opts){
		const groups = qs('#conductor-groups'); const details = qs('#conductor-details');
		if (groups) groups.hidden = true; if (details) details.hidden = false;
		qsa('.conductor-detail-panel').forEach((panel) => panel.hidden = panel.dataset.conductorPanel !== key);
		if (!(opts && opts.skipState)) writeBrowserState({ tab: 'conductors', conductor: key });
	};
	async function requestResumeTft(button){
		const path = button.dataset.path;
		if (!path) return;
		const previous = button.textContent;
		button.disabled = true;
		button.textContent = '이어가는 중...';
		try {
			const response = await fetch('/resume-tft?path=' + encodeURIComponent(path), { method: 'POST' });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok || !payload.ok) throw new Error(payload.error || 'resume failed');
			button.textContent = payload.reactivated ? '질문 활성화됨' : 'Studio 열림';
			setTimeout(() => { button.textContent = previous; button.disabled = false; }, 1600);
		} catch (error) {
			button.textContent = '이어하기 실패';
			button.title = String(error && error.message || error);
			setTimeout(() => { button.textContent = previous; button.disabled = false; }, 2400);
		}
	}
	async function requestOpen(button){
		const path = button.dataset.path;
		const target = button.dataset.target || 'glimpse';
		if (!path) return;
		const previous = button.textContent;
		button.disabled = true;
		button.textContent = target === 'browser' ? '브라우저 여는 중...' : 'Glimpse 여는 중...';
		try {
			const response = await fetch('/open?target=' + encodeURIComponent(target) + '&path=' + encodeURIComponent(path) + '&return=' + encodeURIComponent(currentReturnPath()), { method: 'POST' });
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
	let classificationPath = '';
	function setClassificationStatus(text){ const el = qs('#classificationStatus'); if (el) el.textContent = text; }
	function classificationCategoryPresets(){ return Array.from(qs('#classificationCategorySelect').options).map((option) => option.value).filter((value) => value && value !== '__custom__'); }
	function syncClassificationCategoryCustom(){
		const select = qs('#classificationCategorySelect');
		const custom = qs('#classificationCategoryCustom');
		custom.hidden = select.value !== '__custom__';
		if (!custom.hidden) custom.focus();
	}
	function setClassificationCategory(category){
		const select = qs('#classificationCategorySelect');
		const custom = qs('#classificationCategoryCustom');
		const value = category || '';
		if (!value) { select.value = ''; custom.value = ''; }
		else if (classificationCategoryPresets().includes(value)) { select.value = value; custom.value = ''; }
		else { select.value = '__custom__'; custom.value = value; }
		syncClassificationCategoryCustom();
	}
	function readClassificationCategory(){
		const selectValue = qs('#classificationCategorySelect').value;
		return (selectValue === '__custom__' ? qs('#classificationCategoryCustom').value : selectValue).trim();
	}
	function fillClassificationForm(item){
		qs('#classificationTitle').value = item?.title || '';
		setClassificationCategory(item?.category || '');
		qs('#classificationTags').value = Array.isArray(item?.tags) ? item.tags.join(', ') : '';
		qs('#classificationSummary').value = item?.summary || '';
		qs('#classificationSegments').value = JSON.stringify(Array.isArray(item?.segments) ? item.segments : [], null, 2);
	}
	function readClassificationForm(){
		let segments = [];
		const rawSegments = qs('#classificationSegments').value.trim();
		if (rawSegments) segments = JSON.parse(rawSegments);
		return {
			title: qs('#classificationTitle').value.trim(),
			category: readClassificationCategory(),
			tags: qs('#classificationTags').value.split(/[,#]/).map((item) => item.trim()).filter(Boolean),
			summary: qs('#classificationSummary').value.trim(),
			segments,
			source: 'user'
		};
	}
	async function openClassification(path){
		classificationPath = path;
		qs('#classificationPath').textContent = path;
		qs('#classificationModal').hidden = false;
		fillClassificationForm(null);
		setClassificationStatus('분류 metadata를 불러오는 중...');
		try {
			const response = await fetch('/classification?path=' + encodeURIComponent(path));
			const payload = await response.json().catch(() => ({}));
			if (!response.ok || !payload.ok) throw new Error(payload.error || 'classification load failed');
			fillClassificationForm(payload.classification || null);
			setClassificationStatus(payload.classification ? '저장된 분류를 불러왔습니다.' : '아직 저장된 분류가 없습니다. 직접 입력하거나 AI 추천을 사용하세요.');
		} catch (error) { setClassificationStatus('분류 로드 실패: ' + String(error && error.message || error)); }
	}
	async function suggestClassification(){
		if (!classificationPath) return;
		const button = qs('#classificationSuggest'); const previous = button.textContent;
		button.disabled = true; button.textContent = 'AI 추천 중...'; setClassificationStatus('세션 대화를 읽고 구간을 추천하는 중...');
		try {
			const response = await fetch('/classification/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: classificationPath }) });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok || !payload.ok) throw new Error(payload.error || 'suggest failed');
			fillClassificationForm(payload.classification || null);
			setClassificationStatus(payload.fallbackUsed ? 'AI 추천을 만들지 못해 deterministic fallback을 채웠습니다: ' + (payload.fallbackReason || '') : 'AI 추천을 채웠습니다. 확인 후 저장하세요. model=' + (payload.model || 'unknown'));
		} catch (error) { setClassificationStatus('AI 추천 실패: ' + String(error && error.message || error)); }
		finally { button.disabled = false; button.textContent = previous; }
	}
	async function saveClassification(){
		if (!classificationPath) return;
		const button = qs('#classificationSave'); const previous = button.textContent;
		button.disabled = true; button.textContent = '저장 중...';
		try {
			const classification = readClassificationForm();
			const response = await fetch('/classification', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: classificationPath, classification }) });
			const payload = await response.json().catch(() => ({}));
			if (!response.ok || !payload.ok) throw new Error(payload.error || 'save failed');
			setClassificationStatus('저장했습니다. 목록을 새로고침합니다...');
			setTimeout(() => window.location.reload(), 500);
		} catch (error) { setClassificationStatus('저장 실패: ' + String(error && error.message || error)); }
		finally { button.disabled = false; button.textContent = previous; }
	}
	document.addEventListener('change', (event) => {
		const target = event.target;
		if (target instanceof HTMLElement && target.id === 'classificationCategorySelect') syncClassificationCategoryCustom();
	});
	document.addEventListener('click', (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const resumer = target.closest('.resume-tft');
		if (resumer) { requestResumeTft(resumer); return; }
		const opener = target.closest('.open-artifact');
		if (opener) { requestOpen(opener); return; }
		const capture = target.closest('.open-capture-group');
		if (capture) { showCaptureGroup(capture.dataset.group || ''); return; }
		const pi = target.closest('.open-pi-detail');
		if (pi) { showPiDetail(pi.dataset.pi || ''); return; }
		const conductor = target.closest('.open-conductor-detail');
		if (conductor) { showConductorDetail(conductor.dataset.conductor || ''); return; }
		const classifier = target.closest('.classify-session');
		if (classifier) { openClassification(classifier.dataset.path || ''); return; }
		if (target.id === 'classificationClose') { qs('#classificationModal').hidden = true; return; }
		if (target.id === 'classificationSuggest') { suggestClassification(); return; }
		if (target.id === 'classificationSave') { saveClassification(); return; }
	});
	function restoreFromHash(){
		const params = hashParams();
		const tab = params.get('tab') || '${initialTab}';
		showTab(tab, { skipState: true });
		const pi = params.get('pi');
		const conductor = params.get('conductor');
		const capture = params.get('capture');
		if (tab === 'pi' && pi) showPiDetail(pi, { skipState: true });
		else if (tab === 'pi') showPiGroups({ skipState: true });
		if (tab === 'conductors' && conductor) showConductorDetail(conductor, { skipState: true });
		else if (tab === 'conductors') showConductorGroups({ skipState: true });
		if (tab === 'captures' && capture) showCaptureGroup(capture, { skipState: true });
		else if (tab === 'captures') showCaptureGroups({ skipState: true });
	}
	if (window.location.hash) restoreFromHash(); else showTab('${initialTab}');
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
				mode = await openHtmlArtifact(pi, resolved, false, ctx);
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
	if (typeof valueFromRecord(event.details, "artifactPath") === "string") return;

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
