import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
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

	pi.on("session_start", async (_e, ctx) => {
		if (!ctx.hasUI) return;
		const store = load(ctx);
		const inProgress = store.tasks.filter((t) => t.status === "in_progress");
		if (inProgress.length > 0) {
			ctx.ui.notify(`${inProgress.length} task(s) in progress from previous session`, "info");
		}
	});
}
