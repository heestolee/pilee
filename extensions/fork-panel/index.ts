import { randomUUID } from "node:crypto";
import { copyFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";

const VALID_DIRS = ["right", "left", "down", "up", "tab"] as const;
type Direction = (typeof VALID_DIRS)[number];

function esc(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildScript(direction: Direction, cwd: string, sessionFile: string, prompt?: string): string {
	const baseCmd = `cd \\"${esc(cwd)}\\" && pi --session \\"${esc(sessionFile)}\\"`;
	const cmd = prompt ? `${baseCmd}` : baseCmd;

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
	pi.registerCommand("fork-panel", {
		description: "Fork current session into a new Ghostty panel/tab (args: right|left|down|up|tab [prompt])",
		getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
			const filtered = VALID_DIRS.filter((d) => d.startsWith(prefix)).map((d) => ({ value: d, label: d }));
			return filtered.length > 0 ? filtered : null;
		},
		handler: async (args, ctx) => {
			if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") {
				ctx.ui.notify("/fork-panel은 macOS Ghostty 터미널에서만 동작합니다", "warning");
				return;
			}

			const sessionFile = ctx.sessionManager.getSessionFile();
			if (!sessionFile) {
				ctx.ui.notify("포크할 세션 파일이 없습니다 (ephemeral session)", "error");
				return;
			}

			// Parse args: first token is direction, rest is optional prompt
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

			try {
				copyFileSync(sessionFile, forkedFile);
			} catch (e) {
				ctx.ui.notify(`세션 파일 복사 실패: ${e instanceof Error ? e.message : e}`, "error");
				return;
			}

			// Open in Ghostty
			const script = buildScript(direction, ctx.cwd, forkedFile, prompt);
			const result = await pi.exec("osascript", ["-e", script]);

			if (result.code !== 0) {
				ctx.ui.notify(`패널 생성 실패: ${result.stderr?.trim() ?? "unknown"}`, "error");
				try { unlinkSync(forkedFile); } catch {}
				return;
			}

			ctx.ui.notify(
				`세션 포크 → ${direction === "tab" ? "새 탭" : `${direction} 패널`}${prompt ? ` (자동 prompt 전달됨)` : ""}`,
				"info",
			);
		},
	});
}
