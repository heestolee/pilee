import { existsSync, appendFileSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, basename } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

// ─── Storage ───────────────────────────────────────────────────────────────

const LOG_FILE = join(homedir(), ".pi", "agent", "state", "usage-analytics.jsonl");
const MAX_LOG_AGE_DAYS = 180;

interface BaseEntry {
	ts: string;
	epoch: number;
}

interface SubagentStartEntry extends BaseEntry {
	type: "subagent_start";
	agentType: string;
	agentId: string;
	description?: string;
}

interface SubagentEndEntry extends BaseEntry {
	type: "subagent_end";
	agentType: string;
	agentId: string;
	status: "done" | "error" | "aborted";
	durationMs: number;
	toolUses: number;
	retries?: number;
}

interface SkillReadEntry extends BaseEntry {
	type: "skill_read";
	skill: string;
	path: string;
}

type LogEntry = SubagentStartEntry | SubagentEndEntry | SkillReadEntry;

function appendEntry(entry: LogEntry) {
	try {
		mkdirSync(dirname(LOG_FILE), { recursive: true });
		appendFileSync(LOG_FILE, `${JSON.stringify(entry)}\n`);
	} catch {}
}

function readAll(): LogEntry[] {
	if (!existsSync(LOG_FILE)) return [];
	try {
		return readFileSync(LOG_FILE, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((l) => {
				try { return JSON.parse(l) as LogEntry; } catch { return null; }
			})
			.filter((e): e is LogEntry => e !== null);
	} catch {
		return [];
	}
}

function rotateOld() {
	if (!existsSync(LOG_FILE)) return;
	try {
		const cutoff = Date.now() - MAX_LOG_AGE_DAYS * 24 * 60 * 60 * 1000;
		const all = readAll();
		const fresh = all.filter((e) => e.epoch >= cutoff);
		if (fresh.length === all.length) return;
		writeFileSync(LOG_FILE, fresh.map((e) => JSON.stringify(e)).join("\n") + "\n");
	} catch {}
}

// ─── Skill path detection ──────────────────────────────────────────────────

function isSkillRead(path: string | undefined): { skill: string } | null {
	if (!path) return null;
	if (!path.endsWith("SKILL.md")) return null;
	// Extract skill name from .../skills/<skill-name>/SKILL.md
	const parts = path.split("/");
	const skillIdx = parts.findIndex((p) => p === "skills" || p === "02_SKILLS");
	if (skillIdx >= 0 && parts[skillIdx + 1]) return { skill: parts[skillIdx + 1] };
	// Fallback: parent dir name
	const parent = parts[parts.length - 2];
	if (parent && parent !== "skills") return { skill: parent };
	return null;
}

// ─── Format helpers ────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	const m = Math.floor(ms / 60_000);
	const s = Math.round((ms % 60_000) / 1000);
	return `${m}m ${s}s`;
}

function bar(value: number, max: number, width: number): string {
	if (max === 0) return " ".repeat(width);
	const filled = Math.round((value / max) * width);
	return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled));
}

// ─── Period filtering ──────────────────────────────────────────────────────

type Period = "day" | "week" | "month";
type Tab = "overview" | "agents" | "skills";

function periodCutoff(period: Period): number {
	const days = period === "day" ? 1 : period === "week" ? 7 : 30;
	return Date.now() - days * 24 * 60 * 60 * 1000;
}

function filterByPeriod(entries: LogEntry[], period: Period): LogEntry[] {
	const cutoff = periodCutoff(period);
	return entries.filter((e) => e.epoch >= cutoff);
}

// ─── Renderers ─────────────────────────────────────────────────────────────

function renderOverview(entries: LogEntry[], period: Period, theme: { fg: (c: ThemeColor, t: string) => string }): string[] {
	const filtered = filterByPeriod(entries, period);
	if (filtered.length === 0) return [`데이터 없음 (${period})`];

	const subagentEnds = filtered.filter((e): e is SubagentEndEntry => e.type === "subagent_end");
	const skillReads = filtered.filter((e): e is SkillReadEntry => e.type === "skill_read");

	const totalAgents = subagentEnds.length;
	const doneAgents = subagentEnds.filter((e) => e.status === "done").length;
	const errorAgents = subagentEnds.filter((e) => e.status === "error" || e.status === "aborted").length;
	const avgDuration = totalAgents > 0 ? subagentEnds.reduce((s, e) => s + e.durationMs, 0) / totalAgents : 0;

	const totalSkills = skillReads.length;

	const lines: string[] = [];
	lines.push(theme.fg("accent", "Subagent"));
	lines.push(`  총: ${theme.fg("accent", String(totalAgents))} · 성공: ${theme.fg("success", String(doneAgents))} · 실패: ${theme.fg("error", String(errorAgents))}`);
	lines.push(`  평균 시간: ${formatDuration(avgDuration)}`);
	lines.push("");
	lines.push(theme.fg("accent", "Skill"));
	lines.push(`  총 읽기: ${theme.fg("accent", String(totalSkills))}`);
	lines.push("");

	// Top agents by usage
	const agentCount = new Map<string, number>();
	for (const e of subagentEnds) agentCount.set(e.agentType, (agentCount.get(e.agentType) ?? 0) + 1);
	const topAgents = [...agentCount.entries()].sort((a, b) => b[1] - a[1]);

	if (topAgents.length > 0) {
		lines.push(theme.fg("accent", "자주 쓴 에이전트:"));
		const max = topAgents[0][1];
		for (const [name, n] of topAgents.slice(0, 8)) {
			lines.push(`  ${name.padEnd(22)} ${bar(n, max, 24)} ${n}`);
		}
		lines.push("");
	}

	// Top skills
	const skillCount = new Map<string, number>();
	for (const e of skillReads) skillCount.set(e.skill, (skillCount.get(e.skill) ?? 0) + 1);
	const topSkills = [...skillCount.entries()].sort((a, b) => b[1] - a[1]);

	if (topSkills.length > 0) {
		lines.push(theme.fg("accent", "자주 읽은 스킬:"));
		const max = topSkills[0][1];
		for (const [name, n] of topSkills.slice(0, 8)) {
			lines.push(`  ${name.padEnd(22)} ${bar(n, max, 24)} ${n}`);
		}
	}

	return lines;
}

function renderAgents(entries: LogEntry[], period: Period, theme: { fg: (c: ThemeColor, t: string) => string }): string[] {
	const filtered = filterByPeriod(entries, period).filter((e): e is SubagentEndEntry => e.type === "subagent_end");
	if (filtered.length === 0) return [`데이터 없음 (${period})`];

	const stats = new Map<string, { count: number; done: number; error: number; totalMs: number; minMs: number; maxMs: number; retries: number }>();
	for (const e of filtered) {
		const cur = stats.get(e.agentType) ?? { count: 0, done: 0, error: 0, totalMs: 0, minMs: Number.POSITIVE_INFINITY, maxMs: 0, retries: 0 };
		cur.count++;
		if (e.status === "done") cur.done++;
		else cur.error++;
		cur.totalMs += e.durationMs;
		cur.minMs = Math.min(cur.minMs, e.durationMs);
		cur.maxMs = Math.max(cur.maxMs, e.durationMs);
		cur.retries += e.retries ?? 0;
		stats.set(e.agentType, cur);
	}

	const lines: string[] = [];
	lines.push("에이전트".padEnd(22) + "실행".padStart(6) + "성공".padStart(6) + "실패".padStart(6) + "재시도".padStart(7) + "평균".padStart(10) + "최소".padStart(10) + "최대".padStart(10));
	for (const [name, s] of [...stats.entries()].sort((a, b) => b[1].count - a[1].count)) {
		const avg = s.totalMs / s.count;
		lines.push(
			name.padEnd(22) +
			String(s.count).padStart(6) +
			theme.fg("success", String(s.done).padStart(6)) +
			theme.fg(s.error > 0 ? "error" : "muted", String(s.error).padStart(6)) +
			theme.fg(s.retries > 0 ? "warning" : "muted", String(s.retries).padStart(7)) +
			formatDuration(avg).padStart(10) +
			formatDuration(s.minMs).padStart(10) +
			formatDuration(s.maxMs).padStart(10),
		);
	}
	return lines;
}

function renderSkills(entries: LogEntry[], period: Period, theme: { fg: (c: ThemeColor, t: string) => string }): string[] {
	const filtered = filterByPeriod(entries, period).filter((e): e is SkillReadEntry => e.type === "skill_read");
	if (filtered.length === 0) return [`데이터 없음 (${period})`];

	const counts = new Map<string, { count: number; lastRead: number }>();
	for (const e of filtered) {
		const cur = counts.get(e.skill) ?? { count: 0, lastRead: 0 };
		cur.count++;
		cur.lastRead = Math.max(cur.lastRead, e.epoch);
		counts.set(e.skill, cur);
	}

	const lines: string[] = [];
	lines.push("스킬".padEnd(32) + "읽기".padStart(6) + "마지막".padStart(20));
	for (const [name, s] of [...counts.entries()].sort((a, b) => b[1].count - a[1].count)) {
		const ago = Date.now() - s.lastRead;
		const agoStr = ago < 60_000 ? "방금 전"
			: ago < 3_600_000 ? `${Math.floor(ago / 60_000)}분 전`
			: ago < 86_400_000 ? `${Math.floor(ago / 3_600_000)}시간 전`
			: `${Math.floor(ago / 86_400_000)}일 전`;
		lines.push(
			name.padEnd(32) +
			String(s.count).padStart(6) +
			agoStr.padStart(20),
		);
	}
	return lines;
}

// ─── Overlay ───────────────────────────────────────────────────────────────

async function showOverlay(ctx: ExtensionCommandContext) {
	const entries = readAll();
	if (!ctx.hasUI) {
		ctx.ui.notify(`Analytics overlay requires UI. Logs: ${entries.length} entries`, "warning");
		return;
	}

	let tab: Tab = "overview";
	let period: Period = "week";
	let scrollOffset = 0;

	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => {
			const renderTabs = () => {
				const t = (label: string, t2: Tab, key: string) =>
					tab === t2 ? theme.fg("accent", theme.bold(`[${key}] ${label}`)) : `[${key}] ${label}`;
				return `${t("Overview", "overview", "1")}  ${t("Agents", "agents", "2")}  ${t("Skills", "skills", "3")}`;
			};
			const renderPeriod = () => {
				const p = (label: string, p2: Period, key: string) =>
					period === p2 ? theme.fg("accent", theme.bold(`[${key}] ${label}`)) : `[${key}] ${label}`;
				return `Period: ${p("Day", "day", "d")} ${p("Week", "week", "w")} ${p("Month", "month", "m")}`;
			};

			return {
				render: (w: number) => {
					const lines: string[] = [];
					lines.push(theme.fg("accent", "─".repeat(w)));
					lines.push(`  ${theme.bold("Usage Analytics")}  ${renderTabs()}                ${renderPeriod()}`);
					lines.push(theme.fg("accent", "─".repeat(w)));

					const body =
						tab === "overview" ? renderOverview(entries, period, theme) :
						tab === "agents" ? renderAgents(entries, period, theme) :
						renderSkills(entries, period, theme);

					const visibleHeight = Math.max(5, ((tui as any).terminal?.rows ?? 30) - 6);
					const maxOffset = Math.max(0, body.length - visibleHeight);
					if (scrollOffset > maxOffset) scrollOffset = maxOffset;

					for (let i = scrollOffset; i < Math.min(body.length, scrollOffset + visibleHeight); i++) {
						lines.push(truncateToWidth(body[i], w, ""));
					}

					lines.push(theme.fg("accent", "─".repeat(w)));
					lines.push("  ↑↓/jk 스크롤  ·  1/2/3 탭  ·  d/w/m 기간  ·  q/Esc 닫기");
					return lines;
				},
				handleInput: (data: string) => {
					if (data === "q" || matchesKey(data, Key.escape)) { done(undefined); return; }
					if (data === "1") { tab = "overview"; scrollOffset = 0; }
					else if (data === "2") { tab = "agents"; scrollOffset = 0; }
					else if (data === "3") { tab = "skills"; scrollOffset = 0; }
					else if (data === "d") period = "day";
					else if (data === "w") period = "week";
					else if (data === "m") period = "month";
					else if (matchesKey(data, Key.up) || data === "k") scrollOffset = Math.max(0, scrollOffset - 1);
					else if (matchesKey(data, Key.down) || data === "j") scrollOffset++;
					else if (matchesKey(data, Key.pageUp)) scrollOffset = Math.max(0, scrollOffset - 10);
					else if (matchesKey(data, Key.pageDown)) scrollOffset += 10;
					(tui as any).requestRender?.();
				},
				invalidate: () => {},
			};
		},
		{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } },
	);
}

// ─── Extension entry ───────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	// Track agent starts/ends + skill reads via tool events
	const startTimes = new Map<string, { agentType: string; description?: string; startedAt: number; toolUses: number; retries: number }>();

	pi.on("session_start", async () => {
		rotateOld();
	});

	pi.on("tool_call", async (event: any) => {
		// Agent tool start tracking
		if (event.toolName === "Agent" && event.input) {
			// We don't know the agent_id yet (it's in the result), so track by tool_call_id
			startTimes.set(event.toolCallId, {
				agentType: event.input.subagent_type ?? "unknown",
				description: event.input.description,
				startedAt: Date.now(),
				toolUses: 0,
				retries: 0,
			});
		}
	});

	pi.on("tool_result", async (event: any) => {
		// Agent tool result — log start (and end if not background)
		if (event.toolName === "Agent") {
			const start = startTimes.get(event.toolCallId);
			if (!start) return;

			// Extract agent_id from details
			const agentId = event.details?.agent_id ?? event.toolCallId;
			const status: "done" | "error" | "aborted" =
				event.details?.status === "done" ? "done"
				: event.details?.status === "running" ? "done" // Background — log start only? Let's still log as start.
				: event.details?.status === "aborted" ? "aborted"
				: event.isError ? "error"
				: "done";

			appendEntry({
				ts: new Date().toISOString(),
				epoch: Date.now(),
				type: "subagent_start",
				agentType: start.agentType,
				agentId,
				description: start.description,
			});

			// If foreground (not running), also log end
			if (event.details?.status !== "running") {
				const durationMs = event.details?.duration_ms ?? (Date.now() - start.startedAt);
				appendEntry({
					ts: new Date().toISOString(),
					epoch: Date.now(),
					type: "subagent_end",
					agentType: start.agentType,
					agentId,
					status,
					durationMs,
					toolUses: 0, // not easily extractable from current event
				});
			}

			startTimes.delete(event.toolCallId);
		}

		// get_subagent_result — captures background agent completion
		if (event.toolName === "get_subagent_result" && !event.isError && event.details) {
			const agentId = event.input?.agent_id;
			const status = event.details?.status;
			if (agentId && status && status !== "running") {
				appendEntry({
					ts: new Date().toISOString(),
					epoch: Date.now(),
					type: "subagent_end",
					agentType: event.details?.type ?? "unknown",
					agentId,
					status: status === "done" ? "done" : status === "aborted" ? "aborted" : "error",
					durationMs: event.details?.duration_ms ?? 0,
					toolUses: event.details?.tool_uses ?? 0,
				});
			}
		}

		// Read tool — track skill reads
		if (event.toolName === "Read" || event.toolName === "read") {
			const path = event.input?.path;
			const skill = isSkillRead(path);
			if (skill) {
				appendEntry({
					ts: new Date().toISOString(),
					epoch: Date.now(),
					type: "skill_read",
					skill: skill.skill,
					path,
				});
			}
		}
	});

	pi.registerCommand("analytics", {
		description: "Show subagent & skill usage analytics overlay",
		handler: async (_args, ctx) => showOverlay(ctx),
	});
}
