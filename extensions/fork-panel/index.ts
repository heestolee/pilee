import { createHash, randomUUID } from "node:crypto";
import { closeSync, copyFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { completeSimple } from "@mariozechner/pi-ai";
import { expandProfileTemplate, loadArtifactBrowserProfiles } from "../utils/private-profiles.ts";
import { resolveForkPanelIdentity, type ForkPanelIdentity } from "../utils/fork-panel-identity.ts";

const SPLIT_DIRS = ["right", "left", "down", "up"] as const;
type SplitDirection = (typeof SPLIT_DIRS)[number];
export interface SplitPlacement {
	anchorPath: SplitDirection[];
	splitDirection: SplitDirection;
}
const VALID_DIRS = [...SPLIT_DIRS, "tab"] as const;
type Direction = (typeof VALID_DIRS)[number];
type PanelOpenTarget = "tab" | SplitPlacement;
type OpenMode = "here" | PanelOpenTarget;
type ReviveHereMismatchAction = "fast" | "worktree-here" | Direction;

const HANDOFF_DIR = join(homedir(), ".pi", "agent", "fork-panel");
const INBOX_DIR = join(HANDOFF_DIR, "inbox");
const SESSIONS_ROOT = join(homedir(), ".pi", "agent", "sessions");
const SESSION_PREVIEW_BYTES = 192 * 1024;

let forkInProgress = false;
const FORK_COOLDOWN_MS = 2000;
const RECENT_PATH = join(HANDOFF_DIR, "recent.json");
const HANDOFF_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const REPANEL_MARKER_TTL_MS = 2 * 60 * 1000; // 2m
const RECENT_KEEP = 500;

type ReviveSource = "fork" | "p0";

interface ForkRecord {
	forkId: string;
	label: string;
	panelLabel?: string;
	parentSessionFile?: string;
	sessionFile: string;
	cwd: string;
	createdAt: number;
	closedAt?: number;
	preview?: string;
	source?: ReviveSource;
	title?: string;
}

interface ReviveItem {
	record: ForkRecord;
	workspaceKey: string;
	workspaceLabel: string;
	title: string;
	preview: string;
}

type InboxStatus = "unread" | "read" | "dismissed";
type HandoffDelivery = "inbox" | "inject" | "snapshot";
type HandoffSource = "manual" | "done" | "fallback" | "auto";

interface InboxItem {
	id: string;
	forkId: string;
	panelLabel?: string;
	parentSessionFile?: string;
	title?: string;
	pid: number;
	createdAt: number;
	updatedAt: number;
	finishedAt?: number;
	summary: string;
	mode?: "auto" | "manual" | "done" | "fallback";
	delivery: HandoffDelivery;
	source: HandoffSource;
	status: InboxStatus;
	customNote?: string;
	notifiedAt?: number;
	injectedAt?: number;
}

interface PanelListItem {
	record: ForkRecord;
	revive: ReviveItem;
	panelLabel: string;
	status: "unread" | "running" | "closed" | "read";
	unreadCount: number;
	latestInbox?: InboxItem;
	latestUnread?: InboxItem;
	snapshot?: HandoffData;
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
	rec.preview = sanitizeRowText(preview).slice(0, 140);
	saveRecent(all);
}

function panelNumber(label: string | undefined): number {
	const match = /^P(\d+)$/.exec(label ?? "");
	return match ? Number(match[1]) : 0;
}

function allocatePanelLabel(parentSessionFile: string): string {
	const records = Object.values(loadRecent()).filter((record) => record.parentSessionFile === parentSessionFile);
	const max = records.reduce((acc, record) => Math.max(acc, panelNumber(record.panelLabel)), 0);
	return `P${max + 1}`;
}

function recordSource(record: ForkRecord | undefined): ReviveSource {
	return record?.source === "p0" ? "p0" : "fork";
}

function panelLabelOf(record: ForkRecord | undefined, fallback?: string): string {
	if (recordSource(record) === "p0") return "P0";
	return record?.panelLabel || fallback || "P?";
}

function panelColor(label: string): string {
	const normalized = label.toUpperCase();
	if (normalized === "P0") return "accent";
	if (normalized === "P1") return "success";
	if (normalized === "P2") return "warning";
	return "borderAccent";
}

function isPriorityPanel(label: string): boolean {
	return /^(P0|P1|P2)$/i.test(label);
}

function renderPanelLabel(theme: any, label: string, selected = false): string {
	const text = selected || isPriorityPanel(label) ? theme.bold(label) : label;
	return theme.fg(panelColor(label), text);
}

function shortHash(value: string): string {
	return createHash("sha1").update(value).digest("hex").slice(0, 10);
}

function ensureInboxDir() {
	mkdirSync(INBOX_DIR, { recursive: true });
}

function inboxPath(id: string): string {
	return join(INBOX_DIR, `${id}.json`);
}

function createInboxId(forkId: string, source: HandoffSource, timestamp = Date.now()): string {
	return `${forkId}-${source}-${timestamp}-${randomUUID().slice(0, 6)}`;
}

function readInboxItem(filePath: string): InboxItem | null {
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8"));
		if (!parsed?.id || !parsed?.forkId || !parsed?.summary) return null;
		return parsed as InboxItem;
	} catch {
		return null;
	}
}

function loadInboxItems(): InboxItem[] {
	if (!existsSync(INBOX_DIR)) return [];
	try {
		return readdirSync(INBOX_DIR)
			.filter((file) => file.endsWith(".json"))
			.map((file) => readInboxItem(join(INBOX_DIR, file)))
			.filter((item): item is InboxItem => !!item)
			.sort((a, b) => b.createdAt - a.createdAt);
	} catch {
		return [];
	}
}

function writeInboxItem(item: InboxItem) {
	ensureInboxDir();
	writeFileSync(inboxPath(item.id), JSON.stringify(item, null, 2));
}

function updateInboxItem(item: InboxItem, patch: Partial<InboxItem>) {
	writeInboxItem({ ...item, ...patch, updatedAt: Date.now() });
}

function writeInboxFromHandoff(data: HandoffData, source: HandoffSource, delivery: HandoffDelivery = "inbox"): InboxItem {
	const timestamp = Date.now();
	const item: InboxItem = {
		id: createInboxId(data.forkId, source, timestamp),
		forkId: data.forkId,
		panelLabel: data.panelLabel,
		parentSessionFile: data.parentSessionFile,
		title: data.title,
		pid: data.pid,
		createdAt: timestamp,
		updatedAt: timestamp,
		finishedAt: data.finishedAt,
		summary: data.summary,
		mode: source === "done" ? "done" : source === "fallback" ? "fallback" : data.mode,
		delivery,
		source,
		status: "unread",
		customNote: data.customNote,
	};
	writeInboxItem(item);
	return item;
}

function setInboxRead(item: InboxItem) {
	updateInboxItem(item, { status: "read" });
}

function setInboxDismissed(item: InboxItem) {
	updateInboxItem(item, { status: "dismissed" });
}

function markInboxNotified(item: InboxItem) {
	updateInboxItem(item, { notifiedAt: Date.now() });
}

function markInboxInjected(item: InboxItem) {
	updateInboxItem(item, { status: "read", injectedAt: Date.now(), notifiedAt: item.notifiedAt ?? Date.now() });
}

function readSnapshot(forkId: string): HandoffData | null {
	try {
		const snapshotPath = join(HANDOFF_DIR, `${forkId}.json`);
		if (!existsSync(snapshotPath)) return null;
		return JSON.parse(readFileSync(snapshotPath, "utf8")) as HandoffData;
	} catch {
		return null;
	}
}

function isSnapshotClosed(snapshot: HandoffData | null): boolean {
	if (!snapshot) return false;
	return Boolean(snapshot.finishedAt) || Boolean(snapshot.pid && !isPidAlive(snapshot.pid));
}

function formatHandoffMessage(item: InboxItem | HandoffData, record?: ForkRecord): string {
	const panelLabel = item.panelLabel || panelLabelOf(record);
	const title = sanitizeRowText(item.title || record?.label || "fork panel");
	const note = "customNote" in item && item.customNote ? `\n\n📝 ${item.customNote}` : "";
	return `[panel ${panelLabel} handoff: ${title}]${note}\n\n${item.summary}`;
}

function insertIntoEditor(ctx: ExtensionCommandContext, text: string) {
	const current = ctx.ui.getEditorText?.() ?? "";
	const separator = current.trim() ? "\n\n" : "";
	ctx.ui.setEditorText(`${current}${separator}${text}`);
}

function repanelMarkerPath(forkId: string, pid = process.pid): string {
	return join(HANDOFF_DIR, `${forkId}-repanel-${pid}.json`);
}

function writeRepanelMarker(forkId: string) {
	try {
		mkdirSync(HANDOFF_DIR, { recursive: true });
		writeFileSync(repanelMarkerPath(forkId), JSON.stringify({ forkId, pid: process.pid, createdAt: Date.now() }, null, 2));
		try { unlinkSync(join(HANDOFF_DIR, `${forkId}.json`)); } catch {}
	} catch {}
}

function consumeRepanelMarker(forkId: string): boolean {
	const markerPath = repanelMarkerPath(forkId);
	if (!existsSync(markerPath)) return false;
	let suppress = false;
	try {
		const data = JSON.parse(readFileSync(markerPath, "utf8"));
		suppress = data?.pid === process.pid && Date.now() - Number(data?.createdAt ?? 0) < REPANEL_MARKER_TTL_MS;
	} catch {
		suppress = true;
	}
	try { unlinkSync(markerPath); } catch {}
	return suppress;
}

function sanitizeRowText(value: string | undefined | null): string {
	return (value ?? "")
		.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, "")
		.replace(/[\r\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function parseSessionEntries(raw: string): any[] {
	return raw.split("\n").filter(Boolean).map((line) => {
		try { return JSON.parse(line); } catch { return null; }
	}).filter(Boolean);
}

function readSessionEntries(sessionFile: string): any[] {
	try {
		return parseSessionEntries(readFileSync(sessionFile, "utf8"));
	} catch {
		return [];
	}
}

function readSessionSlice(sessionFile: string, start: number, length: number, trimPartialStart = false): string {
	const fd = openSync(sessionFile, "r");
	try {
		const buffer = Buffer.alloc(length);
		const bytesRead = readSync(fd, buffer, 0, length, start);
		let text = buffer.subarray(0, bytesRead).toString("utf8");
		if (trimPartialStart && start > 0) text = text.replace(/^[^\n]*(\n|$)/, "");
		return text;
	} finally {
		closeSync(fd);
	}
}

function readSessionPreviewEntries(sessionFile: string): any[] {
	try {
		const stat = statSync(sessionFile);
		const headLength = Math.min(stat.size, SESSION_PREVIEW_BYTES);
		const chunks = [readSessionSlice(sessionFile, 0, headLength)];
		if (stat.size > headLength) {
			const tailStart = Math.max(0, stat.size - SESSION_PREVIEW_BYTES);
			chunks.push(readSessionSlice(sessionFile, tailStart, stat.size - tailStart, true));
		}
		const entries = parseSessionEntries(chunks.join("\n"));
		const seen = new Set<string>();
		return entries.filter((entry) => {
			const key = `${entry?.type ?? ""}:${entry?.id ?? JSON.stringify(entry).slice(0, 80)}`;
			if (seen.has(key)) return false;
			seen.add(key);
			return true;
		});
	} catch {
		return [];
	}
}

function messageText(message: any): string {
	const content = message?.content;
	return Array.isArray(content)
		? content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
		: typeof content === "string" ? content : "";
}

function extractLastSessionName(entries: any[]): string {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e?.type === "session_info" && typeof e.name === "string" && e.name.trim()) {
			return sanitizeRowText(e.name);
		}
	}
	return "";
}

function extractLastText(entries: any[], role?: "user" | "assistant"): string {
	for (let i = entries.length - 1; i >= 0; i--) {
		const e = entries[i];
		if (e?.type !== "message") continue;
		if (role && e.message?.role !== role) continue;
		if (!role && e.message?.role !== "user" && e.message?.role !== "assistant") continue;
		const text = sanitizeRowText(messageText(e.message));
		if (text) return text;
	}
	return "";
}

function extractFirstText(entries: any[], role?: "user" | "assistant"): string {
	for (const e of entries) {
		if (e?.type !== "message") continue;
		if (role && e.message?.role !== role) continue;
		if (!role && e.message?.role !== "user" && e.message?.role !== "assistant") continue;
		const text = sanitizeRowText(messageText(e.message));
		if (text) return text;
	}
	return "";
}

function extractSessionCwd(entries: any[]): string {
	for (const entry of entries) {
		if (entry?.type === "session" && typeof entry.cwd === "string" && entry.cwd.trim()) return entry.cwd;
	}
	return "";
}

function normalizedPath(path: string): string {
	return path.replace(/\/+$/, "") || path;
}

function configuredWorkspaceRoots(): Array<{ repo?: string; path: string }> {
	const roots: Array<{ repo?: string; path: string }> = [];
	for (const profile of loadArtifactBrowserProfiles()) {
		for (const root of profile.worktreeRoots ?? []) {
			roots.push({ repo: root.repo, path: normalizedPath(expandProfileTemplate(root.path, { repo: root.repo })) });
		}
	}
	return roots;
}

function workspaceKeyFor(cwd: string): string {
	const home = normalizedPath(homedir());
	const normalized = normalizedPath(cwd || home);
	if (normalized === home) return home;
	for (const root of configuredWorkspaceRoots()) {
		if (normalized.startsWith(`${root.path}/`)) {
			const workspace = normalized.slice(root.path.length + 1).split("/")[0];
			if (workspace) return join(root.path, workspace);
		}
	}
	return normalized;
}

function workspaceLabelFor(cwd: string): string {
	const key = workspaceKeyFor(cwd);
	const home = normalizedPath(homedir());
	if (key === home) return "~";
	for (const root of configuredWorkspaceRoots()) {
		if (key.startsWith(`${root.path}/`)) {
			const workspace = key.slice(root.path.length + 1).split("/")[0];
			if (workspace) return root.repo ? `${root.repo}/${workspace}` : workspace;
		}
	}
	return key.startsWith(`${home}/`) ? `~/${relative(home, key)}` : key;
}

function sameWorkspaceCwd(a: string, b: string): boolean {
	return safeRealpath(workspaceKeyFor(a)) === safeRealpath(workspaceKeyFor(b));
}

function isDirectory(filePath: string): boolean {
	try { return statSync(filePath).isDirectory(); } catch { return false; }
}

function safeRealpath(filePath: string): string {
	try { return realpathSync(filePath); } catch { return filePath; }
}

function collectTextFragments(value: unknown, output: string[] = []): string[] {
	if (typeof value === "string") {
		output.push(value);
		return output;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectTextFragments(item, output);
		return output;
	}
	if (value && typeof value === "object") {
		for (const item of Object.values(value as Record<string, unknown>)) collectTextFragments(item, output);
	}
	return output;
}

function inferWorkspaceCwdFromSessionEntries(entries: any[], fallbackCwd = ""): string {
	const roots = configuredWorkspaceRoots();
	if (roots.length === 0) return "";
	const counts = new Map<string, number>();
	const countCandidate = (candidate: string, weight = 1) => {
		const resolved = safeRealpath(candidate);
		if (!isDirectory(resolved)) return;
		counts.set(resolved, (counts.get(resolved) ?? 0) + weight);
	};

	for (const root of roots) {
		if (fallbackCwd && normalizedPath(fallbackCwd).startsWith(`${root.path}/`)) countCandidate(workspaceKeyFor(fallbackCwd), 100);
	}

	for (const entry of entries) {
		const fragments = collectTextFragments(entry);
		for (const text of fragments) {
			for (const root of roots) {
				const marker = `${root.path}/`;
				let index = text.indexOf(marker);
				while (index >= 0) {
					const rest = text.slice(index + marker.length);
					const workspace = rest.split(/[\s"'`<>\\\]|),]+/)[0]?.split("/")[0];
					if (workspace) countCandidate(join(root.path, workspace));
					index = text.indexOf(marker, index + marker.length);
				}
			}
		}
	}

	return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

function resolveRecordCwdFromSession(record: ForkRecord): string {
	const entries = readSessionPreviewEntries(record.sessionFile);
	return inferWorkspaceCwdFromSessionEntries(entries, record.cwd) || record.cwd;
}

function buildP0RecordFromSession(sessionFile: string): ForkRecord | null {
	try {
		const real = safeRealpath(sessionFile);
		const stat = statSync(real);
		const entries = readSessionPreviewEntries(real);
		const headerCwd = extractSessionCwd(entries) || homedir();
		const cwd = inferWorkspaceCwdFromSessionEntries(entries, headerCwd) || headerCwd;
		const firstUser = extractFirstText(entries, "user");
		const title = extractLastSessionName(entries) || firstUser || basename(real, ".jsonl");
		const preview = extractLastText(entries, "assistant") || extractLastText(entries) || firstUser;
		return {
			forkId: `p0_${shortHash(real)}`,
			label: title,
			panelLabel: "P0",
			sessionFile: real,
			cwd,
			createdAt: stat.mtimeMs,
			closedAt: stat.mtimeMs,
			preview,
			source: "p0",
			title,
		};
	} catch {
		return null;
	}
}

function collectP0SessionRecords(excludeSessionFiles: Set<string>): ForkRecord[] {
	if (!existsSync(SESSIONS_ROOT)) return [];
	const records: ForkRecord[] = [];
	try {
		for (const dirName of readdirSync(SESSIONS_ROOT)) {
			if (dirName === "subagents") continue;
			const dir = join(SESSIONS_ROOT, dirName);
			if (!isDirectory(dir)) continue;
			for (const fileName of readdirSync(dir)) {
				if (!fileName.endsWith(".jsonl")) continue;
				const filePath = safeRealpath(join(dir, fileName));
				if (excludeSessionFiles.has(filePath)) continue;
				const record = buildP0RecordFromSession(filePath);
				if (record) records.push(record);
			}
		}
	} catch {}
	return records.sort((a, b) => (b.closedAt ?? b.createdAt) - (a.closedAt ?? a.createdAt));
}

function collectReviveRecords(recent: Record<string, ForkRecord>): ForkRecord[] {
	const forkRecords = Object.values(recent)
		.filter((record) => existsSync(record.sessionFile))
		.map((record) => ({ ...record, cwd: resolveRecordCwdFromSession(record), source: "fork" as ReviveSource }));
	const forkFiles = new Set(forkRecords.map((record) => safeRealpath(record.sessionFile)));
	return [...forkRecords, ...collectP0SessionRecords(forkFiles)];
}

function buildReviveItem(record: ForkRecord): ReviveItem {
	const entries = record.title && record.preview ? [] : readSessionPreviewEntries(record.sessionFile);
	const lastAssistant = entries.length ? extractLastText(entries, "assistant") : "";
	const lastAny = entries.length ? extractLastText(entries) : "";
	const title = sanitizeRowText(record.title) || extractLastSessionName(entries) || lastAny || sanitizeRowText(record.label) || record.forkId;
	const preview = sanitizeRowText(record.preview) || lastAssistant || lastAny;
	return {
		record,
		workspaceKey: workspaceKeyFor(record.cwd),
		workspaceLabel: workspaceLabelFor(record.cwd),
		title,
		preview: preview === title ? "" : preview,
	};
}

function collectClosedSnapshot(record: ForkRecord): InboxItem | null {
	if (recordSource(record) === "p0") return null;
	const snapshot = readSnapshot(record.forkId);
	if (!isSnapshotClosed(snapshot)) return null;
	const item = writeInboxFromHandoff({
		...snapshot!,
		panelLabel: snapshot?.panelLabel || record.panelLabel,
		parentSessionFile: snapshot?.parentSessionFile || record.parentSessionFile,
		title: snapshot?.title || buildReviveItem(record).title,
	}, "fallback", "inbox");
	markForkClosed(record.forkId, snapshot?.summary ?? "");
	try { unlinkSync(join(HANDOFF_DIR, `${record.forkId}.json`)); } catch {}
	return item;
}

function buildPanelListItems(records: ForkRecord[], inboxItems: InboxItem[]): PanelListItem[] {
	const items: PanelListItem[] = [];
	for (const record of records) {
		const revive = buildReviveItem(record);
		const relatedInbox = inboxItems
			.filter((item) => item.forkId === record.forkId && item.status !== "dismissed")
			.sort((a, b) => b.createdAt - a.createdAt);
		const unread = relatedInbox.filter((item) => item.status === "unread");
		const snapshot = readSnapshot(record.forkId) ?? undefined;
		const closed = Boolean(record.closedAt) || isSnapshotClosed(snapshot ?? null);
		const status: PanelListItem["status"] = unread.length > 0 ? "unread" : closed ? (relatedInbox.length ? "read" : "closed") : "running";
		items.push({
			record,
			revive,
			panelLabel: panelLabelOf(record, snapshot?.panelLabel),
			status,
			unreadCount: unread.length,
			latestInbox: relatedInbox[0],
			latestUnread: unread[0],
			snapshot,
		});
	}
	return items.sort((a, b) => {
		const statusRank = (item: PanelListItem) => item.status === "unread" ? 0 : item.status === "running" ? 1 : 2;
		return statusRank(a) - statusRank(b) || b.record.createdAt - a.record.createdAt;
	});
}

function esc(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function shellQuote(s: string): string {
	return `'${s.replace(/'/g, `'\\''`)}'`;
}

function parseOpenMode(value: string | undefined): OpenMode | null {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return null;
	if (normalized === "here" || normalized === "current" || normalized === "panel" || normalized === "this") return "here";
	if (normalized === "tab") return "tab";
	if (isSplitDirection(normalized)) return splitPlacementFromDirections([normalized]);
	return null;
}

function isSplitDirection(value: string | undefined): value is SplitDirection {
	return SPLIT_DIRS.includes(value as SplitDirection);
}

export function isSplitPlacement(value: unknown): value is SplitPlacement {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<SplitPlacement>;
	return Array.isArray(candidate.anchorPath)
		&& candidate.anchorPath.every(isSplitDirection)
		&& isSplitDirection(candidate.splitDirection);
}

export function splitPlacementFromDirections(directions: SplitDirection[]): SplitPlacement {
	if (directions.length === 0) throw new Error("split placement requires at least one direction");
	return {
		anchorPath: directions.slice(0, -1),
		splitDirection: directions[directions.length - 1],
	};
}

function openTargetFromDirection(direction: Direction): PanelOpenTarget {
	return direction === "tab" ? "tab" : splitPlacementFromDirections([direction]);
}

export function parseSplitPlacementArgs(args: string): SplitPlacement | null {
	const directions = args.trim().split(/\s+/).filter(Boolean);
	if (directions.length === 0 || !directions.every(isSplitDirection)) return null;
	return splitPlacementFromDirections(directions as SplitDirection[]);
}

export function parsePanelTargetRequest(args: string, defaultDirection: SplitDirection = "right"): { target: PanelOpenTarget; prompt?: string } {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	if (tokens[0]?.toLowerCase() === "tab") {
		return { target: "tab", prompt: tokens.slice(1).join(" ") || undefined };
	}

	const directions: SplitDirection[] = [];
	let index = 0;
	while (index < tokens.length && isSplitDirection(tokens[index]?.toLowerCase())) {
		directions.push(tokens[index].toLowerCase() as SplitDirection);
		index++;
	}

	return {
		target: splitPlacementFromDirections(directions.length > 0 ? directions : [defaultDirection]),
		prompt: tokens.slice(index).join(" ") || undefined,
	};
}

function placementLabel(placement: SplitPlacement): string {
	return placement.anchorPath.length > 0
		? `${placement.anchorPath.join(" ")} → ${placement.splitDirection}`
		: placement.splitDirection;
}

function modeLabel(mode: OpenMode): string {
	if (mode === "here") return "현재 패널";
	if (mode === "tab") return "새 탭";
	return `${placementLabel(mode)} 패널`;
}

function buildEnvPrefix(env: Record<string, string | undefined>): string {
	const entries = Object.entries(env).filter(([, value]) => !!value);
	return entries.length > 0 ? `${entries.map(([key, value]) => `${key}=${shellQuote(value!)}`).join(" ")} ` : "";
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

function buildSessionLaunchCommand(cwd: string, sessionFile: string, env: Record<string, string | undefined> = {}): string {
	const command = `cd ${shellQuote(cwd)} && ${buildEnvPrefix(env)}${currentPiCommand()} --session ${shellQuote(sessionFile)}`;
	return esc(command);
}

function resolveReviveCwd(target: ForkRecord, fallbackCwd: string): { cwd: string; fallback: boolean; reason?: string } {
	const candidates = [target.cwd, extractSessionCwd(readSessionPreviewEntries(target.sessionFile))]
		.filter((cwd): cwd is string => typeof cwd === "string" && cwd.trim().length > 0);
	for (const cwd of candidates) {
		const resolved = safeRealpath(cwd);
		if (isDirectory(resolved)) return { cwd: resolved, fallback: false };
	}
	return {
		cwd: fallbackCwd,
		fallback: true,
		reason: candidates[0] ? `세션 cwd가 존재하지 않습니다: ${candidates[0]}` : "세션 cwd를 찾지 못했습니다",
	};
}

function ensureSessionHeaderCwd(sessionFile: string, cwd: string): { updated: boolean; error?: string } {
	try {
		const raw = readFileSync(sessionFile, "utf8");
		const lines = raw.split("\n");
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line.trim()) continue;
			let entry: any;
			try { entry = JSON.parse(line); } catch { continue; }
			if (entry?.type !== "session") continue;
			if (entry.cwd === cwd) return { updated: false };
			entry.cwd = cwd;
			lines[i] = JSON.stringify(entry);
			writeFileSync(sessionFile, lines.join("\n"));
			return { updated: true };
		}
		return { updated: false, error: "session header를 찾지 못했습니다" };
	} catch (error) {
		return { updated: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function chdirForCurrentPanelRevive(cwd: string): { previous: string; changed: boolean; error?: string } {
	const previous = process.cwd();
	if (safeRealpath(previous) === safeRealpath(cwd)) return { previous, changed: false };
	try {
		process.chdir(cwd);
		return { previous, changed: true };
	} catch (error) {
		return { previous, changed: false, error: error instanceof Error ? error.message : String(error) };
	}
}

function buildReplaceCurrentSessionScript(cwd: string, sessionFile: string, env: Record<string, string | undefined> = {}, terminalId?: string | null): string {
	const cmd = buildSessionLaunchCommand(cwd, sessionFile, env);
	const targetTermSelector = terminalId
		? `set targetTerm to first terminal whose id is "${esc(terminalId)}"`
		: "set targetTerm to focused terminal of selected tab of front window";
	return `delay 0.8
tell application "Ghostty"
  activate
  ${targetTermSelector}
  input text "${cmd}" to targetTerm
  send key "enter" to targetTerm
end tell`;
}

function buildAnchorNavigationScript(placement: SplitPlacement, startTermVar: string, anchorTermVar: string): string {
	const lines = [`set ${anchorTermVar} to ${startTermVar}`];
	for (const direction of placement.anchorPath) {
		const pathLabel = esc(placementLabel(placement));
		lines.push(`set previousAnchorId to id of ${anchorTermVar}`);
		lines.push(`set navigationOk to perform action "goto_split:${direction}" on ${anchorTermVar}`);
		lines.push("delay 0.1");
		lines.push("set nextAnchorTerm to focused terminal of selected tab of front window");
		lines.push(`if navigationOk is false then error "Ghostty goto_split:${direction} failed for ${pathLabel}"`);
		lines.push(`if (id of nextAnchorTerm) is previousAnchorId then error "Ghostty anchor path ${pathLabel} did not move from " & previousAnchorId`);
		lines.push(`set ${anchorTermVar} to nextAnchorTerm`);
	}
	return lines.map((line) => `  ${line}`).join("\n");
}

function buildOpenSessionScript(mode: PanelOpenTarget, cwd: string, sessionFile: string, env: Record<string, string | undefined> = {}): string {
	const cmd = buildSessionLaunchCommand(cwd, sessionFile, env);
	if (mode === "tab") {
		return `tell application "System Events"
  tell process "Ghostty"
    keystroke "t" using command down
    delay 1.0
    keystroke "${cmd}"
    key code 36
  end tell
end tell`;
	}

	return `tell application "Ghostty"
  set currentTerm to focused terminal of selected tab of front window
${buildAnchorNavigationScript(mode, "currentTerm", "anchorTerm")}
  set newTerm to split anchorTerm direction ${mode.splitDirection}
  input text "${cmd}" to newTerm
  send key "enter" to newTerm
end tell`;
}

export function buildRepanelScript(placement: SplitPlacement, cwd: string, sessionFile: string, env: Record<string, string | undefined> = {}, oldTerminalId?: string): string {
	const cmd = buildSessionLaunchCommand(cwd, sessionFile, env);
	const oldTermSelector = oldTerminalId
		? `set oldTerm to first terminal whose id is "${esc(oldTerminalId)}"`
		: "set oldTerm to focused terminal of selected tab of front window";
	if (placement.anchorPath.length === 0) {
		return `tell application "Ghostty"
  activate
  ${oldTermSelector}
  close oldTerm
end tell
delay 0.7
tell application "Ghostty"
  set anchorTerm to focused terminal of selected tab of front window
  set newTerm to split anchorTerm direction ${placement.splitDirection}
  input text "${cmd}" to newTerm
  send key "enter" to newTerm
end tell`;
	}

	const pathLabel = esc(placementLabel(placement));
	return `tell application "Ghostty"
  activate
  ${oldTermSelector}
  focus oldTerm
  set currentTerm to oldTerm
${buildAnchorNavigationScript(placement, "currentTerm", "anchorTerm")}
  set anchorId to id of anchorTerm
  if anchorId is (id of oldTerm) then error "Refusing to repanel: anchor path ${pathLabel} resolved to the current terminal"
  close oldTerm
end tell
delay 0.7
tell application "Ghostty"
  set anchorTerm to first terminal whose id is anchorId
  focus anchorTerm
  set newTerm to split anchorTerm direction ${placement.splitDirection}
  input text "${cmd}" to newTerm
  send key "enter" to newTerm
end tell`;
}

async function runDetachedOsa(pi: ExtensionAPI, script: string) {
	mkdirSync(HANDOFF_DIR, { recursive: true });
	const scriptPath = join(HANDOFF_DIR, `repanel-${Date.now()}-${randomUUID().slice(0, 8)}.applescript`);
	writeFileSync(scriptPath, script);
	return pi.exec("bash", ["-lc", `nohup osascript ${shellQuote(scriptPath)} >/dev/null 2>&1 &`]);
}

async function getGhosttyTerminalCount(pi: ExtensionAPI): Promise<number | null> {
	const result = await pi.exec("osascript", ["-e", `tell application "Ghostty" to count terminals of selected tab of front window`]);
	if (result.code !== 0) return null;
	const count = Number.parseInt(result.stdout?.trim() ?? "", 10);
	return Number.isFinite(count) ? count : null;
}

async function getGhosttyFocusedTerminalId(pi: ExtensionAPI): Promise<string | null> {
	const result = await pi.exec("osascript", ["-e", `tell application "Ghostty" to id of focused terminal of selected tab of front window`]);
	if (result.code !== 0) return null;
	return result.stdout?.trim() || null;
}

async function closeCurrentForkPanel(pi: ExtensionAPI) {
	if (process.platform === "darwin" && process.env.TERM_PROGRAM === "ghostty") {
		await runDetachedOsa(pi, `delay 0.2\ntell application "Ghostty"\n  close focused terminal of selected tab of front window\nend tell`);
		setTimeout(() => process.exit(0), 800);
		return;
	}
	setTimeout(() => process.exit(0), 100);
}

interface HandoffData {
	forkId: string;
	panelLabel?: string;
	parentSessionFile?: string;
	parentSessionId?: string;
	title?: string;
	pid: number;
	updatedAt: number;
	finishedAt?: number;
	summary: string;
	mode?: "auto" | "manual" | "done" | "fallback";
	delivery?: HandoffDelivery;
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
	const cleanDir = (dir: string) => {
		try {
			for (const f of readdirSync(dir)) {
				const p = join(dir, f);
				try {
					const stat = statSync(p);
					if (stat.isDirectory()) continue;
					if (now - stat.mtimeMs > HANDOFF_TTL_MS) unlinkSync(p);
				} catch {}
			}
		} catch {}
	};
	cleanDir(HANDOFF_DIR);
	if (existsSync(INBOX_DIR)) cleanDir(INBOX_DIR);
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

function buildScript(target: PanelOpenTarget, cwd: string, sessionFile: string, forkId: string, panelLabel: string, parentSessionFile: string, prompt?: string): string {
	const cmd = buildSessionLaunchCommand(cwd, sessionFile, {
		PI_FORK_ID: forkId,
		PI_FORK_PANEL_LABEL: panelLabel,
		PI_FORK_PARENT: parentSessionFile,
	});

	if (target === "tab") {
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
${buildAnchorNavigationScript(target, "currentTerm", "anchorTerm")}
  set newTerm to split anchorTerm direction ${target.splitDirection}
  input text "${cmd}" to newTerm
  send key "enter" to newTerm${prompt ? `\n  delay 2\n  input text "${esc(prompt)}" to newTerm\n  send key "enter" to newTerm` : ""}
end tell`;
}

export default function (pi: ExtensionAPI) {
	const forkId = process.env.PI_FORK_ID;

	// CHILD MODE additions: this session is a fork of a parent — write snapshots/inbox handoffs
	if (forkId) {
		const handoffPath = join(HANDOFF_DIR, `${forkId}.json`);
		const childPanelLabel = process.env.PI_FORK_PANEL_LABEL;
		const parentSessionFile = process.env.PI_FORK_PARENT;
		let latestEntries: any[] = [];
		let latestCtx: ExtensionContext | undefined;
		let alreadyFinalized = false;

		const currentTitle = () => {
			const entries = latestEntries.length ? latestEntries : latestCtx?.sessionManager.getEntries() ?? [];
			return extractLastSessionName(entries) || extractLastText(entries) || childPanelLabel || forkId;
		};

		const writeAuto = (final: boolean, payload?: string) => {
			try {
				const lastMsg = extractLastAssistant(latestEntries);
				if (!lastMsg) return;
				mkdirSync(HANDOFF_DIR, { recursive: true });
				const data: HandoffData = {
					forkId,
					panelLabel: childPanelLabel,
					parentSessionFile,
					parentSessionId: parentSessionFile,
					title: currentTitle(),
					pid: process.pid,
					updatedAt: Date.now(),
					...(final ? { finishedAt: Date.now() } : {}),
					summary: payload ?? lastMsg,
					mode: "auto",
					delivery: "snapshot",
				};
				writeFileSync(handoffPath, JSON.stringify(data, null, 2));
			} catch {}
		};

		pi.on("session_start", async (_e, ctx) => {
			if (!childPanelLabel) return;
			ctx.ui.notify(`${childPanelLabel} fork panel 시작됨 · /handoff: inbox 저장 · /done: handoff 후 종료`, "info");
		});

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
			if (consumeRepanelMarker(forkId)) return;
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
					if (consumeRepanelMarker(forkId)) {
						process.exit(0);
					}
					writeAuto(true);
				}
			});
		}

		const buildManualHandoff = async (args: string | undefined, ctx: ExtensionContext, source: HandoffSource) => {
			const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
			let mode: "summary" | "full" | "last" = "summary";
			let inject = false;
			let noHandoff = false;
			const noteParts: string[] = [];
			for (const t of tokens) {
				if (t === "--full") mode = "full";
				else if (t === "--last") mode = "last";
				else if (t === "--summary") mode = "summary";
				else if (t === "--inject") inject = true;
				else if (t === "--no-handoff") noHandoff = true;
				else noteParts.push(t);
			}
			if (noHandoff) return { noHandoff: true, mode, inject, item: null as InboxItem | null };

			const entries = ctx.sessionManager.getEntries();
			latestEntries = entries;
			latestCtx = ctx;
			const lastMsg = extractLastAssistant(entries);
			if (!lastMsg) {
				ctx.ui.notify("전송할 응답이 없습니다 (assistant 메시지가 아직 없음)", "warning");
				return null;
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

			const ts = Date.now();
			const data: HandoffData = {
				forkId,
				panelLabel: childPanelLabel,
				parentSessionFile,
				parentSessionId: parentSessionFile,
				title: currentTitle(),
				pid: process.pid,
				updatedAt: ts,
				summary: payload,
				mode: source === "done" ? "done" : "manual",
				delivery: inject ? "inject" : "inbox",
				customNote: note,
			};
			const item = writeInboxFromHandoff(data, source, inject ? "inject" : "inbox");
			return { noHandoff: false, mode, inject, item };
		};

		// Manual /handoff command
		pi.registerCommand("handoff", {
			description: "Send to parent inbox. Options: --inject (immediate follow-up), --full, --last, --summary. [optional note]",
			handler: async (args, ctx) => {
				try {
					const result = await buildManualHandoff(args, ctx, "manual");
					if (!result || result.noHandoff || !result.item) return;
					ctx.ui.notify(`${childPanelLabel ?? "panel"} handoff ${result.inject ? "즉시 주입 요청" : "parent inbox 저장"} (mode: ${result.mode})`, "info");
				} catch (e) {
					ctx.ui.notify(`handoff 실패: ${e instanceof Error ? e.message : e}`, "error");
				}
			},
		});

		pi.registerCommand("done", {
			description: "Send handoff then close this fork panel. Options: --inject, --no-handoff, --full, --last, --summary. [optional note]",
			handler: async (args, ctx) => {
				try {
					const result = await buildManualHandoff(args, ctx, "done");
					alreadyFinalized = true;
					if (result?.noHandoff) {
						markForkClosed(forkId, "closed without handoff");
						ctx.ui.notify(`${childPanelLabel ?? "panel"} 종료 (handoff 없음)`, "info");
					} else if (result?.item) {
						markForkClosed(forkId, result.item.summary);
						ctx.ui.notify(`${childPanelLabel ?? "panel"} ${result.inject ? "handoff 즉시 주입 요청 후" : "handoff inbox 저장 후"} 종료`, "info");
					}
					try { unlinkSync(handoffPath); } catch {}
					await closeCurrentForkPanel(pi);
				} catch (e) {
					ctx.ui.notify(`done 실패: ${e instanceof Error ? e.message : e}`, "error");
				}
			},
		});
		// Continue to register fork-panel command/shortcuts so child can fork further
	} else {
		const recoverIdentity = (ctx: ExtensionContext): ForkPanelIdentity | null => {
			const identity = resolveForkPanelIdentity({ sessionFile: ctx.sessionManager.getSessionFile() });
			if (identity.source !== "recent" || !identity.forkId || identity.panelLabel.toUpperCase() === "P0") return null;
			return identity;
		};

		const buildRecoveredHandoff = async (args: string | undefined, ctx: ExtensionContext, source: HandoffSource) => {
			const identity = recoverIdentity(ctx);
			if (!identity) {
				ctx.ui.notify("현재 세션은 fork-panel recent record와 연결되지 않아 /handoff를 사용할 수 없습니다.", "warning");
				return { noHandoff: true, mode: "summary" as const, item: null as InboxItem | null, identity: null as ForkPanelIdentity | null };
			}

			const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
			let mode: "summary" | "full" | "last" = "summary";
			let inject = false;
			let noHandoff = false;
			const noteParts: string[] = [];
			for (const t of tokens) {
				if (t === "--full") mode = "full";
				else if (t === "--last") mode = "last";
				else if (t === "--summary") mode = "summary";
				else if (t === "--inject") inject = true;
				else if (t === "--no-handoff") noHandoff = true;
				else noteParts.push(t);
			}
			if (noHandoff) return { noHandoff: true, mode, item: null as InboxItem | null, identity };

			const entries = ctx.sessionManager.getEntries();
			const lastMsg = extractLastAssistant(entries);
			if (!lastMsg) {
				ctx.ui.notify("전송할 응답이 없습니다 (assistant 메시지가 아직 없음)", "warning");
				return null;
			}

			let payload: string;
			if (mode === "full") {
				payload = assemblePayload({ mode: "full", lastMessage: lastMsg, transcript: extractFullTranscript(entries) });
			} else if (mode === "summary") {
				ctx.ui.notify("요약 생성 중…", "info");
				const summary = await generateSummary(entries, ctx);
				payload = assemblePayload({ mode: summary ? "summary" : "last", lastMessage: lastMsg, summary });
			} else {
				payload = lastMsg;
			}

			const ts = Date.now();
			const data: HandoffData = {
				forkId: identity.forkId,
				panelLabel: identity.panelLabel,
				parentSessionFile: identity.parentSessionFile,
				parentSessionId: identity.parentSessionFile,
				title: extractLastSessionName(entries) || extractLastText(entries) || identity.panelLabel || identity.forkId,
				pid: process.pid,
				updatedAt: ts,
				summary: payload,
				mode: source === "done" ? "done" : "manual",
				delivery: inject ? "inject" : "inbox",
				customNote: noteParts.join(" ").trim() || undefined,
			};
			const item = writeInboxFromHandoff(data, source, inject ? "inject" : "inbox");
			return { noHandoff: false, mode, item, identity };
		};

		pi.on("session_start", async (_e, ctx) => {
			const identity = recoverIdentity(ctx);
			if (!identity) return;
			ctx.ui.notify(`${identity.panelLabel} fork panel identity 복구됨 · revive env fallback`, "info");
		});

		pi.registerCommand("handoff", {
			description: "Recovered fork-panel handoff when revive lost PI_FORK_* env. Options: --inject, --full, --last, --summary.",
			handler: async (args, ctx) => {
				try {
					const result = await buildRecoveredHandoff(args, ctx, "manual");
					if (!result || result.noHandoff || !result.item || !result.identity) return;
					ctx.ui.notify(`${result.identity.panelLabel} handoff ${result.item.delivery === "inject" ? "즉시 주입 요청" : "parent inbox 저장"} (recovered, mode: ${result.mode})`, "info");
				} catch (e) {
					ctx.ui.notify(`handoff 실패: ${e instanceof Error ? e.message : e}`, "error");
				}
			},
		});

		pi.registerCommand("done", {
			description: "Recovered fork-panel done when revive lost PI_FORK_* env. Options: --inject, --no-handoff, --full, --last, --summary.",
			handler: async (args, ctx) => {
				try {
					const result = await buildRecoveredHandoff(args, ctx, "done");
					if (result?.identity?.forkId) {
						if (result.noHandoff) {
							markForkClosed(result.identity.forkId, "closed without handoff");
							ctx.ui.notify(`${result.identity.panelLabel} 종료 (handoff 없음, recovered)`, "info");
						} else if (result.item) {
							markForkClosed(result.identity.forkId, result.item.summary);
							ctx.ui.notify(`${result.identity.panelLabel} ${result.item.delivery === "inject" ? "handoff 즉시 주입 요청 후" : "handoff inbox 저장 후"} 종료 (recovered)`, "info");
						}
						try { unlinkSync(join(HANDOFF_DIR, `${result.identity.forkId}.json`)); } catch {}
						await closeCurrentForkPanel(pi);
					}
				} catch (e) {
					ctx.ui.notify(`done 실패: ${e instanceof Error ? e.message : e}`, "error");
				}
			},
		});
	}

	// All sessions (parent or child fork): can spawn new forks
	const activeWatchers = new Map<string, ReturnType<typeof setInterval>>();

	function watchHandoff(forkId: string, label: string, ctx?: ExtensionCommandContext) {
		const existing = activeWatchers.get(forkId);
		if (existing) clearInterval(existing);

		const autoPath = join(HANDOFF_DIR, `${forkId}.json`);

		const interval = setInterval(() => {
			const record = loadRecent()[forkId];

			// 1. Inbox handoffs: default stays in inbox, --inject becomes immediate follow-up.
			try {
				for (const item of loadInboxItems().filter((i) => i.forkId === forkId && i.status === "unread")) {
					if (item.delivery === "inject") {
						pi.sendUserMessage(formatHandoffMessage(item, record), { deliverAs: "followUp" });
						markInboxInjected(item);
						continue;
					}
					if (!item.notifiedAt) {
						ctx?.ui.notify(`${item.panelLabel || record?.panelLabel || "panel"} handoff 도착 · /panels에서 Enter로 입력창에 삽입`, "info");
						markInboxNotified(item);
					}
				}
			} catch {}

			// 2. Closed child fallback: turn latest snapshot into an inbox item, not an automatic follow-up.
			if (existsSync(autoPath)) {
				try {
					const data: HandoffData = JSON.parse(readFileSync(autoPath, "utf8"));
					const finished = !!data.finishedAt;
					const pidDead = data.pid && !isPidAlive(data.pid);
					if (finished || pidDead) {
						const item = writeInboxFromHandoff({
							...data,
							panelLabel: data.panelLabel || record?.panelLabel,
							parentSessionFile: data.parentSessionFile || record?.parentSessionFile,
							title: data.title || label,
							finishedAt: data.finishedAt ?? Date.now(),
						}, "fallback", "inbox");
						markForkClosed(forkId, data.summary);
						try { unlinkSync(autoPath); } catch {}
						ctx?.ui.notify(`${item.panelLabel || "panel"} 종료 handoff 도착 · /panels에서 확인`, "info");
						markInboxNotified(item);
					}
				} catch {}
			}

			if (record?.closedAt && !loadInboxItems().some((item) => item.forkId === forkId && item.status === "unread" && item.delivery === "inject")) {
				clearInterval(interval);
				activeWatchers.delete(forkId);
			}
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

			// Parse args. Multiple leading split directions mean: move to an anchor path,
			// then split the anchor in the final direction (`right down` = right panel's bottom).
			const { target, prompt } = parsePanelTargetRequest(args ?? "");

			// Copy session file
			const dir = dirname(sessionFile);
			const timestamp = Date.now();
			const uuid = randomUUID().slice(0, 8);
			const forkedFile = join(dir, `${timestamp}_${uuid}.jsonl`);
			const newForkId = `fk_${uuid}_${timestamp}`;
			const parentSessionFile = sessionFile;
			const panelLabel = allocatePanelLabel(parentSessionFile);

			try {
				copyFileSync(sessionFile, forkedFile);
			} catch (e) {
				ctx.ui.notify(`세션 파일 복사 실패: ${e instanceof Error ? e.message : e}`, "error");
				return;
			}

			// Open in Ghostty
			forkInProgress = true;
			const script = buildScript(target, ctx.cwd, forkedFile, newForkId, panelLabel, parentSessionFile, prompt);
			const result = await pi.exec("osascript", ["-e", script]);

			setTimeout(() => { forkInProgress = false; }, FORK_COOLDOWN_MS);

			if (result.code !== 0) {
				forkInProgress = false;
				ctx.ui.notify(`패널 생성 실패: ${result.stderr?.trim() ?? "unknown"}`, "error");
				try { unlinkSync(forkedFile); } catch {}
				return;
			}

			// Register watcher for handoff
			const targetLabel = target === "tab" ? "새 탭" : `${placementLabel(target)} 패널`;
			const label = prompt ? sanitizeRowText(prompt).slice(0, 40) : targetLabel;
			recordFork({
				forkId: newForkId,
				label,
				panelLabel,
				parentSessionFile,
				sessionFile: forkedFile,
				cwd: ctx.cwd,
				createdAt: timestamp,
			});
			watchHandoff(newForkId, label, ctx);

			ctx.ui.notify(
				`${panelLabel} 세션 포크 → ${targetLabel}${prompt ? ` (자동 prompt)` : ""}\n/handoff는 parent inbox에 저장되고, 종료 fallback도 /panels에서 확인합니다.`,
				"info",
			);
	};

	const completions = (prefix: string): AutocompleteItem[] | null => {
		const parts = prefix.split(/\s+/);
		const last = parts.pop() ?? "";
		const base = parts.length > 0 ? `${parts.join(" ")} ` : "";
		const candidates = base ? SPLIT_DIRS : VALID_DIRS;
		const filtered = candidates.filter((d) => d.startsWith(last)).map((d) => ({ value: `${base}${d}`, label: `${base}${d}` }));
		return filtered.length > 0 ? filtered : null;
	};

	pi.registerCommand("fork-panel", {
		description: "Fork current session into a new Ghostty panel/tab. Leading split dirs form an anchor path. Examples: right, right down, tab [prompt]",
		getArgumentCompletions: completions,
		handler,
	});

	pi.registerCommand("fp", {
		description: "Alias for /fork-panel",
		getArgumentCompletions: completions,
		handler,
	});

	pi.registerCommand("panels", {
		description: "fork-panel inbox/list. Enter inserts selected handoff/snapshot into editor; s sends follow-up; o revives; r marks read; d dismisses.",
		handler: async (args, ctx) => {
			const allRecords = loadRecent();
			for (const record of Object.values(allRecords)) collectClosedSnapshot(record);

			const currentWorkspaceKey = workspaceKeyFor(ctx.cwd);
			const currentWorkspaceLabel = workspaceLabelFor(ctx.cwd);
			let showAll = (args ?? "").trim().split(/\s+/).some((token) => token.toLowerCase() === "all");
			let selectedIndex = 0;
			let scrollOffset = 0;

			const listItems = () => {
				const records = Object.values(loadRecent()).filter((record) => existsSync(record.sessionFile));
				const filtered = showAll ? records : records.filter((record) => workspaceKeyFor(record.cwd) === currentWorkspaceKey);
				return buildPanelListItems(filtered, loadInboxItems());
			};

			const payloadFor = (item: PanelListItem): { text: string; inbox?: InboxItem } | null => {
				const inbox = item.latestUnread ?? item.latestInbox;
				if (inbox) return { text: formatHandoffMessage(inbox, item.record), inbox };
				if (item.snapshot?.summary) return { text: formatHandoffMessage(item.snapshot, item.record) };
				const last = extractLastText(readSessionEntries(item.record.sessionFile), "assistant") || item.revive.preview;
				if (!last) return null;
				return { text: `[panel ${item.panelLabel} snapshot: ${item.revive.title}]\n\n${last}` };
			};

			const markSelectedRead = (item: PanelListItem) => {
				for (const inbox of loadInboxItems().filter((entry) => entry.forkId === item.record.forkId && entry.status === "unread")) {
					setInboxRead(inbox);
				}
			};

			const selected = await ctx.ui.custom<PanelListItem | null>(
				(tui, theme, _kb, done) => ({
					render: (w: number) => {
						const items = listItems();
						if (selectedIndex >= items.length) selectedIndex = Math.max(0, items.length - 1);
						if (scrollOffset >= items.length) scrollOffset = Math.max(0, items.length - 1);
						const rows = (tui as any).terminal?.rows ?? 30;
						const headerH = 3;
						const footerH = 1;
						const bodyH = Math.max(3, rows - headerH - footerH);
						const lines: string[] = [];
						const scopeText = showAll ? "all workspaces" : `workspace ${currentWorkspaceLabel}`;
						const toggleText = showAll ? "a: current" : "a: all";
						lines.push(theme.fg("accent", "─".repeat(w)));
						lines.push(truncateToWidth(`  ${theme.fg("accent", theme.bold("PANELS"))} ${theme.fg("accent", "|")} ${items.length} panels ${theme.fg("accent", "·")} ${theme.fg("border", scopeText)} ${theme.fg("accent", "·")} ${theme.fg("border", "Enter insert · s send · o revive · r read · d dismiss · q close")}`, w, ""));
						lines.push(truncateToWidth(`  ${theme.fg("border", `↑/↓ select · ${toggleText} · unread items are not injected until you choose them`)}`, w, ""));

						if (items.length === 0) {
							lines.push(truncateToWidth(theme.fg("warning", `  현재 워크스페이스(${currentWorkspaceLabel})에 fork panel 기록이 없습니다. a를 눌러 전체를 보세요.`), w, ""));
						} else {
							if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
							if (selectedIndex >= scrollOffset + bodyH) scrollOffset = selectedIndex - bodyH + 1;
							for (let i = scrollOffset; i < Math.min(items.length, scrollOffset + bodyH); i++) {
								const item = items[i];
								const sel = i === selectedIndex;
								const cursor = sel ? theme.fg("accent", "▶") : " ";
								const statusIcon = item.status === "unread" ? theme.fg("warning", "●") : item.status === "running" ? theme.fg("success", "●") : theme.fg("border", "●");
								const status = item.status === "unread" ? `unread${item.unreadCount > 1 ? `(${item.unreadCount})` : ""}` : item.status;
								const panel = renderPanelLabel(theme, item.panelLabel, sel);
								const workspace = theme.fg("border", truncateToWidth(item.revive.workspaceLabel, 16, "…"));
								const titleW = Math.max(18, Math.min(42, Math.floor(w * 0.32)));
								const title = sel ? theme.fg("accent", truncateToWidth(item.revive.title, titleW, "…")) : truncateToWidth(item.revive.title, titleW, "…");
								const previewSource = item.latestUnread?.summary || item.latestInbox?.summary || item.snapshot?.summary || item.revive.preview;
								const previewW = Math.max(0, w - titleW - 48);
								const preview = previewW > 0 ? theme.fg("border", truncateToWidth(sanitizeRowText(previewSource), previewW, "…")) : "";
								lines.push(truncateToWidth(`${cursor} ${statusIcon} ${panel} ${theme.fg("border", status.padEnd(8))} ${workspace}  ${title}  ${preview}`, w, ""));
							}
						}

						while (lines.length < headerH + bodyH) lines.push("");
						lines.push(theme.fg("accent", "─".repeat(w)));
						return lines;
					},
					handleInput: (data: string) => {
						const items = listItems();
						const item = items[selectedIndex];
						if (data === "q" || matchesKey(data, Key.escape)) { done(null); return; }
						if (data === "a") { showAll = !showAll; selectedIndex = 0; scrollOffset = 0; }
						else if (matchesKey(data, Key.up) || data === "k") { if (selectedIndex > 0) selectedIndex--; }
						else if (matchesKey(data, Key.down) || data === "j") { if (selectedIndex < items.length - 1) selectedIndex++; }
						else if (matchesKey(data, Key.enter)) { if (item) done(item); return; }
						else if (data === "s" && item) {
							const payload = payloadFor(item);
							if (payload) {
								pi.sendUserMessage(payload.text, { deliverAs: "followUp" });
								if (payload.inbox) setInboxRead(payload.inbox);
								ctx.ui.notify(`${item.panelLabel} handoff를 follow-up으로 전송했습니다`, "info");
							}
							done(null); return;
						} else if (data === "r" && item) {
							markSelectedRead(item);
							ctx.ui.notify(`${item.panelLabel} unread handoff를 read 처리했습니다`, "info");
						} else if (data === "d" && item) {
							for (const inbox of loadInboxItems().filter((entry) => entry.forkId === item.record.forkId && entry.status !== "dismissed")) setInboxDismissed(inbox);
							ctx.ui.notify(`${item.panelLabel} inbox를 dismiss 처리했습니다`, "info");
						} else if (data === "o" && item) { done(null); void openRevive(item.record, ctx, "right"); return; }
						(tui as any).requestRender?.();
					},
					invalidate: () => {},
				}),
				{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } },
			);

			if (selected) {
				const payload = payloadFor(selected);
				if (!payload) {
					ctx.ui.notify(`${selected.panelLabel}에서 가져올 handoff/snapshot이 없습니다`, "warning");
					return;
				}
				insertIntoEditor(ctx, payload.text);
				if (payload.inbox) setInboxRead(payload.inbox);
				ctx.ui.notify(`${selected.panelLabel} handoff를 입력창에 삽입했습니다`, "info");
			}
		},
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

	const splitCompletions = (prefix: string): AutocompleteItem[] | null => {
		const parts = prefix.split(/\s+/);
		const last = parts.pop() ?? "";
		const base = parts.length > 0 ? `${parts.join(" ")} ` : "";
		const filtered = SPLIT_DIRS.filter((d) => d.startsWith(last)).map((d) => ({ value: `${base}${d}`, label: `${base}${d}` }));
		return filtered.length > 0 ? filtered : null;
	};

	const repanelHandler = async (args: string, ctx: ExtensionCommandContext) => {
		const placement = parseSplitPlacementArgs(args ?? "");
		if (!placement) {
			ctx.ui.notify("사용법: /repanel right|left|down|up [anchor... split] 예: /repanel right down", "warning");
			return;
		}
		await repanelCurrent(placement, ctx);
	};

	pi.registerCommand("repanel", {
		description: "현재 Ghostty pi 패널을 닫은 뒤, anchor 경로 기준으로 같은 세션을 다시 엽니다. 예: /repanel down, /repanel right down",
		getArgumentCompletions: splitCompletions,
		handler: repanelHandler,
	});

	// /revive — reopen a previous fork panel or P0 session
	pi.registerCommand("revive", {
		description: "fork-panel/P0 세션을 선택하고 현재 패널/방향 패널/탭 중 어디에 열지 선택",
		handler: async (args, ctx) => {
			const tokens = (args ?? "").trim().split(/\s+/).filter(Boolean);
			if (tokens[0]?.toLowerCase() === "to") {
				await repanelHandler(tokens.slice(1).join(" "), ctx);
				return;
			}

			const recent = loadRecent();
			const records = collectReviveRecords(recent);
			const recordsById = new Map(records.map((record) => [record.forkId, record]));
			const allItems = records
				.filter((r) => existsSync(r.sessionFile))
				.map(buildReviveItem)
				.sort((a, b) => (b.record.closedAt ?? b.record.createdAt) - (a.record.closedAt ?? a.record.createdAt));
			const currentWorkspaceKey = workspaceKeyFor(ctx.cwd);
			const currentWorkspaceLabel = workspaceLabelFor(ctx.cwd);
			const scopedItems = () => allItems.filter((item) => item.workspaceKey === currentWorkspaceKey);

			let showAll = false;
			let selector: string | null = null;
			let requestedMode: OpenMode | null = null;
			const requestedDirections: SplitDirection[] = [];
			for (const token of tokens) {
				const lower = token.toLowerCase();
				if (lower === "list") continue;
				if (lower === "all") { showAll = true; continue; }
				if (isSplitDirection(lower)) {
					requestedDirections.push(lower);
					requestedMode = splitPlacementFromDirections(requestedDirections);
					continue;
				}
				const mode = parseOpenMode(lower);
				if (mode) requestedMode = mode;
				else if (!selector) selector = token;
			}

			const openItem = async (item: ReviveItem) => {
				const mode = requestedMode ?? await chooseReviveOpenMode(item, ctx);
				if (mode) await openRevive(item.record, ctx, mode);
			};

			if (selector === "last") {
				const target = (showAll ? allItems : scopedItems())[0];
				if (!target) { ctx.ui.notify(`현재 워크스페이스(${currentWorkspaceLabel})에 재개 가능한 세션이 없습니다. /revive all 또는 /revive에서 a를 누르세요.`, "warning"); return; }
				await openItem(target);
				return;
			}
			if (selector) {
				const target = recordsById.get(selector);
				if (!target) { ctx.ui.notify(`세션 없음: ${selector}. /revive로 목록을 확인하세요.`, "error"); return; }
				await openItem(buildReviveItem(target));
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("TUI가 없는 모드에서는 /revive last here 또는 /revive <sessionId> right처럼 대상과 열 위치를 지정하세요.", "warning");
				return;
			}
			if (allItems.length === 0) {
				ctx.ui.notify("재개 가능한 Pi 세션이 없습니다", "info");
				return;
			}

			let selectedIndex = 0;
			let scrollOffset = 0;
			const visibleItems = () => showAll ? allItems : scopedItems();

			const selected = await ctx.ui.custom<ReviveItem | null>(
				(tui, theme, _kb, done) => ({
					render: (w: number) => {
						const items = visibleItems();
						if (selectedIndex >= items.length) selectedIndex = Math.max(0, items.length - 1);
						if (scrollOffset >= items.length) scrollOffset = Math.max(0, items.length - 1);

						const rows = (tui as any).terminal?.rows ?? 30;
						const headerH = 3;
						const footerH = 1;
						const bodyH = Math.max(3, rows - headerH - footerH);
						const lines: string[] = [];
						const scopeText = showAll ? "all workspaces" : `workspace ${currentWorkspaceLabel}`;
						const toggleText = showAll ? "a: current" : "a: all";
						const openHint = requestedMode ? `Enter: open → ${modeLabel(requestedMode)}` : "Enter: choose open target";

						lines.push(theme.fg("accent", "─".repeat(w)));
						const title = `  ${theme.fg("accent", theme.bold("REVIVE"))} ${theme.fg("accent", "|")} ${items.length}/${allItems.length} sessions ${theme.fg("accent", "·")} ${theme.fg("border", scopeText)} ${theme.fg("accent", "·")} ${theme.fg("border", `${openHint} · q/Esc: close`)}`;
						const helpText = `↑/↓ select · Enter open · ${toggleText}`;
						const help = `  ${theme.fg("border", helpText)}`;
						lines.push(truncateToWidth(title, w, ""));
						lines.push(truncateToWidth(help, w, ""));

						if (items.length === 0) {
							lines.push(truncateToWidth(theme.fg("warning", `  현재 워크스페이스(${currentWorkspaceLabel})에 세션이 없습니다. a를 눌러 전체 워크스페이스를 보세요.`), w, ""));
						} else {
							if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
							if (selectedIndex >= scrollOffset + bodyH) scrollOffset = selectedIndex - bodyH + 1;

							for (let i = scrollOffset; i < Math.min(items.length, scrollOffset + bodyH); i++) {
								const item = items[i];
								const r = item.record;
								const sel = i === selectedIndex;
								const cursor = sel ? theme.fg("accent", "▶") : " ";
								const pad = (n: number) => String(n).padStart(2, "0");
								const d = new Date(r.closedAt ?? r.createdAt);
								const timeStr = theme.fg("borderAccent", `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`);
								const status = recordSource(r) === "p0" ? theme.fg("border", "●") : r.closedAt ? "●" : theme.fg("success", "●");
								const panel = renderPanelLabel(theme, panelLabelOf(r), sel);
								const workspace = theme.fg("border", truncateToWidth(item.workspaceLabel, 18, "…"));
								const titleW = Math.max(18, Math.min(42, Math.floor(w * 0.32)));
								const titleRaw = truncateToWidth(item.title, titleW, "…");
								const titleStr = sel ? theme.fg("accent", titleRaw) : theme.fg("text", titleRaw);
								const previewW = Math.max(0, w - titleW - 40);
								const preview = previewW > 0 ? truncateToWidth(item.preview, previewW, "…") : "";
								const previewStr = sel ? preview : theme.fg("borderAccent", preview);
								lines.push(truncateToWidth(`${cursor} ${status} ${panel} ${timeStr} ${workspace}  ${titleStr}  ${previewStr}`, w, ""));
							}
						}

						while (lines.length < headerH + bodyH) lines.push("");
						lines.push(theme.fg("accent", "─".repeat(w)));
						return lines;
					},
					handleInput: (data: string) => {
						const items = visibleItems();
						if (data === "q" || matchesKey(data, Key.escape)) { done(null); return; }
						if (data === "a") {
							showAll = !showAll;
							selectedIndex = 0;
							scrollOffset = 0;
						} else if (matchesKey(data, Key.up) || data === "k") {
							if (selectedIndex > 0) selectedIndex--;
						} else if (matchesKey(data, Key.down) || data === "j") {
							if (selectedIndex < items.length - 1) selectedIndex++;
						} else if (matchesKey(data, Key.enter)) {
							if (items[selectedIndex]) done(items[selectedIndex]);
							return;
						}
						(tui as any).requestRender?.();
					},
					invalidate: () => {},
				}),
				{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } },
			);

			if (selected) await openItem(selected);
		},
	});

	async function chooseReviveOpenMode(item: ReviveItem, ctx: ExtensionCommandContext): Promise<OpenMode | null> {
		if (!ctx.hasUI) return splitPlacementFromDirections(["right"]);
		return ctx.ui.custom<OpenMode | null>(
			(tui, theme, _kb, done) => ({
				render: (w: number) => {
					const lines = [
						theme.fg("accent", "─".repeat(w)),
						truncateToWidth(`  ${theme.fg("accent", theme.bold("OPEN REVIVE"))} ${theme.fg("accent", "|")} ${renderPanelLabel(theme, panelLabelOf(item.record), true)} ${theme.fg("accent", "·")} ${theme.fg("border", item.workspaceLabel)} ${theme.fg("accent", "·")} ${theme.fg("text", item.title)}`, w, ""),
						truncateToWidth(`  ${theme.fg("border", "Enter/h: 현재 패널(다른 worktree면 선택) · ← left · → right · ↑ up · ↓ down · t: 새 탭")}`, w, ""),
						truncateToWidth(`  ${theme.fg("borderAccent", "q/Esc: 취소")}`, w, ""),
						theme.fg("accent", "─".repeat(w)),
					];
					return lines;
				},
				handleInput: (data: string) => {
					if (data === "q" || matchesKey(data, Key.escape)) { done(null); return; }
					if (matchesKey(data, Key.enter) || data === "h") { done("here"); return; }
					if (matchesKey(data, Key.left) || data === "l") { done(splitPlacementFromDirections(["left"])); return; }
					if (matchesKey(data, Key.right) || data === "r") { done(splitPlacementFromDirections(["right"])); return; }
					if (matchesKey(data, Key.up) || data === "u") { done(splitPlacementFromDirections(["up"])); return; }
					if (matchesKey(data, Key.down) || data === "d") { done(splitPlacementFromDirections(["down"])); return; }
					if (data === "t") { done("tab"); return; }
					(tui as any).requestRender?.();
				},
				invalidate: () => {},
			}),
			{ overlay: true, overlayOptions: { width: "72%", minWidth: 52, maxHeight: 8, anchor: "center" } },
		);
	}

	async function chooseReviveHereMismatchAction(item: ReviveItem, currentCwd: string, reviveCwd: string, ctx: ExtensionCommandContext): Promise<ReviveHereMismatchAction | null> {
		if (!ctx.hasUI) return "worktree-here";
		let selectedIndex = 1;
		const options: Array<{ action: ReviveHereMismatchAction; title: string; detail: string }> = [
			{ action: "fast", title: "현재 cwd에서 세션만 빠르게 열기", detail: "워크트리 이동을 보장하지 않습니다. 참고/읽기용에 가깝습니다." },
			{ action: "worktree-here", title: "해당 worktree에서 현재 패널로 열기", detail: "현재 Pi를 재실행해 shell/Pi/tool cwd를 세션 worktree로 맞춥니다." },
		];
		return ctx.ui.custom<ReviveHereMismatchAction | null>(
			(tui, theme, _kb, done) => ({
				render: (w: number) => {
					const lines = [
						theme.fg("accent", "─".repeat(w)),
						truncateToWidth(`  ${theme.fg("accent", theme.bold("WORKTREE MISMATCH"))} ${theme.fg("accent", "|")} ${theme.fg("text", item.title)}`, w, ""),
						truncateToWidth(`  현재 cwd: ${theme.fg("border", workspaceLabelFor(currentCwd))}  →  세션 worktree: ${theme.fg("accent", workspaceLabelFor(reviveCwd))}`, w, ""),
						truncateToWidth(`  ${theme.fg("borderAccent", "j/k 선택 · Enter 확정 · ←/→/↑/↓/t: 해당 worktree 새 패널/탭 · q/Esc 취소")}`, w, ""),
					];
					for (let i = 0; i < options.length; i++) {
						const option = options[i];
						const cursor = i === selectedIndex ? theme.fg("accent", "▶") : " ";
						const title = i === selectedIndex ? theme.fg("accent", option.title) : theme.fg("text", option.title);
						lines.push(truncateToWidth(`${cursor} ${i + 1}. ${title}`, w, ""));
						lines.push(truncateToWidth(`     ${theme.fg("border", option.detail)}`, w, ""));
					}
					lines.push(theme.fg("accent", "─".repeat(w)));
					return lines;
				},
				handleInput: (data: string) => {
					if (data === "q" || matchesKey(data, Key.escape)) { done(null); return; }
					if (matchesKey(data, Key.left) || data === "l") { done("left"); return; }
					if (matchesKey(data, Key.right) || data === "r") { done("right"); return; }
					if (matchesKey(data, Key.up) || data === "u") { done("up"); return; }
					if (matchesKey(data, Key.down) || data === "d") { done("down"); return; }
					if (data === "t") { done("tab"); return; }
					if (data === "k") selectedIndex = Math.max(0, selectedIndex - 1);
					else if (data === "j") selectedIndex = Math.min(options.length - 1, selectedIndex + 1);
					else if (/^[1-2]$/.test(data)) { done(options[Number(data) - 1].action); return; }
					else if (matchesKey(data, Key.enter)) { done(options[selectedIndex].action); return; }
					(tui as any).requestRender?.();
				},
				invalidate: () => {},
			}),
			{ overlay: true, overlayOptions: { width: "82%", minWidth: 64, maxHeight: 13, anchor: "center" } },
		);
	}

	async function openReviveFast(target: ForkRecord, ctx: ExtensionCommandContext, item: ReviveItem, currentCwd: string, reviveCwd: string) {
		try {
			const result = await ctx.switchSession(target.sessionFile, {
				withSession: async (nextCtx) => {
					nextCtx.ui.notify(`${item.title} 세션만 빠르게 열림 · 현재 ${workspaceLabelFor(currentCwd)} / 세션 ${workspaceLabelFor(reviveCwd)}`, "warning");
				},
			});
			if (result.cancelled) ctx.ui.notify("세션 전환이 취소되었습니다", "warning");
		} catch (e) {
			ctx.ui.notify(`세션 전환 실패: ${e instanceof Error ? e.message : e}`, "error");
		}
	}

	async function openReviveHereAtCwd(target: ForkRecord, ctx: ExtensionCommandContext, item: ReviveItem, reviveCwd: { cwd: string; fallback: boolean; reason?: string }) {
		const headerSync = reviveCwd.fallback ? { updated: false } : ensureSessionHeaderCwd(target.sessionFile, reviveCwd.cwd);
		if (headerSync.error) ctx.ui.notify(`revive cwd header 보정 실패: ${headerSync.error}`, "warning");
		const isP0 = recordSource(target) === "p0";
		const env = isP0 ? {} : {
			PI_FORK_ID: target.forkId,
			PI_FORK_PANEL_LABEL: target.panelLabel,
			PI_FORK_PARENT: target.parentSessionFile,
		};
		if (process.platform === "darwin" && process.env.TERM_PROGRAM === "ghostty") {
			const terminalId = await getGhosttyFocusedTerminalId(pi);
			const script = buildReplaceCurrentSessionScript(reviveCwd.cwd, target.sessionFile, env, terminalId);
			const launch = await runDetachedOsa(pi, script);
			if (launch.code === 0) {
				if (!isP0) { try { unlinkSync(join(HANDOFF_DIR, `${target.forkId}.json`)); } catch {} }
				ctx.ui.notify(`${item.workspaceLabel} · ${item.title} 세션 재개 → 현재 패널 재실행`, reviveCwd.fallback ? "warning" : "info");
				ctx.shutdown();
				return;
			}
			ctx.ui.notify(`현재 패널 재실행 실패: ${launch.stderr?.trim() || "unknown"}. in-process 전환으로 fallback합니다.`, "warning");
		}

		const chdirResult = reviveCwd.fallback ? { previous: process.cwd(), changed: false } : chdirForCurrentPanelRevive(reviveCwd.cwd);
		if (chdirResult.error) ctx.ui.notify(`현재 패널 cwd 이동 실패: ${chdirResult.error}`, "warning");
		try {
			const result = await ctx.switchSession(target.sessionFile, {
				cwdOverride: reviveCwd.cwd,
				withSession: async (nextCtx) => {
					const headerNote = headerSync.updated ? " · header cwd 보정" : "";
					const processNote = chdirResult.changed ? " · process cwd 이동" : "";
					const cwdNote = reviveCwd.fallback ? ` · cwd fallback: ${reviveCwd.reason}` : ` · cwd ${workspaceLabelFor(reviveCwd.cwd)}${headerNote}${processNote}`;
					nextCtx.ui.notify(`${item.workspaceLabel} · ${item.title} 세션 재개 → 현재 패널${cwdNote}`, reviveCwd.fallback ? "warning" : "info");
				},
			});
			if (result.cancelled) {
				if (chdirResult.changed) process.chdir(chdirResult.previous);
				ctx.ui.notify("세션 전환이 취소되었습니다", "warning");
			}
		} catch (e) {
			if (chdirResult.changed) process.chdir(chdirResult.previous);
			ctx.ui.notify(`세션 전환 실패: ${e instanceof Error ? e.message : e}`, "error");
		}
	}

	async function openRevive(target: ForkRecord, ctx: ExtensionCommandContext, mode: OpenMode) {
		if (!existsSync(target.sessionFile)) {
			ctx.ui.notify(`세션 파일 없음: ${target.sessionFile}`, "error");
			return;
		}

		const item = buildReviveItem(target);
		if (mode === "here") {
			const reviveCwd = resolveReviveCwd(target, ctx.cwd);
			const currentCwd = ctx.cwd || process.cwd();
			if (!reviveCwd.fallback && !sameWorkspaceCwd(currentCwd, reviveCwd.cwd)) {
				const action = await chooseReviveHereMismatchAction(item, currentCwd, reviveCwd.cwd, ctx);
				if (!action) return;
				if (action === "fast") {
					await openReviveFast(target, ctx, item, currentCwd, reviveCwd.cwd);
					return;
				}
				if (action !== "worktree-here") {
					await openRevive(target, ctx, openTargetFromDirection(action));
					return;
				}
			}
			await openReviveHereAtCwd(target, ctx, item, reviveCwd);
			return;
		}

		if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") {
			ctx.ui.notify("패널/탭 열기는 macOS Ghostty에서만 동작합니다. 현재 패널에서 열려면 here를 선택하세요.", "warning");
			return;
		}

		const reviveCwd = resolveReviveCwd(target, ctx.cwd);
		if (reviveCwd.fallback) ctx.ui.notify(`${reviveCwd.reason}. 현재 cwd로 엽니다: ${reviveCwd.cwd}`, "warning");
		else {
			const headerSync = ensureSessionHeaderCwd(target.sessionFile, reviveCwd.cwd);
			if (headerSync.error) ctx.ui.notify(`revive cwd header 보정 실패: ${headerSync.error}`, "warning");
		}
		const cwd = reviveCwd.cwd;
		const isP0 = recordSource(target) === "p0";
		if (!isP0) { try { unlinkSync(join(HANDOFF_DIR, `${target.forkId}.json`)); } catch {} }
		const script = buildOpenSessionScript(mode, cwd, target.sessionFile, isP0 ? {} : {
			PI_FORK_ID: target.forkId,
			PI_FORK_PANEL_LABEL: target.panelLabel,
			PI_FORK_PARENT: target.parentSessionFile,
		});
		const result = await pi.exec("osascript", ["-e", script]);
		if (result.code !== 0) {
			ctx.ui.notify(`패널 생성 실패: ${result.stderr?.trim() ?? "unknown"}`, "error");
			return;
		}

		if (!isP0) watchHandoff(target.forkId, item.title || target.label, ctx);
		ctx.ui.notify(`${panelLabelOf(target)} · ${item.workspaceLabel} · ${item.title} 세션 재개 → ${modeLabel(mode)}`, "info");
	}

	async function repanelCurrent(placement: SplitPlacement, ctx: ExtensionCommandContext) {
		if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") {
			ctx.ui.notify("/repanel은 macOS Ghostty에서만 동작합니다", "warning");
			return;
		}

		const sessionFile = ctx.sessionManager.getSessionFile();
		if (!sessionFile) {
			ctx.ui.notify("재배치할 세션 파일이 없습니다 (ephemeral session)", "error");
			return;
		}

		const terminalCount = await getGhosttyTerminalCount(pi);
		if (terminalCount === null) {
			ctx.ui.notify("Ghostty 패널 수를 확인하지 못해 /repanel을 중단했습니다", "error");
			return;
		}
		if (terminalCount < 2) {
			ctx.ui.notify("/repanel은 현재 패널을 먼저 닫은 뒤 남은 패널 기준으로 split하므로, 최소 2개 패널이 필요합니다", "warning");
			return;
		}
		const oldTerminalId = await getGhosttyFocusedTerminalId(pi);
		if (!oldTerminalId) {
			ctx.ui.notify("현재 Ghostty 패널 ID를 확인하지 못해 /repanel을 중단했습니다", "error");
			return;
		}

		const forkId = process.env.PI_FORK_ID;
		if (forkId) writeRepanelMarker(forkId);

		const script = buildRepanelScript(placement, ctx.cwd, sessionFile, {
			PI_FORK_ID: forkId,
			PI_FORK_PANEL_LABEL: process.env.PI_FORK_PANEL_LABEL,
			PI_FORK_PARENT: process.env.PI_FORK_PARENT,
		}, oldTerminalId);
		const result = await runDetachedOsa(pi, script);
		if (result.code !== 0) {
			if (forkId) consumeRepanelMarker(forkId);
			ctx.ui.notify(`repanel 실행 실패: ${result.stderr?.trim() ?? "unknown"}`, "error");
			return;
		}

		ctx.ui.notify(`현재 패널을 닫은 뒤 ${placementLabel(placement)} 기준으로 같은 세션을 다시 엽니다`, "info");
	}
}
