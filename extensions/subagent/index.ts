import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { createAgentSession } from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";
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

function text(msg: string, details?: any) {
	return { content: [{ type: "text" as const, text: msg }], details };
}

async function runAgent(record: AgentRecord, agentDef: AgentDef, cwd: string, parentModel: any): Promise<void> {
	try {
		let model = parentModel;
		if (agentDef.model) {
			const slash = agentDef.model.indexOf("/");
			if (slash !== -1) {
				const m = getModel(agentDef.model.slice(0, slash) as any, agentDef.model.slice(slash + 1));
				if (m) model = m;
			}
		}

		const allowedTools = agentDef.tools;

		const { session } = await createAgentSession({
			cwd,
			model,
			thinkingLevel: agentDef.thinkingLevel,
			...(allowedTools ? { tools: allowedTools } : {}),
		});

		record.session = session;

		// Collect text output
		let text = "";
		let toolUses = 0;
		const unsub = session.subscribe((event: any) => {
			if (event.type === "message_start") text = "";
			if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
				text += event.assistantMessageEvent.delta;
			}
			if (event.type === "tool_execution_start") toolUses++;
		});

		const userPrompt = agentDef.systemPrompt
			? `${agentDef.systemPrompt}\n\n---\n\n${record.prompt}`
			: record.prompt;

		await session.prompt(userPrompt, { signal: record.abortController?.signal });
		unsub();

		record.result = text.trim() || "(no output)";
		record.toolUses = toolUses;
		record.status = "done";
		record.completedAt = Date.now();
	} catch (e) {
		record.error = e instanceof Error ? e.message : String(e);
		record.status = e instanceof Error && e.name === "AbortError" ? "aborted" : "error";
		record.completedAt = Date.now();
	}
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
- Use model to specify a different model (as "provider/modelId").
- Use thinking to control extended thinking level.`,
		parameters: Type.Object({
			prompt: Type.String({ description: "The task for the agent to perform." }),
			description: Type.String({ description: "A short (3-5 word) description of the task (shown in UI)." }),
			subagent_type: Type.String({ description: "The type of specialized agent to use. Available: general-purpose, Explore, Plan. Custom agents are also available." }),
			run_in_background: Type.Optional(Type.Boolean({ description: "Set to true to run in background. Returns agent ID immediately." })),
			model: Type.Optional(Type.String({ description: "Model override as 'provider/modelId'." })),
			thinking: Type.Optional(Type.Union([Type.Literal("off"), Type.Literal("minimal"), Type.Literal("low"), Type.Literal("medium"), Type.Literal("high"), Type.Literal("xhigh")])),
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
			};
			records.set(id, record);

			const promise = runAgent(record, def, ctx.cwd, ctx.model);
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
			return text(
				`Agent ${status} in ${duration} (${record.toolUses} tool uses).\n\n${record.result || record.error || "No output."}`,
				{ agent_id: id, status: record.status, duration_ms: (record.completedAt ?? Date.now()) - record.startedAt },
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
				`Type: ${record.type} | Status: ${record.status} | Tool uses: ${record.toolUses} | Duration: ${duration}`,
				`Description: ${record.description}`,
				"",
				record.status === "running"
					? "(still running — use wait=true to block until complete)"
					: record.result || record.error || "No output.",
			];

			if (params.verbose && record.session) {
				try {
					const entries = record.session.sessionManager?.getEntries?.() ?? [];
					const summary = entries
						.filter((e: any) => e.type === "message")
						.map((e: any) => {
							const role = e.message?.role;
							const content = Array.isArray(e.message?.content)
								? e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
								: "";
							return content ? `[${role}]: ${content.slice(0, 500)}` : "";
						})
						.filter(Boolean)
						.join("\n\n");
					if (summary) lines.push("\n--- Conversation ---\n", summary);
				} catch {}
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
				record.session.queueSteering?.(params.message) ?? record.session.prompt?.(params.message);
				return text(`Steering message queued for agent ${params.agent_id}.`);
			} catch (e) {
				return text(`Failed to steer: ${e instanceof Error ? e.message : e}`);
			}
		},
	});

	// Cleanup completed records on shutdown
	pi.on("session_shutdown", async () => {
		for (const r of records.values()) {
			try { r.abortController?.abort(); } catch {}
		}
		records.clear();
	});
}
