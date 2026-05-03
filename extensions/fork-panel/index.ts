import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { completeSimple } from "@mariozechner/pi-ai";

const VALID_DIRS = ["right", "left", "down", "up", "tab"] as const;
type Direction = (typeof VALID_DIRS)[number];

const HANDOFF_DIR = join(homedir(), ".pi", "agent", "fork-panel");

let forkInProgress = false;
const FORK_COOLDOWN_MS = 2000;
const RECENT_PATH = join(HANDOFF_DIR, "recent.json");
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RECENT_KEEP = 50;

interface ForkRecord {
	forkId: string;
	label: string;
	sessionFile: string;
	cwd: string;
	createdAt: number;
	closedAt?: number;
	preview?: string;
}

function loadRecent(): Record<string, ForkRecord> {
	try {
		if (!existsSync(RECENT_PATH)) return {};
		return JSON.parse(readFileSync(RECENT_PATH, "utf8"));
	} catch { return {}; }
}

function saveRecent(data: Record<string, ForkRecord>) {
	const entries = Object.entries(data)
		.sort((a, b) => b[1].createdAt - a[1].createdAt)
		.slice(0, RECENT_KEEP);
	mkdirSync(HANDOFF_DIR, { recursive: true });
	writeFileSync(RECENT_PATH, JSON.stringify(Object.fromEntries(entries), null, 2));
}

function recordFork(rec: ForkRecord) {
	const all = loadRecent();
	all[rec.forkId] = rec;
	saveRecent(all);
}

function markForkClosed(forkId: string, preview: string) {
	const all = loadRecent();
	const rec = all[forkId];
	if (!rec) return;
	rec.closedAt = Date.now();
	rec.preview = preview.slice(0, 100);
	saveRecent(all);
}

function readTranscriptFromFile(sessionFile: string): string | null {
	try {
		const raw = readFileSync(sessionFile, "utf8");
		const entries = raw.split("\n").filter(Boolean).map((l) => {
			try { return JSON.parse(l); } catch { return null; }
		}).filter(Boolean);
		return extractFullTranscript(entries);
	} catch {
		return null;
	}
}

function esc(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

interface HandoffData {
	forkId: string;
	parentSessionId?: string;
	pid: number;
	updatedAt: number;
	finishedAt?: number;
	summary: string;
	mode?: "auto" | "manual";
	customNote?: string;
}

function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function cleanOldHandoffs() {
	if (!existsSync(HANDOFF_DIR)) return;
	const now = Date.now();
	try {
		for (const f of readdirSync(HANDOFF_DIR)) {
			const p = join(HANDOFF_DIR, f);
			try {
				const stat = statSync(p);
				if (now - stat.mtimeMs > HANDOFF_TTL_MS) unlinkSync(p);
			} catch {}
		}
	} catch {}
}

function extractLastAssistant(entries: any[]): string {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e?.type === "message" && e.message?.role === "assistant") {
			const content = e.message.content;
			const text = Array.isArray(content)
				? content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
				: typeof content === "string" ? content : "";
			if (text.trim()) return text.trim();
		}
	}
	return "";
}

function extractFullTranscript(entries: any[]): string {
	const lines: string[] = [];
	for (const e of entries) {
		if (e?.type !== "message") continue;
		const role = e.message?.role;
		const content = Array.isArray(e.message?.content)
			? e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
			: typeof e.message?.content === "string" ? e.message.content : "";
		if (!content.trim()) continue;
		if (role === "user" || role === "assistant") {
			lines.push(`[${role}]: ${content}`);
		}
	}
	return lines.join("\n\n");
}

const SUMMARY_SYSTEM_PROMPT = `You summarize an AI coding session.
Output a brief 3-5 bullet point summary in the same language as the conversation (Korean if Korean).
Focus on: what was done, what was discovered/decided, key file/code references, action items.
Each bullet 1-2 lines max. Be concrete (file paths, function names, ticket IDs).
Output only the bullets, no preamble.`;

async function generateSummary(entries: any[], ctx: ExtensionContext): Promise<string | null> {
	if (!ctx.model || !ctx.modelRegistry) return null;

	const transcript = extractFullTranscript(entries);
	if (!transcript || transcript.length < 200) return null; // too short

	try {
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model).catch(() => null);
		if (!auth?.ok) return null;

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 20000);
		const result = await completeSimple(
			ctx.model,
			{
				systemPrompt: SUMMARY_SYSTEM_PROMPT,
				messages: [{ role: "user", content: [{ type: "text", text: transcript.slice(0, 30000) }], timestamp: Date.now() }],
			},
			{ apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal, reasoning: "minimal", maxTokens: 600 },
		).catch(() => undefined);
		clearTimeout(timeout);

		if (!result || result.stopReason !== "stop") return null;
		const text = result.content
			.filter((c): c is { type: "text"; text: string } => c.type === "text")
			.map((c) => c.text)
			.join("")
			.trim();
		return text || null;
	} catch {
		return null;
	}
}

function assemblePayload(opts: { mode: "summary" | "full" | "last"; lastMessage: string; summary?: string | null; transcript?: string }): string {
	if (opts.mode === "full" && opts.transcript) {
		return `📜 전체 대화:\n\n${opts.transcript}`;
	}
	if (opts.mode === "summary" && opts.summary) {
		return `📋 요약:\n${opts.summary}\n\n💬 마지막 응답:\n${opts.lastMessage}`;
	}
	return opts.lastMessage;
}

function buildScript(direction: Direction, cwd: string, sessionFile: string, forkId: string, prompt?: string): string {
	const cmd = `cd \\"${esc(cwd)}\\" && pi update && PI_FORK_ID=${forkId} pi --session \\"${esc(sessionFile)}\\"`;

	if (direction === "tab") {
		return `tell application "System Events"
  tell process "Ghostty"
    keystroke "t" using command down
    delay 1.0
    keystroke "${cmd}"
    key code 36${prompt ? `\n    delay 2\n    keystroke "${esc(prompt)}"\n    key code 36` : ""}
  end tell
end tell`;
	}

	return `tell application "Ghostty"
  set currentTerm to focused terminal of selected tab of front window
  set newTerm to split currentTerm direction ${direction}
  input text "${cmd}" to newTerm
  send key "enter" to newTerm${prompt ? `\n  delay 2\n  input text "${esc(prompt)}" to newTerm\n  send key "enter" to newTerm` : ""}
end tell`;
}

export default function (pi: ExtensionAPI) {
	const forkId = process.env.PI_FORK_ID;

	// CHILD MODE additions: this session is a fork of a parent — write handoff on shutdown
	if (forkId) {
		const handoffPath = join(HANDOFF_DIR, `${forkId}.json`);
		let latestEntries: any[] = [];
		let latestCtx: ExtensionContext | undefined;
		let alreadyFinalized = false;

		const writeAuto = (final: boolean, payload?: string) => {
			try {
				const lastMsg = extractLastAssistant(latestEntries);
				if (!lastMsg) return;
				mkdirSync(HANDOFF_DIR, { recursive: true });
				const data: HandoffData = {
					forkId,
					parentSessionId: process.env.PI_FORK_PARENT,
					pid: process.pid,
					updatedAt: Date.now(),
					...(final ? { finishedAt: Date.now() } : {}),
					summary: payload ?? lastMsg,
					mode: "auto",
				};
				writeFileSync(handoffPath, JSON.stringify(data, null, 2));
			} catch {}
		};

		// Update on every assistant turn (just last message — fast)
		pi.on("agent_end", async (_e, ctx) => {
			latestEntries = ctx.sessionManager.getEntries();
			latestCtx = ctx;
			writeAuto(false);
		});

		// Final write on graceful shutdown — has time to generate summary
		pi.on("session_shutdown", async (_e, ctx) => {
			if (alreadyFinalized) return;
			alreadyFinalized = true;
			latestEntries = ctx.sessionManager.getEntries();
			const lastMsg = extractLastAssistant(latestEntries);
			const summary = await generateSummary(latestEntries, ctx);
			const payload = assemblePayload({ mode: summary ? "summary" : "last", lastMessage: lastMsg, summary });
			writeAuto(true, payload);
		});

		// Signal handlers (Cmd+W etc.) — no time for LLM, just last message
		for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
			process.on(sig, () => {
				if (!alreadyFinalized) {
					alreadyFinalized = true;
					writeAuto(true);
				}
			});
		}

		// Manual /handoff command
		pi.registerCommand("handoff", {
			description: "Send to parent: default = summary + last message. Options: --full (full transcript), --last (just last message). [optional note]",
			handler: async (args, ctx) => {
				try {
					const entries = ctx.sessionManager.getEntries();
					const lastMsg = extractLastAssistant(entries);
					if (!lastMsg) {
						ctx.ui.notify("전송할 응답이 없습니다 (assistant 메시지가 아직 없음)", "warning");
						return;
					}

					// Parse mode flag and note
					const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
					let mode: "summary" | "full" | "last" = "summary";
					const noteParts: string[] = [];
					for (const t of tokens) {
						if (t === "--full") mode = "full";
						else if (t === "--last") mode = "last";
						else if (t === "--summary") mode = "summary";
						else noteParts.push(t);
					}
					const note = noteParts.join(" ").trim() || undefined;

					let payload: string;
					if (mode === "full") {
						const transcript = extractFullTranscript(entries);
						payload = assemblePayload({ mode: "full", lastMessage: lastMsg, transcript });
					} else if (mode === "summary") {
						ctx.ui.notify("요약 생성 중…", "info");
						const summary = await generateSummary(entries, ctx);
						payload = assemblePayload({ mode: summary ? "summary" : "last", lastMessage: lastMsg, summary });
					} else {
						payload = lastMsg;
					}

					mkdirSync(HANDOFF_DIR, { recursive: true });
					const ts = Date.now();
					const manualPath = join(HANDOFF_DIR, `${forkId}-manual-${ts}.json`);
					const data: HandoffData = {
						forkId,
						parentSessionId: process.env.PI_FORK_PARENT,
						pid: process.pid,
						updatedAt: ts,
						summary: payload,
						mode: "manual",
						customNote: note,
					};
					writeFileSync(manualPath, JSON.stringify(data, null, 2));
					ctx.ui.notify(`부모 세션에 handoff 전송됨 (mode: ${mode}${note ? `, 메모: ${note.slice(0, 30)}` : ""})`, "info");
				} catch (e) {
					ctx.ui.notify(`handoff 실패: ${e instanceof Error ? e.message : e}`, "error");
				}
			},
		});
		// Continue to register fork-panel command/shortcuts so child can fork further
	}

	// All sessions (parent or child fork): can spawn new forks
	const activeWatchers = new Map<string, ReturnType<typeof setInterval>>();

	function watchHandoff(forkId: string, label: string) {
		const autoPath = join(HANDOFF_DIR, `${forkId}.json`);
		const manualPrefix = `${forkId}-manual-`;

		const interval = setInterval(() => {
			// 1. Pick up any manual handoffs (panel still running, multiple possible)
			try {
				if (existsSync(HANDOFF_DIR)) {
					const files = readdirSync(HANDOFF_DIR)
						.filter((f) => f.startsWith(manualPrefix) && f.endsWith(".json"))
						.sort(); // chronological
					for (const f of files) {
						const fp = join(HANDOFF_DIR, f);
						try {
							const data: HandoffData = JSON.parse(readFileSync(fp, "utf8"));
							const note = data.customNote ? `\n\n📝 ${data.customNote}` : "";
							const message = `[fork-panel handoff (manual): ${label}]${note}\n\n${data.summary}`;
							pi.sendUserMessage(message, { deliverAs: "followUp" });
							unlinkSync(fp);
						} catch {}
					}
				}
			} catch {}

			// 2. Check if child is done (auto handoff trigger)
			if (!existsSync(autoPath)) return;
			try {
				const data: HandoffData = JSON.parse(readFileSync(autoPath, "utf8"));
				const finished = !!data.finishedAt;
				const pidDead = data.pid && !isPidAlive(data.pid);
				if (!finished && !pidDead) return;

				const hint = `\n\n💡 전체 transcript이 필요하면: /recall ${forkId}  또는  /recall last`;
				const message = `[fork-panel handoff: ${label}]\n\n${data.summary}${hint}`;
				pi.sendUserMessage(message, { deliverAs: "followUp" });
				markForkClosed(forkId, data.summary);
				unlinkSync(autoPath);
			} catch {}

			clearInterval(interval);
			activeWatchers.delete(forkId);
		}, 2000);
		activeWatchers.set(forkId, interval);
	}

	pi.on("session_shutdown", async () => {
		for (const interval of activeWatchers.values()) clearInterval(interval);
		activeWatchers.clear();
	});

	pi.on("session_start", async () => {
		cleanOldHandoffs();
	});

	const handler = async (args: string, ctx: any) => {
			if (forkInProgress) {
				ctx.ui.notify("포크 진행 중입니다. 잠시 후 다시 시도하세요.", "warning");
				return;
			}

			if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") {
				ctx.ui.notify("/fork-panel은 macOS Ghostty 터미널에서만 동작합니다", "warning");
				return;
			}

			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("포크할 세션 파일이 없습니다 (ephemeral session)", "error");
				return;
			}

			// Parse args
			const trimmed = args?.trim() ?? "";
			const firstSpace = trimmed.indexOf(" ");
			const dirArg = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
			const prompt = firstSpace === -1 ? undefined : trimmed.slice(firstSpace + 1).trim();
			const direction: Direction = VALID_DIRS.includes(dirArg as Direction) ? (dirArg as Direction) : "right";

			// Copy session file
			const dir = dirname(sessionFile);
			const timestamp = Date.now();
			const uuid = randomUUID().slice(0, 8);
			const forkedFile = join(dir, `${timestamp}_${uuid}.jsonl`);
			const newForkId = `fk_${uuid}_${timestamp}`;

			try {
				copyFileSync(sessionFile, forkedFile);
			} catch (e) {
				ctx.ui.notify(`세션 파일 복사 실패: ${e instanceof Error ? e.message : e}`, "error");
				return;
			}

			// Open in Ghostty
			forkInProgress = true;
			const script = buildScript(direction, ctx.cwd, forkedFile, newForkId, prompt);
			const result = await pi.exec("osascript", ["-e", script]);

			setTimeout(() => { forkInProgress = false; }, FORK_COOLDOWN_MS);

			if (result.code !== 0) {
				forkInProgress = false;
				ctx.ui.notify(`패널 생성 실패: ${result.stderr?.trim() ?? "unknown"}`, "error");
				try { unlinkSync(forkedFile); } catch {}
				return;
			}

			// Register watcher for handoff
			const label = prompt ? prompt.slice(0, 40) : `${direction} panel`;
			recordFork({
				forkId: newForkId,
				label,
				sessionFile: forkedFile,
				cwd: ctx.cwd,
				createdAt: timestamp,
			});
			watchHandoff(newForkId, label);

			ctx.ui.notify(
				`세션 포크 → ${direction === "tab" ? "새 탭" : `${direction} 패널`}${prompt ? ` (자동 prompt)` : ""}\n패널 종료 시 마지막 응답이 이 세션에 전달됩니다.`,
				"info",
			);
	};

	const completions = (prefix: string): AutocompleteItem[] | null => {
		const filtered = VALID_DIRS.filter((d) => d.startsWith(prefix)).map((d) => ({ value: d, label: d }));
		return filtered.length > 0 ? filtered : null;
	};

	pi.registerCommand("fork-panel", {
		description: "Fork current session into a new Ghostty panel/tab. On panel close, the panel's last assistant message returns to this session as a follow-up. (args: right|left|down|up|tab [prompt])",
		getArgumentCompletions: completions,
		handler,
	});

	pi.registerCommand("fp", {
		description: "Alias for /fork-panel",
		getArgumentCompletions: completions,
		handler,
	});

	// Keyboard shortcuts: Ctrl+Shift+Arrow → fork-panel direction
	for (const [key, dir] of [
		["ctrl+shift+right", "right"],
		["ctrl+shift+left", "left"],
		["ctrl+shift+up", "up"],
		["ctrl+shift+down", "down"],
	] as const) {
		pi.registerShortcut(key, {
			description: `fork-panel ${dir}`,
			handler: async (ctx) => {
				await handler(dir, ctx);
			},
		});
	}

	pi.registerShortcut("ctrl+shift+n", {
		description: "fork-panel new tab",
		handler: async (ctx) => {
			await handler("tab", ctx);
		},
	});

	// /recall — pull full transcript from a recent (closed) fork
	pi.registerCommand("recall", {
		description: "Recall full transcript from a recent fork-panel session. Usage: /recall [list|last|<forkId>]",
		handler: async (args, ctx) => {
			const sub = (args ?? "").trim();
			const all = loadRecent();
			const sortedClosed = Object.values(all)
				.filter((r) => r.closedAt)
				.sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));

			if (!sub || sub === "list") {
				const recent = Object.values(all)
					.sort((a, b) => b.createdAt - a.createdAt)
					.slice(0, 10);
				if (recent.length === 0) {
					ctx.ui.notify("No recent forks tracked.", "info");
					return;
				}
				const lines = ["Recent forks:"];
				for (const r of recent) {
					const time = new Date(r.createdAt).toLocaleString();
					const status = r.closedAt ? "closed" : "running";
					const preview = r.preview ? ` — ${r.preview.slice(0, 50)}…` : "";
					lines.push(`  ${r.forkId} [${status}] ${r.label} (${time})${preview}`);
				}
				lines.push("\nUsage: /recall last  |  /recall <forkId>");
				ctx.ui.notify(lines.join("\n"), "info");
				return;
			}

			let target: ForkRecord | undefined;
			if (sub === "last") {
				target = sortedClosed[0];
				if (!target) { ctx.ui.notify("No closed forks to recall.", "warning"); return; }
			} else {
				target = all[sub];
				if (!target) { ctx.ui.notify(`Fork not found: ${sub}. Use /recall list to see available.`, "error"); return; }
			}

			if (!existsSync(target.sessionFile)) {
				ctx.ui.notify(`Session file missing: ${target.sessionFile}`, "error");
				return;
			}

			const transcript = readTranscriptFromFile(target.sessionFile);
			if (!transcript) {
				ctx.ui.notify(`Could not read transcript from ${target.sessionFile}`, "error");
				return;
			}

			const message = `[recall: ${target.label}]\n\n📜 전체 대화:\n\n${transcript}`;
			pi.sendUserMessage(message, { deliverAs: "followUp" });
			ctx.ui.notify(`전체 transcript 전달됨 (${target.label}, ${(transcript.length / 1000).toFixed(1)}K chars)`, "info");
		},
	});

	// /revive — reopen a previous fork panel session
	pi.registerCommand("revive", {
		description: "TUI로 종료된 fork-panel 세션 목록을 보고 선택해서 Ghostty 패널로 재개",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;

			const sub = (args ?? "").trim();
			const all = loadRecent();
			const sorted = Object.values(all)
				.filter((r) => existsSync(r.sessionFile))
				.sort((a, b) => (b.closedAt ?? b.createdAt) - (a.closedAt ?? a.createdAt));

			if (sub === "last") {
				const target = sorted[0];
				if (!target) { ctx.ui.notify("재개 가능한 세션이 없습니다", "warning"); return; }
				await openRevive(target, ctx);
				return;
			}
			if (sub && all[sub]) {
				await openRevive(all[sub], ctx);
				return;
			}

			if (sorted.length === 0) {
				ctx.ui.notify("재개 가능한 포크 세션이 없습니다", "info");
				return;
			}

			let selectedIndex = 0;
			let scrollOffset = 0;

			const selected = await ctx.ui.custom<ForkRecord | null>(
				(tui, theme, _kb, done) => ({
					render: (w: number) => {
						const rows = (tui as any).terminal?.rows ?? 30;
						const headerH = 3;
						const footerH = 1;
						const bodyH = Math.max(3, rows - headerH - footerH);
						const lines: string[] = [];

						lines.push(theme.fg("accent", "─".repeat(w)));
						lines.push(`  ${theme.fg("accent", theme.bold("REVIVE"))} ${theme.fg("accent", "|")} ${sorted.length} sessions ${theme.fg("accent", "·")} ${theme.fg("border", "Enter: open · q/Esc: close")}`);
						lines.push(`  ${theme.fg("border", "↑/↓ select · Enter open")}`);

						if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
						if (selectedIndex >= scrollOffset + bodyH) scrollOffset = selectedIndex - bodyH + 1;

						for (let i = scrollOffset; i < Math.min(sorted.length, scrollOffset + bodyH); i++) {
							const r = sorted[i];
							const sel = i === selectedIndex;
							const cursor = sel ? theme.fg("accent", "▶") : " ";
							const pad = (n: number) => String(n).padStart(2, "0");
							const d = new Date(r.closedAt ?? r.createdAt);
							const timeStr = theme.fg("borderAccent", `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
							const label = sel ? theme.fg("accent", r.label) : theme.fg("text", r.label);
							const status = r.closedAt ? "●" : theme.fg("success", "●");
							const previewW = Math.max(10, w - 45);
							const preview = r.preview ? r.preview.slice(0, previewW) : "";
							const previewStr = sel ? preview : theme.fg("borderAccent", preview);
							lines.push(truncateToWidth(`${cursor} ${status} ${timeStr} ${label}  ${previewStr}`, w, ""));
						}

						while (lines.length < headerH + bodyH) lines.push("");
						lines.push(theme.fg("accent", "─".repeat(w)));
						return lines;
					},
					handleInput: (data: string) => {
						if (data === "q" || matchesKey(data, Key.escape)) { done(null); return; }
						if (matchesKey(data, Key.up) || data === "k") {
							if (selectedIndex > 0) selectedIndex--;
						} else if (matchesKey(data, Key.down) || data === "j") {
							if (selectedIndex < sorted.length - 1) selectedIndex++;
						} else if (matchesKey(data, Key.enter)) {
							done(sorted[selectedIndex]);
							return;
						}
						(tui as any).requestRender?.();
					},
					invalidate: () => {},
				}),
				{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } },
			);

			if (selected) await openRevive(selected, ctx);
		},
	});

	async function openRevive(target: ForkRecord, ctx: ExtensionContext) {
		if (!existsSync(target.sessionFile)) {
			ctx.ui.notify(`세션 파일 없음: ${target.sessionFile}`, "error");
			return;
		}
		if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") {
			ctx.ui.notify("/revive는 macOS Ghostty에서만 동작합니다", "warning");
			return;
		}
		const cwd = target.cwd || ctx.cwd;
		const escStr = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
		const cmd = `cd \\"${escStr(cwd)}\\" && pi --session \\"${escStr(target.sessionFile)}\\"`;
		const script = `tell application "Ghostty"
  set currentTerm to focused terminal of selected tab of front window
  set newTerm to split currentTerm direction right
  input text "${cmd}" to newTerm
  send key "enter" to newTerm
end tell`;
		const result = await pi.exec("osascript", ["-e", script]);
		if (result.code !== 0) {
			ctx.ui.notify(`패널 생성 실패: ${result.stderr?.trim() ?? "unknown"}`, "error");
			return;
		}
		ctx.ui.notify(`${target.label} 세션 재개 → right 패널`, "info");
	}
}
