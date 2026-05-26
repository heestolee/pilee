import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export type ArchiveSessionOpenTarget = "tab" | "here";

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function esc(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildEnvPrefix(env: Record<string, string | undefined>): string {
	const entries = Object.entries(env).filter(([, value]) => !!value);
	return entries.length > 0 ? `${entries.map(([key, value]) => `${key}=${shellQuote(value!)}`).join(" ")} ` : "";
}

export function currentPiCommand(): string {
	const envPi = process.env.PILEE_PI_BIN || process.env.PI_BIN;
	if (envPi && existsSync(envPi)) return shellQuote(envPi);
	const cliPath = process.argv[1] && existsSync(process.argv[1]) ? process.argv[1] : "";
	if (cliPath) return `${shellQuote(process.execPath)} ${shellQuote(cliPath)}`;
	const userWrapper = join(homedir(), ".local", "bin", "pi");
	if (existsSync(userWrapper)) return shellQuote(userWrapper);
	return "pi";
}

export function buildSessionLaunchCommand(cwd: string, sessionFile: string, env: Record<string, string | undefined> = {}): string {
	return `cd ${shellQuote(cwd)} && ${buildEnvPrefix(env)}${currentPiCommand()} --session ${shellQuote(sessionFile)}`;
}

export function buildOpenSessionTabScript(cwd: string, sessionFile: string, env: Record<string, string | undefined> = {}): string {
	const cmd = esc(buildSessionLaunchCommand(cwd, sessionFile, env));
	return `tell application "System Events"
  tell process "Ghostty"
    keystroke "t" using command down
    delay 1.0
    keystroke "${cmd}"
    key code 36
  end tell
end tell`;
}

export async function openSessionInGhosttyTab(pi: ExtensionAPI, cwd: string, sessionFile: string, env: Record<string, string | undefined> = {}) {
	if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") {
		throw new Error("새 탭 열기는 macOS Ghostty에서만 지원합니다.");
	}
	const result = await pi.exec("osascript", ["-e", buildOpenSessionTabScript(cwd, sessionFile, env)]);
	if (result.code !== 0) throw new Error(result.stderr?.trim() || "Ghostty 새 탭 열기 실패");
}
