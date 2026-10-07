import { createHash, randomUUID } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { bindCapturedWindow, captureGhosttyWindow, type GhosttyTerminal, type GhosttyTab, type GhosttyWindow } from "./capture.ts";
import { createSessionRegistration, type RegistrationEnvironment } from "./registration.ts";
import { readRegistrations } from "./registry.ts";
import { saveCompleteSnapshot } from "./store.ts";
export { parseGhosttySnapshotOutput, ghosttySnapshotScript } from "./capture.ts";
import { receiveRestoreSession, restoreWorkspace } from "./restore.ts";
import { pinSnapshotSelection, readSnapshotSelection, selectSnapshot, type PinnedSnapshotSource, type SnapshotReference } from "./selection.ts";
import { planWorkspaceRestore, type RestorePlan } from "./planner.ts";

const HOST = "ghostty";
const SNAPSHOT_VERSION = 1;
const WORKSPACE_DIR = join(getAgentDir(), "workspaces");
const SNAPSHOT_DIR = join(WORKSPACE_DIR, "snapshots");
const AUTOSAVE_ID = "autosave";
const AUTOSAVE_ARCHIVE_PREFIX = "autosave-";
const DAY_MS = 24 * 60 * 60 * 1000;
const AUTOSAVE_ARCHIVE_LIMIT = 40;
const AUTOSAVE_LIST_ARCHIVE_LIMIT = 8;
const AUTOSAVE_RECENT_ARCHIVE_KEEP = 12;
const AUTOSAVE_ARCHIVE_MIN_GAP_MS = 60 * 60 * 1000;
const AUTOSAVE_CLEANUP_INTERVAL_MS = DAY_MS;
const AUTOSAVE_LEADER_LEASE_MS = 75 * 60 * 1000;
const AUTOSAVE_LOCK_STALE_MS = 5 * 60 * 1000;
const AUTOSAVE_INITIAL_DELAY_MIN_MS = 30_000;
const AUTOSAVE_INITIAL_DELAY_JITTER_MS = 30_000;
const AUTOSAVE_INTERVAL_MS = 60 * 60 * 1000;
const AUTOSAVE_MIN_GAP_MS = 20_000;
const AUTOSAVE_STATE_PATH = join(WORKSPACE_DIR, "autosave-state.json");
const AUTOSAVE_LOCK_PATH = join(WORKSPACE_DIR, "autosave.lock");

let restoreController: AbortController | undefined;
let activeRegistration: ReturnType<typeof createSessionRegistration> | undefined;
let captureLifecycle = new AbortController();

type WorkspaceSource = "manual" | "auto";
type WorkspaceHost = typeof HOST;

export type WorkspaceTerminalSnapshot = GhosttyTerminal & {
	sessionFile?: string;
	sessionTitle?: string;
	panelLabel?: string;
	forkId?: string;
	parentSessionFile?: string;
	match?: "exact" | "active" | "fallback" | "none";
};

type WorkspaceTabSnapshot = Omit<GhosttyTab, "terminals"> & {
	terminals: WorkspaceTerminalSnapshot[];
};

export type WorkspaceSnapshot = {
	version: typeof SNAPSHOT_VERSION;
	id: string;
	name: string;
	source: WorkspaceSource;
	host: WorkspaceHost;
	createdAt: number;
	updatedAt: number;
	complete?: true;
	slot?: string;
	window: {
		id: string;
		name: string;
	};
	tabs: WorkspaceTabSnapshot[];
};

type WorkspaceSummary = SnapshotReference & {
	name: string;
	source: WorkspaceSource;
	updatedAt: number;
	tabs: number;
	terminals: number;
	matched: number;
};

type WorkspaceArgs = {
	sub: "save" | "restore" | "list" | "status" | "help";
	target?: string;
	name?: string;
	dryRun: boolean;
	append: boolean;
	all: boolean;
};

type AutosaveState = {
	lastAttemptAt?: number;
	lastSavedAt?: number;
	lastSkippedAt?: number;
	lastSnapshotHash?: string;
	lastArchiveAt?: number;
	lastCleanupAt?: number;
	pid?: number;
	ok?: boolean;
	saved?: boolean;
	archivedPath?: string;
	skippedReason?: string;
	stats?: { tabs: number; terminals: number; matched: number; score: number };
	leader?: {
		pid: number;
		sessionFile?: string;
		acquiredAt: number;
		leaseUntil: number;
	};
	error?: string;
	deletedArchives?: number;
};

function ensureWorkspaceDirs() {
	mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
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
	const userWrapper = join(homedir(), ".local", "bin", "pi");
	if (existsSync(userWrapper)) return shellQuote(userWrapper);
	const cliPath = process.argv[1] && existsSync(process.argv[1]) ? process.argv[1] : "";
	if (cliPath) return `${shellQuote(process.execPath)} ${shellQuote(cliPath)}`;
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
	return `cd ${shellQuote(term.cwd)} && ${buildEnvPrefix(env)}${currentPiCommand()} --session ${shellQuote(term.sessionFile)}`;
}

function readActiveRecords() { return readRegistrations(WORKSPACE_DIR); }

function isStaleCtxError(err: unknown): boolean {
	return String((err as Error)?.message ?? err).includes("ctx is stale");
}

function writeActiveRecord(ctx: ExtensionContext) { activeRegistration?.refresh(ctx); }

function snapshotPath(id: string): string {
	return join(SNAPSHOT_DIR, `${id}.json`);
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

export function workspaceSnapshotStats(snapshot: Pick<WorkspaceSnapshot, "tabs">): { tabs: number; terminals: number; matched: number; score: number } {
	const terminals = snapshot.tabs.flatMap((tab) => tab.terminals);
	const matched = terminals.filter((term) => term.sessionFile).length;
	return {
		tabs: snapshot.tabs.length,
		terminals: terminals.length,
		matched,
		score: matched * 100 + terminals.length * 10 + snapshot.tabs.length,
	};
}

export function workspaceSnapshotHash(snapshot: Pick<WorkspaceSnapshot, "tabs">): string {
	const stable = snapshot.tabs.map((tab) => ({
		index: tab.index,
		name: tab.name,
		selected: tab.selected,
		terminals: tab.terminals.map((term) => ({
			index: term.index,
			name: term.name,
			cwd: term.cwd,
			sessionFile: term.sessionFile,
			sessionTitle: term.sessionTitle,
			panelLabel: term.panelLabel,
			forkId: term.forkId,
			parentSessionFile: term.parentSessionFile,
			match: term.match,
		})),
	}));
	return createHash("sha256").update(JSON.stringify(stable)).digest("hex").slice(0, 16);
}

function isRecoverableSummary(summary: WorkspaceSummary): boolean {
	return summary.matched > 0;
}

function workspaceSummaryScore(summary: Pick<WorkspaceSummary, "tabs" | "terminals" | "matched">): number {
	return summary.matched * 100 + summary.terminals * 10 + summary.tabs;
}

export function compareWorkspaceSummaries(a: WorkspaceSummary, b: WorkspaceSummary): number {
	const aRecoverable = isRecoverableSummary(a);
	const bRecoverable = isRecoverableSummary(b);
	if (aRecoverable !== bRecoverable) return aRecoverable ? -1 : 1;
	const scoreDelta = workspaceSummaryScore(b) - workspaceSummaryScore(a);
	if (scoreDelta !== 0) return scoreDelta;
	if (a.updatedAt !== b.updatedAt) return b.updatedAt - a.updatedAt;
	return a.name.localeCompare(b.name, "ko");
}

export function autosaveReplacementReason(existing: Pick<WorkspaceSnapshot, "tabs"> | null, next: Pick<WorkspaceSnapshot, "tabs">): string | undefined {
	if (!existing) return undefined;
	const previous = workspaceSnapshotStats(existing);
	const incoming = workspaceSnapshotStats(next);
	if (previous.matched > 0 && incoming.matched === 0) {
		return `기존 autosave는 session ${previous.matched}/${previous.terminals}인데 새 autosave는 session 0/${incoming.terminals}입니다.`;
	}
	if (previous.terminals >= 2 && incoming.terminals <= 1 && incoming.score < previous.score) {
		return `기존 autosave는 panel ${previous.terminals}개인데 새 autosave는 panel ${incoming.terminals}개입니다.`;
	}
	if (previous.score >= 100 && incoming.score < previous.score * 0.6) {
		return `새 autosave 복원 점수(${incoming.score})가 기존(${previous.score})보다 크게 낮습니다.`;
	}
	return undefined;
}

function timestampId(ts: number): string {
	return new Date(ts).toISOString().replace(/[-:.]/gu, "").slice(0, 15);
}

function autosaveArchivePath(snapshot: WorkspaceSnapshot): string {
	return snapshotPath(`${AUTOSAVE_ARCHIVE_PREFIX}${timestampId(snapshot.updatedAt)}`);
}

function isAutosaveArchive(snapshot: WorkspaceSnapshot): boolean {
	return snapshot.source === "auto" && /^autosave-\d{8}T\d{6}$/u.test(snapshot.id);
}

function isAutosaveArchiveSummary(summary: WorkspaceSummary): boolean {
	return summary.source === "auto" && /^autosave-\d{8}T\d{6}$/u.test(summary.id);
}

function archiveAutosaveSnapshot(snapshot: WorkspaceSnapshot | null): string | undefined {
	if (!snapshot || snapshot.id !== AUTOSAVE_ID) return undefined;
	const archive = { ...snapshot, id: `${AUTOSAVE_ARCHIVE_PREFIX}${timestampId(snapshot.updatedAt)}` };
	const path = autosaveArchivePath(archive);
	if (!existsSync(path)) writeFileSync(path, JSON.stringify(archive, null, 2));
	return path;
}

type AutosaveArchiveFile = { path: string; updatedAt: number };

function listAutosaveArchives(): AutosaveArchiveFile[] {
	try {
		return readdirSync(SNAPSHOT_DIR)
			.filter((entry) => entry.endsWith(".json"))
			.map((entry) => {
				const path = join(SNAPSHOT_DIR, entry);
				const snapshot = readSnapshot(path);
				return snapshot && isAutosaveArchive(snapshot) ? { path, updatedAt: snapshot.updatedAt } : null;
			})
			.filter((entry): entry is AutosaveArchiveFile => Boolean(entry))
			.sort((a, b) => b.updatedAt - a.updatedAt);
	} catch {
		return [];
	}
}

function archiveDayKey(ts: number): string {
	return new Date(ts).toISOString().slice(0, 10);
}

function archiveWeekKey(ts: number): string {
	return String(Math.floor(ts / (7 * DAY_MS)));
}

function pruneAutosaveArchives(now = Date.now()): number {
	const archives = listAutosaveArchives();
	if (archives.length <= AUTOSAVE_ARCHIVE_LIMIT) return 0;
	const keep = new Set<string>();
	for (const archive of archives.slice(0, AUTOSAVE_RECENT_ARCHIVE_KEEP)) keep.add(archive.path);

	const daySeen = new Set<string>();
	for (const archive of archives) {
		if (now - archive.updatedAt > 7 * DAY_MS) continue;
		const key = archiveDayKey(archive.updatedAt);
		if (daySeen.has(key)) continue;
		daySeen.add(key);
		keep.add(archive.path);
	}

	const weekSeen = new Set<string>();
	for (const archive of archives) {
		if (now - archive.updatedAt > 28 * DAY_MS) continue;
		const key = archiveWeekKey(archive.updatedAt);
		if (weekSeen.has(key)) continue;
		weekSeen.add(key);
		keep.add(archive.path);
	}

	if (keep.size > AUTOSAVE_ARCHIVE_LIMIT) {
		const capped = new Set(archives.filter((archive) => keep.has(archive.path)).slice(0, AUTOSAVE_ARCHIVE_LIMIT).map((archive) => archive.path));
		keep.clear();
		for (const path of capped) keep.add(path);
	}

	let deleted = 0;
	for (const archive of archives) {
		if (keep.has(archive.path)) continue;
		try {
			unlinkSync(archive.path);
			deleted += 1;
		} catch {}
	}
	return deleted;
}

function shouldArchiveAutosaveSnapshot(existing: WorkspaceSnapshot | null, next: WorkspaceSnapshot, state: AutosaveState, nextHash: string, now: number): boolean {
	if (!existing || existing.id !== AUTOSAVE_ID) return false;
	const existingHash = workspaceSnapshotHash(existing);
	if (existingHash === nextHash) return false;
	const previous = workspaceSnapshotStats(existing);
	const incoming = workspaceSnapshotStats(next);
	const structureChanged = previous.tabs !== incoming.tabs || previous.terminals !== incoming.terminals || previous.matched !== incoming.matched;
	const scoreChanged = previous.score !== incoming.score;
	const archiveGapElapsed = !state.lastArchiveAt || now - state.lastArchiveAt >= AUTOSAVE_ARCHIVE_MIN_GAP_MS;
	return structureChanged || scoreChanged || archiveGapElapsed;
}

function saveAutosaveSnapshot(snapshot: WorkspaceSnapshot, state: AutosaveState, nextHash: string, now: number): { path: string; saved: boolean; reason?: string; archivedPath?: string } {
	ensureWorkspaceDirs();
	const path = snapshotPath(AUTOSAVE_ID);
	const existing = readSnapshot(path);
	const reason = autosaveReplacementReason(existing, snapshot);
	if (reason) return { path, saved: false, reason };
	const archivedPath = shouldArchiveAutosaveSnapshot(existing, snapshot, state, nextHash, now) ? archiveAutosaveSnapshot(existing) : undefined;
	writeFileSync(path, JSON.stringify(snapshot, null, 2));
	return { path, saved: true, archivedPath };
}

function listSnapshots(): WorkspaceSummary[] {
	ensureWorkspaceDirs();
	return readdirSync(SNAPSHOT_DIR)
		.filter((entry) => entry.endsWith(".json"))
		.map((entry) => {
			const path = join(SNAPSHOT_DIR, entry);
			let selected;
			try { selected = readSnapshotSelection(path); } catch { return null; }
			const { snapshot, reference } = selected;
			const stats = workspaceSnapshotStats(snapshot);
			return {
				...reference,
				name: snapshot.name,
				source: snapshot.source,
				updatedAt: snapshot.updatedAt,
				tabs: stats.tabs,
				terminals: stats.terminals,
				matched: stats.matched,
				path,
			};
		})
		.filter((summary): summary is WorkspaceSummary => Boolean(summary))
		.sort(compareWorkspaceSummaries);
}

function visibleSnapshotSummaries(summaries: WorkspaceSummary[]): WorkspaceSummary[] {
	const fixed = summaries.filter((summary) => !isAutosaveArchiveSummary(summary));
	const archives = summaries.filter(isAutosaveArchiveSummary).slice(0, AUTOSAVE_LIST_ARCHIVE_LIMIT);
	return [...fixed, ...archives].sort(compareWorkspaceSummaries);
}

function buildSnapshot(window: GhosttyWindow, source: WorkspaceSource, name?: string): WorkspaceSnapshot {
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
		complete: true,
		tabs: bindCapturedWindow(window, WORKSPACE_DIR),
	};
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
	const firstToken = tokens.shift();
	const first = (firstToken || "status").toLowerCase();
	const knownSubs = ["save", "restore", "list", "status", "help"];
	const sub = knownSubs.includes(first)
		? first as WorkspaceArgs["sub"]
		: firstToken ? "restore" : "status";
	const rest = sub === "restore" && firstToken && !knownSubs.includes(first) ? [firstToken, ...tokens] : tokens;
	let dryRun = false;
	let append = true;
	let all = false;
	const positional: string[] = [];
	for (const token of rest) {
		if (token === "--dry-run" || token === "-n") dryRun = true;
		else if (token === "--append") append = true;
		else if (token === "--all" || token === "-a") all = true;
		else positional.push(token);
	}
	if (sub === "save") return { sub, name: positional.join(" ").trim() || undefined, dryRun, append, all };
	if (sub === "restore") return { sub, target: positional.join(" ").trim() || undefined, dryRun, append, all };
	return { sub, target: positional.join(" ").trim() || undefined, dryRun, append, all };
}

export function buildRestorePlan(snapshot: WorkspaceSnapshot): RestorePlan {
	return planWorkspaceRestore(snapshot, buildSessionLaunchCommand);
}

function renderSnapshotSummary(summary: WorkspaceSummary, index?: number): string {
	const prefix = typeof index === "number" ? `${index + 1}. ` : "";
	const source = summary.source === "auto" ? "auto" : "manual";
	return `${prefix}${summary.name} (${summary.id}) · ${source} · ${displayDate(summary.updatedAt)} · tab ${summary.tabs}, panel ${summary.terminals}, session ${summary.matched}/${summary.terminals}`;
}

function renderList(summaries: WorkspaceSummary[], hiddenArchives = 0): string {
	if (summaries.length === 0) return "저장된 workspace snapshot이 없습니다.";
	const lines = ["저장된 workspace snapshots", "", ...summaries.map(renderSnapshotSummary)];
	if (hiddenArchives > 0) {
		lines.push("", `숨긴 autosave archive ${hiddenArchives}개 · 전체 목록은 /workspace list --all`);
	}
	return lines.join("\n");
}

export function renderPlan(plan: RestorePlan): string {
	const lines = [
		`Workspace restore plan — ${plan.snapshot.name}`,
		`mode: append · tabs ${plan.snapshot.tabs.length} · 원본 total ${plan.total} / ready ${plan.ready} / blocked ${plan.blocked}`,
		plan.blocked || !plan.total ? "전체 preflight BLOCKED — 원본 패널이 모두 준비되기 전에는 실행하지 않습니다." : "전체 preflight READY — 실제 실행 전후 identity를 다시 확인합니다.",
		"",
	];
	plan.actions.forEach((tabActions, tabIndex) => {
		const tab = plan.snapshot.tabs[tabIndex];
		lines.push(`Tab ${tabIndex + 1}: ${tab.name || `tab ${tab.index}`} · panels ${tabActions.length}`);
		tabActions.forEach((action, termIndex) => {
			const state = action.command ? "READY" : "BLOCKED";
			const label = action.panelLabel ? ` · ${action.panelLabel}` : "";
			const reason = action.blockedReason ? ` · ${action.blockedReason}` : "";
			lines.push(`  ${termIndex + 1}. ${state}${label} · ${action.terminalName} · ${action.sourcePanelKey}${reason}`);
			lines.push(`     terminal cwd: ${action.terminalCwd} · session cwd: ${action.sessionCwd || "미확인"}`);
		});
	});
	return lines.join("\n");
}

async function runRestore(pi: ExtensionAPI, ctx: ExtensionCommandContext, plan: RestorePlan & { source: PinnedSnapshotSource }): Promise<string> {
	if (restoreController) throw new Error("이 세션에서 workspace 복구가 이미 진행 중입니다.");
	const controller = new AbortController();
	restoreController = controller;
	try {
		return await restoreWorkspace(pi, plan.actions, WORKSPACE_DIR, {
			source: plan.source,
			signal: controller.signal,
			onProgress: (message) => ctx.ui.setStatus("workspace-restore", message),
		});
	} finally {
		if (restoreController === controller) restoreController = undefined;
		try { ctx.ui.setStatus("workspace-restore", undefined); } catch (error) { if (!isStaleCtxError(error)) throw error; }
	}
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
	if (!activeRegistration?.isCurrent()) throw new Error("현재 패널이 등록되지 않았습니다. /reload 후 다시 시도하세요.");
	const runtime = captureLifecycle;
	writeActiveRecord(ctx);
	const window = await captureGhosttyWindow(pi, runtime.signal);
	if (runtime.signal.aborted || !activeRegistration.isCurrent()) return;
	const snapshot = buildSnapshot(window, "manual", args.name);
	const { path } = saveCompleteSnapshot(WORKSPACE_DIR, snapshot);
	const summary: WorkspaceSummary = {
		...readSnapshotSelection(path).reference,
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

async function handleRestore(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: WorkspaceArgs, lastList?: SnapshotReference[]) {
	const selected = selectSnapshot(args.target, listSnapshots(), lastList, ctx.cwd);
	const source = pinSnapshotSelection(selected, WORKSPACE_DIR);
	const plan = { ...buildRestorePlan(selected.snapshot), source };
	const report = [
		`requested target: ${args.target}`,
		`resolved snapshot: ${selected.snapshot.name} (${source.id})`,
		`snapshot path: ${source.path}`,
		`source SHA256: ${source.hash}`,
		`pinned source: ${source.pinnedPath}`,
		"",
		renderPlan(plan),
	].filter((line): line is string => line !== undefined).join("\n");
	if (args.dryRun) {
		ctx.ui.notify("workspace restore dry-run plan을 표시했습니다.", "info");
		sendReport(pi, "Workspace restore dry-run", report);
		return;
	}
	try {
		if (plan.blocked || !plan.total) throw new Error(`전체 preflight BLOCKED: 원본 ${plan.total} / ready ${plan.ready} / blocked ${plan.blocked}. host 호출 없이 중단합니다.`);
		const reportPath = await runRestore(pi, ctx, plan);
		ctx.ui.notify(`workspace 복원 완료: ${plan.ready}/${plan.total} panels · 세션 READY 확인`, "info");
		sendReport(pi, "Workspace restore 완료", `${report}\n\n진행 기록: ${reportPath}`);
	} catch (error) {
		if (isStaleCtxError(error)) return;
		sendReport(pi, "Workspace restore 중단", `${report}\n\n${error instanceof Error ? error.message : String(error)}`);
		throw error;
	}
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
	const state = readJson<AutosaveState>(AUTOSAVE_STATE_PATH, {});
	const body = [
		liveLine,
		`active session registry: ${activeCount}`,
		`latest snapshot: ${latest}`,
		state.leader ? `autosave leader: pid ${state.leader.pid} · lease ${displayDate(state.leader.leaseUntil)}` : "autosave leader: 없음",
		state.lastSnapshotHash ? `autosave hash: ${state.lastSnapshotHash}` : undefined,
		state.skippedReason ? `autosave skip: ${state.skippedReason}` : undefined,
		"",
		"commands:",
		"  /workspace [number|name-or-id]",
		"  /workspace save [name]",
		"  /workspace save \"작업 이름\"",
		"  /workspace restore [number|name-or-id] [--dry-run] [--append] [--all]",
		"  /workspace list [--all]",
		"  /workspace status",
	].filter((line): line is string => line !== undefined).join("\n");
	ctx.ui.notify("workspace 상태를 표시했습니다.", "info");
	sendReport(pi, "Workspace status", body);
}

function acquireAutosaveLock(): (() => void) | undefined {
	ensureWorkspaceDirs();
	function openLock(): number | undefined {
		try { return openSync(AUTOSAVE_LOCK_PATH, "wx"); } catch { return undefined; }
	}
	let fd = openLock();
	if (fd === undefined) {
		try {
			const st = statSync(AUTOSAVE_LOCK_PATH);
			if (Date.now() - st.mtimeMs > AUTOSAVE_LOCK_STALE_MS) {
				unlinkSync(AUTOSAVE_LOCK_PATH);
				fd = openLock();
			}
		} catch {}
	}
	if (fd === undefined) return undefined;
	writeFileSync(fd, `${process.pid}\n`);
	return () => {
		try { closeSync(fd!); } catch {}
		try { unlinkSync(AUTOSAVE_LOCK_PATH); } catch {}
	};
}

function pidIsAlive(pid: number | undefined): boolean {
	if (!pid || pid === process.pid) return Boolean(pid);
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function autosaveLeaderFor(ctx: ExtensionContext, previous: AutosaveState["leader"] | undefined, now: number): NonNullable<AutosaveState["leader"]> {
	const sessionFile = ctx.sessionManager.getSessionFile();
	return {
		pid: process.pid,
		sessionFile: sessionFile ? safeRealpath(sessionFile) : undefined,
		acquiredAt: previous?.pid === process.pid ? previous.acquiredAt : now,
		leaseUntil: now + AUTOSAVE_LEADER_LEASE_MS,
	};
}

function autosaveLeaderSkipReason(state: AutosaveState, now: number): string | undefined {
	const leader = state.leader;
	if (!leader || leader.pid === process.pid) return undefined;
	if (leader.leaseUntil <= now) return undefined;
	if (!pidIsAlive(leader.pid)) return undefined;
	return `다른 Pi process(pid ${leader.pid})가 autosave leader입니다.`;
}

function shouldRunAutosaveCleanup(state: AutosaveState, now: number): boolean {
	if (!state.lastCleanupAt || now - state.lastCleanupAt >= AUTOSAVE_CLEANUP_INTERVAL_MS) return true;
	return listAutosaveArchives().length > AUTOSAVE_ARCHIVE_LIMIT;
}

async function autosave(pi: ExtensionAPI, ctx: ExtensionContext, isActive: () => boolean) {
	if (!isActive() || process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty" || !activeRegistration?.isCurrent()) return;
	const runtime = captureLifecycle;
	const releaseLock = acquireAutosaveLock();
	if (!releaseLock) return;
	try {
		const now = Date.now();
		const state = readJson<AutosaveState>(AUTOSAVE_STATE_PATH, {});
		const lastAttemptAt = state.lastAttemptAt ?? state.lastSavedAt;
		if (lastAttemptAt && now - lastAttemptAt < AUTOSAVE_MIN_GAP_MS) return;

		const leaderSkipReason = autosaveLeaderSkipReason(state, now);
		if (leaderSkipReason) {
			writeJson(AUTOSAVE_STATE_PATH, {
				...state,
				lastAttemptAt: now,
				lastSkippedAt: now,
				pid: process.pid,
				ok: true,
				saved: false,
				skippedReason: leaderSkipReason,
			});
			return;
		}

		const leader = autosaveLeaderFor(ctx, state.leader, now);
		writeActiveRecord(ctx);
		const window = await captureGhosttyWindow(pi, runtime.signal);
		if (!isActive() || runtime.signal.aborted || !activeRegistration.isCurrent()) return;
		const snapshot = buildSnapshot(window, "auto", "autosave");
		const stats = workspaceSnapshotStats(snapshot);
		const nextHash = workspaceSnapshotHash(snapshot);
		const cleanupDue = shouldRunAutosaveCleanup(state, now);
		let deletedArchives = 0;

		if (state.lastSnapshotHash === nextHash) {
			if (cleanupDue) deletedArchives = pruneAutosaveArchives(now);
			writeJson(AUTOSAVE_STATE_PATH, {
				...state,
				lastAttemptAt: now,
				lastSkippedAt: now,
				lastCleanupAt: cleanupDue ? now : state.lastCleanupAt,
				pid: process.pid,
				leader,
				ok: true,
				saved: false,
				skippedReason: "workspace snapshot 내용 변경 없음",
				stats,
				deletedArchives,
			});
			return;
		}

		const saved = saveAutosaveSnapshot(snapshot, state, nextHash, now);
		if (cleanupDue) deletedArchives = pruneAutosaveArchives(now);
		writeJson(AUTOSAVE_STATE_PATH, {
			...state,
			lastAttemptAt: now,
			lastSavedAt: saved.saved ? Date.now() : state.lastSavedAt,
			lastSnapshotHash: saved.saved ? nextHash : state.lastSnapshotHash,
			lastArchiveAt: saved.archivedPath ? now : state.lastArchiveAt,
			lastCleanupAt: cleanupDue ? now : state.lastCleanupAt,
			pid: process.pid,
			leader,
			ok: true,
			saved: saved.saved,
			archivedPath: saved.archivedPath,
			skippedReason: saved.reason,
			stats,
			deletedArchives,
		});
	} catch (error) {
		if (!isActive() || isStaleCtxError(error)) return;
		const now = Date.now();
		const state = readJson<AutosaveState>(AUTOSAVE_STATE_PATH, {});
		writeJson(AUTOSAVE_STATE_PATH, {
			...state,
			lastAttemptAt: now,
			pid: process.pid,
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	} finally {
		releaseLock();
	}
}

function scheduleAutosave(pi: ExtensionAPI, ctx: ExtensionContext): () => void {
	if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") return () => {};
	let active = true;
	const run = () => { if (active) void autosave(pi, ctx, () => active); };
	const initialDelay = AUTOSAVE_INITIAL_DELAY_MIN_MS + Math.floor(Math.random() * AUTOSAVE_INITIAL_DELAY_JITTER_MS);
	const initial = setTimeout(run, initialDelay);
	const interval = setInterval(run, AUTOSAVE_INTERVAL_MS);
	initial.unref?.();
	interval.unref?.();
	return () => {
		active = false;
		clearTimeout(initial);
		clearInterval(interval);
	};
}

const HELP = `Ghostty workspace snapshot/restore

Usage:
  /workspace [number|name-or-id]
  /workspace status
  /workspace save [name]
  /workspace restore [number|name-or-id] [--dry-run] [--append]
  /workspace list

Notes:
- 패널은 짧은 임시 제목 표식으로 terminal ID에 정확히 등록합니다. 평소 제목은 그대로 유지합니다.
- 이전 runtime·미등록 패널은 /reload가 필요하며, 누락·중복 binding이 있으면 새 snapshot을 저장하지 않습니다.
- 수동 저장은 전체 exact 연결과 session header preflight를 통과한 뒤 atomic하게 저장합니다.
- 자동 저장의 시작 지연·반복 실행·내용 변경 기준과 archive 보관 정책은 유지합니다.
- 직전 목록의 번호는 같은 세션에서만 사용하며 파일 변경·삭제 시 다시 선택해야 합니다.
- 기본 restore는 append입니다. 선택한 원본 bytes/hash와 전체 header-cwd preflight, 패널별 READY 확인을 유지합니다.
- Ghostty가 split tree/비율을 제공하지 않아 패널 배치는 순차 right split으로 근사 복원합니다.`;

function workspaceArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const prefix = argumentPrefix.trimStart();
	const hasTrailingSpace = /\s$/u.test(argumentPrefix);
	const tokens = tokenizeArgs(prefix);
	const commandItems: AutocompleteItem[] = [
		{ value: "status", label: "status", description: "현재 Ghostty workspace 상태" },
		{ value: "save", label: "save", description: "현재 Ghostty window snapshot 저장" },
		{ value: "restore", label: "restore", description: "명시한 snapshot을 append mode로 복원" },
		{ value: "list", label: "list", description: "저장된 snapshots 목록" },
	];

	if (tokens.length === 0) return commandItems;
	if (/^[1-9]\d*$/u.test(tokens[0] || "")) return null;

	const first = (tokens[0] || "").toLowerCase();
	if (first === "restore") {
		const hasTarget = tokens.slice(1).some((token) => !token.startsWith("-"));
		if (hasTarget) return null;
		if (!hasTrailingSpace) return null;
		return visibleSnapshotSummaries(listSnapshots()).map((summary) => ({
			value: `restore ${shellQuote(summary.path)}`,
			label: `restore ${summary.id}`,
			description: `${summary.name} · ${displayDate(summary.updatedAt)} · session ${summary.matched}/${summary.terminals}`,
		}));
	}

	if (["status", "save", "list", "help"].includes(first)) return null;
	if (tokens.length > 1 || hasTrailingSpace) return null;
	const filtered = commandItems.filter((item) => item.value.startsWith(first));
	return filtered.length > 0 ? filtered : null;
}

export default function (pi: ExtensionAPI, environment?: RegistrationEnvironment) {
	const registration = createSessionRegistration(pi, WORKSPACE_DIR, environment);
	activeRegistration = registration;
	const displayedLists = new Map<string | ExtensionContext["sessionManager"], SnapshotReference[]>();
	const listKey = (ctx: ExtensionContext) => ctx.sessionManager.getSessionFile() || ctx.sessionManager;
	let revokeRestoreReceipt: (() => void) | undefined;
	let disposeAutosave: (() => void) | undefined;
	pi.on("session_start", async (_event, ctx) => {
		disposeAutosave?.();
		revokeRestoreReceipt?.();
		revokeRestoreReceipt = receiveRestoreSession(ctx);
		captureLifecycle = new AbortController();
		await registration.start(ctx);
		if (registration.isCurrent()) disposeAutosave = scheduleAutosave(pi, ctx);
	});
	pi.on("message_end", async (_event, ctx) => {
		writeActiveRecord(ctx);
	});
	pi.on("agent_end", async (_event, ctx) => {
		writeActiveRecord(ctx);
	});
	pi.on("session_shutdown", async () => {
		disposeAutosave?.();
		disposeAutosave = undefined;
		captureLifecycle.abort();
		registration.stop();
		restoreController?.abort();
		revokeRestoreReceipt?.();
		revokeRestoreReceipt = undefined;
	});

	pi.registerCommand("workspace", {
		description: "Ghostty 작업공간 저장/복원",
		getArgumentCompletions: async (argumentPrefix: string): Promise<AutocompleteItem[] | null> => workspaceArgumentCompletions(argumentPrefix),
		handler: async (rawArgs: string, ctx: ExtensionCommandContext) => {
			const args = parseWorkspaceArgs(rawArgs);
			try {
				if (args.sub === "help") {
					ctx.ui.notify(HELP, "info");
					return;
				}
				if (args.sub === "save") return await handleSave(pi, ctx, args);
				if (args.sub === "restore") return await handleRestore(pi, ctx, args, displayedLists.get(listKey(ctx)));
				if (args.sub === "list") {
					const allSummaries = listSnapshots();
					const summaries = args.all ? allSummaries : visibleSnapshotSummaries(allSummaries);
					const hiddenArchives = args.all ? 0 : allSummaries.length - summaries.length;
					const body = renderList(summaries, hiddenArchives);
					displayedLists.set(listKey(ctx), summaries.map(({ id, path, realPath, hash }) => ({ id, path, realPath, hash })));
					ctx.ui.notify("workspace snapshot 목록을 표시했습니다.", "info");
					sendReport(pi, "Workspace list", body);
					return;
				}
				return await handleStatus(pi, ctx);
			} catch (error) {
				if (isStaleCtxError(error)) return;
				ctx.ui.notify(`workspace 오류: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
