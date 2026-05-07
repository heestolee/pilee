import { existsSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const SESSION_EXPORT_DIR = join(homedir(), ".pi", "agent", "state", "session-exports");
export const BACKLOG_SESSION_EXPORT_DIR = join(homedir(), ".pi", "agent", "state", "backlog-session-exports");

export function expandHome(filePath: string): string {
	if (filePath === "~") return homedir();
	if (filePath.startsWith("~/")) return join(homedir(), filePath.slice(2));
	return filePath;
}

export function displayPath(filePath: string): string {
	const expandedHome = homedir();
	if (filePath === expandedHome) return "~";
	if (filePath.startsWith(`${expandedHome}/`)) return `~/${filePath.slice(expandedHome.length + 1)}`;
	return filePath;
}

export async function openFile(pi: ExtensionAPI, filePath: string): Promise<void> {
	const plat = platform();
	const result = plat === "darwin"
		? await pi.exec("open", [filePath])
		: plat === "win32"
			? await pi.exec("cmd", ["/c", "start", "", filePath])
			: await pi.exec("xdg-open", [filePath]);
	if (result.code !== 0) throw new Error(result.stderr || `파일 열기 실패 (${result.code})`);
}

function safeSessionName(sessionFile: string): string {
	return basename(sessionFile, ".jsonl").replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 80) || "session";
}

export function sessionExportPath(sessionFile: string, options: { outputDir?: string; filenamePrefix?: string } = {}): string {
	const outputDir = options.outputDir ?? SESSION_EXPORT_DIR;
	const prefix = options.filenamePrefix?.trim();
	const filename = prefix ? `${prefix}-${safeSessionName(sessionFile)}.html` : `${safeSessionName(sessionFile)}.html`;
	return join(outputDir, filename);
}

export async function exportSessionFileToHtml(
	pi: ExtensionAPI,
	sessionFile: string,
	options: { outputDir?: string; filenamePrefix?: string } = {},
): Promise<string> {
	if (!existsSync(sessionFile)) throw new Error(`세션 파일을 찾을 수 없습니다: ${displayPath(sessionFile)}`);
	const outputPath = sessionExportPath(sessionFile, options);
	mkdirSync(options.outputDir ?? SESSION_EXPORT_DIR, { recursive: true });
	const cliPath = process.argv[1] && existsSync(process.argv[1]) ? process.argv[1] : undefined;
	const command = cliPath ? process.execPath : "pi";
	const args = cliPath ? [cliPath, "--export", sessionFile, outputPath] : ["--export", sessionFile, outputPath];
	const result = await pi.exec(command, args);
	if (result.code !== 0) throw new Error(result.stderr || result.stdout || `세션 export 실패 (${result.code})`);
	return outputPath;
}
