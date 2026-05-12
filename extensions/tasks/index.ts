import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";
import { resolveWorkUnit } from "../utils/work-context.ts";

type TaskKind = "slice" | "decision" | "verify" | "blocked" | "followup" | "general";
type TaskOwner = "agent" | "user" | "reviewer" | "subagent" | "external";

interface Task {
	id: string;
	subject: string;
	description: string;
	activeForm?: string;
	status: "pending" | "in_progress" | "completed";
	kind?: TaskKind;
	owner?: TaskOwner | string;
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
		return t && t.status !== "completed";
	});
}

function taskKind(t: Task): TaskKind {
	const metaKind = typeof t.metadata?.kind === "string" ? t.metadata.kind : undefined;
	return (t.kind || metaKind || "general") as TaskKind;
}

function taskPriority(t: Task): number {
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

function formatTask(store: TaskStore, t: Task): string {
	const blockers = openBlockers(store, t);
	const blocked = blockers.length > 0 ? ` [blocked by: ${blockers.join(", ")}]` : "";
	const owner = t.owner ? ` (owner: ${t.owner})` : "";
	const kind = taskKind(t) !== "general" ? ` <${taskKind(t)}>` : "";
	return `#${t.id} [${t.status}]${kind} ${t.subject}${owner}${blocked}`;
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

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "TaskCreate",
		label: "Create Task",
		description: "Create a new task to track work.",
		parameters: Type.Object({
			subject: Type.String({ description: "Brief task title" }),
			description: Type.String({ description: "Detailed description" }),
			activeForm: Type.Optional(Type.String({ description: "Present continuous form for spinner" })),
			kind: Type.Optional(Type.Union([Type.Literal("slice"), Type.Literal("decision"), Type.Literal("verify"), Type.Literal("blocked"), Type.Literal("followup"), Type.Literal("general")])),
			owner: Type.Optional(Type.Union([Type.Literal("agent"), Type.Literal("user"), Type.Literal("reviewer"), Type.Literal("subagent"), Type.Literal("external")])),
			acceptance: Type.Optional(Type.Array(Type.String(), { description: "Done-when checks for this task" })),
			refs: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Frame/success criteria/slice/file references" })),
			evidence: Type.Optional(Type.Array(Type.String(), { description: "Evidence refs collected for this task" })),
			agentType: Type.Optional(Type.String({ description: "Agent type for subagent execution" })),
			metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Arbitrary metadata" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
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
			const active = store.tasks.filter((t) => t.status !== "completed");
			const completed = store.tasks.filter((t) => t.status === "completed");
			if (store.tasks.length === 0) return text("No tasks.");
			const lines = sortTasks(active).map((t) => formatTask(store, t));
			if (completed.length > 0) lines.push(`\n${completed.length} completed task(s)`);
			const unit = resolveWorkUnit(ctx.cwd, ctx.sessionManager?.getSessionFile?.());
			return text(lines.join("\n"), { tasksPath: unit.tasksPath, active: active.length, completed: completed.length });
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
				task.owner ? `Owner: ${task.owner}` : null,
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
		description: "Update task status, subject, description, owner, or dependencies.",
		parameters: Type.Object({
			taskId: Type.String({ description: "Task ID" }),
			status: Type.Optional(Type.Union([
				Type.Literal("pending"),
				Type.Literal("in_progress"),
				Type.Literal("completed"),
				Type.Literal("deleted"),
			])),
			subject: Type.Optional(Type.String()),
			description: Type.Optional(Type.String()),
			activeForm: Type.Optional(Type.String()),
			kind: Type.Optional(Type.Union([Type.Literal("slice"), Type.Literal("decision"), Type.Literal("verify"), Type.Literal("blocked"), Type.Literal("followup"), Type.Literal("general")])),
			owner: Type.Optional(Type.String()),
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

			if (params.status === "deleted") {
				store.tasks = store.tasks.filter((t) => t.id !== params.taskId);
				for (const t of store.tasks) {
					t.blocks = t.blocks.filter((id) => id !== params.taskId);
					t.blockedBy = t.blockedBy.filter((id) => id !== params.taskId);
				}
				save(ctx, store);
				return text(`Task #${params.taskId} deleted.`);
			}

			if (params.status) task.status = params.status;
			if (params.subject) task.subject = params.subject;
			if (params.description) task.description = params.description;
			if (params.activeForm) task.activeForm = params.activeForm;
			if (params.kind) task.kind = params.kind;
			if (params.owner) task.owner = params.owner;
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

	// ─── Widget (above editor) ─────────────────────────────────────────────

	let latestCtx: ExtensionContext | undefined;
	const WIDGET_KEY = "tasks";

	function updateWidget(ctx: ExtensionContext) {
		if (!ctx.hasUI) return;
		const store = load(ctx);
		const active = store.tasks.filter((t) => t.status !== "completed");
		if (active.length === 0) {
			ctx.ui.setWidget(WIDGET_KEY, undefined);
			return;
		}
		const inProgress = active.filter((t) => t.status === "in_progress");
		const pending = active.filter((t) => t.status === "pending");
		const needsUser = active.filter((t) => t.owner === "user" || taskKind(t) === "decision");
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
			const lines: string[] = [];
			const header = `${theme.fg("accent", "☐")} Tasks: ${theme.fg("success", String(inProgress.length))} in progress · ${String(pending.length)} pending · ${theme.fg(needsUser.length ? "warning" : "border", String(needsUser.length))} needs user`;
			lines.push(header);
			for (const t of sortTasks(active).slice(0, 3)) {
				const marker = t.owner === "user" || taskKind(t) === "decision" ? "?" : t.status === "in_progress" ? "▸" : "·";
				lines.push(`  ${theme.fg(marker === "?" ? "warning" : "borderAccent", marker)} ${t.activeForm ?? t.subject}`);
			}
			return { render: (width: number) => lines.map(l => truncateToWidth(l, width)), invalidate() {}, handleInput() {} };
		});
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

	pi.on("tool_result", async (event, ctx) => {
		latestCtx = ctx;
		if (["TaskCreate", "TaskUpdate"].includes(event.toolName)) {
			updateWidget(ctx);
		}
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

		const getVisible = () => sortTasks(showCompleted ? store.tasks : store.tasks.filter((t) => t.status !== "completed"));

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
					lines.push(`  ${theme.fg("warning", "d")}            ${theme.fg("border", "삭제")}`);
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
						const total = store.tasks.length;

						const lines: string[] = [];
						lines.push(theme.fg("accent", "─".repeat(w)));
						const needsUser = store.tasks.filter((t) => t.status !== "completed" && (t.owner === "user" || taskKind(t) === "decision")).length;
						lines.push(`  ${theme.bold("Work Tasks")} (${total - completed}/${total} active · ${needsUser} needs user)        ${inputMode ? theme.fg("warning", `[${inputMode === "new" ? "새 태스크" : "수정"}]`) : ""}`);
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
								const icon = t.status === "completed" ? theme.fg("success", "✓") : t.status === "in_progress" ? theme.fg("warning", "●") : "○";
								const subject = t.status === "completed" ? theme.fg("border", t.subject) : sel ? theme.fg("accent", t.subject) : t.subject;
								const kind = taskKind(t);
								const metaParts = [kind !== "general" ? kind : undefined, t.owner ? `@${t.owner}` : undefined, t.metadata?.ticket ? String(t.metadata.ticket) : undefined].filter(Boolean);
								const meta = metaParts.length ? ` [${metaParts.join(" · ")}]` : "";
								const lineColor: ThemeColor = t.owner === "user" || kind === "decision" ? "warning" : t.status === "in_progress" ? "accent" : "text";
								lines.push(truncateToWidth(`${cursor} ${icon} #${t.id} ${theme.fg(lineColor, subject)}${meta}`, w, ""));
							}
						}

						if (completed > 0 && !showCompleted) {
							lines.push(`  + ${completed} completed (v로 표시)`);
						}

						lines.push(theme.fg("accent", "─".repeat(w)));
						lines.push(`  ${theme.fg("border", "↑↓ 이동 · Space 상태 토글 · n 새로 · d 삭제 · b backlog · v 완료 표시 · q 닫기")}`);

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
								store.tasks = store.tasks.filter((s) => s.id !== t.id);
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
								store.tasks = store.tasks.filter((s) => s.id !== t.id);
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
		description: "Interactive task checklist overlay",
		handler: async (_args, ctx) => showTasksOverlay(ctx),
	});

	// ─── Keyboard shortcut ─────────────────────────────────────────────────

	pi.registerShortcut("ctrl+shift+t", {
		description: "Open tasks overlay",
		handler: async (ctx) => {
			// Shortcut can't open overlay directly (no CommandContext)
			// Pre-fill /tasks command
			ctx.ui.setEditorText("/tasks");
		},
	});
}
