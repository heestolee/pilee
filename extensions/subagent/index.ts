import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	ToolDefinition,
} from "@mariozechner/pi-coding-agent";
import { createAgentSession } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";

interface AgentDef {
	name: string;
	displayName: string;
	description: string;
	systemPrompt?: string;
	model?: string;
	thinkingLevel?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	tools?: string[]; // tool allowlist; undefined = all
	inheritContext?: boolean;
}

const READ_ONLY_TOOLS = ["read", "bash", "grep", "find", "ls"];

const HANG_CHECK_INTERVAL_MS = 30_000;
const HANG_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1_000;
const MAX_REPLAY_EVENTS = 500;

const DEFAULT_AGENTS: Record<string, AgentDef> = {
	"general-purpose": {
		name: "general-purpose",
		displayName: "Agent",
		description: "General-purpose agent for complex, multi-step tasks",
	},
	Explore: {
		name: "Explore",
		displayName: "Explore",
		description: "Fast codebase exploration agent (read-only)",
		tools: READ_ONLY_TOOLS,
		model: "anthropic/claude-haiku-4-5-20251001",
		systemPrompt: `# READ-ONLY MODE
You are a code search specialist. You excel at navigating and exploring codebases.
You do NOT have file editing tools.
- Use read, bash, grep, find, ls to explore
- Report findings as text
- Do not modify files`,
	},
	Plan: {
		name: "Plan",
		displayName: "Plan",
		description: "Software architect for implementation planning (read-only)",
		tools: READ_ONLY_TOOLS,
		systemPrompt: `# PLANNING MODE
You are a software architect creating implementation plans.
- Read existing code to understand context
- Output a structured plan with: goal, files to change, steps, risks
- Do not modify files`,
	},
};

type ReplayEvent =
	| { type: "user"; text: string; ts: number }
	| { type: "assistant"; text: string; ts: number }
	| { type: "tool_call"; name: string; args: any; ts: number }
	| { type: "tool_result"; name: string; result: string; ts: number }
	| { type: "system"; text: string; ts: number };

interface AgentRecord {
	id: string;
	type: string;
	prompt: string;
	description: string;
	status: "running" | "done" | "error" | "aborted";
	startedAt: number;
	completedAt?: number;
	result?: string;
	error?: string;
	toolUses: number;
	session?: any;
	promise?: Promise<void>;
	abortController?: AbortController;
	lastActivityAt: number;
	retries: number;
	maxRetries: number;
	autoRetry: boolean;
	hungNotified?: boolean;
	pendingQuestions: Map<string, (reply: string) => void>;
	events: ReplayEvent[];
}

const records = new Map<string, AgentRecord>();

function loadCustomAgents(cwd: string): Record<string, AgentDef> {
	const result: Record<string, AgentDef> = {};
	const dirs = [
		join(cwd, ".pi", "agents"),
		join(cwd, ".agents"),
		join(homedir(), ".pi", "agent", "agents"),
	];
	for (const dir of dirs) {
		if (!existsSync(dir)) continue;
		try {
			const fs = require("node:fs") as typeof import("node:fs");
			for (const f of fs.readdirSync(dir)) {
				if (!f.endsWith(".md")) continue;
				const name = f.replace(/\.md$/, "");
				if (result[name]) continue;
				const content = readFileSync(join(dir, f), "utf8");
				const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
				const body = fmMatch ? fmMatch[2] : content;
				const fm: Record<string, string> = {};
				if (fmMatch) {
					for (const line of fmMatch[1].split("\n")) {
						const [k, ...v] = line.split(":");
						if (k && v.length) fm[k.trim()] = v.join(":").trim();
					}
				}
				result[name] = {
					name,
					displayName: fm.displayName || fm.name || name,
					description: fm.description || "Custom agent",
					model: fm.model,
					thinkingLevel: fm.thinkingLevel as any,
					systemPrompt: body.trim(),
				};
			}
		} catch {}
	}
	return result;
}

function getAgents(cwd: string): Record<string, AgentDef> {
	return { ...DEFAULT_AGENTS, ...loadCustomAgents(cwd) };
}

function buildTypeListText(agents: Record<string, AgentDef>): string {
	const lines = ["Default agents:"];
	for (const a of Object.values(agents)) {
		lines.push(`- ${a.name}: ${a.description}`);
	}
	return lines.join("\n");
}

function formatDuration(start: number, end?: number): string {
	const ms = (end ?? Date.now()) - start;
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	return `${Math.floor(s / 60)}m ${s % 60}s`;
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	const pad = (n: number) => n.toString().padStart(2, "0");
	return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function text(msg: string, details?: any) {
	return { content: [{ type: "text" as const, text: msg }], details };
}

function pushEvent(record: AgentRecord, ev: ReplayEvent): void {
	record.events.push(ev);
	if (record.events.length > MAX_REPLAY_EVENTS) {
		record.events.splice(0, record.events.length - MAX_REPLAY_EVENTS);
	}
}

function summarizeArgs(args: any, max = 80): string {
	let s: string;
	try {
		s = JSON.stringify(args);
	} catch {
		s = String(args);
	}
	if (!s) return "";
	return s.length <= max ? s : `${s.slice(0, max - 3)}...`;
}

function buildAskMasterTool(record: AgentRecord, pi: ExtensionAPI): ToolDefinition {
	return {
		name: "ask_master",
		label: "Ask Master",
		description: `Ask the parent (master) session for clarification or a decision.

Calling this tool pauses your work and sends a question to the master. Your tool result will contain the master's reply.

Use this when:
- You need a decision the master should make (architecture, scope, risky operations).
- Requirements are ambiguous and you cannot proceed without input.
- You discovered something unexpected and want guidance.

Do NOT use ask_master for things you can resolve yourself by reading code or running safe commands.`,
		parameters: Type.Object({
			message: Type.String({ description: "The question for the master. Include context, options, and your recommendation." }),
			context: Type.Optional(Type.String({ description: "Optional extra context (current state, what you found, etc)." })),
		}),
		async execute(_toolCallId, params, signal) {
			const msg = (params as any).message as string;
			const extra = ((params as any).context as string | undefined) ?? "";
			const questionId = randomUUID().slice(0, 8);

			const display = [
				`[ask_master] Subagent ${record.id} (${record.type}) requests guidance.`,
				`Question: ${msg}`,
				extra ? `Context: ${extra}` : "",
				`Reply with: reply_to_subagent(agent_id="${record.id}", question_id="${questionId}", reply="...")`,
			]
				.filter(Boolean)
				.join("\n");

			try {
				pi.sendMessage(
					{
						customType: "subagent-ask-master",
						content: display,
						display: true,
						details: { agentId: record.id, questionId, message: msg, context: extra },
					},
					{ deliverAs: "followUp", triggerTurn: false },
				);
			} catch {}

			try {
				pi.sendUserMessage(display, { deliverAs: "followUp" });
			} catch {}

			pushEvent(record, { type: "system", text: `ask_master(${questionId}): ${msg}`, ts: Date.now() });
			record.lastActivityAt = Date.now();

			const reply = await new Promise<string>((resolve, reject) => {
				record.pendingQuestions.set(questionId, resolve);
				const onAbort = () => {
					record.pendingQuestions.delete(questionId);
					reject(new Error("ask_master aborted"));
				};
				if (signal?.aborted) {
					onAbort();
					return;
				}
				signal?.addEventListener("abort", onAbort, { once: true });
			});

			record.lastActivityAt = Date.now();
			pushEvent(record, { type: "system", text: `master replied to ${questionId}: ${reply.slice(0, 200)}`, ts: Date.now() });

			return text(`Master replied:\n\n${reply}`, { questionId, reply });
		},
	};
}

async function runAgentOnce(record: AgentRecord, agentDef: AgentDef, cwd: string, parentModel: any, pi: ExtensionAPI): Promise<void> {
	let model = parentModel;
	if (agentDef.model) {
		const slash = agentDef.model.indexOf("/");
		if (slash !== -1) {
			const m = getModel(agentDef.model.slice(0, slash) as any, agentDef.model.slice(slash + 1));
			if (m) model = m;
		}
	}

	const allowedTools = agentDef.tools;
	const askMasterTool = buildAskMasterTool(record, pi);

	const { session } = await createAgentSession({
		cwd,
		model,
		thinkingLevel: agentDef.thinkingLevel,
		customTools: [askMasterTool],
		...(allowedTools ? { tools: allowedTools as any } : {}),
	});

	record.session = session;

	let assistantText = "";
	let toolUses = 0;
	const unsub = session.subscribe((event: any) => {
		record.lastActivityAt = Date.now();
		if (event.type === "message_start") {
			assistantText = "";
		}
		if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
			assistantText += event.assistantMessageEvent.delta;
		}
		if (event.type === "message_end") {
			const role = event.message?.role;
			if (role === "assistant" && assistantText.trim()) {
				pushEvent(record, { type: "assistant", text: assistantText, ts: Date.now() });
			}
		}
		if (event.type === "tool_execution_start") {
			toolUses++;
			pushEvent(record, {
				type: "tool_call",
				name: event.toolName ?? "tool",
				args: event.args,
				ts: Date.now(),
			});
		}
		if (event.type === "tool_execution_end") {
			let resultText = "";
			try {
				const r = event.result;
				if (typeof r === "string") resultText = r;
				else if (Array.isArray(r?.content)) {
					resultText = r.content
						.filter((c: any) => c?.type === "text")
						.map((c: any) => c.text)
						.join("");
				} else if (r != null) resultText = JSON.stringify(r);
			} catch {}
			pushEvent(record, {
				type: "tool_result",
				name: event.toolName ?? "tool",
				result: resultText,
				ts: Date.now(),
			});
		}
	});

	try {
		const userPrompt = agentDef.systemPrompt
			? `${agentDef.systemPrompt}\n\n---\n\n${record.prompt}`
			: record.prompt;
		pushEvent(record, { type: "user", text: userPrompt, ts: Date.now() });
		record.lastActivityAt = Date.now();

		await session.prompt(userPrompt, { signal: record.abortController?.signal });
		record.result = assistantText.trim() || "(no output)";
		record.toolUses = toolUses;
	} finally {
		try { unsub(); } catch {}
	}
}

async function runAgentWithRetry(record: AgentRecord, agentDef: AgentDef, cwd: string, parentModel: any, pi: ExtensionAPI): Promise<void> {
	for (;;) {
		try {
			await runAgentOnce(record, agentDef, cwd, parentModel, pi);
			record.status = "done";
			record.completedAt = Date.now();
			return;
		} catch (e) {
			const isAbort = e instanceof Error && (e.name === "AbortError" || /abort/i.test(e.message));
			if (isAbort || record.abortController?.signal.aborted) {
				record.error = e instanceof Error ? e.message : String(e);
				record.status = "aborted";
				record.completedAt = Date.now();
				return;
			}

			if (record.autoRetry && record.retries < record.maxRetries) {
				record.retries++;
				const errMsg = e instanceof Error ? e.message : String(e);
				pushEvent(record, {
					type: "system",
					text: `retry ${record.retries}/${record.maxRetries} after error: ${errMsg.slice(0, 200)}`,
					ts: Date.now(),
				});
				record.lastActivityAt = Date.now();
				try {
					await new Promise<void>((resolve, reject) => {
						const t = setTimeout(resolve, RETRY_DELAY_MS);
						const onAbort = () => {
							clearTimeout(t);
							reject(new Error("aborted during retry wait"));
						};
						if (record.abortController?.signal.aborted) {
							onAbort();
							return;
						}
						record.abortController?.signal.addEventListener("abort", onAbort, { once: true });
					});
				} catch {
					record.error = "aborted during retry wait";
					record.status = "aborted";
					record.completedAt = Date.now();
					return;
				}
				continue;
			}

			record.error = e instanceof Error ? e.message : String(e);
			record.status = "error";
			record.completedAt = Date.now();
			return;
		}
	}
}

function checkForHungRuns(pi: ExtensionAPI): void {
	const now = Date.now();
	for (const record of records.values()) {
		if (record.status !== "running") continue;
		if (record.hungNotified) continue;
		const idleMs = now - record.lastActivityAt;
		if (idleMs < HANG_TIMEOUT_MS) continue;

		record.hungNotified = true;
		const idleS = Math.round(idleMs / 1000);
		const reason = `Auto-aborted: no activity for ${idleS}s`;
		try {
			record.abortController?.abort();
		} catch {}
		record.error = reason;
		record.status = "aborted";
		record.completedAt = Date.now();
		pushEvent(record, { type: "system", text: reason, ts: Date.now() });

		const message = `⚠️ subagent ${record.id} (${record.type}) — ${idleS}초 무응답으로 자동 abort됨\nDescription: ${record.description}`;
		try {
			pi.sendUserMessage(message, { deliverAs: "followUp" });
		} catch {}
	}
}

function renderReplayOverlay(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
	if (!ctx.hasUI) {
		const lines: string[] = ["Subagent records:"];
		for (const r of records.values()) {
			lines.push(`  ${r.id} ${r.type} [${r.status}] tools:${r.toolUses} retries:${r.retries} ${r.description}`);
		}
		ctx.ui?.notify?.(lines.join("\n"), "info");
		return Promise.resolve();
	}

	const list = Array.from(records.values()).sort((a, b) => b.startedAt - a.startedAt);
	if (list.length === 0) {
		ctx.ui.notify("No subagent records yet.", "info");
		return Promise.resolve();
	}

	type View = "list" | "detail";
	const state = {
		view: "list" as View,
		listIndex: 0,
		listScroll: 0,
		detailIndex: 0,
		detailScroll: 0,
	};

	function getDetailLines(record: AgentRecord, width: number): string[] {
		const out: string[] = [];
		const w = Math.max(20, width - 4);
		const wrap = (s: string): string[] => {
			const lines: string[] = [];
			for (const raw of s.split("\n")) {
				if (raw.length === 0) {
					lines.push("");
					continue;
				}
				let i = 0;
				while (i < raw.length) {
					lines.push(raw.slice(i, i + w));
					i += w;
				}
			}
			return lines;
		};

		out.push(`Agent ${record.id} | ${record.type} | status: ${record.status}`);
		out.push(`Started: ${formatTime(record.startedAt)}  Duration: ${formatDuration(record.startedAt, record.completedAt)}  Tools: ${record.toolUses}  Retries: ${record.retries}`);
		out.push(`Description: ${record.description}`);
		out.push("");

		for (const ev of record.events) {
			const ts = formatTime(ev.ts);
			if (ev.type === "user") {
				out.push(`[${ts}] 👤 USER`);
				for (const l of wrap(ev.text)) out.push(`  ${l}`);
			} else if (ev.type === "assistant") {
				out.push(`[${ts}] 🤖 ASSISTANT`);
				for (const l of wrap(ev.text)) out.push(`  ${l}`);
			} else if (ev.type === "tool_call") {
				out.push(`[${ts}] 🛠  → ${ev.name} ${summarizeArgs(ev.args, w - 10)}`);
			} else if (ev.type === "tool_result") {
				out.push(`[${ts}] 🛠  ← ${ev.name}`);
				for (const l of wrap(ev.result || "(no output)")) out.push(`    ${l}`);
			} else if (ev.type === "system") {
				out.push(`[${ts}] ⚙  ${ev.text}`);
			}
			out.push("");
		}
		if (record.result) {
			out.push("--- RESULT ---");
			for (const l of wrap(record.result)) out.push(l);
		}
		if (record.error) {
			out.push("--- ERROR ---");
			for (const l of wrap(record.error)) out.push(l);
		}
		return out;
	}

	return ctx.ui.custom<void>(
		(tui, theme, _kb, done) => {
			let cachedDetailLines: string[] | null = null;
			let cachedDetailWidth = -1;

			return {
				render: (w: number) => {
					const t: any = theme;
					const fg = t.fg.bind(t);
					const rows = (tui as any).terminal?.rows ?? 30;
					const headerH = 4;
					const footerH = 2;
					const bodyH = Math.max(5, rows - headerH - footerH);
					const out: string[] = [];

					out.push(fg("accent", "─".repeat(w)));
					out.push(`  ${fg("accent", t.bold("SUBAGENT REPLAY"))}  ${fg("dim", `${list.length} record${list.length === 1 ? "" : "s"}`)}`);
					out.push(
						fg(
							"dim",
							state.view === "list"
								? "  ↑/↓ select · Enter view · q/Esc close"
								: "  ↑/↓/PgUp/PgDn scroll · Esc back · q close",
						),
					);
					out.push(fg("accent", "─".repeat(w)));

					if (state.view === "list") {
						const maxRows = bodyH;
						if (state.listIndex < state.listScroll) state.listScroll = state.listIndex;
						if (state.listIndex >= state.listScroll + maxRows) state.listScroll = state.listIndex - maxRows + 1;
						for (let i = state.listScroll; i < Math.min(list.length, state.listScroll + maxRows); i++) {
							const r = list[i];
							const sel = i === state.listIndex;
							const cursor = sel ? fg("accent", "▶") : " ";
							let statusColor: any = "dim";
							if (r.status === "running") statusColor = "warning";
							else if (r.status === "done") statusColor = "success";
							else if (r.status === "error") statusColor = "error";
							else if (r.status === "aborted") statusColor = "muted";
							const status = fg(statusColor, `[${r.status}]`);
							const meta = fg("dim", `${r.id} ${r.type} ${formatDuration(r.startedAt, r.completedAt)} tools:${r.toolUses}${r.retries ? ` retries:${r.retries}` : ""}`);
							const desc = sel ? fg("accent", r.description) : r.description;
							const line = `${cursor} ${status} ${meta}  ${desc}`;
							out.push(truncateToWidth(line, w, ""));
						}
						const blank = maxRows - Math.min(list.length - state.listScroll, maxRows);
						for (let i = 0; i < blank; i++) out.push("");
					} else {
						const record = list[state.listIndex];
						if (cachedDetailWidth !== w) {
							cachedDetailLines = getDetailLines(record, w);
							cachedDetailWidth = w;
						}
						const lines = cachedDetailLines ?? getDetailLines(record, w);
						const maxRows = bodyH;
						const maxScroll = Math.max(0, lines.length - maxRows);
						if (state.detailScroll > maxScroll) state.detailScroll = maxScroll;
						for (let i = state.detailScroll; i < Math.min(lines.length, state.detailScroll + maxRows); i++) {
							out.push(truncateToWidth(lines[i] ?? "", w, ""));
						}
						const blank = maxRows - Math.min(lines.length - state.detailScroll, maxRows);
						for (let i = 0; i < blank; i++) out.push("");
					}

					out.push(fg("accent", "─".repeat(w)));
					if (state.view === "list") {
						out.push(fg("dim", `  ${state.listIndex + 1}/${list.length}`));
					} else {
						const record = list[state.listIndex];
						const total = (cachedDetailLines ?? getDetailLines(record, w)).length;
						out.push(fg("dim", `  scroll ${state.detailScroll + 1}-${Math.min(total, state.detailScroll + bodyH)} / ${total}`));
					}
					return out;
				},
				handleInput: (data: string) => {
					if (data === "q" || data === "Q") {
						done(undefined);
						return;
					}
					if (state.view === "list") {
						if (matchesKey(data, Key.escape)) {
							done(undefined);
							return;
						}
						if (matchesKey(data, Key.up) || data === "k") {
							state.listIndex = Math.max(0, state.listIndex - 1);
						} else if (matchesKey(data, Key.down) || data === "j") {
							state.listIndex = Math.min(list.length - 1, state.listIndex + 1);
						} else if (matchesKey(data, Key.enter)) {
							state.view = "detail";
							state.detailScroll = 0;
							cachedDetailLines = null;
							cachedDetailWidth = -1;
						}
					} else {
						if (matchesKey(data, Key.escape)) {
							state.view = "list";
							cachedDetailLines = null;
							cachedDetailWidth = -1;
						} else if (matchesKey(data, Key.up) || data === "k") {
							state.detailScroll = Math.max(0, state.detailScroll - 1);
						} else if (matchesKey(data, Key.down) || data === "j") {
							state.detailScroll++;
						} else if (matchesKey(data, Key.pageUp)) {
							state.detailScroll = Math.max(0, state.detailScroll - 20);
						} else if (matchesKey(data, Key.pageDown)) {
							state.detailScroll += 20;
						} else if (data === "g") {
							state.detailScroll = 0;
						} else if (data === "G") {
							state.detailScroll = Number.MAX_SAFE_INTEGER; // clamped on render
						}
					}
					(tui as any).requestRender?.();
				},
				invalidate: () => {},
			};
		},
		{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } },
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "Agent",
		label: "Agent",
		description: `Launch a new agent to handle complex, multi-step tasks autonomously.

The Agent tool launches specialized agents that autonomously handle complex tasks. Each agent type has specific capabilities and tools available to it.

Available agent types:
${buildTypeListText(DEFAULT_AGENTS)}

Custom agents can be defined in .pi/agents/<name>.md (project) or ~/.pi/agent/agents/<name>.md (global) — they are picked up automatically.

Guidelines:
- For parallel work, use run_in_background: true on each agent. Foreground calls run sequentially — only one executes at a time.
- Use Explore for codebase searches and code understanding.
- Use Plan for architecture and implementation planning.
- Use general-purpose for complex tasks that need file editing.
- Provide clear, detailed prompts so the agent can work autonomously.
- Agent results are returned as text — summarize them for the user.
- Use run_in_background for work you don't need immediately. Use get_subagent_result to retrieve results later.
- Use steer_subagent to send mid-run messages to a running background agent.
- Subagents may call ask_master to escalate questions back to you. Reply with reply_to_subagent.
- Subagents auto-retry on transient errors (up to 3 times) and auto-abort after 5 minutes of inactivity.
- Use model to specify a different model (as "provider/modelId").
- Use thinking to control extended thinking level.`,
		parameters: Type.Object({
			prompt: Type.String({ description: "The task for the agent to perform." }),
			description: Type.String({ description: "A short (3-5 word) description of the task (shown in UI)." }),
			subagent_type: Type.String({ description: "The type of specialized agent to use. Available: general-purpose, Explore, Plan. Custom agents are also available." }),
			run_in_background: Type.Optional(Type.Boolean({ description: "Set to true to run in background. Returns agent ID immediately." })),
			model: Type.Optional(Type.String({ description: "Model override as 'provider/modelId'." })),
			thinking: Type.Optional(Type.Union([Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("xhigh")])),
			auto_retry: Type.Optional(Type.Boolean({ description: "Auto-retry on transient errors (up to 3 times). Default: true." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const agents = getAgents(ctx.cwd);
			const agentDef = agents[params.subagent_type];
			if (!agentDef) {
				return text(`Unknown agent type: "${params.subagent_type}". Available: ${Object.keys(agents).join(", ")}`);
			}

			const def: AgentDef = { ...agentDef };
			if (params.model) def.model = params.model;
			if (params.thinking) def.thinkingLevel = params.thinking;

			const id = randomUUID().slice(0, 8);
			const record: AgentRecord = {
				id,
				type: params.subagent_type,
				prompt: params.prompt,
				description: params.description,
				status: "running",
				startedAt: Date.now(),
				toolUses: 0,
				abortController: new AbortController(),
				lastActivityAt: Date.now(),
				retries: 0,
				maxRetries: DEFAULT_MAX_RETRIES,
				autoRetry: params.auto_retry !== false,
				pendingQuestions: new Map(),
				events: [],
			};
			records.set(id, record);

			const promise = runAgentWithRetry(record, def, ctx.cwd, ctx.model, pi);
			record.promise = promise;

			if (params.run_in_background) {
				return text(
					`Agent launched in background. ID: ${id}\nType: ${def.displayName}\nDescription: ${params.description}\n\nUse get_subagent_result with agent_id="${id}" to check status.`,
					{ agent_id: id, status: "running" },
				);
			}

			await promise;
			const duration = formatDuration(record.startedAt, record.completedAt);
			const status = record.status === "done" ? "completed" : record.status;
			const retryNote = record.retries > 0 ? ` (after ${record.retries} retr${record.retries === 1 ? "y" : "ies"})` : "";
			return text(
				`Agent ${status} in ${duration}${retryNote} (${record.toolUses} tool uses).\n\n${record.result || record.error || "No output."}`,
				{
					agent_id: id,
					status: record.status,
					duration_ms: (record.completedAt ?? Date.now()) - record.startedAt,
					retries: record.retries,
				},
			);
		},
	});

	pi.registerTool({
		name: "get_subagent_result",
		label: "Get Agent Result",
		description: "Check status and retrieve results from a background agent. Use the agent ID returned by Agent with run_in_background.",
		parameters: Type.Object({
			agent_id: Type.String({ description: "The agent ID to check." }),
			wait: Type.Optional(Type.Boolean({ description: "If true, wait for the agent to complete. Default: false." })),
			verbose: Type.Optional(Type.Boolean({ description: "If true, include the agent's full conversation. Default: false." })),
		}),
		async execute(_id, params) {
			const record = records.get(params.agent_id);
			if (!record) return text(`Agent not found: "${params.agent_id}". It may have been cleaned up.`);

			if (params.wait && record.status === "running" && record.promise) {
				await record.promise;
			}

			const duration = formatDuration(record.startedAt, record.completedAt);
			const lines = [
				`Agent: ${record.id}`,
				`Type: ${record.type} | Status: ${record.status} | Tool uses: ${record.toolUses} | Retries: ${record.retries} | Duration: ${duration}`,
				`Description: ${record.description}`,
				"",
				record.status === "running"
					? "(still running — use wait=true to block until complete)"
					: record.result || record.error || "No output.",
			];

			if (params.verbose) {
				const summary = record.events
					.map((ev) => {
						if (ev.type === "user") return `[user]: ${ev.text.slice(0, 500)}`;
						if (ev.type === "assistant") return `[assistant]: ${ev.text.slice(0, 500)}`;
						if (ev.type === "tool_call") return `[tool→ ${ev.name}]: ${summarizeArgs(ev.args, 200)}`;
						if (ev.type === "tool_result") return `[tool← ${ev.name}]: ${ev.result.slice(0, 200)}`;
						return `[system]: ${ev.text.slice(0, 200)}`;
					})
					.join("\n\n");
				if (summary) lines.push("\n--- Conversation ---\n", summary);
			}

			return text(lines.join("\n"));
		},
	});

	pi.registerTool({
		name: "steer_subagent",
		label: "Steer Agent",
		description: "Send a steering message to a running agent. The message will interrupt the agent after its current tool execution and be injected into its conversation. Only works on running agents.",
		parameters: Type.Object({
			agent_id: Type.String({ description: "The agent ID to steer (must be currently running)." }),
			message: Type.String({ description: "The steering message to send." }),
		}),
		async execute(_id, params) {
			const record = records.get(params.agent_id);
			if (!record) return text(`Agent not found: "${params.agent_id}".`);
			if (record.status !== "running") return text(`Agent "${params.agent_id}" is not running (status: ${record.status}).`);
			if (!record.session) return text(`Agent "${params.agent_id}" has no active session.`);

			try {
				if (typeof record.session.steer === "function") {
					await record.session.steer(params.message);
				} else if (typeof record.session.queueSteering === "function") {
					record.session.queueSteering(params.message);
				} else {
					await record.session.prompt(params.message, { streamingBehavior: "steer" });
				}
				record.lastActivityAt = Date.now();
				pushEvent(record, { type: "system", text: `steered: ${params.message.slice(0, 200)}`, ts: Date.now() });
				return text(`Steering message queued for agent ${params.agent_id}.`);
			} catch (e) {
				return text(`Failed to steer: ${e instanceof Error ? e.message : e}`);
			}
		},
	});

	pi.registerTool({
		name: "reply_to_subagent",
		label: "Reply to Subagent",
		description: "Reply to a subagent that called ask_master. The reply is delivered as the tool result of the subagent's ask_master call.",
		parameters: Type.Object({
			agent_id: Type.String({ description: "The subagent ID that asked the question." }),
			question_id: Type.String({ description: "The question_id from the ask_master call." }),
			reply: Type.String({ description: "Your reply to the subagent." }),
		}),
		async execute(_id, params) {
			const record = records.get(params.agent_id);
			if (!record) return text(`Agent not found: "${params.agent_id}".`);
			const resolver = record.pendingQuestions.get(params.question_id);
			if (!resolver) {
				return text(`No pending question "${params.question_id}" for agent "${params.agent_id}". It may have already been answered or the agent ended.`);
			}
			record.pendingQuestions.delete(params.question_id);
			resolver(params.reply);
			record.lastActivityAt = Date.now();
			return text(`Reply delivered to subagent ${params.agent_id} (question ${params.question_id}).`);
		},
	});

	pi.registerCommand("subagent-replay", {
		description: "Browse subagent records and replay their conversations",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			await renderReplayOverlay(pi, ctx);
		},
	});

	const hangCheckTimer = setInterval(() => {
		try { checkForHungRuns(pi); } catch {}
	}, HANG_CHECK_INTERVAL_MS);
	if (typeof (hangCheckTimer as any).unref === "function") {
		(hangCheckTimer as any).unref();
	}

	pi.on("session_shutdown", async () => {
		try { clearInterval(hangCheckTimer); } catch {}
		for (const r of records.values()) {
			try { r.abortController?.abort(); } catch {}
			for (const reject of r.pendingQuestions.values()) {
				try { reject("(session shutdown)"); } catch {}
			}
			r.pendingQuestions.clear();
		}
		records.clear();
	});
}
