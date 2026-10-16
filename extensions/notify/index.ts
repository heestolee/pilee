import { spawn } from "node:child_process";
import type { AgentActivityOutcome, AgentEndEvent, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

const WIDGET_BG = "\x1b[48;2;130;130;130m";
const WIDGET_RESET = "\x1b[49m";

function isStaleCtxError(err: unknown): boolean {
	return String((err as Error)?.message ?? err).includes("ctx is stale");
}

function showNotifyWidget(ctx: ExtensionContext, message: string, status: string) {
	try {
		if (!ctx.hasUI) return;
		ctx.ui.setWidget("notify-bar", (_tui, theme) => ({
		invalidate() {},
		render(width: number): string[] {
			const content = `  ${theme.fg("text", "🔔")} ${theme.fg("accent", status)} ${theme.fg("text", `— ${message}`)}`;
			const truncated = truncateToWidth(content, width);
			const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
			return [`${WIDGET_BG}${truncated}${pad}${WIDGET_RESET}`];
		},
		}));
	} catch (err) {
		if (!isStaleCtxError(err)) throw err;
	}
}

function clearNotifyWidget(ctx: ExtensionContext) {
	try {
		if (ctx.hasUI) ctx.ui.setWidget("notify-bar", undefined);
	} catch (err) {
		if (!isStaleCtxError(err)) throw err;
	}
}

function extractSummary(messages: AgentEndEvent["messages"]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role !== "assistant") continue;
		const textBlock = msg.content.find((c) => c.type === "text" && c.text.trim());
		if (textBlock?.type !== "text") continue;
		const firstLine = textBlock.text.trim().split("\n")[0].replace(/^[#*\-]+\s*/, "");
		if (firstLine.length > 80) return firstLine.slice(0, 77) + "…";
		return firstLine;
	}
	return undefined;
}

function sendNotification(_pi: ExtensionAPI, title: string, message: string) {
	const clean = (s: string) => s.replace(/["'\\`$]/g, "").slice(0, 200);
	const child = spawn("/opt/homebrew/bin/terminal-notifier", [
		"-title", clean(title),
		"-message", clean(message),
		"-sound", "default",
	], { detached: true, stdio: "ignore" });
	child.unref();
}

export default function (pi: ExtensionAPI, notify = sendNotification) {
	let enabled = true;
	let sessionTitle = "";
	let summary: string | undefined;
	let outcome: AgentActivityOutcome | undefined;
	let pending = false;
	pi.on("session_start", async () => {
		sessionTitle = pi.getSessionName?.() ?? "pi";
		summary = undefined;
		outcome = undefined;
		pending = false;
	});

	pi.on("agent_end", async (event) => {
		summary = extractSummary(event.messages);
		const lastAssistant = event.messages.findLast((message) => message.role === "assistant");
		outcome = lastAssistant?.role === "assistant" && lastAssistant.stopReason === "error" ? "error"
			: lastAssistant?.role === "assistant" && lastAssistant.stopReason === "aborted" ? "aborted" : "completed";
		pending = true;
	});
	pi.on("agent_before_settle", async (event) => {
		outcome = event.outcome;
	});
	pi.on("agent_settled", async (event, ctx) => {
		if (!pending) return;
		pending = false;
		try {
			if (!enabled || !ctx.hasUI) return;
		} catch (err) {
			if (isStaleCtxError(err)) return;
			throw err;
		}
		const text = summary ?? pi.getSessionName?.() ?? sessionTitle ?? "pi";
		const status = event.aborted || outcome === "aborted" ? "작업 중단" : outcome === "error" ? "작업 실패" : "작업 완료";
		notify(pi, "pilee", `${status} — ${text}`);
		showNotifyWidget(ctx, text, status);
	});

	pi.on("agent_start", async (_e, ctx) => {
		summary = undefined;
		outcome = undefined;
		pending = false;
		clearNotifyWidget(ctx);
	});

	pi.on("input", async (_e, ctx) => {
		clearNotifyWidget(ctx);
	});

	pi.on("session_shutdown", async () => {
		pending = false;
		summary = undefined;
		outcome = undefined;
	});

	pi.registerCommand("notify", {
		description: "Enable completion notifications for this session. /notify off to disable.",
		handler: async (args, ctx) => {
			const sub = args.trim().toLowerCase();
			if (sub === "off" || sub === "disable") {
				enabled = false;
				clearNotifyWidget(ctx);
				ctx.ui.notify("알림 비활성화됨", "info");
				return;
			}
			if (sub === "status") {
				ctx.ui.notify(`알림: ${enabled ? "활성" : "비활성"}`, "info");
				return;
			}
			enabled = true;
			ctx.ui.notify("알림 활성화됨 — 에이전트 작업 끝나면 macOS 알림이 표시됩니다. /notify off로 끔.", "info");
			notify(pi, "pilee", "알림 테스트 — 이 알림이 보이면 정상입니다!");
		},
	});
}
