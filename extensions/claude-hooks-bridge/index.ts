import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type Json = Record<string, unknown>;
type HookEvent = "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PostToolUse" | "Stop";
interface HookDef { type?: string; command?: string; timeout?: number }
interface HookGroup { matcher?: string; hooks?: HookDef[] }
interface Settings { hooks?: Record<string, HookGroup[]> }
interface ExecResult { command: string; code: number; stdout: string; stderr: string; timedOut: boolean; json: unknown }

const SETTINGS_PATH = path.join(".claude", "settings.json");
const TRANSCRIPT_DIR = path.join(os.tmpdir(), "pi-claude-hooks-bridge");
const TIMEOUT_MS = 600_000;
const TOOL_ALIASES: Record<string, string> = { bash: "Bash", read: "Read", edit: "Edit", write: "Write" };

let settingsCache: { mtimeMs: number; settings: Settings | null } | null = null;
let sessionId = "";
let stopActive = false;
let parseErrorNotified = false;

function loadSettings(cwd: string): { settings: Settings | null; parseError?: string } {
	const p = path.join(cwd, SETTINGS_PATH);
	if (!existsSync(p)) return { settings: null };
	try {
		const mtime = statSync(p).mtimeMs;
		if (settingsCache?.mtimeMs === mtime) return { settings: settingsCache.settings };
		const s = JSON.parse(readFileSync(p, "utf8")) as Settings;
		settingsCache = { mtimeMs: mtime, settings: s };
		return { settings: s };
	} catch (e) {
		return { settings: null, parseError: `.claude/settings.json parse error: ${e instanceof Error ? e.message : e}` };
	}
}

function getHooks(settings: Settings | null, event: HookEvent, toolName?: string): HookDef[] {
	const groups = settings?.hooks?.[event];
	if (!Array.isArray(groups)) return [];
	const results: HookDef[] = [];
	for (const g of groups) {
		if (toolName && g.matcher && g.matcher !== "*") {
			const alias = TOOL_ALIASES[toolName] ?? toolName;
			const candidates = [toolName, toolName.toLowerCase(), alias, alias.toLowerCase()];
			try {
				const re = new RegExp(`^(?:${g.matcher})$`);
				if (!candidates.some((c) => re.test(c))) continue;
			} catch {
				const tokens = g.matcher.split("|").map((t) => t.trim().toLowerCase());
				if (!candidates.some((c) => tokens.includes(c.toLowerCase()))) continue;
			}
		}
		for (const h of g.hooks ?? []) {
			if (h?.type === "command" && typeof h.command === "string" && h.command.trim()) results.push(h);
		}
	}
	return results;
}

function execHook(command: string, cwd: string, payload: Json, timeoutMs: number): Promise<ExecResult> {
	return new Promise((resolve) => {
		const child = spawn("bash", ["-lc", command], { cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: cwd, PWD: cwd }, stdio: ["pipe", "pipe", "pipe"] });
		let stdout = "", stderr = "", done = false, timedOut = false;
		const finish = (code: number) => {
			if (done) return;
			done = true;
			let json: unknown = null;
			try { json = JSON.parse(stdout.trim()); } catch {}
			resolve({ command, code, stdout, stderr, timedOut, json });
		};
		const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); setTimeout(() => child.kill("SIGKILL"), 1000); }, timeoutMs);
		child.stdout.on("data", (c) => { stdout += c; });
		child.stderr.on("data", (c) => { stderr += c; });
		child.on("error", (e) => { clearTimeout(timer); stderr += `\n${e.message}`; finish(1); });
		child.on("close", (code) => { clearTimeout(timer); finish(code ?? 1); });
		try { child.stdin.write(`${JSON.stringify(payload)}\n`); child.stdin.end(); } catch { finish(1); }
	});
}

async function runHooks(settings: Settings | null, event: HookEvent, cwd: string, payload: Json, toolName?: string): Promise<ExecResult[]> {
	const results: ExecResult[] = [];
	for (const h of getHooks(settings, event, toolName)) {
		results.push(await execHook(h.command!, cwd, payload, (h.timeout ?? 0) > 0 ? h.timeout! * 1000 : TIMEOUT_MS));
	}
	return results;
}

function basePayload(event: string, ctx: ExtensionContext): Json {
	return { hook_event_name: event, session_id: sessionId, cwd: ctx.cwd };
}

function extractDecision(r: ExecResult): { action: string; reason?: string } {
	const obj = r.json && typeof r.json === "object" ? (r.json as Json) : undefined;
	const dec = (typeof obj?.decision === "string" ? obj.decision : typeof obj?.permissionDecision === "string" ? obj.permissionDecision : "").toLowerCase();
	const reason = typeof obj?.reason === "string" ? obj.reason : typeof obj?.permissionDecisionReason === "string" ? obj.permissionDecisionReason : r.stderr.trim() || undefined;
	if (dec === "allow") return { action: "allow", reason };
	if (dec === "ask") return { action: "ask", reason };
	if (dec === "deny" || dec === "block") return { action: "block", reason };
	if (r.code === 2) return { action: "block", reason: reason || "Hook exit code 2" };
	return { action: "none", reason };
}

function normalizeInput(toolName: string, raw: unknown, cwd: string): Json {
	const input = raw && typeof raw === "object" ? { ...(raw as Json) } : {};
	const p = typeof input.path === "string" ? input.path : typeof input.filePath === "string" ? input.filePath : undefined;
	if (p) { const abs = path.isAbsolute(p) ? p : path.resolve(cwd, p); input.path = abs; input.file_path = abs; input.filePath = abs; }
	return input;
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (event, ctx) => {
		sessionId = ctx.sessionManager.getSessionId?.() ?? "unknown";
		stopActive = false;
		parseErrorNotified = false;
		if (event.reason === "resume" || event.reason === "fork") return;
		const { settings, parseError } = loadSettings(ctx.cwd);
		if (parseError && ctx.hasUI && !parseErrorNotified) { ctx.ui.notify(`[hooks] ${parseError}`, "warning"); parseErrorNotified = true; }
		for (const r of await runHooks(settings, "SessionStart", ctx.cwd, basePayload("SessionStart", ctx))) {
			if (ctx.hasUI && r.stdout.trim()) ctx.ui.notify(r.stdout.trim().slice(0, 1200), "info");
		}
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const { settings } = loadSettings(ctx.cwd);
		await runHooks(settings, "UserPromptSubmit", ctx.cwd, { ...basePayload("UserPromptSubmit", ctx), prompt: event.prompt });
	});

	pi.on("tool_call", async (event, ctx) => {
		const { settings } = loadSettings(ctx.cwd);
		for (const r of await runHooks(settings, "PreToolUse", ctx.cwd, {
			...basePayload("PreToolUse", ctx),
			tool_name: TOOL_ALIASES[event.toolName] ?? event.toolName,
			tool_input: normalizeInput(event.toolName, event.input, ctx.cwd),
			tool_use_id: event.toolCallId,
		}, event.toolName)) {
			const d = extractDecision(r);
			if (d.action === "ask") {
				if (!ctx.hasUI) return { block: true, reason: `Blocked (no UI): ${d.reason ?? "Hook requested permission"}` };
				if (!(await ctx.ui.confirm("Claude hook permission", d.reason ?? "Hook requested permission"))) return { block: true, reason: d.reason ?? "Blocked by user" };
			}
			if (d.action === "block") return { block: true, reason: d.reason ?? "Blocked by PreToolUse hook" };
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		const { settings } = loadSettings(ctx.cwd);
		await runHooks(settings, "PostToolUse", ctx.cwd, {
			...basePayload("PostToolUse", ctx),
			tool_name: TOOL_ALIASES[event.toolName] ?? event.toolName,
			tool_input: normalizeInput(event.toolName, event.input, ctx.cwd),
			tool_response: { is_error: Boolean(event.isError), content: event.content, details: event.details },
			tool_use_id: event.toolCallId,
		}, event.toolName);
	});

	pi.on("agent_end", async (_event, ctx) => {
		const { settings } = loadSettings(ctx.cwd);
		const payload: Json = { ...basePayload("Stop", ctx), stop_hook_active: stopActive };
		try {
			const entries = ctx.sessionManager.getEntries();
			for (let i = entries.length - 1; i >= 0; i--) {
				const e = entries[i] as any;
				if (e?.type === "message" && e.message?.role === "assistant") {
					const text = Array.isArray(e.message.content) ? e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("") : "";
					if (text) { payload.last_assistant_message = text; break; }
				}
			}
			mkdirSync(TRANSCRIPT_DIR, { recursive: true });
			const file = path.join(TRANSCRIPT_DIR, `${sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.jsonl`);
			writeFileSync(file, "", "utf8");
			payload.transcript_path = file;
		} catch {}

		for (const r of await runHooks(settings, "Stop", ctx.cwd, payload)) {
			const d = extractDecision(r);
			if (d.action === "block") {
				if (!stopActive) {
					stopActive = true;
					pi.sendUserMessage(d.reason || "Stop hook blocked completion.", { deliverAs: "followUp" });
					if (ctx.hasUI) ctx.ui.notify("[hooks] Stop hook blocked end", "info");
					return;
				}
				stopActive = false;
				if (ctx.hasUI) ctx.ui.notify(`[hooks] Stop hook blocked again (loop guard)`, "warning");
			}
		}
		stopActive = false;
	});

	pi.on("session_shutdown", async () => {
		sessionId = "";
		stopActive = false;
		settingsCache = null;
		parseErrorNotified = false;
	});
}
