import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { platform } from "node:os";
import { Buffer } from "node:buffer";
import { getGlimpseOpen, type GlimpseWindow } from "./glimpse.ts";

type CompanionMode = "glimpse" | "reused" | "none";
type ToggleMode = "hidden" | "shown" | "missing" | "none";

type CompanionGeometry = {
	x?: number;
	y?: number;
	width: number;
	height: number;
};

type CompanionRecord = {
	key: string;
	title: string;
	html: string;
	openLinks: boolean;
	window?: GlimpseWindow;
	closed: boolean;
	updatedAt: number;
};

export type CompanionOpenResult = {
	mode: CompanionMode;
	key: string;
	window?: GlimpseWindow;
};

export type CompanionToggleResult = {
	mode: ToggleMode;
	key: string;
	title?: string;
	window?: GlimpseWindow;
};

const companions = new Map<string, CompanionRecord>();
let testOpenForTesting: ((html: string, opts: Record<string, unknown>) => GlimpseWindow) | null = null;

export function __setCompanionWindowOpenForTesting(open: ((html: string, opts: Record<string, unknown>) => GlimpseWindow) | null): void {
	testOpenForTesting = open;
}

export function __resetCompanionWindowStateForTesting(): void {
	for (const record of companions.values()) {
		try { record.window?.close(); } catch {}
	}
	companions.clear();
	testOpenForTesting = null;
}

async function resolveGlimpseOpen(): Promise<((html: string, opts: Record<string, unknown>) => GlimpseWindow) | null> {
	return testOpenForTesting ?? await getGlimpseOpen();
}

function sessionKey(ctx: Pick<ExtensionContext, "cwd" | "sessionManager">): string {
	try {
		const file = ctx.sessionManager?.getSessionFile?.();
		if (file) return `session:${file}`;
	} catch {}
	return `cwd:${ctx.cwd ?? process.cwd()}`;
}

function redirectHtml(url: string, title: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body style="margin:0;background:#fafaf9"><script>window.location.replace(${JSON.stringify(url)});</script></body></html>`;
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

async function rightHalfGeometry(pi: ExtensionAPI, fallbackWidth: number, fallbackHeight: number): Promise<CompanionGeometry> {
	if (platform() !== "darwin") return { width: fallbackWidth, height: fallbackHeight };
	try {
		const script = `ObjC.import('AppKit');
const frame = $.NSScreen.mainScreen.visibleFrame;
JSON.stringify({ x: frame.origin.x, y: frame.origin.y, width: frame.size.width, height: frame.size.height });`;
		const result = await pi.exec("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeout: 5000 });
		if (result.code !== 0) throw new Error(result.stderr || "osascript failed");
		const parsed = JSON.parse(result.stdout.trim()) as { x: number; y: number; width: number; height: number };
		const width = Math.max(640, Math.floor(parsed.width / 2));
		const height = Math.max(560, Math.floor(parsed.height));
		return {
			x: Math.floor(parsed.x + parsed.width - width),
			y: Math.floor(parsed.y),
			width,
			height,
		};
	} catch {
		return { width: fallbackWidth, height: fallbackHeight };
	}
}

function writeHtml(win: GlimpseWindow, html: string): void {
	const anyWin = win as GlimpseWindow & { setHTML?: (html: string) => void };
	if (typeof anyWin.setHTML === "function") {
		anyWin.setHTML(html);
		return;
	}
	win._write?.({ type: "html", html: Buffer.from(html).toString("base64") });
}

function showWindow(win: GlimpseWindow, title: string): void {
	const anyWin = win as GlimpseWindow & { show?: (options?: { title?: string }) => void };
	if (typeof anyWin.show === "function") anyWin.show({ title });
	else win._write?.({ type: "show", title });
}

function applyGeometry(win: GlimpseWindow, geometry: CompanionGeometry): void {
	win._write?.({ type: "bounds", ...geometry });
	win._write?.({ type: "resize", width: geometry.width, height: geometry.height });
}

function isOpen(record: CompanionRecord | undefined): record is CompanionRecord & { window: GlimpseWindow } {
	return Boolean(record?.window && !record.closed);
}

export async function openCompanionHtml(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
	html: string,
	title: string,
	options: { width?: number; height?: number; openLinks?: boolean; key?: string } = {},
): Promise<CompanionOpenResult> {
	const key = options.key ?? sessionKey(ctx);
	const open = await resolveGlimpseOpen();
	if (!open) return { mode: "none", key };
	const openLinks = options.openLinks ?? true;
	const existing = companions.get(key);
	if (isOpen(existing)) {
		const htmlChanged = existing.html !== html;
		existing.title = title;
		existing.html = html;
		existing.openLinks = openLinks;
		existing.updatedAt = Date.now();
		if (htmlChanged) writeHtml(existing.window, html);
		showWindow(existing.window, title);
		return { mode: "reused", key, window: existing.window };
	}
	const geometry = await rightHalfGeometry(pi, options.width ?? 1180, options.height ?? 920);
	try {
		const win = open(html, { ...geometry, title, openLinks });
		const record: CompanionRecord = { key, title, html, openLinks, window: win, closed: false, updatedAt: Date.now() };
		win.on("closed", () => {
			record.closed = true;
			record.window = undefined;
		});
		companions.set(key, record);
		return { mode: "glimpse", key, window: win };
	} catch {
		return { mode: "none", key };
	}
}

export async function openCompanionUrl(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
	url: string,
	title: string,
	options: { width?: number; height?: number; openLinks?: boolean; key?: string } = {},
): Promise<CompanionOpenResult> {
	return openCompanionHtml(pi, ctx, redirectHtml(url, title), title, options);
}

export async function toggleCompanionWindow(
	pi: ExtensionAPI,
	ctx: Pick<ExtensionContext, "cwd" | "sessionManager">,
	options: { key?: string; width?: number; height?: number } = {},
): Promise<CompanionToggleResult> {
	const key = options.key ?? sessionKey(ctx);
	const existing = companions.get(key);
	if (isOpen(existing)) {
		existing.window.close();
		existing.closed = true;
		existing.window = undefined;
		return { mode: "hidden", key, title: existing.title };
	}
	if (!existing?.html) return { mode: "missing", key };
	const reopened = await openCompanionHtml(pi, ctx, existing.html, existing.title, {
		width: options.width,
		height: options.height,
		openLinks: existing.openLinks,
		key,
	});
	return { mode: reopened.mode === "none" ? "none" : "shown", key, title: existing.title, window: reopened.window };
}
