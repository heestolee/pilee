import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { completeSimple } from "@mariozechner/pi-ai";
import { Type } from "typebox";

interface SupervisorState {
	active: boolean;
	outcome: string;
	provider: string;
	modelId: string;
	sensitivity: "low" | "medium" | "high";
	interventions: { turnCount: number; message: string; reasoning: string; timestamp: number }[];
	turnCount: number;
	startedAt: number;
}

const SYSTEM_PROMPT = `You are a supervisor monitoring an AI coding agent's work toward a specific outcome.

Analyze the recent conversation and decide:
1. "continue" — agent is on track, no intervention needed
2. "steer" — agent is drifting, provide a corrective message
3. "done" — the outcome has been achieved

Respond in JSON only:
{"action":"continue"|"steer"|"done","message":"<steering message if steer>","reasoning":"<brief explanation>","confidence":0.0-1.0}`;

const DEFAULT_PROVIDER = "anthropic";
const DEFAULT_MODEL = "claude-haiku-4-5-20251001";
const MAX_IDLE_STEERS = 5;
const WIDGET_ID = "supervisor";

function text(msg: string) {
	return { content: [{ type: "text" as const, text: msg }], details: {} };
}

function truncate(s: string, max: number) {
	return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export default function (pi: ExtensionAPI) {
	let state: SupervisorState | null = null;
	let ctx: ExtensionContext | undefined;
	let idleSteers = 0;

	function buildSnapshot(c: ExtensionContext, limit: number): string {
		try {
			const entries = c.sessionManager.getEntries();
			const messages: string[] = [];
			for (let i = Math.max(0, entries.length - limit); i < entries.length; i++) {
				const e = entries[i] as any;
				if (e?.type !== "message") continue;
				const role = e.message?.role;
				const content = Array.isArray(e.message?.content)
					? e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("")
					: "";
				if (content && (role === "user" || role === "assistant")) {
					messages.push(`[${role}]: ${content.slice(0, 500)}`);
				}
			}
			return messages.join("\n\n");
		} catch { return "(no conversation snapshot)"; }
	}

	async function analyze(c: ExtensionContext, s: SupervisorState, agentIdle: boolean): Promise<{ action: string; message?: string; reasoning: string; confidence: number }> {
		const limit = s.sensitivity === "high" ? 20 : s.sensitivity === "medium" ? 12 : 8;
		const snapshot = buildSnapshot(c, limit);
		const userPrompt = `Outcome: "${s.outcome}"\nAgent is ${agentIdle ? "idle (finished its turn)" : "working"}.\nTurn count: ${s.turnCount}\nPrevious steers: ${s.interventions.length}\n\nRecent conversation:\n${snapshot}`;

		const auth = await c.modelRegistry?.getApiKeyAndHeaders({ provider: s.provider, id: s.modelId } as any).catch(() => undefined);
		if (!auth?.ok) return { action: "continue", reasoning: "Auth not available", confidence: 0 };

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15000);
		const result = await completeSimple(
			{ provider: s.provider, id: s.modelId } as any,
			{ systemPrompt: SYSTEM_PROMPT, messages: [{ role: "user", content: [{ type: "text", text: userPrompt }], timestamp: Date.now() }] },
			{ apiKey: auth.apiKey, headers: auth.headers, signal: controller.signal, maxTokens: 300 },
		).catch(() => undefined);
		clearTimeout(timeout);

		if (!result) return { action: "continue", reasoning: "Model call failed", confidence: 0 };
		const raw = result.content.filter((c): c is { type: "text"; text: string } => c.type === "text").map((c) => c.text).join("");
		try {
			return JSON.parse(raw.replace(/```json\n?|```/g, "").trim());
		} catch {
			return { action: "continue", reasoning: `Parse error: ${raw.slice(0, 100)}`, confidence: 0 };
		}
	}

	function updateUI(c: ExtensionContext, label?: string) {
		if (!c.hasUI) return;
		if (!state?.active) {
			c.ui.setWidget(WIDGET_ID, undefined);
			c.ui.setStatus("supervisor", undefined);
			return;
		}
		const steers = state.interventions.length;
		c.ui.setWidget(WIDGET_ID, (_tui, theme) => {
			const header = `${theme.fg("accent", "◉")} ${theme.fg("accent", "Supervising")}`;
			const goal = `${theme.fg("dim", "Goal:")} ${theme.fg("muted", `"${truncate(state!.outcome, 48)}"`)}`
			const info = [theme.fg("dim", state!.modelId), steers > 0 ? theme.fg("dim", `↗ ${steers}`) : "", label ? theme.fg("muted", label) : ""].filter(Boolean).join(" · ");
			return { render: () => [`${header} ${goal} ${info}`], invalidate() {}, handleInput() {} };
		});
	}

	// Tool: start_supervision
	pi.registerTool({
		name: "start_supervision",
		label: "Start Supervision",
		description: "Activate the supervisor to track the conversation toward a specific outcome. The supervisor will observe every turn and steer the agent if it drifts. Once supervision is active it is locked — only the user can change or stop it.",
		parameters: Type.Object({
			outcome: Type.String({ description: "The desired end-state to supervise toward. Be specific and measurable (e.g. 'Implement JWT auth with refresh tokens and full test coverage')." }),
			sensitivity: Type.Optional(Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")], { description: "How aggressively to steer. low = only when seriously off track, medium = on mild drift (default), high = proactively + mid-turn checks." })),
			model: Type.Optional(Type.String({ description: "Supervisor model as 'provider/modelId' (e.g. 'anthropic/claude-haiku-4-5-20251001'). Defaults to workspace config, then the active chat model." })),
		}),
		async execute(_id, params, _signal, _onUpdate, c) {
			if (state?.active) {
				return text(`Supervision is already active and cannot be changed by the model.\nActive outcome: "${state.outcome}"\nOnly the user can stop or modify supervision via /supervise.`);
			}
			const sensitivity = params.sensitivity ?? "medium";
			let provider = DEFAULT_PROVIDER;
			let modelId = DEFAULT_MODEL;
			if (params.model) {
				const slash = params.model.indexOf("/");
				provider = slash === -1 ? DEFAULT_PROVIDER : params.model.slice(0, slash);
				modelId = slash === -1 ? params.model : params.model.slice(slash + 1);
			} else if (c.model) {
				provider = c.model.provider ?? DEFAULT_PROVIDER;
				modelId = c.model.id ?? DEFAULT_MODEL;
			}
			state = { active: true, outcome: params.outcome, provider, modelId, sensitivity, interventions: [], turnCount: 0, startedAt: Date.now() };
			idleSteers = 0;
			ctx = c;
			updateUI(c);
			if (c.hasUI) c.ui.notify(`Supervisor started: "${truncate(params.outcome, 60)}" | ${provider}/${modelId} | ${sensitivity}`, "info");
			return text(`Supervision active. Outcome: "${params.outcome}" | ${provider}/${modelId} | sensitivity: ${sensitivity}`);
		},
	});

	// Events
	pi.on("turn_end", async (_event, c) => {
		ctx = c;
		if (!state?.active || state.sensitivity === "low") return;
		if (state.turnCount < 2) return;
		if (state.sensitivity === "medium" && (state.turnCount - 2) % 3 !== 0) return;
		try {
			const decision = await analyze(c, state, false);
			if (decision.action === "steer" && decision.message && decision.confidence >= 0.9) {
				state.interventions.push({ turnCount: state.turnCount, message: decision.message, reasoning: decision.reasoning, timestamp: Date.now() });
				updateUI(c, `steering: ${truncate(decision.message, 50)}`);
				pi.sendUserMessage(decision.message, { deliverAs: "steer" });
			}
		} catch {}
	});

	pi.on("agent_end", async (_event, c) => {
		ctx = c;
		if (!state?.active) return;
		state.turnCount++;
		const stagnating = idleSteers >= MAX_IDLE_STEERS;
		updateUI(c, "analyzing...");
		const decision = await analyze(c, state, true);
		if (decision.action === "steer" && decision.message) {
			idleSteers++;
			state.interventions.push({ turnCount: state.turnCount, message: decision.message, reasoning: decision.reasoning, timestamp: Date.now() });
			updateUI(c, `steering: ${truncate(decision.message, 50)}`);
			setTimeout(() => { try { pi.sendUserMessage(decision.message!); } catch {} }, 0);
		} else if (decision.action === "done") {
			idleSteers = 0;
			const suffix = stagnating ? ` (stopped after ${MAX_IDLE_STEERS} steers)` : "";
			if (c.hasUI) c.ui.notify(`Supervisor: outcome achieved! "${state.outcome}"${suffix}`, "info");
			state.active = false;
			updateUI(c);
		} else {
			updateUI(c, "watching");
		}
	});

	// /supervise command
	pi.registerCommand("supervise", {
		description: "Supervise the chat toward a desired outcome (/supervise <outcome>, /supervise stop, /supervise status)",
		handler: async (args, c) => {
			ctx = c;
			const sub = args.trim();
			if (sub === "stop") {
				if (!state?.active) { c.ui.notify("Supervisor is not active.", "warning"); return; }
				state.active = false;
				idleSteers = 0;
				updateUI(c);
				c.ui.notify("Supervisor stopped.", "info");
			} else if (sub === "status") {
				if (!state?.active) { c.ui.notify("Supervisor is not active.", "info"); return; }
				c.ui.notify(`Supervising: "${state.outcome}" | ${state.provider}/${state.modelId} | ${state.sensitivity} | turns: ${state.turnCount} | steers: ${state.interventions.length}`, "info");
			} else if (sub) {
				state = { active: true, outcome: sub, provider: ctx?.model?.provider ?? DEFAULT_PROVIDER, modelId: ctx?.model?.id ?? DEFAULT_MODEL, sensitivity: "medium", interventions: [], turnCount: 0, startedAt: Date.now() };
				idleSteers = 0;
				updateUI(c);
				c.ui.notify(`Supervisor started: "${truncate(sub, 60)}"`, "info");
			} else {
				c.ui.notify("Usage: /supervise <outcome> | /supervise stop | /supervise status", "info");
			}
		},
	});

	pi.on("session_start", async (_e, c) => { ctx = c; state = null; });
	pi.on("session_shutdown", async () => { state = null; });
}
