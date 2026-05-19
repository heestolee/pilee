import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { resolveWorkUnit } from "../utils/work-context.ts";

type TaskKind = "slice" | "decision" | "verify" | "blocked" | "followup" | "general";
type TaskOwner = "agent" | "user" | "reviewer" | "subagent" | "external";
type TaskStatus = "pending" | "in_progress" | "completed" | "deleted" | "rejected" | "deprioritized" | "superseded";
type TaskDispositionType = "deleted" | "rejected" | "deprioritized" | "superseded" | "misread";
type TaskSource = "frame" | "user" | "agent" | "subagent" | "verify" | "review" | "manual";

interface TaskDisposition {
	type: TaskDispositionType;
	reason?: string;
	at: number;
	by?: TaskOwner | string;
}

interface Task {
	id: string;
	subject: string;
	description: string;
	activeForm?: string;
	status: TaskStatus;
	kind?: TaskKind;
	owner?: TaskOwner | string;
	area?: string;
	source?: TaskSource | string;
	disposition?: TaskDisposition;
	acceptance?: string[];
	refs?: Record<string, unknown>;
	evidence?: string[];
	blocks: string[];
	blockedBy: string[];
	metadata: Record<string, unknown>;
	createdAt: number;
	updatedAt: number;
}

interface TaskStore {
	nextId: number;
	tasks: Task[];
}

function legacyStorePath(ctx: ExtensionContext): string {
	const sessionId = ctx.sessionManager?.getSessionId?.() ?? "default";
	return join(ctx.cwd, ".pi", "tasks", `tasks-${sessionId}.json`);
}

function storePath(ctx: ExtensionContext): string {
	const unit = resolveWorkUnit(ctx.cwd, ctx.sessionManager?.getSessionFile?.());
	mkdirSync(dirname(unit.tasksPath), { recursive: true });
	return unit.tasksPath;
}

function load(ctx: ExtensionContext): TaskStore {
	const p = storePath(ctx);
	if (!existsSync(p)) {
		const legacy = legacyStorePath(ctx);
		if (existsSync(legacy)) {
			try { return JSON.parse(readFileSync(legacy, "utf8")); } catch {}
		}
		return { nextId: 1, tasks: [] };
	}
	try {
		return JSON.parse(readFileSync(p, "utf8"));
	} catch {
		return { nextId: 1, tasks: [] };
	}
}

function save(ctx: ExtensionContext, store: TaskStore) {
	writeFileSync(storePath(ctx), JSON.stringify(store, null, 2));
}

function find(store: TaskStore, id: string): Task | undefined {
	return store.tasks.find((t) => t.id === id);
}

function openBlockers(store: TaskStore, task: Task): string[] {
	return task.blockedBy.filter((id) => {
		const t = find(store, id);
		return t && !isTerminalTask(t);
	});
}

function taskKind(t: Task): TaskKind {
	const metaKind = typeof t.metadata?.kind === "string" ? t.metadata.kind : undefined;
	return (t.kind || metaKind || "general") as TaskKind;
}

const SOFT_DISPOSITION_STATUSES = new Set<TaskStatus>(["deleted", "rejected", "deprioritized", "superseded"]);
const AREA_ORDER = ["FE", "BE", "DB", "UI", "UX", "검증", "리뷰", "문서", "인프라", "판단", "Blocked", "기타"];
const TASK_SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;
const TASK_SPINNER_INTERVAL_MS = 120;

function isSoftDispositionStatus(status: TaskStatus): boolean {
	return SOFT_DISPOSITION_STATUSES.has(status);
}

function isTerminalTask(t: Task): boolean {
	return t.status === "completed" || isSoftDispositionStatus(t.status);
}

function taskPriority(t: Task): number {
	if (isSoftDispositionStatus(t.status)) return 10;
	if (t.status === "completed") return 9;
	if (t.owner === "user" || taskKind(t) === "decision") return 0;
	if (t.status === "in_progress") return 1;
	if (taskKind(t) === "blocked") return 2;
	if (taskKind(t) === "slice") return 3;
	if (taskKind(t) === "verify") return 4;
	return 5;
}

function sortTasks(tasks: Task[]): Task[] {
	return [...tasks].sort((a, b) => taskPriority(a) - taskPriority(b) || a.createdAt - b.createdAt);
}

function normalizeArea(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim().replace(/^-?\s*\(?\s*/, "").replace(/\s*\)?\s*$/, "");
	if (!trimmed) return undefined;
	const upper = trimmed.toUpperCase();
	if (["FE", "BE", "DB", "UI", "UX"].includes(upper)) return upper;
	return trimmed;
}

function taskArea(t: Task): string {
	const fromTask = normalizeArea(t.area);
	if (fromTask) return fromTask;
	const fromMetadata = normalizeArea(t.metadata?.area ?? t.metadata?.group ?? t.metadata?.scope);
	if (fromMetadata) return fromMetadata;
	const fromRefs = normalizeArea(t.refs?.area ?? t.refs?.group ?? t.refs?.scope);
	if (fromRefs) return fromRefs;
	const kind = taskKind(t);
	if (kind === "verify") return "검증";
	if (kind === "decision") return "판단";
	if (kind === "blocked") return "Blocked";
	return "기타";
}

function taskSource(t: Task): string | undefined {
	if (t.source) return t.source;
	const source = t.metadata?.source;
	return typeof source === "string" ? source : undefined;
}

function dispositionTypeForStatus(status: TaskStatus): TaskDispositionType | undefined {
	if (status === "deleted" || status === "rejected" || status === "deprioritized" || status === "superseded") return status;
	return undefined;
}

function dispositionLabel(type: TaskDispositionType): string {
	if (type === "deleted") return "삭제";
	if (type === "rejected") return "반려";
	if (type === "deprioritized") return "우선순위밀림";
	if (type === "superseded") return "대체";
	return "오독";
}

function taskDisposition(t: Task): TaskDisposition | undefined {
	if (t.disposition) return t.disposition;
	const type = dispositionTypeForStatus(t.status);
	return type ? { type, at: t.updatedAt } : undefined;
}

function formatDisposition(t: Task): string {
	const disposition = taskDisposition(t);
	if (!disposition) return "";
	const label = dispositionLabel(disposition.type);
	return disposition.reason ? ` (${label}: ${disposition.reason})` : ` (${label})`;
}

function formatTask(store: TaskStore, t: Task): string {
	const blockers = openBlockers(store, t);
	const blocked = blockers.length > 0 ? ` [blocked by: ${blockers.join(", ")}]` : "";
	const owner = t.owner ? ` (owner: ${t.owner})` : "";
	const kind = taskKind(t) !== "general" ? ` <${taskKind(t)}>` : "";
	const area = taskArea(t) !== "기타" ? ` (${taskArea(t)})` : "";
	const disposition = formatDisposition(t);
	return `#${t.id} [${t.status}]${kind}${area} ${t.subject}${owner}${blocked}${disposition}`;
}

const BACKLOG_FILE = join(homedir(), ".pi", "agent", "state", "backlog.json");

function loadBacklog(): { nextId: number; items: any[] } {
	if (!existsSync(BACKLOG_FILE)) return { nextId: 1, items: [] };
	try { return JSON.parse(readFileSync(BACKLOG_FILE, "utf8")); } catch { return { nextId: 1, items: [] }; }
}

function saveBacklog(store: { nextId: number; items: any[] }) {
	mkdirSync(dirname(BACKLOG_FILE), { recursive: true });
	writeFileSync(BACKLOG_FILE, JSON.stringify(store, null, 2));
}

function text(t: string, details: Record<string, unknown> = {}) {
	return { content: [{ type: "text" as const, text: t }], details };
}

function stringifyTaskCreateIntent(params: {
	subject: string;
	description: string;
	activeForm?: string;
	metadata?: Record<string, unknown>;
}): string {
	return [params.subject, params.description, params.activeForm, JSON.stringify(params.metadata ?? {})]
		.filter((part): part is string => typeof part === "string" && part.trim().length > 0)
		.join("\n")
		.toLowerCase();
}

function looksLikeExplicitBacklogCapture(params: {
	subject: string;
	description: string;
	activeForm?: string;
	kind?: TaskKind;
	metadata?: Record<string, unknown>;
}): boolean {
	if (params.kind) return false;
	const textValue = stringifyTaskCreateIntent(params);
	return /(?:백로그|backlog)\s*(?:에|로|으로|에다)?\s*(?:넣|남기|기록|추가|저장|보관|올리|담아)|(?:넣|남기|기록|추가|저장|보관|올리|담아).{0,20}(?:백로그|backlog)|\/backlog\b/u.test(textValue);
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "TaskCreate",
		label: "Create Task",
		description: "Create a work-unit task for current active work only. Use area/group (FE, BE, DB, UI, UX, 검증, 리뷰 등) so the task overlay shows the implementation map. Do not use when the user explicitly says backlog/백로그; use BacklogCreate or /backlog instead. Deferred/later wording without explicit backlog is a judgment cue, not a tool-level block.",
		promptSnippet: "Create a work-unit task with area/source metadata for the passive work-map overlay.",
		promptGuidelines: [
			"Use TaskCreate when the active work has multiple implementation, review, or verification steps; assign area/source so the tasks overlay reflects the user's work map.",
			"Use TaskUpdate with deleted/rejected/deprioritized/superseded plus dispositionReason instead of removing tasks when scope changes.",
		],
		parameters: Type.Object({
			subject: Type.String({ description: "Brief task title" }),
			description: Type.String({ description: "Detailed description" }),
			activeForm: Type.Optional(Type.String({ description: "Present continuous form for spinner" })),
			kind: Type.Optional(Type.Union([Type.Literal("slice"), Type.Literal("decision"), Type.Literal("verify"), Type.Literal("blocked"), Type.Literal("followup"), Type.Literal("general")])),
			owner: Type.Optional(Type.Union([Type.Literal("agent"), Type.Literal("user"), Type.Literal("reviewer"), Type.Literal("subagent"), Type.Literal("external")])),
			area: Type.Optional(Type.String({ description: "Visible work area/group header, e.g. FE, BE, DB, UI, UX, 검증, 리뷰, 문서, 인프라" })),
			source: Type.Optional(Type.Union([Type.Literal("frame"), Type.Literal("user"), Type.Literal("agent"), Type.Literal("subagent"), Type.Literal("verify"), Type.Literal("review"), Type.Literal("manual")])),
			acceptance: Type.Optional(Type.Array(Type.String(), { description: "Done-when checks for this task" })),
			refs: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Frame/success criteria/slice/file references" })),
			evidence: Type.Optional(Type.Array(Type.String(), { description: "Evidence refs collected for this task" })),
			agentType: Type.Optional(Type.String({ description: "Agent type for subagent execution" })),
			metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Arbitrary metadata" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			if (looksLikeExplicitBacklogCapture(params)) {
				return text(
					"TaskCreate blocked: the request explicitly mentions backlog/백로그. Use BacklogCreate or /backlog instead.",
					{ blocked: true, suggestedTool: "BacklogCreate", tasksPath: storePath(ctx), backlogPath: BACKLOG_FILE },
				);
			}

			const store = load(ctx);
			const metadata = params.metadata ?? {};
			const task: Task = {
				id: String(store.nextId++),
				subject: params.subject,
				description: params.description,
				activeForm: params.activeForm,
				status: "pending",
				kind: params.kind ?? (typeof metadata.kind === "string" ? metadata.kind as TaskKind : undefined),
				owner: params.owner,
				area: normalizeArea(params.area ?? metadata.area ?? metadata.group),
				source: params.source ?? (typeof metadata.source === "string" ? metadata.source : undefined),
				acceptance: params.acceptance,
				refs: params.refs,
				evidence: params.evidence,
				blocks: [],
				blockedBy: [],
				metadata,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			};
			if (params.agentType) task.metadata.agentType = params.agentType;
			store.tasks.push(task);
			save(ctx, store);
			const unit = resolveWorkUnit(ctx.cwd, ctx.sessionManager?.getSessionFile?.());
			return text(`Task #${task.id} created successfully: ${task.subject}`, { task, tasksPath: unit.tasksPath });
		},
	});

	pi.registerTool({
		name: "TaskList",
		label: "List Tasks",
		description: "List all tasks with status summary.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _onUpdate, ctx) {
			const store = load(ctx);
			const active = store.tasks.filter((t) => !isTerminalTask(t));
			const completed = store.tasks.filter((t) => t.status === "completed");
			const held = store.tasks.filter((t) => isSoftDispositionStatus(t.status));
			if (store.tasks.length === 0) return text("No tasks.");
			const lines = sortTasks(active).map((t) => formatTask(store, t));
			if (completed.length > 0) lines.push(`\n${completed.length} completed task(s)`);
			if (held.length > 0) lines.push(`${held.length} held/removed task(s):`, ...sortTasks(held).map((t) => formatTask(store, t)));
			const unit = resolveWorkUnit(ctx.cwd, ctx.sessionManager?.getSessionFile?.());
			return text(lines.join("\n"), { tasksPath: unit.tasksPath, active: active.length, completed: completed.length, held: held.length });
		},
	});

	pi.registerTool({
		name: "TaskGet",
		label: "Get Task",
		description: "Get full details of a task by ID.",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task ID" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const store = load(ctx);
			const task = find(store, params.taskId);
			if (!task) return text(`Task #${params.taskId} not found.`);
			const blockers = openBlockers(store, task);
			const lines = [
				`#${task.id} — ${task.subject}`,
				`Status: ${task.status}`,
				`Kind: ${taskKind(task)}`,
				`Area: ${taskArea(task)}`,
				task.owner ? `Owner: ${task.owner}` : null,
				taskSource(task) ? `Source: ${taskSource(task)}` : null,
				taskDisposition(task) ? `Disposition: ${formatDisposition(task).trim()}` : null,
				`Description: ${task.description}`,
				task.acceptance?.length ? `Acceptance:\n${task.acceptance.map((item) => `- ${item}`).join("\n")}` : null,
				task.refs ? `Refs: ${JSON.stringify(task.refs)}` : null,
				task.evidence?.length ? `Evidence:\n${task.evidence.map((item) => `- ${item}`).join("\n")}` : null,
				task.blocks.length > 0 ? `Blocks: ${task.blocks.join(", ")}` : null,
				blockers.length > 0 ? `Blocked by (open): ${blockers.join(", ")}` : null,
			].filter(Boolean);
			return text(lines.join("\n"), { task });
		},
	});

	pi.registerTool({
		name: "TaskUpdate",
		label: "Update Task",
		description: "Update task status, subject, description, area/group, owner, or dependencies. Do not physically delete normal tasks: use status deleted/rejected/deprioritized/superseded with a dispositionReason so context is preserved with strikethrough in the overlay.",
		promptSnippet: "Update work-unit task state, area/source metadata, and soft disposition for preserved context.",
		promptGuidelines: [
			"Use TaskUpdate to keep task state current while working; do not leave the overlay stale after finishing or reprioritizing a step.",
			"Use TaskUpdate status=deleted/rejected/deprioritized/superseded with dispositionReason when a mapped task is removed from scope so the context is not lost.",
		],
		parameters: Type.Object({
			taskId: Type.String({ description: "Task ID" }),
			status: Type.Optional(Type.Union([
				Type.Literal("pending"),
				Type.Literal("in_progress"),
				Type.Literal("completed"),
				Type.Literal("deleted"),
				Type.Literal("rejected"),
				Type.Literal("deprioritized"),
				Type.Literal("superseded"),
			])),
			subject: Type.Optional(Type.String()),
			description: Type.Optional(Type.String()),
			activeForm: Type.Optional(Type.String()),
			kind: Type.Optional(Type.Union([Type.Literal("slice"), Type.Literal("decision"), Type.Literal("verify"), Type.Literal("blocked"), Type.Literal("followup"), Type.Literal("general")])),
			owner: Type.Optional(Type.String()),
			area: Type.Optional(Type.String({ description: "Visible work area/group header, e.g. FE, BE, DB, UI, UX, 검증, 리뷰" })),
			source: Type.Optional(Type.String({ description: "Where this task/change came from: frame, user, agent, subagent, verify, review, manual" })),
			disposition: Type.Optional(Type.Union([Type.Literal("deleted"), Type.Literal("rejected"), Type.Literal("deprioritized"), Type.Literal("superseded"), Type.Literal("misread")])),
			dispositionReason: Type.Optional(Type.String({ description: "Short reason shown next to strikethrough items" })),
			acceptance: Type.Optional(Type.Array(Type.String())),
			refs: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			evidence: Type.Optional(Type.Array(Type.String())),
			metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
			addBlocks: Type.Optional(Type.Array(Type.String())),
			addBlockedBy: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const store = load(ctx);
			const task = find(store, params.taskId);
			if (!task) return text(`Task #${params.taskId} not found.`);

			if (params.status) {
				task.status = params.status;
				const dispositionType = params.disposition ?? dispositionTypeForStatus(params.status);
				if (dispositionType) {
					task.disposition = {
						type: dispositionType,
						reason: params.dispositionReason,
						at: Date.now(),
						by: params.owner ?? task.owner ?? "agent",
					};
				} else if (params.status === "pending" || params.status === "in_progress" || params.status === "completed") {
					delete task.disposition;
				}
			} else if (params.disposition) {
				task.status = params.disposition === "misread" ? "rejected" : params.disposition;
				task.disposition = {
					type: params.disposition,
					reason: params.dispositionReason,
					at: Date.now(),
					by: params.owner ?? task.owner ?? "agent",
				};
			}
			if (params.subject) task.subject = params.subject;
			if (params.description) task.description = params.description;
			if (params.activeForm) task.activeForm = params.activeForm;
			if (params.kind) task.kind = params.kind;
			if (params.owner) task.owner = params.owner;
			if (params.area) task.area = normalizeArea(params.area);
			if (params.source) task.source = params.source;
			if (params.acceptance) task.acceptance = params.acceptance;
			if (params.refs) task.refs = params.refs;
			if (params.evidence) task.evidence = params.evidence;
			if (params.metadata) {
				for (const [k, v] of Object.entries(params.metadata)) {
					if (v === null) delete task.metadata[k];
					else task.metadata[k] = v;
				}
			}
			if (params.addBlocks) {
				for (const id of params.addBlocks) {
					if (!task.blocks.includes(id)) task.blocks.push(id);
					const target = find(store, id);
					if (target && !target.blockedBy.includes(task.id)) target.blockedBy.push(task.id);
				}
			}
			if (params.addBlockedBy) {
				for (const id of params.addBlockedBy) {
					if (!task.blockedBy.includes(id)) task.blockedBy.push(id);
					const source = find(store, id);
					if (source && !source.blocks.includes(task.id)) source.blocks.push(task.id);
				}
			}
			task.updatedAt = Date.now();
			save(ctx, store);
			const unit = resolveWorkUnit(ctx.cwd, ctx.sessionManager?.getSessionFile?.());
			return text(`Updated task #${params.taskId} status`, { task, tasksPath: unit.tasksPath });
		},
	});

	// ─── Passive work map overlay ──────────────────────────────────────────

	let latestCtx: ExtensionContext | undefined;
	const WIDGET_KEY = "tasks";
	type TaskOverlayRecord = {
		opening: boolean;
		component?: WorkTaskOverlayComponent;
		handle?: { hide?: () => void };
		close?: () => void;
	};
	const taskOverlayStore = new Map<string, TaskOverlayRecord>();
	const taskOverlayHiddenStore = new Map<string, boolean>();
	const taskOverlayAgentRunningStore = new Map<string, boolean>();

	function taskOverlayKey(ctx: Pick<ExtensionContext, "cwd" | "sessionManager">): string {
		return storePath(ctx as ExtensionContext);
	}

	function groupedTasks(store: TaskStore, includeTerminal = true): Array<{ area: string; tasks: Task[] }> {
		const groups = new Map<string, Task[]>();
		for (const task of sortTasks(includeTerminal ? store.tasks : store.tasks.filter((t) => !isTerminalTask(t)))) {
			const area = taskArea(task);
			groups.set(area, [...(groups.get(area) ?? []), task]);
		}
		return [...groups.entries()]
			.map(([area, tasks]) => ({ area, tasks }))
			.sort((a, b) => {
				const ai = AREA_ORDER.indexOf(a.area);
				const bi = AREA_ORDER.indexOf(b.area);
				const ap = ai === -1 ? AREA_ORDER.length : ai;
				const bp = bi === -1 ? AREA_ORDER.length : bi;
				return ap - bp || a.area.localeCompare(b.area, "ko");
			});
	}

	function padAnsi(textValue: string, width: number): string {
		const clipped = truncateToWidth(textValue, width, "…", true);
		return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
	}

	function renderTaskSubject(task: Task): string {
		return task.status === "in_progress" && task.activeForm ? task.activeForm : task.subject;
	}

	class WorkTaskOverlayComponent {
		private tui: { requestRender?: () => void };
		private theme: Theme;
		private store: TaskStore;
		private agentRunning: boolean;
		private timer: ReturnType<typeof setInterval> | undefined;
		private disposed = false;

		constructor(tui: { requestRender?: () => void }, theme: Theme, store: TaskStore, agentRunning: boolean) {
			this.tui = tui;
			this.theme = theme;
			this.store = { nextId: store.nextId, tasks: store.tasks.map((task) => ({ ...task, metadata: { ...task.metadata } })) };
			this.agentRunning = agentRunning;
			this.syncTimer();
		}

		setStore(store: TaskStore): void {
			this.store = { nextId: store.nextId, tasks: store.tasks.map((task) => ({ ...task, metadata: { ...task.metadata } })) };
			this.syncTimer();
			this.tui.requestRender?.();
		}

		setAgentRunning(running: boolean): void {
			this.agentRunning = running;
			this.syncTimer();
			this.tui.requestRender?.();
		}

		invalidate(): void {
			this.tui.requestRender?.();
		}

		dispose(): void {
			if (this.disposed) return;
			this.disposed = true;
			if (this.timer) clearInterval(this.timer);
			this.timer = undefined;
		}

		render(width: number): string[] {
			const innerWidth = Math.max(1, width - 2);
			const active = this.store.tasks.filter((task) => !isTerminalTask(task)).length;
			const completed = this.store.tasks.filter((task) => task.status === "completed").length;
			const held = this.store.tasks.filter((task) => isSoftDispositionStatus(task.status)).length;
			const hasRunning = this.agentRunning && this.store.tasks.some((task) => task.status === "in_progress");
			const borderColor: ThemeColor = hasRunning ? "accent" : active > 0 ? "borderAccent" : "borderMuted";
			const border = (textValue: string) => this.theme.fg(borderColor, hasRunning ? this.theme.bold(textValue) : textValue);
			const row = (textValue: string) => `${border("│")}${padAnsi(textValue, innerWidth)}${border("│")}`;
			const title = this.theme.fg("accent", this.theme.bold(" Work Tasks "));
			const summaryParts = [`${active} active`];
			if (completed > 0) summaryParts.push(`${completed} done`);
			if (held > 0) summaryParts.push(`${held} held`);
			const summary = this.theme.fg("dim", ` ${summaryParts.join(" · ")} `);
			const titlePad = Math.max(0, innerWidth - visibleWidth(title) - visibleWidth(summary));
			const lines = [`${border("╭")}${title}${border("─".repeat(titlePad))}${summary}${border("╮")}`];

			if (this.store.tasks.length === 0) {
				lines.push(row(` ${this.theme.fg("dim", "작업 없음")}`));
			} else {
				for (const group of groupedTasks(this.store)) {
					lines.push(row(` ${this.theme.fg("muted", `-(${group.area})`)}`));
					for (const task of group.tasks) lines.push(row(this.renderTaskLine(task)));
				}
			}

			lines.push(`${border("╰")}${border("─".repeat(innerWidth))}${border("╯")}`);
			return lines;
		}

		private renderTaskLine(task: Task): string {
			const subject = renderTaskSubject(task);
			const source = taskSource(task);
			const sourceSuffix = source && source !== "agent" ? this.theme.fg("dim", ` · ${source}`) : "";
			if (task.status === "completed") {
				return `  ${this.theme.fg("success", "✓")} ${this.theme.fg("dim", subject)}${sourceSuffix}`;
			}
			if (isSoftDispositionStatus(task.status)) {
				const disposition = this.theme.fg("warning", formatDisposition(task));
				return `  ${this.theme.fg("warning", "⊘")} ${this.theme.fg("dim", this.theme.strikethrough(subject))}${disposition}${sourceSuffix}`;
			}
			if (task.status === "in_progress") {
				const marker = this.agentRunning ? this.currentSpinner() : "→";
				return `  ${this.theme.fg("accent", marker)} ${this.theme.fg("accent", this.theme.bold(subject))}${sourceSuffix}`;
			}
			return `  ${this.theme.fg("muted", "○")} ${this.theme.fg("toolOutput", subject)}${sourceSuffix}`;
		}

		private currentSpinner(): string {
			return TASK_SPINNER_FRAMES[Math.floor(Date.now() / TASK_SPINNER_INTERVAL_MS) % TASK_SPINNER_FRAMES.length] ?? "•";
		}

		private syncTimer(): void {
			const shouldRun = !this.disposed && this.agentRunning && this.store.tasks.some((task) => task.status === "in_progress");
			if (shouldRun && !this.timer) {
				this.timer = setInterval(() => this.tui.requestRender?.(), TASK_SPINNER_INTERVAL_MS);
				return;
			}
			if (!shouldRun && this.timer) {
				clearInterval(this.timer);
				this.timer = undefined;
			}
		}
	}

	function hideTaskOverlay(key: string): void {
		const record = taskOverlayStore.get(key);
		if (!record) return;
		record.close?.();
		record.handle?.hide?.();
		record.component?.dispose();
		taskOverlayStore.delete(key);
	}

	function showOrUpdateTaskOverlay(ctx: ExtensionContext, key: string, store: TaskStore): void {
		const agentRunning = taskOverlayAgentRunningStore.get(key) ?? false;
		const record = taskOverlayStore.get(key);
		if (record?.component) {
			record.component.setStore(store);
			record.component.setAgentRunning(agentRunning);
			return;
		}
		if (record?.opening) return;
		taskOverlayStore.set(key, { opening: true });
		const initialStore = { nextId: store.nextId, tasks: store.tasks.map((task) => ({ ...task, metadata: { ...task.metadata } })) };
		void ctx.ui.custom(
			(tui, theme, _keybindings, done) => {
				const component = new WorkTaskOverlayComponent(tui, theme, initialStore, agentRunning);
				const current = taskOverlayStore.get(key) ?? { opening: false };
				taskOverlayStore.set(key, { ...current, opening: false, component, close: done });
				return component;
			},
			{
				overlay: true,
				overlayOptions: {
					anchor: "top-right",
					width: 52,
					maxHeight: "70%",
					margin: { top: 1, right: 2 },
					nonCapturing: true,
					visible: (termWidth: number) => termWidth >= 80,
				},
				onHandle: (handle) => {
					const current = taskOverlayStore.get(key) ?? { opening: false };
					taskOverlayStore.set(key, { ...current, handle });
				},
			},
		).finally(() => {
			const current = taskOverlayStore.get(key);
			current?.component?.dispose();
			taskOverlayStore.delete(key);
		}).catch(() => {});
	}

	function updateWidget(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		const key = taskOverlayKey(ctx);
		const store = load(ctx);
		if (store.tasks.length === 0 || taskOverlayHiddenStore.get(key)) {
			hideTaskOverlay(key);
			return;
		}
		showOrUpdateTaskOverlay(ctx, key, store);
	}

	function setPassiveTaskOverlayVisible(ctx: ExtensionContext, visible: boolean): void {
		const key = taskOverlayKey(ctx);
		taskOverlayHiddenStore.set(key, !visible);
		if (visible) updateWidget(ctx);
		else hideTaskOverlay(key);
	}

	function togglePassiveTaskOverlay(ctx: ExtensionContext): boolean {
		const key = taskOverlayKey(ctx);
		const nextVisible = taskOverlayHiddenStore.get(key) === true;
		setPassiveTaskOverlayVisible(ctx, nextVisible);
		return nextVisible;
	}

	function isPassiveTaskOverlayHidden(ctx: ExtensionContext): boolean {
		return taskOverlayHiddenStore.get(taskOverlayKey(ctx)) === true;
	}

	function setTaskOverlayAgentRunning(ctx: ExtensionContext, running: boolean): void {
		const key = taskOverlayKey(ctx);
		taskOverlayAgentRunningStore.set(key, running);
	}

	pi.on("session_start", async (_e, ctx) => {
		latestCtx = ctx;
		if (!ctx.hasUI) return;
		updateWidget(ctx);
		const store = load(ctx);
		const inProgress = store.tasks.filter((t) => t.status === "in_progress");
		if (inProgress.length > 0) {
			ctx.ui.notify(`${inProgress.length} task(s) in progress from previous session`, "info");
		}
	});

	pi.on("agent_start", async (_event, ctx) => {
		latestCtx = ctx;
		setTaskOverlayAgentRunning(ctx, true);
		updateWidget(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		latestCtx = ctx;
		setTaskOverlayAgentRunning(ctx, false);
		updateWidget(ctx);
	});

	pi.on("tool_result", async (event, ctx) => {
		latestCtx = ctx;
		if (["TaskCreate", "TaskUpdate"].includes(event.toolName)) {
			updateWidget(ctx);
		}
	});

	pi.on("session_tree", async (_event, ctx) => {
		latestCtx = ctx;
		setTaskOverlayAgentRunning(ctx, false);
		updateWidget(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		const key = taskOverlayKey(ctx);
		hideTaskOverlay(key);
		taskOverlayHiddenStore.delete(key);
		taskOverlayAgentRunningStore.delete(key);
	});

	// ─── Overlay (/tasks command) ──────────────────────────────────────────

	async function showTasksOverlay(ctx: ExtensionCommandContext) {
		const store = load(ctx);
		if (store.tasks.length === 0) {
			ctx.ui.notify("No tasks. LLM will create tasks with TaskCreate tool.", "info");
			return;
		}

		let selectedIdx = 0;
		let showHelp = false;
		let showCompleted = false;
		let inputMode: null | "new" | "edit" = null;
		let inputBuffer = "";

		const getVisible = () => sortTasks(showCompleted ? store.tasks : store.tasks.filter((t) => !isTerminalTask(t)));

		await ctx.ui.custom<void>(
			(tui, theme, _kb, done) => {
				const renderHelp = (w: number): string[] => {
					const lines: string[] = [];
					lines.push(...new DynamicBorder((s: string) => theme.fg("accent", s)).render(w));
					lines.push(`  ${theme.bold("KEYBINDINGS")}`);
					lines.push("");
					lines.push(`  ${theme.fg("warning", "↑/↓, k/j")}     ${theme.fg("border", "항목 이동")}`);
					lines.push(`  ${theme.fg("warning", "Space/Enter")}  ${theme.fg("border", "상태 토글 (pending→in_progress→completed)")}`);
					lines.push(`  ${theme.fg("warning", "n")}            ${theme.fg("border", "새 태스크 추가")}`);
					lines.push(`  ${theme.fg("warning", "d")}            ${theme.fg("border", "삭제 표시(soft delete)")}`);
					lines.push(`  ${theme.fg("warning", ",")}            ${theme.fg("border", "이 도움말")}`);
					lines.push(`  ${theme.fg("warning", "q")}            ${theme.fg("border", "닫기")}`);
					lines.push("");
					lines.push(`  ${theme.fg("border", "아무 키나 누르면 닫힘")}`);
					lines.push(...new DynamicBorder((s: string) => theme.fg("accent", s)).render(w));
					return lines;
				};

				return {
					render: (w: number) => {
						if (showHelp) return renderHelp(w);
						const visible = getVisible();
						const completed = store.tasks.filter((t) => t.status === "completed").length;
						const held = store.tasks.filter((t) => isSoftDispositionStatus(t.status)).length;
						const active = store.tasks.filter((t) => !isTerminalTask(t)).length;
						const total = store.tasks.length;

						const lines: string[] = [];
						lines.push(theme.fg("accent", "─".repeat(w)));
						const needsUser = store.tasks.filter((t) => !isTerminalTask(t) && (t.owner === "user" || taskKind(t) === "decision")).length;
						lines.push(`  ${theme.bold("Work Tasks")} (${active}/${total} active · ${completed} done · ${held} held · ${needsUser} needs user)        ${inputMode ? theme.fg("warning", `[${inputMode === "new" ? "새 태스크" : "수정"}]`) : ""}`);
						lines.push(theme.fg("accent", "─".repeat(w)));

						if (inputMode) {
							lines.push(`  > ${inputBuffer}${theme.fg("accent", "│")}`);
							lines.push(`  ${theme.fg("border", "Enter: 확인 · Esc: 취소")}`);
							lines.push(theme.fg("accent", "─".repeat(w)));
							return lines;
						}

						if (visible.length === 0) {
							lines.push(`  ${theme.fg("border", "모든 태스크 완료! 🎉")}`);
						} else {
							for (let i = 0; i < visible.length; i++) {
								const t = visible[i];
								const sel = i === selectedIdx;
								const cursor = sel ? theme.fg("accent", "▶") : " ";
								const icon = t.status === "completed" ? theme.fg("success", "✓") : isSoftDispositionStatus(t.status) ? theme.fg("warning", "⊘") : t.status === "in_progress" ? theme.fg("warning", "●") : "○";
								const rawSubject = renderTaskSubject(t);
								const subject = isSoftDispositionStatus(t.status)
									? theme.fg("border", theme.strikethrough(rawSubject))
									: t.status === "completed"
										? theme.fg("border", rawSubject)
										: sel ? theme.fg("accent", rawSubject) : rawSubject;
								const kind = taskKind(t);
								const metaParts = [taskArea(t), kind !== "general" ? kind : undefined, t.owner ? `@${t.owner}` : undefined, t.metadata?.ticket ? String(t.metadata.ticket) : undefined].filter(Boolean);
								if (isSoftDispositionStatus(t.status)) metaParts.push(formatDisposition(t).trim());
								const meta = metaParts.length ? ` [${metaParts.join(" · ")}]` : "";
								const lineColor: ThemeColor = t.owner === "user" || kind === "decision" ? "warning" : t.status === "in_progress" ? "accent" : "text";
								lines.push(truncateToWidth(`${cursor} ${icon} #${t.id} ${theme.fg(lineColor, subject)}${meta}`, w, ""));
							}
						}

						if ((completed > 0 || held > 0) && !showCompleted) {
							lines.push(`  + ${completed} completed · ${held} held (v로 표시)`);
						}

						lines.push(theme.fg("accent", "─".repeat(w)));
						lines.push(`  ${theme.fg("border", "↑↓ 이동 · Space 상태 · n 새로 · d 삭제표시 · b backlog · v 완료/보류 표시 · q 닫기")}`);

						return lines;
					},
					handleInput: (data: string) => {
						if (showHelp) {
							showHelp = false;
							(tui as any).requestRender?.();
							return;
						}

						if (matchesKey(data, ",")) {
							showHelp = true;
							(tui as any).requestRender?.();
							return;
						}

						const visible = getVisible();

						// Input mode
						if (inputMode) {
							if (matchesKey(data, Key.escape)) {
								inputMode = null;
								inputBuffer = "";
							} else if (matchesKey(data, Key.enter)) {
								if (inputBuffer.trim()) {
									if (inputMode === "new") {
										const task: Task = {
											id: String(store.nextId++),
											subject: inputBuffer.trim(),
											description: "",
											status: "pending",
											kind: "general",
											blocks: [],
											blockedBy: [],
											metadata: {},
											createdAt: Date.now(),
											updatedAt: Date.now(),
										};
										store.tasks.push(task);
										save(ctx, store);
									}
								}
								inputMode = null;
								inputBuffer = "";
								updateWidget(ctx);
							} else if (matchesKey(data, Key.backspace)) {
								inputBuffer = inputBuffer.slice(0, -1);
							} else if (data.length === 1 && data >= " ") {
								inputBuffer += data;
							}
							(tui as any).requestRender?.();
							return;
						}

						// Navigation
						if (matchesKey(data, Key.escape) || data === "q") {
							done(undefined);
							return;
						}
						if (matchesKey(data, Key.up) || data === "k") {
							selectedIdx = Math.max(0, selectedIdx - 1);
						} else if (matchesKey(data, Key.down) || data === "j") {
							selectedIdx = Math.min(visible.length - 1, selectedIdx + 1);
						} else if (data === " " || matchesKey(data, Key.enter)) {
							// Toggle status
							const t = visible[selectedIdx];
							if (t) {
								if (t.status === "pending") t.status = "in_progress";
								else if (t.status === "in_progress") t.status = "completed";
								t.updatedAt = Date.now();
								save(ctx, store);
								updateWidget(ctx);
								// Adjust selection if task moved out
								const newVisible = getVisible();
								if (selectedIdx >= newVisible.length) selectedIdx = Math.max(0, newVisible.length - 1);
							}
						} else if (data === "n") {
							inputMode = "new";
							inputBuffer = "";
						} else if (data === "d") {
							const t = visible[selectedIdx];
							if (t) {
								t.status = "deleted";
								t.disposition = { type: "deleted", reason: "수동 삭제 표시", at: Date.now(), by: "user" };
								t.updatedAt = Date.now();
								save(ctx, store);
								updateWidget(ctx);
								if (selectedIdx >= getVisible().length) selectedIdx = Math.max(0, getVisible().length - 1);
							}
						} else if (data === "v") {
							showCompleted = !showCompleted;
							selectedIdx = 0;
						} else if (data === "b") {
							const t = visible[selectedIdx];
							if (t) {
								const bl = loadBacklog();
								bl.items.push({
									id: bl.nextId++,
									title: t.subject,
									priority: "medium",
									note: t.description || undefined,
									status: "open",
									createdAt: Date.now(),
								});
								saveBacklog(bl);
								t.status = "deprioritized";
								t.disposition = { type: "deprioritized", reason: "backlog로 이동", at: Date.now(), by: "user" };
								t.updatedAt = Date.now();
								save(ctx, store);
								updateWidget(ctx);
								if (selectedIdx >= getVisible().length) selectedIdx = Math.max(0, getVisible().length - 1);
							}
						}
						(tui as any).requestRender?.();
					},
					invalidate: () => {},
				};
			},
			{ overlay: true, overlayOptions: { width: "80%", maxHeight: "60%", anchor: "center" } },
		);
	}

	pi.registerCommand("tasks", {
		description: "Interactive task checklist overlay. Use /tasks show|hide|status to control the passive work-map overlay.",
		getArgumentCompletions(prefix: string) {
			const values = ["show", "hide", "status"];
			const filtered = values.filter((value) => value.startsWith(prefix.trim().toLowerCase()));
			return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const action = args.trim().toLowerCase();
			if (action === "show") {
				setPassiveTaskOverlayVisible(ctx, true);
				ctx.ui.notify("tasks work-map overlay를 표시합니다.", "info");
				return;
			}
			if (action === "hide") {
				setPassiveTaskOverlayVisible(ctx, false);
				ctx.ui.notify("tasks work-map overlay를 숨겼습니다. /tasks show 또는 Ctrl+Shift+O로 다시 표시할 수 있습니다.", "info");
				return;
			}
			if (action === "status") {
				ctx.ui.notify(`tasks overlay: ${isPassiveTaskOverlayHidden(ctx) ? "hidden" : "shown"}`, "info");
				return;
			}
			await showTasksOverlay(ctx);
		},
	});

	// ─── Keyboard shortcut ─────────────────────────────────────────────────

	pi.registerShortcut("ctrl+shift+t", {
		description: "Open tasks overlay",
		handler: async (ctx) => {
			await showTasksOverlay(ctx);
		},
	});

	pi.registerShortcut("ctrl+shift+o", {
		description: "Toggle passive tasks work-map overlay",
		handler: async (ctx) => {
			const visible = togglePassiveTaskOverlay(ctx);
			ctx.ui.notify(
				visible
					? "tasks work-map overlay를 표시합니다."
					: "tasks work-map overlay를 숨겼습니다. Ctrl+Shift+O로 다시 표시할 수 있습니다.",
				"info",
			);
		},
	});
}
