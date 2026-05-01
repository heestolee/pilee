import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
import { POKEMON_KO_TO_ID, renderSprite } from "./sprite.js";

// ─── Config ────────────────────────────────────────────────────────────────

interface ScreensaverConfig {
	idleMinutes: number;
	showWorktreeMeta: boolean;
	showSprite: boolean;
	spriteSize: number;
	enabled: boolean;
}

const DEFAULT_CONFIG: ScreensaverConfig = {
	idleMinutes: 5,
	showWorktreeMeta: true,
	showSprite: true,
	spriteSize: 32,
	enabled: true,
};

const CONFIG_PATH = join(homedir(), ".pi", "agent", "idle-screensaver.json");

function loadConfig(): ScreensaverConfig {
	if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG };
	try {
		const data = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
		return { ...DEFAULT_CONFIG, ...data };
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

// ─── Worktree meta ─────────────────────────────────────────────────────────

interface WorktreeMeta {
	name?: string;
	branch?: string;
	ticket?: string;
	note?: string;
}

function readWorktreeMeta(cwd: string): WorktreeMeta | null {
	const p = join(cwd, ".pi", "worktree-meta.json");
	if (!existsSync(p)) return null;
	try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

// ─── State ─────────────────────────────────────────────────────────────────

const config = loadConfig();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let agentRunning = false;
let overlayActive = false;
let askUserQuestionActive = false;
let latestCtx: ExtensionContext | null = null;
let piRef: ExtensionAPI | null = null;

type ScreensaverTui = { terminal?: { rows?: number } };
type ScreensaverTheme = { fg: (color: ThemeColor, text: string) => string; bold: (text: string) => string };

// ─── Timer helpers ─────────────────────────────────────────────────────────

function clearIdleTimer(): void {
	if (idleTimer) {
		clearTimeout(idleTimer);
		idleTimer = null;
	}
}

function scheduleIdleTimer(): void {
	clearIdleTimer();
	if (!config.enabled) return;
	if (agentRunning || overlayActive || askUserQuestionActive) return;
	idleTimer = setTimeout(() => void showScreensaver(), config.idleMinutes * 60 * 1000);
}

// ─── Show screensaver ──────────────────────────────────────────────────────

async function showScreensaver(): Promise<void> {
	if (!latestCtx?.hasUI) return;

	overlayActive = true;
	clearIdleTimer();

	const sessionName = piRef?.getSessionName() ?? "";
	const folder = latestCtx.sessionManager.getCwd();
	const folderName = folder.split("/").pop() ?? "";

	let branch = "";
	try {
		branch = execSync("git branch --show-current", { cwd: folder, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
	} catch {}

	const meta = config.showWorktreeMeta ? readWorktreeMeta(folder) : null;

	// Build display lines
	const title = sessionName || folderName || "Pi";
	const subtitleParts: string[] = [];
	if (meta?.name && meta.name !== folderName) subtitleParts.push(meta.name);
	if (branch) subtitleParts.push(branch);
	const subtitle = subtitleParts.join(" · ");

	const metaLines: string[] = [];
	if (meta?.ticket) metaLines.push(meta.ticket);
	if (meta?.note) metaLines.push(meta.note);

	// Try to load sprite — match by folderName (workspace name) or meta.name
	let spriteLines: string[] | null = null;
	let spritePokemonName: string | null = null;
	if (config.showSprite) {
		// First try exact match
		const candidates = [folderName, meta?.name].filter(Boolean) as string[];
		for (const candidate of candidates) {
			if (POKEMON_KO_TO_ID[candidate]) {
				spriteLines = await renderSprite(candidate, config.spriteSize, config.spriteSize);
				if (spriteLines) {
					spritePokemonName = candidate;
					break;
				}
			}
		}

		// Fallback: random pokemon
		if (!spriteLines) {
			const allNames = Object.keys(POKEMON_KO_TO_ID);
			const randomName = allNames[Math.floor(Math.random() * allNames.length)];
			spriteLines = await renderSprite(randomName, config.spriteSize, config.spriteSize);
			if (spriteLines) spritePokemonName = randomName;
		}
	}

	await latestCtx.ui.custom(
		(tui: ScreensaverTui, theme: ScreensaverTheme, _kb: unknown, done: (v: undefined) => void) => ({
			render: (w: number) => renderScreensaver(w, tui.terminal?.rows ?? 40, { title, subtitle, metaLines, spriteLines, spritePokemonName }, theme),
			handleInput: (_data: string) => done(undefined),
			invalidate: () => {},
		}),
		{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } },
	);

	overlayActive = false;
	scheduleIdleTimer();
}

// ─── Renderer ──────────────────────────────────────────────────────────────

interface RenderData {
	title: string;
	subtitle: string;
	metaLines: string[];
	spriteLines: string[] | null;
	spritePokemonName: string | null;
}

function renderScreensaver(width: number, height: number, data: RenderData, theme: ScreensaverTheme): string[] {
	const lines: string[] = [];
	const bc = (s: string) => theme.fg("accent", s);

	const hRule = new DynamicBorder(bc).render(width)[0] ?? bc("─".repeat(width));
	const L = bc("│");
	const R = bc("│");
	const innerWidth = width - 2;

	const emptyLine = () => L + " ".repeat(innerWidth) + R;
	const placeLine = (chars: string) => {
		const vw = visibleWidth(chars);
		return L + chars + " ".repeat(Math.max(0, innerWidth - vw)) + R;
	};
	const centerLine = (text: string) => {
		const tw = visibleWidth(text);
		const pad = Math.max(0, Math.floor((innerWidth - tw) / 2));
		return placeLine(" ".repeat(pad) + text);
	};

	const compact = data.title.trim();
	const spread = compact.length <= 24 ? compact.split("").join(" ") : compact;
	const titleText = spread || "Pi";

	const separatorWidth = Math.min(innerWidth - 4, Math.max(visibleWidth(titleText) + 8, 24));
	const separator = bc("─".repeat(Math.max(1, separatorWidth)));

	const SPRITE_H = (data.spriteLines?.length ?? 0) + (data.spritePokemonName ? 1 : 0);
	const TITLE_BLOCK_H = 3;
	const META_BLOCK_H = (data.subtitle ? 2 : 0) + (data.metaLines.length > 0 ? data.metaLines.length + 1 : 0);
	const FOOTER_H = 1;
	const innerHeight = height - 2;
	const SPRITE_PAD = SPRITE_H > 0 ? 1 : 0;
	const contentH = SPRITE_H + SPRITE_PAD + TITLE_BLOCK_H + META_BLOCK_H + FOOTER_H;
	const topPad = Math.max(0, Math.floor((innerHeight - contentH) / 2) - 1);

	lines.push(hRule);
	for (let i = 0; i < topPad; i++) lines.push(emptyLine());

	// Sprite (if available)
	if (data.spriteLines) {
		for (const sl of data.spriteLines) {
			lines.push(centerLine(sl));
		}
		if (data.spritePokemonName) {
			lines.push(centerLine(theme.fg("dim", data.spritePokemonName)));
		}
		lines.push(emptyLine());
	}

	// Title
	lines.push(centerLine(separator));
	lines.push(centerLine(theme.fg("accent", titleText)));
	lines.push(centerLine(separator));

	// Subtitle (folder/branch)
	if (data.subtitle) {
		lines.push(emptyLine());
		lines.push(centerLine(theme.fg("muted", data.subtitle)));
	}

	// Meta (ticket/note)
	if (data.metaLines.length > 0) {
		lines.push(emptyLine());
		for (const m of data.metaLines) lines.push(centerLine(theme.fg("muted", m)));
	}

	while (lines.length < height - 2) lines.push(emptyLine());
	if (lines.length === height - 2) {
		lines.push(centerLine(theme.fg("dim", "Press any key to dismiss")));
	}
	while (lines.length < height - 1) lines.push(emptyLine());
	lines.push(hRule);

	return lines;
}

// ─── Entry ─────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	piRef = pi;

	pi.on("input", (event, ctx) => {
		latestCtx = ctx;
		if (event.source !== "extension") scheduleIdleTimer();
	});

	pi.on("agent_start", (_e, ctx) => {
		latestCtx = ctx;
		agentRunning = true;
		clearIdleTimer();
	});

	pi.on("agent_end", (_e, ctx) => {
		latestCtx = ctx;
		agentRunning = false;
		scheduleIdleTimer();
	});

	pi.on("tool_execution_start", (event, ctx) => {
		latestCtx = ctx;
		if (event.toolName === "AskUserQuestion") {
			askUserQuestionActive = true;
			clearIdleTimer();
		}
	});

	pi.on("tool_execution_end", (event, ctx) => {
		latestCtx = ctx;
		if (event.toolName === "AskUserQuestion") {
			askUserQuestionActive = false;
			scheduleIdleTimer();
		}
	});

	pi.on("session_start", (_e, ctx) => {
		latestCtx = ctx;
		clearIdleTimer();
		overlayActive = false;
		scheduleIdleTimer();
	});

	pi.on("session_shutdown", () => clearIdleTimer());

	// /screensaver command
	pi.registerCommand("screensaver", {
		description: "Idle screensaver controls (/screensaver show|on|off|config)",
		async handler(args, ctx) {
			const sub = args.trim();
			if (sub === "show") {
				await showScreensaver();
				return;
			}
			if (sub === "off" || sub === "disable") {
				config.enabled = false;
				clearIdleTimer();
				ctx.ui.notify("Screensaver disabled", "info");
				return;
			}
			if (sub === "on" || sub === "enable") {
				config.enabled = true;
				scheduleIdleTimer();
				ctx.ui.notify("Screensaver enabled", "info");
				return;
			}
			if (sub === "config") {
				ctx.ui.notify(`Idle: ${config.idleMinutes}min · enabled: ${config.enabled} · showWorktreeMeta: ${config.showWorktreeMeta}\nConfig file: ${CONFIG_PATH}`, "info");
				return;
			}
			ctx.ui.notify("Usage: /screensaver show|on|off|config", "info");
		},
	});
}
