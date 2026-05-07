import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const SESSION_EXPORT_DIR = join(homedir(), ".pi", "agent", "state", "session-exports");
export const BACKLOG_SESSION_EXPORT_DIR = join(homedir(), ".pi", "agent", "state", "backlog-session-exports");

const SESSION_EXPORT_CACHE_VERSION = "2026-05-08-no-tools-body-filter-v1";

interface SessionExportCacheMeta {
	cacheVersion: string;
	sourcePath: string;
	sourceSize: number;
	sourceMtimeMs: number;
	exportedAt: string;
}

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

export function isPiSessionFile(sessionFile: string): boolean {
	try {
		for (const line of readFileSync(sessionFile, "utf-8").split(/\r?\n/).slice(0, 5)) {
			if (!line.trim()) continue;
			const first = JSON.parse(line) as Record<string, unknown>;
			return first.type === "session" && typeof first.id === "string";
		}
	} catch {}
	return false;
}

function cacheMetaPath(outputPath: string): string {
	return `${outputPath}.meta.json`;
}

function sourceCacheMeta(sessionFile: string): Omit<SessionExportCacheMeta, "cacheVersion" | "exportedAt"> {
	const stat = statSync(sessionFile);
	return {
		sourcePath: realpathSync(sessionFile),
		sourceSize: stat.size,
		sourceMtimeMs: stat.mtimeMs,
	};
}

function readCacheMeta(outputPath: string): SessionExportCacheMeta | null {
	try { return JSON.parse(readFileSync(cacheMetaPath(outputPath), "utf-8")) as SessionExportCacheMeta; } catch { return null; }
}

function cacheMatches(outputPath: string, source: Omit<SessionExportCacheMeta, "cacheVersion" | "exportedAt">): boolean {
	if (!existsSync(outputPath)) return false;
	const meta = readCacheMeta(outputPath);
	return Boolean(meta
		&& meta.cacheVersion === SESSION_EXPORT_CACHE_VERSION
		&& meta.sourcePath === source.sourcePath
		&& meta.sourceSize === source.sourceSize
		&& meta.sourceMtimeMs === source.sourceMtimeMs);
}

function writeCacheMeta(outputPath: string, source: Omit<SessionExportCacheMeta, "cacheVersion" | "exportedAt">) {
	writeFileSync(cacheMetaPath(outputPath), JSON.stringify({
		cacheVersion: SESSION_EXPORT_CACHE_VERSION,
		...source,
		exportedAt: new Date().toISOString(),
	}, null, 2));
}

function patchSessionExportHtml(html: string): string {
	let patched = html
		.replace('let filterMode = \'default\';', 'let filterMode = \'no-tools\';')
		.replace('class="filter-btn active" data-filter="default"', 'class="filter-btn" data-filter="default"')
		.replace('class="filter-btn" data-filter="no-tools"', 'class="filter-btn active" data-filter="no-tools"');

	if (!patched.includes("function entryPassesContentFilter(entry)")) {
		const marker = "      function navigateTo(targetId, scrollMode = 'target', scrollToEntryId = null) {";
		const helper = `      function entryPassesContentFilter(entry) {
        if (entry.type === 'message' && entry.message.role === 'assistant') {
          const msg = entry.message;
          const hasText = hasTextContent(msg.content);
          const isErrorOrAborted = msg.stopReason && msg.stopReason !== 'stop' && msg.stopReason !== 'toolUse';
          if (!hasText && !isErrorOrAborted) return false;
        }

        const isSettingsEntry = ['label', 'custom', 'model_change', 'thinking_level_change'].includes(entry.type);
        switch (filterMode) {
          case 'user-only':
            return entry.type === 'message' && entry.message.role === 'user';
          case 'no-tools':
            return !isSettingsEntry && !(entry.type === 'message' && entry.message.role === 'toolResult');
          case 'labeled-only':
            return labelMap.has(entry.id);
          case 'all':
            return true;
          default:
            return !isSettingsEntry;
        }
      }

`;
		patched = patched.replace(marker, `${helper}${marker}`);
	}

	patched = patched.replace(
		`        for (const entry of path) {
          const node = renderEntryToNode(entry);
          if (node) {
            fragment.appendChild(node);
          }
        }`,
		`        for (const entry of path) {
          if (!entryPassesContentFilter(entry)) continue;
          const node = renderEntryToNode(entry);
          if (node) {
            fragment.appendChild(node);
          }
        }`,
	);

	patched = patched.replace(
		`          filterMode = btn.dataset.filter;
          forceTreeRerender();`,
		`          filterMode = btn.dataset.filter;
          navigateTo(currentLeafId || leafId, 'none');`,
	);

	return patched;
}

function patchSessionExportFile(outputPath: string) {
	const html = readFileSync(outputPath, "utf-8");
	const patched = patchSessionExportHtml(html);
	if (patched !== html) writeFileSync(outputPath, patched, "utf-8");
}

export async function exportSessionFileToHtml(
	pi: ExtensionAPI,
	sessionFile: string,
	options: { outputDir?: string; filenamePrefix?: string } = {},
): Promise<string> {
	if (!existsSync(sessionFile)) throw new Error(`세션 파일을 찾을 수 없습니다: ${displayPath(sessionFile)}`);
	if (!isPiSessionFile(sessionFile)) throw new Error(`Pi session JSONL만 HTML export할 수 있습니다: ${displayPath(sessionFile)}`);
	const outputPath = sessionExportPath(sessionFile, options);
	mkdirSync(options.outputDir ?? SESSION_EXPORT_DIR, { recursive: true });
	const source = sourceCacheMeta(sessionFile);
	if (cacheMatches(outputPath, source)) return outputPath;
	const cliPath = process.argv[1] && existsSync(process.argv[1]) ? process.argv[1] : undefined;
	const command = cliPath ? process.execPath : "pi";
	const args = cliPath ? [cliPath, "--export", sessionFile, outputPath] : ["--export", sessionFile, outputPath];
	const result = await pi.exec(command, args);
	if (result.code !== 0) throw new Error(result.stderr || result.stdout || `세션 export 실패 (${result.code})`);
	patchSessionExportFile(outputPath);
	writeCacheMeta(outputPath, source);
	return outputPath;
}
