import { randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { resolveForkPanelIdentity } from "../utils/fork-panel-identity.ts";

const HOST = "ghostty";
const SNAPSHOT_VERSION = 1;
const WORKSPACE_DIR = join(getAgentDir(), "workspaces");
const SNAPSHOT_DIR = join(WORKSPACE_DIR, "snapshots");
const ACTIVE_PATH = join(WORKSPACE_DIR, "active-sessions.json");
const AUTOSAVE_ID = "autosave";
const ACTIVE_TTL_MS = 24 * 60 * 60 * 1000;
const AUTOSAVE_INTERVAL_MS = 30_000;
const AUTOSAVE_MIN_GAP_MS = 20_000;
const AUTOSAVE_STATE_PATH = join(WORKSPACE_DIR, "autosave-state.json");

let autosaveScheduled = false;
let latestContext: ExtensionContext | undefined;

type WorkspaceSource = "manual" | "auto";
type WorkspaceHost = typeof HOST;

type ActiveSessionRecord = {
	sessionFile: string;
	cwd: string;
	title: string;
	panelLabel: string;
	forkId?: string;
	parentSessionFile?: string;
	updatedAt: number;
	pid: number;
};

type GhosttyTerminal = {
	id: string;
	index: number;
	name: string;
	cwd: string;
};

type GhosttyTab = {
	id: string;
	index: number;
	selected: boolean;
	name: string;
	terminals: GhosttyTerminal[];
};

type GhosttyWindow = {
	id: string;
	name: string;
	tabs: GhosttyTab[];
};

type WorkspaceTerminalSnapshot = GhosttyTerminal & {
	sessionFile?: string;
	sessionTitle?: string;
	panelLabel?: string;
	forkId?: string;
	parentSessionFile?: string;
	match?: "active" | "fallback" | "none";
};

type WorkspaceTabSnapshot = Omit<GhosttyTab, "terminals"> & {
	terminals: WorkspaceTerminalSnapshot[];
};

type WorkspaceSnapshot = {
	version: typeof SNAPSHOT_VERSION;
	id: string;
	name: string;
	source: WorkspaceSource;
	host: WorkspaceHost;
	createdAt: number;
	updatedAt: number;
	window: {
		id: string;
		name: string;
	};
	tabs: WorkspaceTabSnapshot[];
};

type WorkspaceSummary = {
	id: string;
	name: string;
	source: WorkspaceSource;
	updatedAt: number;
	tabs: number;
	terminals: number;
	matched: number;
	path: string;
};

type WorkspaceArgs = {
	sub: "save" | "restore" | "list" | "status" | "help";
	target?: string;
	name?: string;
	dryRun: boolean;
	append: boolean;
};

type RestoreAction = {
	tabName: string;
	terminalName: string;
	cwd: string;
	sessionFile?: string;
	panelLabel?: string;
	command?: string;
	skipReason?: string;
};

type RestorePlan = {
	snapshot: WorkspaceSnapshot;
	actions: RestoreAction[][];
	runnable: number;
	skipped: number;
	mode: "append";
};

function ensureWorkspaceDirs() {
	mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function escAppleScript(value: string): string {
	return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function safeRealpath(path: string): string {
	try { return realpathSync.native(path); } catch { return path; }
}

function readJson<T>(path: string, fallback: T): T {
	try {
		if (!existsSync(path)) return fallback;
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return fallback;
	}
}

function writeJson(path: string, value: unknown) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(value, null, 2));
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeTitle(value: string): string {
	const currentUser = basename(homedir());
	return value
		.replace(/^π\s*-\s*/u, "")
		.replace(new RegExp(`\\s+-\\s+${escapeRegex(currentUser)}$`, "u"), "")
		.trim()
		.toLowerCase();
}

function displayDate(ts: number): string {
	return new Date(ts).toLocaleString("ko-KR", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9가-힣._-]+/giu, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48) || "workspace";
}

function currentPiCommand(): string {
	const envPi = process.env.PILEE_PI_BIN || process.env.PI_BIN;
	if (envPi && existsSync(envPi)) return shellQuote(envPi);
	const cliPath = process.argv[1] && existsSync(process.argv[1]) ? process.argv[1] : "";
	if (cliPath) return `${shellQuote(process.execPath)} ${shellQuote(cliPath)}`;
	const userWrapper = join(homedir(), ".local", "bin", "pi");
	if (existsSync(userWrapper)) return shellQuote(userWrapper);
	return "pi";
}

function buildEnvPrefix(env: Record<string, string | undefined>): string {
	const entries = Object.entries(env).filter(([, value]) => Boolean(value));
	return entries.length > 0 ? `${entries.map(([key, value]) => `${key}=${shellQuote(value!)}`).join(" ")} ` : "";
}

function buildSessionLaunchCommand(term: WorkspaceTerminalSnapshot): string | undefined {
	if (!term.sessionFile) return undefined;
	const env = term.panelLabel && term.panelLabel !== "P0"
		? {
			PI_FORK_ID: term.forkId,
			PI_FORK_PANEL_LABEL: term.panelLabel,
			PI_FORK_PARENT: term.parentSessionFile,
		}
		: {};
	return `cd ${shellQuote(term.cwd || homedir())} && ${buildEnvPrefix(env)}${currentPiCommand()} --session ${shellQuote(term.sessionFile)}`;
}

function readActiveRecords(): ActiveSessionRecord[] {
	const raw = readJson<{ records?: ActiveSessionRecord[] }>(ACTIVE_PATH, { records: [] }).records ?? [];
	const cutoff = Date.now() - ACTIVE_TTL_MS;
	return raw
		.filter((record) => record.updatedAt >= cutoff && record.sessionFile && existsSync(record.sessionFile))
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

function writeActiveRecord(ctx: ExtensionContext) {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return;
	const sessionTitle = ctx.sessionManager.getSessionName() || basename(sessionFile).replace(/\.jsonl$/u, "");
	const identity = resolveForkPanelIdentity({ sessionFile });
	const next: ActiveSessionRecord = {
		sessionFile: safeRealpath(sessionFile),
		cwd: ctx.sessionManager.getCwd(),
		title: sessionTitle,
		panelLabel: identity.panelLabel,
		forkId: identity.forkId,
		parentSessionFile: identity.parentSessionFile,
		updatedAt: Date.now(),
		pid: process.pid,
	};
	const records = readActiveRecords().filter((record) => safeRealpath(record.sessionFile) !== next.sessionFile);
	records.unshift(next);
	ensureWorkspaceDirs();
	writeFileSync(ACTIVE_PATH, JSON.stringify({ updatedAt: Date.now(), records: records.slice(0, 500) }, null, 2));
}

function scoreActiveRecord(term: GhosttyTerminal, record: ActiveSessionRecord): number {
	let score = 0;
	if (safeRealpath(term.cwd) === safeRealpath(record.cwd)) score += 50;
	const terminalTitle = normalizeTitle(term.name);
	const recordTitle = normalizeTitle(record.title);
	if (terminalTitle && recordTitle) {
		if (terminalTitle === recordTitle) score += 60;
		else if (terminalTitle.includes(recordTitle) || recordTitle.includes(terminalTitle)) score += 35;
	}
	if (term.name.includes(record.title)) score += 15;
	return score;
}

function findActiveMatch(term: GhosttyTerminal, records: ActiveSessionRecord[]): ActiveSessionRecord | undefined {
	let best: { record: ActiveSessionRecord; score: number } | undefined;
	for (const record of records) {
		const score = scoreActiveRecord(term, record);
		if (score < 65) continue;
		if (!best || score > best.score || (score === best.score && record.updatedAt > best.record.updatedAt)) {
			best = { record, score };
		}
	}
	return best?.record;
}

function readSessionSample(sessionFile: string, bytes = 128 * 1024): string {
	let fd: number | undefined;
	try {
		const stat = statSync(sessionFile);
		fd = openSync(sessionFile, "r");
		const headLength = Math.min(bytes, stat.size);
		const head = Buffer.alloc(headLength);
		readSync(fd, head, 0, headLength, 0);
		if (stat.size <= bytes) return head.toString("utf8");

		const tailLength = Math.min(bytes, stat.size - headLength);
		const tail = Buffer.alloc(tailLength);
		readSync(fd, tail, 0, tailLength, Math.max(headLength, stat.size - tailLength));
		return `${head.toString("utf8")}\n${tail.toString("utf8")}`;
	} catch {
		return "";
	} finally {
		if (fd !== undefined) {
			try { closeSync(fd); } catch {}
		}
	}
}

function parseSessionInfo(sessionFile: string): { title?: string; cwd?: string } {
	const sample = readSessionSample(sessionFile);
	if (!sample) return {};
	const lines = sample.split(/\r?\n/u).filter(Boolean).slice(0, 400);
	let title: string | undefined;
	let cwd: string | undefined;
	for (const line of lines) {
		try {
			const entry = JSON.parse(line);
			if (entry?.type === "session" && typeof entry.cwd === "string") cwd = entry.cwd;
			if (entry?.type === "session_info" && typeof entry.name === "string") title = entry.name;
			if (title && cwd) break;
		} catch {}
	}
	return { title, cwd };
}

function collectRecentSessionFallbacks(limit = 500): ActiveSessionRecord[] {
	const sessionsRoot = join(getAgentDir(), "sessions");
	const files: string[] = [];
	function walk(dir: string, depth: number) {
		if (depth > 3 || files.length > limit * 3) return;
		let entries: string[] = [];
		try { entries = readdirSync(dir); } catch { return; }
		for (const entry of entries) {
			const path = join(dir, entry);
			let st;
			try { st = statSync(path); } catch { continue; }
			if (st.isDirectory()) walk(path, depth + 1);
			else if (entry.endsWith(".jsonl")) files.push(path);
		}
	}
	walk(sessionsRoot, 0);
	return files
		.map((file) => {
			let st;
			try { st = statSync(file); } catch { return null; }
			return { file, mtime: st.mtimeMs };
		})
		.filter((item): item is { file: string; mtime: number } => Boolean(item))
		.sort((a, b) => b.mtime - a.mtime)
		.slice(0, limit)
		.map(({ file, mtime }) => {
			const meta = parseSessionInfo(file);
			const identity = resolveForkPanelIdentity({ sessionFile: file });
			return {
				sessionFile: safeRealpath(file),
				cwd: meta.cwd || homedir(),
				title: meta.title || basename(file).replace(/\.jsonl$/u, ""),
				panelLabel: identity.panelLabel,
				forkId: identity.forkId,
				parentSessionFile: identity.parentSessionFile,
				updatedAt: mtime,
				pid: 0,
			};
		});
}

function enrichWindow(window: GhosttyWindow, includeFallback: boolean): WorkspaceTabSnapshot[] {
	const active = readActiveRecords();
	const fallback = includeFallback ? collectRecentSessionFallbacks() : [];
	return window.tabs.map((tab) => ({
		...tab,
		terminals: tab.terminals.map((term) => {
			const activeMatch = findActiveMatch(term, active);
			const fallbackMatch = activeMatch ? undefined : findActiveMatch(term, fallback);
			const match = activeMatch ?? fallbackMatch;
			return {
				...term,
				sessionFile: match?.sessionFile,
				sessionTitle: match?.title,
				panelLabel: match?.panelLabel,
				forkId: match?.forkId,
				parentSessionFile: match?.parentSessionFile,
				match: activeMatch ? "active" : fallbackMatch ? "fallback" : "none",
			};
		}),
	}));
}

function snapshotPath(id: string): string {
	return join(SNAPSHOT_DIR, `${id}.json`);
}

function saveSnapshot(snapshot: WorkspaceSnapshot): string {
	ensureWorkspaceDirs();
	const path = snapshotPath(snapshot.id);
	writeFileSync(path, JSON.stringify(snapshot, null, 2));
	return path;
}

function readSnapshot(path: string): WorkspaceSnapshot | null {
	try {
		const snapshot = JSON.parse(readFileSync(path, "utf8")) as WorkspaceSnapshot;
		if (snapshot.version !== SNAPSHOT_VERSION || snapshot.host !== HOST) return null;
		return snapshot;
	} catch {
		return null;
	}
}

function listSnapshots(): WorkspaceSummary[] {
	ensureWorkspaceDirs();
	return readdirSync(SNAPSHOT_DIR)
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => {
			const path = join(SNAPSHOT_DIR, entry);
			const snapshot = readSnapshot(path);
			if (!snapshot) return null;
			const terminals = snapshot.tabs.flatMap((tab) => tab.terminals);
			return {
				id: snapshot.id,
				name: snapshot.name,
				source: snapshot.source,
				updatedAt: snapshot.updatedAt,
				tabs: snapshot.tabs.length,
				terminals: terminals.length,
				matched: terminals.filter((term) => term.sessionFile).length,
				path,
			};
		})
		.filter((summary): summary is WorkspaceSummary => Boolean(summary))
		.sort((a, b) => b.updatedAt - a.updatedAt);
}

function resolveSnapshot(target?: string): { snapshot?: WorkspaceSnapshot; summary?: WorkspaceSummary; error?: string } {
	const summaries = listSnapshots();
	if (summaries.length === 0) return { error: "저장된 workspace snapshot이 없습니다. 먼저 /workspace save를 실행하세요." };
	let summary: WorkspaceSummary | undefined;
	if (target) {
		const normalized = target.toLowerCase();
		if (/^[1-9]\d*$/u.test(normalized)) {
			const index = Number.parseInt(normalized, 10) - 1;
			summary = summaries[index];
			if (!summary) return { error: `snapshot 번호를 찾지 못했습니다: ${target} (범위: 1-${summaries.length})` };
		} else {
			summary = summaries.find((item) => item.id.toLowerCase() === normalized)
				?? summaries.find((item) => item.name.toLowerCase() === normalized)
				?? summaries.find((item) => item.id.toLowerCase().includes(normalized) || item.name.toLowerCase().includes(normalized));
			if (!summary) return { error: `snapshot을 찾지 못했습니다: ${target}` };
		}
	} else {
		summary = summaries[0];
	}
	const snapshot = readSnapshot(summary.path);
	if (!snapshot) return { error: `snapshot 파일을 읽지 못했습니다: ${summary.path}` };
	return { snapshot, summary };
}

function buildSnapshot(window: GhosttyWindow, source: WorkspaceSource, name?: string, includeFallback = true): WorkspaceSnapshot {
	const now = Date.now();
	const label = name?.trim() || (source === "auto" ? "autosave" : `workspace ${displayDate(now)}`);
	const id = source === "auto"
		? AUTOSAVE_ID
		: `${new Date(now).toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${slugify(label)}-${randomUUID().slice(0, 6)}`;
	return {
		version: SNAPSHOT_VERSION,
		id,
		name: label,
		source,
		host: HOST,
		createdAt: now,
		updatedAt: now,
		window: { id: window.id, name: window.name },
		tabs: enrichWindow(window, includeFallback),
	};
}

export function parseGhosttySnapshotOutput(stdout: string): GhosttyWindow {
	const window: GhosttyWindow = { id: "", name: "", tabs: [] };
	let currentTab: GhosttyTab | undefined;
	for (const line of stdout.split(/\r?\n/u)) {
		if (!line.trim()) continue;
		const [kind, ...parts] = line.split("\t");
		if (kind === "WINDOW") {
			window.id = parts[0] || "";
			window.name = parts[1] || "";
			continue;
		}
		if (kind === "TAB") {
			currentTab = {
				id: parts[0] || "",
				index: Number.parseInt(parts[1] || "0", 10) || window.tabs.length + 1,
				selected: (parts[2] || "").toLowerCase() === "true",
				name: parts[3] || "",
				terminals: [],
			};
			window.tabs.push(currentTab);
			continue;
		}
		if (kind === "TERM" && currentTab) {
			currentTab.terminals.push({
				id: parts[0] || "",
				index: Number.parseInt(parts[1] || "0", 10) || currentTab.terminals.length + 1,
				name: parts[2] || "",
				cwd: parts[3] || homedir(),
			});
		}
	}
	return window;
}

export function ghosttySnapshotScript(): string {
	return `property tabChar : character id 9
property newlineChar : character id 10

on cleanText(value)
  set s to value as text
  set s to my replaceText(tabChar, " ", s)
  set s to my replaceText(newlineChar, " ", s)
  set s to my replaceText(return, " ", s)
  return s
end cleanText

on replaceText(findText, replaceText, sourceText)
  set AppleScript's text item delimiters to findText
  set textItems to text items of sourceText
  set AppleScript's text item delimiters to replaceText
  set sourceText to textItems as text
  set AppleScript's text item delimiters to ""
  return sourceText
end replaceText

tell application "Ghostty"
  if not running then error "Ghostty is not running"
  set targetWindow to front window
  set out to "WINDOW" & tabChar & (id of targetWindow as text) & tabChar & my cleanText(name of targetWindow) & newlineChar
  repeat with targetTab in tabs of targetWindow
    set out to out & "TAB" & tabChar & (id of targetTab as text) & tabChar & (index of targetTab as text) & tabChar & (selected of targetTab as text) & tabChar & my cleanText(name of targetTab) & newlineChar
    set termIndex to 0
    repeat with targetTerm in terminals of targetTab
      set termIndex to termIndex + 1
      set termCwd to ""
      try
        set termCwd to working directory of targetTerm as text
      end try
      set out to out & "TERM" & tabChar & (id of targetTerm as text) & tabChar & (termIndex as text) & tabChar & my cleanText(name of targetTerm) & tabChar & my cleanText(termCwd) & newlineChar
    end repeat
  end repeat
  return out
end tell`;
}

async function captureGhosttyWindow(pi: ExtensionAPI): Promise<GhosttyWindow> {
	const result = await pi.exec("osascript", ["-e", ghosttySnapshotScript()]);
	if (result.code !== 0) {
		throw new Error((result.stderr || result.stdout || "Ghostty snapshot 실패").trim());
	}
	const window = parseGhosttySnapshotOutput(result.stdout || "");
	if (window.tabs.length === 0) throw new Error("Ghostty tab을 찾지 못했습니다.");
	return window;
}

function tokenizeArgs(args: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: string | null = null;
	let escaped = false;
	for (const ch of args) {
		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (ch === quote) quote = null;
			else current += ch;
			continue;
		}
		if (ch === "'" || ch === '"') {
			quote = ch;
			continue;
		}
		if (/\s/u.test(ch)) {
			if (current) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += ch;
	}
	if (current) tokens.push(current);
	return tokens;
}

export function parseWorkspaceArgs(args: string): WorkspaceArgs {
	const tokens = tokenizeArgs(args);
	const first = (tokens.shift() || "status").toLowerCase();
	const sub = ["save", "restore", "list", "status", "help"].includes(first)
		? first as WorkspaceArgs["sub"]
		: "status";
	const rest = sub === "status" && first !== "status" ? [first, ...tokens] : tokens;
	let dryRun = false;
	let append = true;
	const positional: string[] = [];
	for (const token of rest) {
		if (token === "--dry-run" || token === "-n") dryRun = true;
		else if (token === "--append") append = true;
		else positional.push(token);
	}
	if (sub === "save") return { sub, name: positional.join(" ").trim() || undefined, dryRun, append };
	if (sub === "restore") return { sub, target: positional.join(" ").trim() || undefined, dryRun, append };
	return { sub, target: positional.join(" ").trim() || undefined, dryRun, append };
}

export function buildRestorePlan(snapshot: WorkspaceSnapshot): RestorePlan {
	const actions = snapshot.tabs.map((tab) => tab.terminals.map((term) => {
		const command = buildSessionLaunchCommand(term);
		return {
			tabName: tab.name || `tab ${tab.index}`,
			terminalName: term.name || `terminal ${term.index}`,
			cwd: term.cwd || homedir(),
			sessionFile: term.sessionFile,
			panelLabel: term.panelLabel || "P0",
			command,
			skipReason: command ? undefined : "연결된 Pi sessionFile 없음",
		};
	}));
	const flat = actions.flat();
	return {
		snapshot,
		actions,
		runnable: flat.filter((action) => action.command).length,
		skipped: flat.filter((action) => !action.command).length,
		mode: "append",
	};
}

function renderSnapshotSummary(summary: WorkspaceSummary, index?: number): string {
	const prefix = typeof index === "number" ? `${index + 1}. ` : "";
	const source = summary.source === "auto" ? "auto" : "manual";
	return `${prefix}${summary.name} (${summary.id}) · ${source} · ${displayDate(summary.updatedAt)} · tab ${summary.tabs}, panel ${summary.terminals}, session ${summary.matched}/${summary.terminals}`;
}

function renderList(summaries: WorkspaceSummary[]): string {
	if (summaries.length === 0) return "저장된 workspace snapshot이 없습니다.";
	return ["저장된 workspace snapshots", "", ...summaries.map(renderSnapshotSummary)].join("\n");
}

export function renderPlan(plan: RestorePlan): string {
	const lines = [
		`Workspace restore plan — ${plan.snapshot.name}`,
		`mode: append · tabs ${plan.snapshot.tabs.length} · runnable ${plan.runnable} · skipped ${plan.skipped}`,
		"",
	];
	plan.actions.forEach((tabActions, tabIndex) => {
		const tab = plan.snapshot.tabs[tabIndex];
		lines.push(`Tab ${tabIndex + 1}: ${tab.name || `tab ${tab.index}`} · panels ${tabActions.length}`);
		tabActions.forEach((action, termIndex) => {
			const state = action.command ? "RUN" : "SKIP";
			const label = action.panelLabel ? ` · ${action.panelLabel}` : "";
			const reason = action.skipReason ? ` · ${action.skipReason}` : "";
			lines.push(`  ${termIndex + 1}. ${state}${label} · ${action.terminalName} · ${action.cwd}${reason}`);
		});
	});
	return lines.join("\n");
}

export function buildRestoreScript(plan: RestorePlan): string {
	const lines: string[] = [
		`tell application "Ghostty"`,
		`  activate`,
		`end tell`,
	];
	for (const tabActions of plan.actions) {
		const runnableActions = tabActions.filter((action) => action.command);
		if (runnableActions.length === 0) continue;
		lines.push(`tell application "System Events"`);
		lines.push(`  tell process "Ghostty"`);
		lines.push(`    keystroke "t" using command down`);
		lines.push(`  end tell`);
		lines.push(`end tell`);
		lines.push(`delay 0.8`);
		runnableActions.forEach((action, index) => {
			if (!action.command) return;
			if (index === 0) {
				lines.push(`tell application "Ghostty"`);
				lines.push(`  set targetTerm to focused terminal of selected tab of front window`);
				lines.push(`  input text "${escAppleScript(action.command)}" to targetTerm`);
				lines.push(`  send key "enter" to targetTerm`);
				lines.push(`end tell`);
				lines.push(`delay 0.5`);
			} else {
				lines.push(`tell application "Ghostty"`);
				lines.push(`  set currentTerm to focused terminal of selected tab of front window`);
				lines.push(`  set newTerm to split currentTerm direction right`);
				lines.push(`  input text "${escAppleScript(action.command)}" to newTerm`);
				lines.push(`  send key "enter" to newTerm`);
				lines.push(`end tell`);
				lines.push(`delay 0.5`);
			}
		});
	}
	return lines.join("\n");
}

async function runRestore(pi: ExtensionAPI, plan: RestorePlan): Promise<string> {
	if (plan.runnable === 0) throw new Error("복원 가능한 Pi session이 없습니다.");
	ensureWorkspaceDirs();
	const script = buildRestoreScript(plan);
	const path = join(WORKSPACE_DIR, `restore-${Date.now()}-${randomUUID().slice(0, 6)}.applescript`);
	writeFileSync(path, script);
	const result = await pi.exec("osascript", [path]);
	if (result.code !== 0) throw new Error((result.stderr || result.stdout || "workspace restore 실패").trim());
	return path;
}

function sendReport(pi: ExtensionAPI, title: string, body: string) {
	pi.sendMessage({
		customType: "workspace",
		content: `### ${title}\n\n${body}`,
		display: true,
		details: { title, body },
	}, { triggerTurn: false });
}

async function handleSave(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: WorkspaceArgs) {
	writeActiveRecord(ctx);
	const window = await captureGhosttyWindow(pi);
	const snapshot = buildSnapshot(window, "manual", args.name, true);
	const path = saveSnapshot(snapshot);
	const summary: WorkspaceSummary = {
		id: snapshot.id,
		name: snapshot.name,
		source: snapshot.source,
		updatedAt: snapshot.updatedAt,
		tabs: snapshot.tabs.length,
		terminals: snapshot.tabs.flatMap((tab) => tab.terminals).length,
		matched: snapshot.tabs.flatMap((tab) => tab.terminals).filter((term) => term.sessionFile).length,
		path,
	};
	ctx.ui.notify(`workspace 저장 완료: ${summary.tabs} tabs / ${summary.matched}/${summary.terminals} sessions`, "info");
	sendReport(pi, "Workspace 저장 완료", `${renderSnapshotSummary(summary)}\n\npath: ${path}`);
}

async function handleRestore(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: WorkspaceArgs) {
	const resolved = resolveSnapshot(args.target);
	if (!resolved.snapshot) {
		ctx.ui.notify(resolved.error || "snapshot을 찾지 못했습니다.", "error");
		return;
	}
	const plan = buildRestorePlan(resolved.snapshot);
	const report = renderPlan(plan);
	if (args.dryRun) {
		ctx.ui.notify("workspace restore dry-run plan을 표시했습니다.", "info");
		sendReport(pi, "Workspace restore dry-run", report);
		return;
	}
	const scriptPath = await runRestore(pi, plan);
	ctx.ui.notify(`workspace 복원 시작: ${plan.runnable} panels`, "info");
	sendReport(pi, "Workspace restore 실행", `${report}\n\nscript: ${scriptPath}`);
}

async function handleStatus(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	writeActiveRecord(ctx);
	let liveLine = "현재 Ghostty window: 확인 실패";
	try {
		const window = await captureGhosttyWindow(pi);
		const tabs = window.tabs.length;
		const terminals = window.tabs.flatMap((tab) => tab.terminals).length;
		liveLine = `현재 Ghostty window: tab ${tabs}, panel ${terminals}`;
	} catch (error) {
		liveLine = `현재 Ghostty window: ${(error instanceof Error ? error.message : String(error)).slice(0, 160)}`;
	}
	const summaries = listSnapshots();
	const latest = summaries[0] ? renderSnapshotSummary(summaries[0]) : "저장된 snapshot 없음";
	const activeCount = readActiveRecords().length;
	const body = [
		liveLine,
		`active session registry: ${activeCount}`,
		`latest snapshot: ${latest}`,
		"",
		"commands:",
		"  /workspace save [name]",
		"  /workspace restore [number|name-or-id] [--dry-run] [--append]",
		"  /workspace list",
		"  /workspace status",
	].join("\n");
	ctx.ui.notify("workspace 상태를 표시했습니다.", "info");
	sendReport(pi, "Workspace status", body);
}

async function autosave(pi: ExtensionAPI, ctx: ExtensionContext) {
	if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") return;
	const state = readJson<{ lastSavedAt?: number }>(AUTOSAVE_STATE_PATH, {});
	if (state.lastSavedAt && Date.now() - state.lastSavedAt < AUTOSAVE_MIN_GAP_MS) return;
	writeJson(AUTOSAVE_STATE_PATH, { lastSavedAt: Date.now(), pid: process.pid });
	try {
		writeActiveRecord(ctx);
		const window = await captureGhosttyWindow(pi);
		const snapshot = buildSnapshot(window, "auto", "autosave", false);
		saveSnapshot(snapshot);
		writeJson(AUTOSAVE_STATE_PATH, { lastSavedAt: Date.now(), pid: process.pid, ok: true });
	} catch (error) {
		writeJson(AUTOSAVE_STATE_PATH, {
			lastSavedAt: Date.now(),
			pid: process.pid,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

function scheduleAutosave(pi: ExtensionAPI, ctx: ExtensionContext) {
	latestContext = ctx;
	if (autosaveScheduled) return;
	if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") return;
	autosaveScheduled = true;
	const initialDelay = 5_000 + Math.floor(Math.random() * 5_000);
	setTimeout(() => { if (latestContext) void autosave(pi, latestContext); }, initialDelay).unref?.();
	setInterval(() => { if (latestContext) void autosave(pi, latestContext); }, AUTOSAVE_INTERVAL_MS).unref?.();
}

const HELP = `Ghostty workspace snapshot/restore

Usage:
  /workspace status
  /workspace save [name]
  /workspace restore [number|name-or-id] [--dry-run] [--append]
  /workspace list

Notes:
- 기본 restore mode는 append입니다. 현재 창을 닫거나 대체하지 않습니다.
- /workspace list의 번호를 그대로 /workspace restore <번호>에 사용할 수 있습니다.
- autosave는 session 시작 5~10초 뒤 첫 저장 후 약 30초마다 갱신됩니다.
- Ghostty AppleScript가 split tree/비율을 제공하지 않아 split panel은 순차 right split으로 근사 복원합니다.
- Pi session 매핑은 active session registry를 우선하고, 수동 save에서는 최근 session fallback을 보조로 사용합니다.`;

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		writeActiveRecord(ctx);
		scheduleAutosave(pi, ctx);
	});
	pi.on("message_end", async (_event, ctx) => {
		latestContext = ctx;
		writeActiveRecord(ctx);
	});
	pi.on("agent_end", async (_event, ctx) => {
		latestContext = ctx;
		writeActiveRecord(ctx);
	});

	pi.registerCommand("workspace", {
		description: "Ghostty 작업공간 저장/복원",
		getArgumentCompletions: async (): Promise<AutocompleteItem[]> => [
			{ value: "status", label: "status", description: "현재 Ghostty workspace 상태" },
			{ value: "save", label: "save", description: "현재 Ghostty window snapshot 저장" },
			{ value: "restore --dry-run", label: "restore --dry-run", description: "최신 snapshot 복원 계획만 보기" },
			{ value: "restore", label: "restore", description: "최신 snapshot을 append mode로 복원" },
			{ value: "list", label: "list", description: "저장된 snapshots 목록" },
		],
		handler: async (rawArgs: string, ctx: ExtensionCommandContext) => {
			const args = parseWorkspaceArgs(rawArgs);
			try {
				if (args.sub === "help") {
					ctx.ui.notify(HELP, "info");
					return;
				}
				if (args.sub === "save") return await handleSave(pi, ctx, args);
				if (args.sub === "restore") return await handleRestore(pi, ctx, args);
				if (args.sub === "list") {
					const body = renderList(listSnapshots());
					ctx.ui.notify("workspace snapshot 목록을 표시했습니다.", "info");
					sendReport(pi, "Workspace list", body);
					return;
				}
				return await handleStatus(pi, ctx);
			} catch (error) {
				ctx.ui.notify(`workspace 오류: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
