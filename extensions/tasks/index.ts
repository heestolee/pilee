import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";

interface Task {
	id: string;
	subject: string;
	description: string;
	activeForm?: string;
	status: "pending" | "in_progress" | "completed";
	owner?: string;
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

function storePath(ctx: ExtensionContext): string {
	const sessionId = ctx.sessionManager?.getSessionId?.() ?? "default";
	const dir = join(ctx.cwd, ".pi", "tasks");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, `tasks-${sessionId}.json`);
}

function load(ctx: ExtensionContext): TaskStore {
	const p = storePath(ctx);
	if (!existsSync(p)) return { nextId: 1, tasks: [] };
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

function formatTask(store: TaskStore, t: Task): string {
	const blockers = openBlockers(store, t);
	const blocked = blockers.length > 0 ? ` [blocked by: ${blockers.join(", ")}]` : "";
	const owner = t.owner ? ` (owner: ${t.owner})` : "";
	return `#${t.id} [${t.status}] ${t.subject}${owner}${blocked}`;
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

function text(t: string) {
	return { content: [{ type: "text" as const, text: t }], details: {} };
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
			agentType: Type.Optional(Type.String({ description: "Agent type for subagent execution" })),
			metadata: Type.Optional(Type.Record(Type.String(), Type.Unknown(), { description: "Arbitrary metadata" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const store = load(ctx);
			const task: Task = {
				id: String(store.nextId++),
				subject: params.subject,
				description: params.description,
				activeForm: params.activeForm,
				status: "pending",
				blocks: [],
				blockedBy: [],
				metadata: params.metadata ?? {},
				createdAt: Date.now(),
				updatedAt: Date.now(),
			};
			if (params.agentType) task.metadata.agentType = params.agentType;
			store.tasks.push(task);
			save(ctx, store);
			return text(`Task #${task.id} created successfully: ${task.subject}`);
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
			const lines = active.map((t) => formatTask(store, t));
			if (completed.length > 0) lines.push(`\n${completed.length} completed task(s)`);
			return text(lines.join("\n"));
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
				task.owner ? `Owner: ${task.owner}` : null,
				`Description: ${task.description}`,
				task.blocks.length > 0 ? `Blocks: ${task.blocks.join(", ")}` : null,
				blockers.length > 0 ? `Blocked by (open): ${blockers.join(", ")}` : null,
			].filter(Boolean);
			return text(lines.join("\n"));
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
			owner: Type.Optional(Type.String()),
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
			if (params.owner) task.owner = params.owner;
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
			return text(`Updated task #${params.taskId} status`);
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
		ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => {
			const lines: string[] = [];
			const header = `${theme.fg("accent", "☐")} Tasks: ${theme.fg("success", String(inProgress.length))} in progress · ${String(pending.length)} pending`;
			lines.push(header);
			for (const t of inProgress.slice(0, 3)) {
				lines.push(`  ${theme.fg("warning", "▸")} ${t.activeForm ?? t.subject}`);
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

		const getVisible = () => showCompleted ? store.tasks : store.tasks.filter((t) => t.status !== "completed");

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
						lines.push(`  ${theme.bold("Tasks")} (${total - completed}/${total} active)        ${inputMode ? theme.fg("warning", `[${inputMode === "new" ? "새 태스크" : "수정"}]`) : ""}`);
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
								const meta = t.metadata?.ticket ? ` [${t.metadata.ticket}]` : "";
								lines.push(truncateToWidth(`${cursor} ${icon} #${t.id} ${subject}${meta}`, w, ""));
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
