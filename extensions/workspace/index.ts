import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { receiveRestoreSession, restoreWorkspace } from "./restore.ts";
import { pinSnapshotSelection, selectSnapshot, type PinnedSnapshotSource, type SnapshotReference } from "./selection.ts";
import { planWorkspaceRestore, type RestorePlan } from "./planner.ts";
import { bindCapturedWindow, captureGhosttyWindow, type GhosttyTerminal, type GhosttyTab, type GhosttyWindow } from "./capture.ts";
import { createSessionRegistration, supportsRegistration, type RegistrationEnvironment } from "./registration.ts";
import { readRegistrations } from "./registry.ts";
import { listSnapshots, saveCompleteSnapshot, workspaceSnapshotStats, type WorkspaceSummary } from "./store.ts";
import { saveHourlySnapshot, scheduleHourlyAutosave } from "./autosave.ts";
export { parseGhosttySnapshotOutput, ghosttySnapshotScript } from "./capture.ts";
export { compareWorkspaceSummaries, workspaceSnapshotStats } from "./store.ts";

const WORKSPACE_DIR = join(getAgentDir(), "workspaces");
let restoreController: AbortController | undefined;

export type WorkspaceTerminalSnapshot = GhosttyTerminal & {
	sessionFile?: string;
	sessionTitle?: string;
	panelLabel?: string;
	forkId?: string;
	parentSessionFile?: string;
	match?: "exact" | "active" | "fallback" | "none";
};
export type WorkspaceSnapshot = {
	version: 1;
	id: string;
	name: string;
	source: "manual" | "auto";
	host: "ghostty";
	createdAt: number;
	updatedAt: number;
	complete?: true;
	slot?: string;
	window: { id: string; name: string };
	tabs: Array<Omit<GhosttyTab, "terminals"> & { terminals: WorkspaceTerminalSnapshot[] }>;
};
type WorkspaceArgs = {
	sub: "save" | "restore" | "list" | "status" | "help";
	target?: string;
	name?: string;
	dryRun: boolean;
	append: boolean;
	all: boolean;
};

function shellQuote(value: string): string { return `'${value.replace(/'/g, `'\\''`)}'`; }
function isStaleCtxError(err: unknown): boolean { return String((err as Error)?.message ?? err).includes("ctx is stale"); }
function displayDate(ts: number): string {
	return new Date(ts).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}
function slugify(value: string): string {
	return value.trim().toLowerCase().replace(/[^a-z0-9가-힣._-]+/giu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "workspace";
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
		? { PI_FORK_ID: term.forkId, PI_FORK_PANEL_LABEL: term.panelLabel, PI_FORK_PARENT: term.parentSessionFile } : {};
	return `cd ${shellQuote(term.cwd)} && ${buildEnvPrefix(env)}${currentPiCommand()} --session ${shellQuote(term.sessionFile)}`;
}
function buildSnapshot(window: GhosttyWindow, source: WorkspaceSnapshot["source"], name?: string): WorkspaceSnapshot {
	const now = Date.now();
	const label = name?.trim() || `workspace ${displayDate(now)}`;
	return {
		version: 1, id: `${new Date(now).toISOString().replace(/[-:.]/g, "").slice(0, 15)}-${slugify(label)}-${randomUUID().slice(0, 6)}`,
		name: label, source, host: "ghostty", createdAt: now, updatedAt: now, complete: true,
		window: { id: window.id, name: window.name }, tabs: bindCapturedWindow(window, WORKSPACE_DIR),
	};
}
function tokenizeArgs(args: string): string[] {
	const tokens: string[] = [];
	let current = "";
	let quote: string | null = null;
	let escaped = false;
	for (const ch of args) {
		if (escaped) { current += ch; escaped = false; continue; }
		if (ch === "\\") { escaped = true; continue; }
		if (quote) { if (ch === quote) quote = null; else current += ch; continue; }
		if (ch === "'" || ch === '"') { quote = ch; continue; }
		if (/\s/u.test(ch)) { if (current) { tokens.push(current); current = ""; } continue; }
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
	const sub = knownSubs.includes(first) ? first as WorkspaceArgs["sub"] : firstToken ? "restore" : "status";
	const rest = sub === "restore" && firstToken && !knownSubs.includes(first) ? [firstToken, ...tokens] : tokens;
	let dryRun = false;
	let append = true;
	let all = false;
	const positional: string[] = [];
	for (const token of rest) {
		if (token === "--dry-run" || token === "-n") dryRun = true;
		else if (token === "--append") append = true;
		else if (token === "--all" || token === "-a") all = true; // Compatibility no-op: all lists are complete.
		else positional.push(token);
	}
	if (sub === "save") return { sub, name: positional.join(" ").trim() || undefined, dryRun, append, all };
	return { sub, target: positional.join(" ").trim() || undefined, dryRun, append, all };
}
export function buildRestorePlan(snapshot: WorkspaceSnapshot): RestorePlan { return planWorkspaceRestore(snapshot, buildSessionLaunchCommand); }
function renderSnapshotSummary(summary: WorkspaceSummary, index?: number): string {
	const prefix = typeof index === "number" ? `${index + 1}. ` : "";
	return `${prefix}${summary.name} (${summary.id}) · ${summary.source} · ${displayDate(summary.updatedAt)} · tab ${summary.tabs}, panel ${summary.terminals}, session ${summary.matched}/${summary.terminals}`;
}
function renderList(summaries: WorkspaceSummary[]): string {
	if (!summaries.length) return "저장된 workspace snapshot이 없습니다.";
	return ["저장된 workspace snapshots · 최신순 전체 목록", "", ...summaries.map(renderSnapshotSummary)].join("\n");
}
export function renderPlan(plan: RestorePlan): string {
	const lines = [
		`Workspace restore plan — ${plan.snapshot.name}`,
		`mode: append · tabs ${plan.snapshot.tabs.length} · 원본 total ${plan.total} / ready ${plan.ready} / blocked ${plan.blocked}`,
		plan.blocked || !plan.total ? "전체 preflight BLOCKED — 원본 패널이 모두 준비되기 전에는 실행하지 않습니다." : "전체 preflight READY — 실제 실행 전후 identity를 다시 확인합니다.", "",
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
		return await restoreWorkspace(pi, plan.actions, WORKSPACE_DIR, { source: plan.source, signal: controller.signal, onProgress: (message) => ctx.ui.setStatus("workspace-restore", message) });
	} finally {
		if (restoreController === controller) restoreController = undefined;
		try { ctx.ui.setStatus("workspace-restore", undefined); } catch (error) { if (!isStaleCtxError(error)) throw error; }
	}
}
function sendReport(pi: ExtensionAPI, title: string, body: string) {
	pi.sendMessage({ customType: "workspace", content: `### ${title}\n\n${body}`, display: true, details: { title, body } }, { triggerTurn: false });
}
async function handleRestore(pi: ExtensionAPI, ctx: ExtensionCommandContext, args: WorkspaceArgs, lastList?: SnapshotReference[]) {
	const selected = selectSnapshot(args.target, listSnapshots(WORKSPACE_DIR), lastList, ctx.cwd);
	const source = pinSnapshotSelection(selected, WORKSPACE_DIR);
	const plan = { ...buildRestorePlan(selected.snapshot), source };
	const report = [
		`requested target: ${args.target}`, `resolved snapshot: ${selected.snapshot.name} (${source.id})`,
		`snapshot path: ${source.path}`, `source SHA256: ${source.hash}`, `pinned source: ${source.pinnedPath}`, "", renderPlan(plan),
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
const HELP = `Ghostty workspace snapshot/restore

Usage:
  /workspace [number|name-or-id]
  /workspace status
  /workspace save [name]
  /workspace save "작업 이름"
  /workspace restore [number|name-or-id] [--dry-run] [--append]
  /workspace list

Notes:
- 실행 중 매 정각에 같은 내용도 자동 저장합니다. 시작 직후 저장·꺼져 있던 시간의 소급 저장은 없습니다.
- 완전한 새 자동 저장 성공 후 자동본만 최근 10개로 정리합니다. 수동 저장은 별도 보존합니다.
- 목록과 자동완성은 최신순 전체 목록입니다. 직전 목록의 번호는 같은 세션에서만 사용하며 파일 변경·삭제 시 다시 선택해야 합니다.
- 패널은 짧은 임시 제목 표식으로 terminal ID에 정확히 등록합니다. 평소 제목은 그대로 유지합니다.
- 이전 runtime·미등록 패널은 /reload가 필요합니다. 누락·중복 binding이 하나라도 있으면 저장과 자동본 정리를 하지 않습니다.
- 기본 restore는 append입니다. 대상을 생략하면 복원하지 않으며 exact id 또는 snapshot 파일 경로도 지정할 수 있습니다.
- 선택한 source bytes/hash, 전체 header-cwd preflight, 패널별 READY, 동일 source 재실행 차단을 유지합니다.
- Ghostty가 split tree/비율을 제공하지 않아 패널 배치는 순차 right split으로 근사 복원합니다.`;

function workspaceArgumentCompletions(argumentPrefix: string): AutocompleteItem[] | null {
	const prefix = argumentPrefix.trimStart();
	const hasTrailingSpace = /\s$/u.test(argumentPrefix);
	const tokens = tokenizeArgs(prefix);
	const commandItems: AutocompleteItem[] = [
		{ value: "status", label: "status", description: "현재 Ghostty workspace 상태" },
		{ value: "save", label: "save", description: "현재 Ghostty window snapshot 저장" },
		{ value: "restore", label: "restore", description: "명시한 snapshot을 append mode로 복원" },
		{ value: "list", label: "list", description: "저장된 snapshots 최신순 전체 목록" },
	];
	if (!tokens.length) return commandItems;
	if (/^[1-9]\d*$/u.test(tokens[0] || "")) return null;
	const first = (tokens[0] || "").toLowerCase();
	if (first === "restore") {
		if (tokens.slice(1).some((token) => !token.startsWith("-")) || !hasTrailingSpace) return null;
		return listSnapshots(WORKSPACE_DIR).map((summary) => ({ value: `restore ${shellQuote(summary.path)}`, label: `restore ${summary.id}`,
			description: `${summary.name} · ${displayDate(summary.updatedAt)} · session ${summary.matched}/${summary.terminals}` }));
	}
	if (["status", "save", "list", "help"].includes(first) || tokens.length > 1 || hasTrailingSpace) return null;
	const filtered = commandItems.filter((item) => item.value.startsWith(first));
	return filtered.length ? filtered : null;
}

export default function (pi: ExtensionAPI, environment?: RegistrationEnvironment) {
	const displayedLists = new Map<string | ExtensionContext["sessionManager"], SnapshotReference[]>();
	const listKey = (ctx: ExtensionContext) => ctx.sessionManager.getSessionFile() || ctx.sessionManager;
	const registration = createSessionRegistration(pi, WORKSPACE_DIR, environment);
	let revokeRestoreReceipt: (() => void) | undefined;
	let stopAutosave: (() => void) | undefined;
	let lifecycle = new AbortController();
	const capture = async (source: WorkspaceSnapshot["source"], name?: string) => {
		if (!registration.isCurrent()) throw new Error("현재 패널이 등록되지 않았습니다. Ghostty TUI에서 /reload 후 다시 시도하세요.");
		registration.refresh();
		const signal = lifecycle.signal;
		const window = await captureGhosttyWindow(pi, signal);
		if (signal.aborted || !registration.isCurrent()) throw new Error("capture 중 세션이 종료·전환·리로드되었습니다.");
		return buildSnapshot(window, source, name);
	};
	pi.on("session_start", async (_event, ctx) => {
		revokeRestoreReceipt = receiveRestoreSession(ctx);
		stopAutosave?.();
		const runtime = new AbortController();
		lifecycle = runtime;
		await registration.start(ctx);
		if (lifecycle !== runtime || runtime.signal.aborted) return;
		const isCurrent = () => !runtime.signal.aborted && lifecycle === runtime && registration.isCurrent();
		stopAutosave = scheduleHourlyAutosave((slot) => saveHourlySnapshot(WORKSPACE_DIR, slot, () => capture("auto"), isCurrent), isCurrent);
	});
	pi.on("message_end", async (_event, ctx) => { registration.refresh(ctx); });
	pi.on("agent_end", async (_event, ctx) => { registration.refresh(ctx); });
	pi.on("session_tree", async (_event, ctx) => { registration.refresh(ctx); });
	pi.on("session_shutdown", async () => {
		stopAutosave?.(); stopAutosave = undefined;
		lifecycle.abort();
		restoreController?.abort();
		try { revokeRestoreReceipt?.(); }
		finally { revokeRestoreReceipt = undefined; registration.stop(); }
	});
	pi.registerCommand("workspace", {
		description: "Ghostty 작업공간 저장/복원",
		getArgumentCompletions: async (prefix: string): Promise<AutocompleteItem[] | null> => workspaceArgumentCompletions(prefix),
		handler: async (rawArgs: string, ctx: ExtensionCommandContext) => {
			const args = parseWorkspaceArgs(rawArgs);
			try {
				if (args.sub === "help") { ctx.ui.notify(HELP, "info"); return; }
				if (args.sub === "restore") return await handleRestore(pi, ctx, args, displayedLists.get(listKey(ctx)));
				if (args.sub === "list") {
					const summaries = listSnapshots(WORKSPACE_DIR);
					displayedLists.set(listKey(ctx), summaries.map(({ id, path, realPath, hash }) => ({ id, path, realPath, hash })));
					ctx.ui.notify("workspace snapshot 목록을 표시했습니다.", "info");
					sendReport(pi, "Workspace list", renderList(summaries)); return;
				}
				if (args.sub === "save") {
					registration.refresh(ctx);
					const runtime = lifecycle;
					const snapshot = await capture("manual", args.name);
					if (runtime !== lifecycle || runtime.signal.aborted || !registration.isCurrent()) return;
					const { path } = saveCompleteSnapshot(WORKSPACE_DIR, snapshot);
					const stats = workspaceSnapshotStats(snapshot);
					ctx.ui.notify(`workspace 저장 완료: ${stats.tabs} tabs / ${stats.matched}/${stats.terminals} sessions`, "info");
					sendReport(pi, "Workspace 저장 완료", `${snapshot.name} (${snapshot.id}) · manual · ${displayDate(snapshot.updatedAt)}\n\npath: ${path}`); return;
				}
				registration.refresh(ctx);
				let live = "현재 환경은 Ghostty TUI가 아니므로 host를 조회하지 않습니다.";
				if (supportsRegistration(ctx, environment)) {
					try { const snapshot = await capture("manual"); const stats = workspaceSnapshotStats(snapshot); live = `현재 Ghostty window: tab ${stats.tabs}, panel ${stats.terminals}, exact session ${stats.matched}`; }
					catch (error) { live = String(error); }
				}
				const summaries = listSnapshots(WORKSPACE_DIR);
				const records = readRegistrations(WORKSPACE_DIR);
				let state = "아직 정각 저장 기록이 없습니다.";
				try { state = readFileSync(join(WORKSPACE_DIR, "autosave-state.json"), "utf8"); } catch {}
				const body = [live, `live process registry: ${records.length}`, ...records.filter((record) => record.error).map((record) => `미등록 pid ${record.pid}: ${record.error}`),
					`최신 저장본: ${summaries[0] ? renderSnapshotSummary(summaries[0]) : "없음"}`, "정각 저장 상태:", state, "", HELP].join("\n");
				ctx.ui.notify("workspace 상태를 표시했습니다.", "info");
				sendReport(pi, "Workspace status", body);
			} catch (error) {
				if (isStaleCtxError(error)) return;
				ctx.ui.notify(`workspace 오류: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
