import { closeSync, existsSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export type ArchiveSessionOpenTarget = "tab" | "here";

/** A resume must use the source header, never a guessed workspace or current cwd. */
export function resolveSessionHeaderCwd(sessionFile: string, expectedCwd?: string): string {
	const fd = openSync(sessionFile, "r");
	let header: { type?: string; cwd?: string };
	try {
		const buffer = Buffer.alloc(256 * 1024);
		const count = readSync(fd, buffer, 0, buffer.length, 0);
		const line = buffer.toString("utf8", 0, count).split(/\r?\n/).find((value) => value.trim());
		header = JSON.parse(line || "{}");
	} finally {
		closeSync(fd);
	}
	if (header.type !== "session" || typeof header.cwd !== "string" || !isAbsolute(header.cwd)) {
		throw new Error("원본 Pi session header의 cwd를 확인할 수 없어 전환을 차단했습니다.");
	}
	let cwd: string;
	try {
		cwd = realpathSync(header.cwd);
		if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error("원본 세션 cwd가 없습니다. 현행 Pi 공개 resume API는 cwd override를 지원하지 않아 다른 경로로 대신 열지 않았습니다.");
	}
	if (expectedCwd && realpathSync(expectedCwd) !== cwd) {
		throw new Error("Archive metadata와 원본 session header의 cwd가 달라 전환을 차단했습니다.");
	}
	return cwd;
}

export async function openArchiveSessionHere(
	ctx: Pick<ExtensionCommandContext, "switchSession">,
	sessionFile: string,
	openCwd: string,
	label: string,
): Promise<{ cancelled: boolean }> {
	const cwd = resolveSessionHeaderCwd(sessionFile, openCwd);
	return ctx.switchSession(sessionFile, {
		withSession: async (nextCtx) => {
			if (realpathSync(nextCtx.cwd) !== cwd) {
				throw new Error("세션 전환 후 cwd가 원본과 다릅니다. 재개 성공으로 처리하지 않았습니다.");
			}
			nextCtx.ui.notify(`${label} 세션 재개 → 현재 패널`, "info");
		},
	});
}

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
