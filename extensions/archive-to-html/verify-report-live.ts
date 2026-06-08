import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, copyFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { homedir, platform } from "node:os";
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { openCompanionUrl } from "../utils/companion-window.ts";
import type { GlimpseWindow } from "../utils/glimpse.ts";
import { webviewCopyCss, webviewCopyScript } from "../utils/webview-copy.ts";

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
type ReportLintSeverity = "gap" | "warning";

interface ReportLintWarning {
	severity: ReportLintSeverity;
	itemId?: string;
	title: string;
	detail: string;
}

interface Evidence {
	label?: string;
	kind?: EvidenceKind;
	path?: string;
	url?: string;
	text?: string;
	purpose?: string;
	inspectFor?: string[] | string;
	expected?: string;
	observed?: string;
	role?: string;
	relatedItem?: string;
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
	lintWarnings?: ReportLintWarning[];
	createdAt: number;
	updatedAt: number;
	items: ReportItem[];
	logs: Array<{ time: number; message: string }>;
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

const evidenceSchema = Type.Object({
	label: Type.Optional(Type.String()),
	kind: Type.Optional(Type.String({ description: "image|gif|json|text|network|console|diff|link" })),
	path: Type.Optional(Type.String({ description: "Local evidence file path, relative to cwd or absolute." })),
	url: Type.Optional(Type.String({ description: "Remote evidence URL." })),
	text: Type.Optional(Type.String({ description: "Inline evidence text or short excerpt." })),
	purpose: Type.Optional(Type.String({ description: "Why this evidence was collected." })),
	inspectFor: Type.Optional(Type.Union([Type.Array(Type.String()), Type.String()], { description: "What a reviewer should inspect in this evidence." })),
	expected: Type.Optional(Type.String({ description: "Expected result this evidence should prove." })),
	observed: Type.Optional(Type.String({ description: "Observed result in this evidence." })),
	role: Type.Optional(Type.String({ description: "primary|supporting|raw or similar evidence role." })),
	relatedItem: Type.Optional(Type.String({ description: "Related verification item / success criterion id." })),
});

const itemSchema = Type.Object({
	id: Type.String({ description: "Stable item id, e.g. V1 or A1." }),
	title: Type.String({ description: "Verification criterion/title." }),
	type: Type.Optional(Type.String({ description: "UI_CAPTURE|NETWORK|CONSOLE|CODE_DIFF|BE|SKIP" })),
	status: Type.Optional(Type.String({ description: "pending|running|pass|fail|skip|blocked|unverified" })),
	detail: Type.Optional(Type.String({ description: "What was checked and what happened." })),
	evidence: Type.Optional(Type.Array(evidenceSchema)),
});

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function renderEscapedTextWithLinks(value: string): string {
	const urlPattern = /https?:\/\/[^\s<>"]+/g;
	let html = "";
	let lastIndex = 0;
	for (const match of value.matchAll(urlPattern)) {
		const rawUrl = match[0] ?? "";
		const index = match.index ?? 0;
		const trailing = rawUrl.match(/[),.;:!?]+$/)?.[0] ?? "";
		const url = trailing ? rawUrl.slice(0, -trailing.length) : rawUrl;
		html += escapeHtml(value.slice(lastIndex, index));
		html += `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(url)}</a>${escapeHtml(trailing)}`;
		lastIndex = index + rawUrl.length;
	}
	html += escapeHtml(value.slice(lastIndex));
	return html;
}

function renderInlineRichText(value: string): string {
	const parts = value.split(/(`[^`]*`)/g);
	return parts.map((part) => {
		if (part.startsWith("`") && part.endsWith("`") && part.length >= 2) {
			return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
		}
		return renderEscapedTextWithLinks(part);
	}).join("");
}

function splitDetailSentences(value: string): string[] {
	return value
		.replace(/\s+/g, " ")
		.trim()
		.split(/(?<=[.!?。])\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
}

function renderDetailHtml(value?: string): string {
	const trimmed = value?.trim();
	if (!trimmed) return "";
	const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	if (lines.length > 1) {
		let listItems: string[] = [];
		let html = "";
		const flushList = () => {
			if (!listItems.length) return;
			html += `<ul class="detail-list">${listItems.join("")}</ul>`;
			listItems = [];
		};
		for (const line of lines) {
			const bullet = line.match(/^[-*•]\s+(.*)$/);
			if (bullet) {
				listItems.push(`<li>${renderInlineRichText(bullet[1] ?? "")}</li>`);
				continue;
			}
			flushList();
			html += `<p>${renderInlineRichText(line)}</p>`;
		}
		flushList();
		return `<div class="detail detail-readable">${html}</div>`;
	}
	const sentences = splitDetailSentences(trimmed);
	if (trimmed.length >= 180 && sentences.length >= 2) {
		return `<div class="detail detail-readable"><ul class="detail-list">${sentences.map((sentence) => `<li>${renderInlineRichText(sentence)}</li>`).join("")}</ul></div>`;
	}
	return `<p class="detail">${renderInlineRichText(trimmed)}</p>`;
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

function isPathInside(filePath: string, rootDir: string): boolean {
	const rel = relative(resolve(rootDir), resolve(filePath));
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function isPathAllowed(filePath: string, state: VerifyReportState): boolean {
	const resolved = resolve(filePath);
	const roots = [resolve(state.cwd), resolve(state.capturesDir)];
	return roots.some((root) => isPathInside(resolved, root));
}

function evidenceWithNormalizedPath(evidence: Evidence, state: VerifyReportState): Evidence {
	if (!evidence.path) return evidence;
	return { ...evidence, path: normalizeLocalPath(evidence.path, state.cwd) };
}

function safeAssetName(value: string): string {
	return value.replace(/[^a-zA-Z0-9가-힣._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 140) || `evidence-${randomUUID().slice(0, 8)}`;
}

function uniqueAssetPath(dir: string, desiredName: string, sourcePath: string): string {
	const parsed = extname(desiredName) ? { stem: desiredName.slice(0, -extname(desiredName).length), ext: extname(desiredName) } : { stem: desiredName, ext: "" };
	for (let i = 0; i < 100; i += 1) {
		const suffix = i === 0 ? "" : `-${i + 1}`;
		const candidate = join(dir, `${parsed.stem}${suffix}${parsed.ext}`);
		try {
			if (existsSync(candidate) && resolve(candidate) === resolve(sourcePath)) return candidate;
			if (!existsSync(candidate)) return candidate;
		} catch {
			if (!existsSync(candidate)) return candidate;
		}
	}
	return join(dir, `${parsed.stem}-${randomUUID().slice(0, 8)}${parsed.ext}`);
}

function materializeEvidenceAsset(evidence: Evidence, state: VerifyReportState): Evidence {
	if (!evidence.path) return evidence;
	const normalized = evidenceWithNormalizedPath(evidence, state);
	if (!normalized.path || !existsSync(normalized.path)) return normalized;
	if (isPathInside(normalized.path, state.capturesDir)) return normalized;
	mkdirSync(state.capturesDir, { recursive: true });
	const dest = uniqueAssetPath(state.capturesDir, safeAssetName(basename(normalized.path)), normalized.path);
	if (!existsSync(dest)) copyFileSync(normalized.path, dest);
	return { ...normalized, path: dest };
}

function materializeEvidenceAssets(state: VerifyReportState): void {
	state.items = state.items.map((item) => ({
		...item,
		evidence: item.evidence.map((evidence) => materializeEvidenceAsset(evidence, state)),
	}));
}

function inlineReportImageAssets(html: string, htmlDir: string): string {
	return html.replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (match, prefix, src, suffix) => {
		if (/^(https?:|data:|blob:)/i.test(src)) return match;
		const assetPath = isAbsolute(src) ? src : resolve(htmlDir, src);
		if (!existsSync(assetPath)) return match;
		const data = readFileSync(assetPath).toString("base64");
		return `${prefix}data:${mimeFor(assetPath)};base64,${data}${suffix}`;
	});
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
		lintWarnings: state.lintWarnings ?? [],
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

async function openUrlInBrowser(pi: ExtensionAPI, url: string): Promise<void> {
	const plat = platform();
	const result = plat === "darwin"
		? await pi.exec("open", [url])
		: plat === "win32"
			? await pi.exec("cmd", ["/c", "start", "", url])
			: await pi.exec("xdg-open", [url]);
	if (result.code !== 0) throw new Error(result.stderr || `Failed to open browser (${result.code})`);
}

async function openLivePreview(pi: ExtensionAPI, ctx: ExtensionContext, handle: LiveHandle): Promise<"glimpse" | "browser" | "none"> {
	const companion = await openCompanionUrl(pi, ctx, handle.state.url, handle.state.title, { width: 1180, height: 920 });
	if (companion.window) {
		handle.window = companion.window;
		companion.window.on("closed", () => {
			handle.window = undefined;
		});
		return "glimpse";
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

interface ImageDimensions {
	width: number;
	height: number;
}

function readImageDimensions(filePath: string): ImageDimensions | null {
	try {
		const buffer = readFileSync(filePath);
		if (buffer.length >= 24 && buffer.toString("ascii", 1, 4) === "PNG") {
			return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
		}
		if (buffer.length >= 10 && buffer.toString("ascii", 0, 3) === "GIF") {
			return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
		}
		if (buffer.length >= 12 && buffer[0] === 0xff && buffer[1] === 0xd8) {
			let offset = 2;
			while (offset + 9 < buffer.length) {
				if (buffer[offset] !== 0xff) {
					offset += 1;
					continue;
				}
				const marker = buffer[offset + 1];
				const length = buffer.readUInt16BE(offset + 2);
				if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
					return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
				}
				offset += 2 + length;
			}
		}
		if (buffer.length >= 30 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
			const chunk = buffer.toString("ascii", 12, 16);
			if (chunk === "VP8X") {
				return {
					width: 1 + buffer.readUIntLE(24, 3),
					height: 1 + buffer.readUIntLE(27, 3),
				};
			}
			if (chunk === "VP8 " && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) {
				return {
					width: buffer.readUInt16LE(26) & 0x3fff,
					height: buffer.readUInt16LE(28) & 0x3fff,
				};
			}
			if (chunk === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
				const b0 = buffer[21];
				const b1 = buffer[22];
				const b2 = buffer[23];
				const b3 = buffer[24];
				return {
					width: 1 + (((b1 & 0x3f) << 8) | b0),
					height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
				};
			}
		}
	} catch {}
	return null;
}

function isTallEvidence(dimensions: ImageDimensions | null): boolean {
	if (!dimensions) return false;
	const ratio = dimensions.height / Math.max(dimensions.width, 1);
	return dimensions.height >= 1600 || (dimensions.height >= 1200 && ratio >= 2.4);
}

function imageDimensionLabel(dimensions: ImageDimensions | null): string {
	return dimensions ? ` · ${dimensions.width}×${dimensions.height}` : "";
}

const MOTION_CLAIM_TERMS = [
	"이동", "전환", "흐름", "플로우", "클릭", "열림", "닫힘", "열고", "닫고", "스무스", "부드럽", "끊김", "이어", "도달", "launch", "transition", "flow", "click", "open", "close", "smooth", "continuity", "navigation",
];

const SETUP_NOISE_TERMS = [
	"로그인", "login", "빌드", "build", "metro", "pod", "pods", "env", "환경변수", "codegen", "부트스트랩", "bootstrap", "dependency", "dependencies", "install", "설치", "dev server", "개발 서버", "서버 시작", "server start",
];

function searchableItemText(item: ReportItem): string {
	return [
		item.id,
		item.title,
		item.type,
		item.detail,
		...item.evidence.flatMap((evidence) => [evidence.label, evidence.purpose, evidence.expected, evidence.observed, Array.isArray(evidence.inspectFor) ? evidence.inspectFor.join(" ") : evidence.inspectFor]),
	].filter(Boolean).join(" ").toLowerCase();
}

function includesTerm(text: string, terms: string[]): boolean {
	return terms.some((term) => text.includes(term.toLowerCase()));
}

function isMotionUiClaim(item: ReportItem): boolean {
	if ((item.type ?? "").toUpperCase() !== "UI_CAPTURE") return false;
	return includesTerm(searchableItemText(item), MOTION_CLAIM_TERMS);
}

function evidenceRole(evidence: Evidence): string {
	return (evidence.role ?? "").toLowerCase();
}

function hasPrimaryEvidenceKind(item: ReportItem, kind: EvidenceKind): boolean {
	return item.evidence.some((evidence) => evidenceRole(evidence) === "primary" && evidenceKind(evidence) === kind);
}

function hasSupportingImage(item: ReportItem): boolean {
	return item.evidence.some((evidence) => evidenceKind(evidence) === "image" && evidenceRole(evidence) !== "primary");
}

function evidenceIntentMissing(evidence: Evidence): boolean {
	return !evidence.purpose || !evidence.expected || !evidence.observed || !evidence.inspectFor || !evidence.role;
}

function pushLintWarning(warnings: ReportLintWarning[], warning: ReportLintWarning): void {
	const key = `${warning.severity}:${warning.itemId ?? ""}:${warning.title}:${warning.detail}`;
	if (warnings.some((existing) => `${existing.severity}:${existing.itemId ?? ""}:${existing.title}:${existing.detail}` === key)) return;
	warnings.push(warning);
}

export function lintVerifyReport(state: VerifyReportState): ReportLintWarning[] {
	const warnings: ReportLintWarning[] = [];
	for (const item of state.items) {
		if (item.status !== "pass") continue;
		const text = searchableItemText(item);
		if (isMotionUiClaim(item) && !hasPrimaryEvidenceKind(item, "gif")) {
			pushLintWarning(warnings, {
				severity: "gap",
				itemId: item.id,
				title: "Motion claim에 GIF primary evidence가 없습니다",
				detail: "이동/전환/클릭/스무스함/도달 같은 흐름 claim은 정적 PNG만으로 PASS 처리하지 말고 GIF/짧은 영상 primary evidence로 닫아야 합니다.",
			});
		}
		if (isMotionUiClaim(item) && hasPrimaryEvidenceKind(item, "gif") && !hasSupportingImage(item)) {
			pushLintWarning(warnings, {
				severity: "warning",
				itemId: item.id,
				title: "GIF primary에는 대표 PNG/crop 보조 증거를 함께 두세요",
				detail: "GIF는 흐름을 닫고, 대표 PNG/crop은 최종 상태를 선명하게 확인하게 합니다. 가능하면 같은 item 안에 supporting image를 추가하세요.",
			});
		}
		if (includesTerm(text, SETUP_NOISE_TERMS)) {
			pushLintWarning(warnings, {
				severity: "warning",
				itemId: item.id,
				title: "setup/bootstrap noise가 PASS 항목에 섞였을 수 있습니다",
				detail: "로그인/빌드/Metro/pod/env/codegen/부트스트랩은 검증 대상 자체이거나 blocked 사유일 때만 report item으로 남기고, 에이전트가 검증 전 헤맨 준비 과정은 내부 로그로만 두세요.",
			});
		}
		for (const evidence of item.evidence) {
			const kind = evidenceKind(evidence);
			if (evidenceRole(evidence) === "primary" && kind === "image" && evidence.path && isTallEvidence(readImageDimensions(evidence.path))) {
				pushLintWarning(warnings, {
					severity: "warning",
					itemId: item.id,
					title: "긴 이미지는 primary evidence로 적합하지 않습니다",
					detail: "세로로 긴/full-page 이미지는 supporting/toggle로 두고, 검증 지점이 보이는 crop 또는 flow GIF를 primary로 사용하세요.",
				});
			}
			if (evidenceIntentMissing(evidence)) {
				pushLintWarning(warnings, {
					severity: "warning",
					itemId: item.id,
					title: "evidence intent metadata가 부족합니다",
					detail: "각 evidence에는 purpose, inspectFor, expected, observed, role, relatedItem을 가능한 한 채워 raw artifact가 나중에도 읽히게 해야 합니다.",
				});
			}
		}
	}
	return warnings;
}

function renderImageFigure(evidence: Evidence, state: VerifyReportState, label: string, dimensions: ImageDimensions | null): string {
	const src = relativeEvidencePath(evidence, state) ?? evidence.path ?? "";
	return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)} · ${escapeHtml(basename(evidence.path ?? src))}${escapeHtml(imageDimensionLabel(dimensions))}</figcaption></figure>`;
}

function renderEvidenceIntentStatic(evidence: Evidence): string {
	const inspect = Array.isArray(evidence.inspectFor) ? evidence.inspectFor.filter(Boolean) : typeof evidence.inspectFor === "string" ? [evidence.inspectFor] : [];
	const rows = [
		evidence.relatedItem ? ["관련 기준", evidence.relatedItem] : undefined,
		evidence.role ? ["역할", evidence.role] : undefined,
		evidence.purpose ? ["왜 수집했나", evidence.purpose] : undefined,
		inspect.length ? ["봐야 할 것", inspect.join(" / ")] : undefined,
		evidence.expected ? ["기대 결과", evidence.expected] : undefined,
		evidence.observed ? ["실제 관찰", evidence.observed] : undefined,
	].filter(Boolean) as string[][];
	if (!rows.length) return "";
	return `<dl class="evidence-intent">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>`;
}

const RAW_EVIDENCE_INLINE_BYTES = 80_000;

function shouldRenderRawEvidenceDetails(evidence: Evidence, kind: EvidenceKind): boolean {
	if (evidence.url || ["image", "gif", "link"].includes(kind)) return false;
	if (evidence.role?.toLowerCase() === "raw") return true;
	if (["json", "network", "console", "diff"].includes(kind)) return true;
	return Boolean(evidence.path);
}

function renderRawEvidencePayload(evidence: Evidence, state: VerifyReportState): string {
	const pathLabel = evidence.path ? relativeEvidencePath(evidence, state) ?? evidence.path : null;
	const pathHtml = pathLabel ? `<div class="raw-evidence-path"><strong>파일</strong><code>${escapeHtml(pathLabel)}</code></div>` : "";
	if (evidence.text) return `${pathHtml}<pre><code>${escapeHtml(evidence.text)}</code></pre>`;
	if (!evidence.path) return `${pathHtml}<p class="raw-evidence-note">inline raw content가 없습니다.</p>`;
	try {
		const stats = statSync(evidence.path);
		if (stats.size > RAW_EVIDENCE_INLINE_BYTES) {
			return `${pathHtml}<p class="raw-evidence-note">파일이 커서 inline preview를 생략했습니다 (${Math.round(stats.size / 1024)}KB). 원본 파일을 열어 확인하세요.</p>`;
		}
		return `${pathHtml}<pre><code>${escapeHtml(readFileSync(evidence.path, "utf-8"))}</code></pre>`;
	} catch (error) {
		return `${pathHtml}<p class="raw-evidence-note">raw evidence를 읽을 수 없습니다: ${escapeHtml(error instanceof Error ? error.message : String(error))}</p>`;
	}
}

function renderRawEvidenceDetailsStatic(evidence: Evidence, state: VerifyReportState, kind: EvidenceKind, label: string): string {
	return `<details class="raw-evidence"><summary>Raw evidence — ${escapeHtml(label)} <span>${escapeHtml(kind)}</span></summary>${renderEvidenceIntentStatic(evidence)}${renderRawEvidencePayload(evidence, state)}</details>`;
}

function renderEvidenceStatic(evidence: Evidence, state: VerifyReportState): string {
	const kind = evidenceKind(evidence);
	const label = evidence.label || kind;
	let body = "";
	const rawDetails = shouldRenderRawEvidenceDetails(evidence, kind);
	if (evidence.url) body = `<a href="${escapeHtml(evidence.url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
	else if (evidence.path && ["image", "gif"].includes(kind)) {
		const dimensions = readImageDimensions(evidence.path);
		const figure = renderImageFigure(evidence, state, label, dimensions);
		body = isTallEvidence(dimensions)
			? `<details class="tall-evidence"><summary>긴/전체 페이지 캡처 보기 — ${escapeHtml(label)}${escapeHtml(imageDimensionLabel(dimensions))}</summary>${figure}</details>`
			: figure;
	} else if (rawDetails) body = renderRawEvidenceDetailsStatic(evidence, state, kind, label);
	else if (evidence.text) body = `<pre><code>${escapeHtml(evidence.text)}</code></pre>`;
	if (!body) return "";
	const normalizedRole = evidence.role?.replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
	const roleClass = normalizedRole ? ` evidence-role-${normalizedRole}` : "";
	const primaryImageClass = normalizedRole === "primary" && ["image", "gif"].includes(kind) ? " evidence-primary-image-card" : "";
	const layoutClass = rawDetails ? " evidence-raw-card" : primaryImageClass;
	return `<article class="evidence-card${roleClass}${layoutClass}"><div class="evidence-card-head"><strong>${escapeHtml(label)}</strong>${kind ? `<span>${escapeHtml(kind)}</span>` : ""}</div>${body}${rawDetails ? "" : renderEvidenceIntentStatic(evidence)}</article>`;
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
	${webviewCopyCss()}
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
	.detail { color:var(--detail); line-height:1.62; white-space:pre-wrap; }
	.detail-readable { white-space:normal; margin:14px 0; padding:13px 15px; border:1px solid var(--line); border-left:4px solid var(--accent); border-radius:13px; background:rgba(255,255,255,.58); }
	.detail-readable p { margin:0 0 9px; color:inherit; }
	.detail-readable p:last-child { margin-bottom:0; }
	.detail-list { margin:0; padding-left:1.15em; display:grid; gap:8px; }
	.detail-list li { padding-left:2px; }
	.gap-list { display:grid; gap:10px; margin-top:12px; }
	.gap-item { background:#fffbeb; border:1px solid #fbbf24; border-radius:12px; padding:12px 14px; color:#78350f; }
	.gap-item strong { display:block; color:#92400e; margin-bottom:5px; }
	.evidence { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap:12px; margin-top:12px; align-items:start; }
	.evidence-card { border:1px solid var(--line); border-radius:14px; background:var(--panel2); padding:12px; min-width:0; }
	.evidence-card.evidence-raw-card, .evidence-card.evidence-primary-image-card { grid-column:1 / -1; }
	.evidence-card.evidence-primary-image-card img { width:100%; height:auto; }
	.evidence-card-head { display:flex; justify-content:space-between; gap:8px; align-items:center; margin-bottom:8px; color:var(--detail); }
	.evidence-card-head span { color:var(--muted); font-size:11px; text-transform:uppercase; }
	.evidence-intent { display:grid; gap:7px; margin:10px 0 0; }
	.evidence-intent div { border-top:1px solid var(--line); padding-top:7px; }
	.evidence-intent dt { color:var(--muted); font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; }
	.evidence-intent dd { margin:2px 0 0; color:var(--detail); font-size:12px; line-height:1.45; }
	details.raw-evidence { border:1px solid var(--line); border-radius:12px; background:var(--panel); overflow:hidden; }
	details.raw-evidence summary { cursor:pointer; padding:10px 12px; color:var(--detail); font-weight:800; background:var(--panel2); }
	details.raw-evidence summary span { color:var(--muted); font-size:11px; text-transform:uppercase; margin-left:6px; }
	details.raw-evidence .evidence-intent { margin:10px 12px; }
	.raw-evidence-path { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin:10px 12px; color:var(--muted); font-size:12px; }
	.raw-evidence-note { margin:10px 12px; color:var(--muted); font-size:12px; }
	details.raw-evidence pre { margin:0; border-width:1px 0 0; border-radius:0; max-height:460px; }
	figure { margin:0; }
	img { display:block; max-width:100%; border:1px solid var(--line); border-radius:12px; background:var(--imageBg); }
	figcaption { color:var(--muted); font-size:12px; margin-top:6px; }
	details.tall-image { border:1px dashed var(--line); border-radius:12px; padding:10px 12px; background:var(--imageBg); }
	details.tall-image summary { cursor:pointer; color:var(--detail); font-weight:700; }
	details.tall-image figure { margin-top:10px; }
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
${webviewCopyScript()}
var state = ${JSON.stringify(initialState)};
function esc(v) { return String(v == null ? '' : v).replace(/[&<>\"]/g, function(ch) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]; }); }
function statusLabel(s) { return ({draft:'준비',running:'진행 중',done:'완료',aborted:'중단',pending:'대기',pass:'PASS',fail:'FAIL',skip:'SKIP',blocked:'BLOCKED',unverified:'미검증'})[s] || s; }
function count(status) { return (state.items || []).filter(function(i){ return i.status === status; }).length; }
function evKind(ev) { if (ev.kind) return ev.kind; if (ev.url) return 'link'; if (!ev.path) return 'text'; var p=ev.path.toLowerCase(); if (/\.(png|jpg|jpeg|webp|svg)$/.test(p)) return 'image'; if (/\.gif$/.test(p)) return 'gif'; if (/\.json$/.test(p)) return 'json'; return 'text'; }
function isTallImage(width, height) { var ratio = height / Math.max(width || 1, 1); return height >= 1600 || (height >= 1200 && ratio >= 2.4); }
function maybeCollapseTallImage(img) {
  var fig = img.closest('figure[data-auto-collapse]');
  if (!fig || fig.closest('details.tall-image') || !img.naturalHeight || !img.naturalWidth || !isTallImage(img.naturalWidth, img.naturalHeight)) return;
  var details = document.createElement('details');
  details.className = 'tall-image';
  var summary = document.createElement('summary');
  summary.textContent = '긴/전체 페이지 캡처 보기 — ' + (fig.getAttribute('data-label') || 'image') + ' · ' + img.naturalWidth + '×' + img.naturalHeight;
  details.appendChild(summary);
  fig.parentNode.insertBefore(details, fig);
  details.appendChild(fig);
}
function collapseTallImages() {
  document.querySelectorAll('figure[data-auto-collapse] img').forEach(function(img) {
    if (img.complete) maybeCollapseTallImage(img);
    else img.addEventListener('load', function() { maybeCollapseTallImage(img); }, { once: true });
  });
}
function evIntentHtml(ev) {
  var inspect = Array.isArray(ev.inspectFor) ? ev.inspectFor.filter(Boolean).join(' / ') : (typeof ev.inspectFor === 'string' ? ev.inspectFor : '');
  var rows = [
    ev.relatedItem && ['관련 기준', ev.relatedItem],
    ev.role && ['역할', ev.role],
    ev.purpose && ['왜 수집했나', ev.purpose],
    inspect && ['봐야 할 것', inspect],
    ev.expected && ['기대 결과', ev.expected],
    ev.observed && ['실제 관찰', ev.observed]
  ].filter(Boolean);
  if (!rows.length) return '';
  return '<dl class="evidence-intent">' + rows.map(function(row){ return '<div><dt>' + esc(row[0]) + '</dt><dd>' + esc(row[1]) + '</dd></div>'; }).join('') + '</dl>';
}
function shouldRawDetails(ev, kind) {
  if (ev.url || kind === 'image' || kind === 'gif' || kind === 'link') return false;
  if (String(ev.role || '').toLowerCase() === 'raw') return true;
  if (['json','network','console','diff'].indexOf(kind) >= 0) return true;
  return !!ev.path;
}
function rawDetailsHtml(ev, kind, label) {
  var path = ev.path ? '<div class="raw-evidence-path"><strong>파일</strong><code>' + esc(ev.path) + '</code></div>' : '';
  var payload = ev.text ? '<pre><code>' + esc(ev.text) + '</code></pre>' : (ev.path ? '<p class="raw-evidence-note">정적 report export에서 raw 파일 preview가 inline으로 포함됩니다. Live preview에서는 파일 경로와 intent metadata만 표시합니다.</p>' : '<p class="raw-evidence-note">inline raw content가 없습니다.</p>');
  return '<details class="raw-evidence"><summary>Raw evidence — ' + esc(label) + ' <span>' + esc(kind) + '</span></summary>' + evIntentHtml(ev) + path + payload + '</details>';
}
function evHtml(ev) {
  var kind = evKind(ev); var label = ev.label || kind; var body = ''; var raw = shouldRawDetails(ev, kind);
  if (ev.url) body = '<a href="' + esc(ev.url) + '" target="_blank" rel="noreferrer">' + esc(label) + '</a>';
  else if (ev.path && (kind === 'image' || kind === 'gif')) body = '<figure data-auto-collapse="true" data-label="' + esc(label) + '"><img src="/file?path=' + encodeURIComponent(ev.path) + '" alt="' + esc(label) + '" onload="maybeCollapseTallImage(this)"><figcaption>' + esc(label) + ' · ' + esc(ev.path.split('/').pop()) + '</figcaption></figure>';
  else if (raw) body = rawDetailsHtml(ev, kind, label);
  else if (ev.text) body = '<pre><code>' + esc(ev.text) + '</code></pre>';
  if (!body) return '';
  var role = String(ev.role || '').replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
  var roleClass = role ? ' evidence-role-' + role : '';
  var primaryImageClass = role === 'primary' && (kind === 'image' || kind === 'gif') ? ' evidence-primary-image-card' : '';
  return '<article class="evidence-card' + roleClass + (raw ? ' evidence-raw-card' : primaryImageClass) + '"><div class="evidence-card-head"><strong>' + esc(label) + '</strong><span>' + esc(kind) + '</span></div>' + body + (raw ? '' : evIntentHtml(ev)) + '</article>';
}
function escapedTextWithLinks(v) {
  var text = String(v == null ? '' : v);
  var re = /(https?:\\/\\/[^\\s<>"']+)/g;
  var html = '';
  var last = 0;
  var match;
  while ((match = re.exec(text))) {
    var raw = match[0] || '';
    var trailingMatch = raw.match(/[),.;:!?]+$/);
    var trailing = trailingMatch ? trailingMatch[0] : '';
    var url = trailing ? raw.slice(0, -trailing.length) : raw;
    html += esc(text.slice(last, match.index));
    html += '<a href="' + esc(url) + '" target="_blank" rel="noreferrer">' + esc(url) + '</a>' + esc(trailing);
    last = match.index + raw.length;
  }
  html += esc(text.slice(last));
  return html;
}
function inlineHtml(v) {
  var text = String(v == null ? '' : v);
  var out = '';
  var i = 0;
  while (i < text.length) {
    var start = text.indexOf('\`', i);
    if (start < 0) { out += escapedTextWithLinks(text.slice(i)); break; }
    var end = text.indexOf('\`', start + 1);
    if (end < 0) { out += escapedTextWithLinks(text.slice(i)); break; }
    out += escapedTextWithLinks(text.slice(i, start));
    out += '<code>' + esc(text.slice(start + 1, end)) + '</code>';
    i = end + 1;
  }
  return out;
}
function splitDetailSentences(v) {
  return String(v == null ? '' : v).replace(/\\s+/g, ' ').trim().split(/(?<=[.!?。])\\s+/).map(function(part){ return part.trim(); }).filter(Boolean);
}
function detailHtml(v) {
  var trimmed = String(v == null ? '' : v).trim();
  if (!trimmed) return '';
  var lines = trimmed.split(/\\r?\\n/).map(function(line){ return line.trim(); }).filter(Boolean);
  if (lines.length > 1) {
    var html = '';
    var list = [];
    var flush = function(){ if (!list.length) return; html += '<ul class="detail-list">' + list.join('') + '</ul>'; list = []; };
    lines.forEach(function(line){
      var bullet = line.match(/^[-*•]\\s+(.*)$/);
      if (bullet) { list.push('<li>' + inlineHtml(bullet[1] || '') + '</li>'); return; }
      flush();
      html += '<p>' + inlineHtml(line) + '</p>';
    });
    flush();
    return '<div class="detail detail-readable">' + html + '</div>';
  }
  var sentences = splitDetailSentences(trimmed);
  if (trimmed.length >= 180 && sentences.length >= 2) {
    return '<div class="detail detail-readable"><ul class="detail-list">' + sentences.map(function(sentence){ return '<li>' + inlineHtml(sentence) + '</li>'; }).join('') + '</ul></div>';
  }
  return '<p class="detail">' + inlineHtml(trimmed) + '</p>';
}
function lintWarningsHtml() {
  var warnings = state.lintWarnings || [];
  if (!warnings.length) return '';
  return '<section class="summary"><h2>🧭 Report Lint</h2><p class="detail">flow evidence와 setup noise를 확정 전에 다시 보는 자동 점검입니다.</p><div class="gap-list">' + warnings.map(function(w){ return '<div class="gap-item"><strong>' + esc(String(w.severity || 'warning').toUpperCase()) + (w.itemId ? ' · ' + esc(w.itemId) : '') + ' · ' + esc(w.title || '') + '</strong>' + detailHtml(w.detail || '') + '</div>'; }).join('') + '</div></section>';
}
function render() {
  var items = state.items || [];
  var html = '<div class="header"><div class="header-row"><div><h1>' + esc(state.title || 'Verify Report Live') + '</h1><div class="meta">' +
    '<span class="badge ' + esc(state.status) + '">' + (state.status === 'running' ? '<span class="pulse"></span>' : '') + statusLabel(state.status) + '</span>' +
    (state.ticket ? '<span class="badge">' + esc(state.ticket) + '</span>' : '') +
    '<span class="badge">workspace=' + esc(state.workspaceName || '') + '</span>' +
    '<span class="badge">runId=' + esc(state.runId || '') + '</span>' +
    '</div></div><div class="meta"><span class="badge">updated ' + new Date(state.updatedAt || Date.now()).toLocaleTimeString() + '</span></div></div></div>';
  html += '<main><section class="summary"><h2>요약</h2>' + detailHtml(state.summary) + detailHtml(state.finalSummary) +
    '<div class="grid"><div class="stat"><strong>' + items.length + '</strong>전체</div><div class="stat"><strong>' + count('pass') + '</strong>PASS</div><div class="stat"><strong>' + count('fail') + '</strong>FAIL</div><div class="stat"><strong>' + (count('skip') + count('blocked') + count('unverified')) + '</strong>SKIP/미검증</div></div>' +
    (state.reportPath ? '<p><strong>report.html</strong>: <code>' + esc(state.reportPath) + '</code></p>' : '') + '</section>' + lintWarningsHtml();
  for (var i=0; i<items.length; i++) { var item = items[i];
    html += '<section class="item"><div class="item-head"><div><h3>' + esc(item.id) + '. ' + esc(item.title) + '</h3>' + (item.type ? '<div class="type">' + esc(item.type) + '</div>' : '') + '</div><span class="status ' + esc(item.status || 'pending') + '">' + statusLabel(item.status || 'pending') + '</span></div>' +
      detailHtml(item.detail) +
      '<div class="evidence">' + (item.evidence || []).map(evHtml).join('') + '</div></section>';
  }
  if (state.logs && state.logs.length) {
    html += '<section class="logs"><h2>Live Log</h2>' + state.logs.slice().reverse().map(function(log){ return '<div class="log">' + new Date(log.time).toLocaleTimeString() + ' · ' + esc(log.message) + '</div>'; }).join('') + '</section>';
  }
  html += '</main>';
  document.getElementById('app').innerHTML = html;
  collapseTallImages();
}
render();
var events = new EventSource('/events');
events.addEventListener('state', function(e) { state = JSON.parse(e.data); render(); });
events.onerror = function() { var el = document.querySelector('.header .meta'); if (el) el.insertAdjacentHTML('beforeend', '<span class="badge fail">연결 끊김</span>'); };
</script>
</body>
</html>`;
}

function renderLintWarningsSectionStatic(warnings: ReportLintWarning[] | undefined): string {
	if (!warnings?.length) return "";
	return `<section>
	<h2>🧭 Report Lint</h2>
	<p>아래 항목은 리포트를 확정하기 전에 다시 봐야 하는 자동 점검 결과입니다. PASS 판정 자체를 자동으로 뒤집지는 않지만, flow evidence와 setup noise를 점검해야 합니다.</p>
	<div class="gap-list">
	${warnings.map((warning) => `<div class="gap-item lint-${escapeHtml(warning.severity)}"><strong>${escapeHtml(warning.severity.toUpperCase())}${warning.itemId ? ` · ${escapeHtml(warning.itemId)}` : ""} · ${escapeHtml(warning.title)}</strong>${renderDetailHtml(warning.detail)}</div>`).join("\n")}
	</div>
</section>`;
}

function generateStaticReportHtml(state: VerifyReportState): string {
	const counts = {
		pass: state.items.filter((item) => item.status === "pass").length,
		fail: state.items.filter((item) => item.status === "fail").length,
		skipped: state.items.filter((item) => ["skip", "blocked", "unverified"].includes(item.status)).length,
	};
	const coverageGaps = state.items.filter((item) => ["skip", "blocked", "unverified"].includes(item.status));
	const title = `${REPORT_SIGNATURE} — ${state.ticket || state.title}`;
	const outcomeClass = counts.fail > 0 || state.status === "aborted" ? "fail" : counts.skipped > 0 ? "partial" : "pass";
	const outcomeLabel = counts.fail > 0 || state.status === "aborted" ? "ISSUES FOUND" : counts.skipped > 0 ? "PARTIAL" : "PASSED";
	const outcomeIcon = outcomeClass === "fail" ? "❌" : outcomeClass === "partial" ? "⚠️" : "✅";
	return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
	* { box-sizing: border-box; margin: 0; padding: 0; }
	${webviewCopyCss()}
	body {
		font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', 'Segoe UI', sans-serif;
		line-height: 1.6;
		color: #1f2937;
		background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
		min-height: 100vh;
	}
	.container { max-width: 1100px; margin: 0 auto; padding: 40px 24px; }
	header {
		background: linear-gradient(135deg, #10b981 0%, #047857 100%);
		color: white;
		padding: 40px;
		border-radius: 14px;
		margin-bottom: 32px;
		box-shadow: 0 10px 25px rgba(16, 185, 129, 0.2);
	}
	header h1 { font-size: 28px; line-height: 1.25; margin-bottom: 8px; }
	header .subtitle { font-size: 16px; opacity: 0.92; }
	header .meta { margin-top: 16px; font-size: 14px; opacity: 0.88; display: flex; gap: 12px; flex-wrap: wrap; }
	.badge { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: rgba(255,255,255,0.20); color: inherit; }
	.badge.outcome.pass { background: rgba(209, 250, 229, .95); color: #065f46; }
	.badge.outcome.partial { background: rgba(254, 243, 199, .95); color: #92400e; }
	.badge.outcome.fail { background: rgba(254, 226, 226, .95); color: #991b1b; }
	section {
		background: white;
		border-radius: 14px;
		padding: 32px;
		margin-bottom: 24px;
		box-shadow: 0 1px 3px rgba(0,0,0,0.06);
	}
	section h2 { font-size: 22px; margin-bottom: 16px; color: #111827; display: flex; align-items: center; gap: 8px; }
	section h3 { font-size: 16px; margin-bottom: 8px; color: #374151; }
	p { margin-bottom: 12px; color: #4b5563; }
	.pass-banner {
		background: #d1fae5;
		border: 1px solid #10b981;
		color: #065f46;
		padding: 16px 20px;
		border-radius: 10px;
		font-weight: 700;
		margin-bottom: 16px;
		font-size: 15px;
	}
	.pass-banner.partial { background: #fef3c7; border-color: #f59e0b; color: #92400e; }
	.pass-banner.fail { background: #fee2e2; border-color: #ef4444; color: #991b1b; }
	.gap-list { display: grid; gap: 10px; margin-top: 12px; }
	.gap-item { background: #fffbeb; border: 1px solid #fbbf24; border-radius: 10px; padding: 12px 14px; color: #78350f; }
	.gap-item strong { display: block; color: #92400e; margin-bottom: 4px; }
	.info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
	.info-item { background: #f9fafb; padding: 12px 16px; border-radius: 10px; border: 1px solid #e5e7eb; min-width: 0; }
	.info-item .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
	.info-item .value { font-weight: 700; color: #1f2937; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 13px; overflow-wrap: anywhere; }
	table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
	th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
	th { background: #f9fafb; color: #374151; font-weight: 700; }
	.pass { color: #059669; font-weight: 800; }
	.fail { color: #dc2626; font-weight: 800; }
	.skip { color: #d97706; font-weight: 800; }
	.running, .pending { color: #2563eb; font-weight: 800; }
	.detail { white-space: pre-wrap; line-height: 1.65; color: #4b5563; }
	.detail-readable { white-space: normal; margin: 14px 0; padding: 14px 16px; border: 1px solid #e5e7eb; border-left: 4px solid #8b5cf6; border-radius: 12px; background: #f8fafc; }
	.detail-readable p { margin: 0 0 9px; color: inherit; }
	.detail-readable p:last-child { margin-bottom: 0; }
	.detail-list { margin: 0; padding-left: 1.15em; display: grid; gap: 8px; }
	.detail-list li { padding-left: 2px; }
	.gap-detail { margin-top: 8px; }
	.step { background: #f9fafb; border-radius: 10px; padding: 20px; margin-bottom: 16px; border: 1px solid #e5e7eb; }
	.step-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
	.step-num { background: #10b981; color: white; min-width: 32px; height: 32px; padding: 0 9px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; flex-shrink: 0; }
	.step-title { font-weight: 800; color: #1f2937; font-size: 16px; }
	.step-meta { color: #6b7280; font-size: 13px; margin-top: 2px; }
	.evidence { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: 14px; margin-top: 14px; align-items: start; }
	.evidence-card { border: 1px solid #e5e7eb; border-radius: 12px; background: #fff; padding: 12px; min-width: 0; }
	.evidence-card.evidence-raw-card, .evidence-card.evidence-primary-image-card { grid-column: 1 / -1; }
	.evidence-card.evidence-primary-image-card img { width: 100%; height: auto; }
	.evidence-card-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 8px; color: #1f2937; }
	.evidence-card-head span { color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; }
	.evidence-intent { display: grid; gap: 7px; margin: 10px 0 0; }
	.evidence-intent div { border-top: 1px solid #e5e7eb; padding-top: 7px; }
	.evidence-intent dt { color: #6b7280; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
	.evidence-intent dd { margin: 2px 0 0; color: #4b5563; font-size: 12px; line-height: 1.45; }
	.raw-evidence { border: 1px solid #e5e7eb; border-radius: 10px; background: #fff; overflow: hidden; }
	.raw-evidence summary { cursor: pointer; padding: 10px 12px; font-weight: 800; color: #374151; background: #f9fafb; }
	.raw-evidence summary span { color: #6b7280; font-size: 11px; text-transform: uppercase; margin-left: 6px; }
	.raw-evidence .evidence-intent { margin: 10px 12px; }
	.raw-evidence-path { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 10px 12px; color: #6b7280; font-size: 12px; }
	.raw-evidence-note { margin: 10px 12px; color: #6b7280; font-size: 12px; }
	.raw-evidence pre { margin: 0; border-radius: 0; max-height: 460px; }
	figure { margin: 0; }
	img { display: block; max-width: 100%; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
	figcaption { color: #6b7280; font-size: 12px; margin-top: 6px; }
	.tall-evidence { border: 1px dashed #d1d5db; border-radius: 10px; padding: 12px 14px; background: #fff; }
	.tall-evidence summary { cursor: pointer; font-weight: 800; color: #374151; }
	.tall-evidence figure { margin-top: 12px; }
	code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 13px; color: #be185d; }
	pre { background: #1f2937; color: #f9fafb; padding: 16px; border-radius: 10px; overflow-x: auto; white-space: pre-wrap; font-size: 13px; line-height: 1.5; margin: 12px 0; }
	pre code { background: none; color: inherit; padding: 0; }
	@media (max-width: 760px) { .container { padding: 24px 14px; } header, section { padding: 24px; } .info-grid { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<div class="container">
<header>
	<h1>${escapeHtml(title)}</h1>
	<div class="subtitle">${escapeHtml(state.summary || state.finalSummary || "검증 결과와 캡처 증거를 한눈에 확인하는 리포트")}</div>
	<div class="meta">
		<span><strong>일자</strong> ${escapeHtml(new Date(state.createdAt).toLocaleString())}</span>
		<span><strong>workspace</strong> ${escapeHtml(state.workspaceName)}</span>
		<span><strong>status</strong> ${escapeHtml(statusLabel(state.status))}</span>
		<span class="badge outcome ${outcomeClass}">${outcomeLabel}</span>
	</div>
</header>

<section>
	<h2>📋 요약</h2>
	<div class="pass-banner ${outcomeClass}">${outcomeIcon} <strong>${counts.pass} passed</strong> · ${counts.fail} failed · ${counts.skipped} skipped/unverified</div>
	${state.finalSummary ? renderDetailHtml(state.finalSummary) : state.summary ? renderDetailHtml(state.summary) : ""}
	<div class="info-grid">
		<div class="info-item"><div class="label">report</div><div class="value">${escapeHtml(state.reportPath)}</div></div>
		<div class="info-item"><div class="label">run id</div><div class="value">${escapeHtml(state.runId)}</div></div>
		<div class="info-item"><div class="label">items</div><div class="value">${state.items.length}</div></div>
		<div class="info-item"><div class="label">archive</div><div class="value">${escapeHtml(state.archivePath || "-")}</div></div>
	</div>
</section>

${renderLintWarningsSectionStatic(state.lintWarnings)}

${coverageGaps.length ? `<section>
	<h2>⚠️ Coverage Gaps</h2>
	<p>아래 항목은 리포트에 포함됐지만 PASS로 닫히지 않았습니다. 추가 캡처/로그/환경 검증이 필요합니다.</p>
	<div class="gap-list">
	${coverageGaps.map((item) => `<div class="gap-item"><strong>${escapeHtml(item.id)} · ${escapeHtml(statusLabel(item.status))}</strong>${escapeHtml(item.title)}${item.detail ? `<div class="gap-detail">${renderDetailHtml(item.detail)}</div>` : ""}</div>`).join("\n")}
	</div>
</section>` : ""}

<section>
	<h2>🧪 검증 항목</h2>
	<table>
	<thead><tr><th>#</th><th>항목</th><th>분류</th><th>결과</th><th>상세</th></tr></thead>
	<tbody>
	${state.items.map((item) => `<tr><td>${escapeHtml(item.id)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.type || "")}</td><td class="${escapeHtml(statusClass(item.status))}">${escapeHtml(statusLabel(item.status))}</td><td>${escapeHtml(item.detail || "")}</td></tr>`).join("\n")}
	</tbody>
	</table>
</section>

<section>
	<h2>📸 상세 증거</h2>
	${state.items.map((item) => `<div class="step"><div class="step-header"><div class="step-num">${escapeHtml(item.id)}</div><div><div class="step-title">${escapeHtml(item.title)}</div><div class="step-meta">${escapeHtml(item.type || "-")} · <span class="${escapeHtml(statusClass(item.status))}">${escapeHtml(statusLabel(item.status))}</span></div></div></div>${renderDetailHtml(item.detail)}<div class="evidence">${item.evidence.map((evidence) => renderEvidenceStatic(evidence, state)).join("\n")}</div></div>`).join("\n")}
</section>
</div>
<script>
${webviewCopyScript()}
</script>
</body>
</html>`;
}

function writeEvidenceIntentSidecar(state: VerifyReportState): void {
	const evidence_created = state.items.flatMap((item) => item.evidence
		.filter((evidence) => evidence.path)
		.map((evidence) => ({
			path: evidence.path,
			kind: evidenceKind(evidence),
			label: evidence.label,
			role: evidence.role,
			relatedItem: evidence.relatedItem || item.id,
			purpose: evidence.purpose,
			inspectFor: evidence.inspectFor,
			expected: evidence.expected,
			observed: evidence.observed,
		})));
	if (!evidence_created.length) return;
	writeFileSync(join(state.capturesDir, "evidence-intent.json"), `${JSON.stringify({
		version: 1,
		generatedAt: new Date(state.updatedAt).toISOString(),
		runId: state.runId,
		title: state.title,
		workspace: state.workspaceName,
		evidence_created,
	}, null, 2)}\n`, "utf-8");
}

function archiveReport(state: VerifyReportState): string {
	mkdirSync(REPORTS_ARCHIVE_DIR, { recursive: true });
	const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
	const filename = `${ts}_${state.workspaceName}${state.ticket ? `_${state.ticket}` : ""}.html`;
	const dest = join(REPORTS_ARCHIVE_DIR, filename);
	const html = readFileSync(state.reportPath, "utf-8");
	writeFileSync(dest, inlineReportImageAssets(html, dirname(state.reportPath)), "utf-8");
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
			"Use verify_report_live for /verify-report workflows: start after defining verification coverage, update after each item with status/evidence, then finish to export report.html.",
			"Evidence must close the stated criterion. If a required axis is not checked, keep that item unverified/blocked instead of marking pass.",
			"Evidence should explain its intent: include purpose, inspectFor, expected, observed, role, and relatedItem when available so raw captures are readable later.",
			"For UI movement/transition/click/open-close/smoothness claims, use GIF or short video as primary evidence and pair it with one representative PNG/crop as supporting evidence.",
			"For static UI evidence, use a contextual focused crop as primary evidence and attach a same-route full viewport screenshot as supporting context; the crop should include enough surrounding UI to identify the location, not just the isolated text/control.",
			"For user-facing Web UI, verify both desktop and mobile viewports when applicable; if one viewport is irrelevant or unavailable, record the reason as a gap/exclusion instead of silently omitting it.",
			"Tall/full-page images are auto-collapsed in the report and should be supporting context only.",
			"Keep login/build/dev-server/env/bootstrap setup noise out of PASS items unless setup itself is the verification target or a blocking coverage gap.",
			"When existing UI/behavior is the baseline, include Before and After image evidence in the same item when practical, with labels that state environment/viewport/role.",
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
				if (ctx.hasUI) opened = await openLivePreview(pi, ctx, handle);
				return {
					content: [{ type: "text", text: `Started live Verify Report (${runId}). Preview: ${state.url}. Captures: ${capturesDir}. report.html: ${reportPath}. Opened: ${opened}.` }],
					details: { runId, url: state.url, capturesDir, reportPath, opened },
				};
			}

			const handle = (params.runId ? liveRuns.get(params.runId) : latestHandle());
			if (!handle) throw new Error("No active verify_report_live run. Call action=start first.");
			const { state } = handle;

			if (action === "open") {
				const opened = ctx.hasUI ? await openLivePreview(pi, ctx, handle) : "none";
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
				materializeEvidenceAssets(state);
				state.lintWarnings = lintVerifyReport(state);
				state.status = "done";
				addLog(state, state.lintWarnings.length ? `Report lint completed with ${state.lintWarnings.length} warning(s).` : "Report lint completed with no warnings.");
				addLog(state, "Static report.html exported.");
				mkdirSync(dirname(state.reportPath), { recursive: true });
				try { writeEvidenceIntentSidecar(state); } catch {}
				writeFileSync(state.reportPath, generateStaticReportHtml(state), "utf-8");
				try { state.archivePath = archiveReport(state); } catch {}
				pushState(handle);
				const warningSuffix = state.lintWarnings.length ? ` Report lint warnings: ${state.lintWarnings.length}.` : "";
				return { content: [{ type: "text", text: `Finished live Verify Report (${state.runId}). Exported: ${state.reportPath}${state.archivePath ? `; archived: ${state.archivePath}` : ""}.${warningSuffix}` }], details: { runId: state.runId, reportPath: state.reportPath, archivePath: state.archivePath, url: state.url, lintWarnings: state.lintWarnings } };
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
