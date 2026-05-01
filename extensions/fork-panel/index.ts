import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";

const VALID_DIRS = ["right", "left", "down", "up", "tab"] as const;
type Direction = (typeof VALID_DIRS)[number];

const HANDOFF_DIR = join(homedir(), ".pi", "agent", "fork-panel");
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000; // 24h

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

function buildScript(direction: Direction, cwd: string, sessionFile: string, forkId: string, prompt?: string): string {
	const cmd = `PI_FORK_ID=${forkId} cd \\"${esc(cwd)}\\" && PI_FORK_ID=${forkId} pi --session \\"${esc(sessionFile)}\\"`;

	if (direction === "tab") {
		return `tell application "Ghostty"
  set newTerm to make new tab in front window
  input text "${cmd}" to newTerm
  send key "enter" to newTerm${prompt ? `\n  delay 2\n  input text "${esc(prompt)}" to newTerm\n  send key "enter" to newTerm` : ""}
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
		let alreadyFinalized = false;

		const writeHandoff = (final: boolean) => {
			try {
				const summary = extractLastAssistant(latestEntries);
				if (!summary) return;
				mkdirSync(HANDOFF_DIR, { recursive: true });
				const data: HandoffData = {
					forkId,
					parentSessionId: process.env.PI_FORK_PARENT,
					pid: process.pid,
					updatedAt: Date.now(),
					...(final ? { finishedAt: Date.now() } : {}),
					summary,
				};
				writeFileSync(handoffPath, JSON.stringify(data, null, 2));
			} catch {}
		};

		// Update on every assistant turn
		pi.on("agent_end", async (_e, ctx) => {
			latestEntries = ctx.sessionManager.getEntries();
			writeHandoff(false);
		});

		// Final write on graceful shutdown (/quit, Ctrl+C)
		pi.on("session_shutdown", async (_e, ctx) => {
			if (alreadyFinalized) return;
			alreadyFinalized = true;
			latestEntries = ctx.sessionManager.getEntries();
			writeHandoff(true);
		});

		// Final write on signals (Cmd+W, kill, etc.)
		for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
			process.on(sig, () => {
				if (!alreadyFinalized) {
					alreadyFinalized = true;
					writeHandoff(true);
				}
			});
		}
		// Continue to register fork-panel command/shortcuts so child can fork further
	}

	// All sessions (parent or child fork): can spawn new forks
	const activeWatchers = new Map<string, ReturnType<typeof setInterval>>();

	function watchHandoff(forkId: string, label: string) {
		const handoffPath = join(HANDOFF_DIR, `${forkId}.json`);
		const interval = setInterval(() => {
			if (!existsSync(handoffPath)) return;
			try {
				const data: HandoffData = JSON.parse(readFileSync(handoffPath, "utf8"));
				// Trigger handoff when:
				//   1. file has finishedAt marker (graceful shutdown), OR
				//   2. child PID is dead (Cmd+W, crash, etc.)
				const finished = !!data.finishedAt;
				const pidDead = data.pid && !isPidAlive(data.pid);
				if (!finished && !pidDead) return;

				const message = `[fork-panel handoff: ${label}]\n\n${data.summary}`;
				pi.sendUserMessage(message, { deliverAs: "followUp" });
				unlinkSync(handoffPath);
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
			const script = buildScript(direction, ctx.cwd, forkedFile, newForkId, prompt);
			const result = await pi.exec("osascript", ["-e", script]);

			if (result.code !== 0) {
				ctx.ui.notify(`패널 생성 실패: ${result.stderr?.trim() ?? "unknown"}`, "error");
				try { unlinkSync(forkedFile); } catch {}
				return;
			}

			// Register watcher for handoff
			const label = prompt ? prompt.slice(0, 40) : `${direction} panel`;
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
}
