import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

let enabled = true;
let sessionTitle = "";
let widgetTimer: ReturnType<typeof setTimeout> | null = null;

const WIDGET_BG = "\x1b[48;2;130;130;130m";
const WIDGET_RESET = "\x1b[49m";

function showNotifyWidget(ctx: ExtensionContext, message: string) {
	if (!ctx.hasUI) return;
	if (widgetTimer) clearTimeout(widgetTimer);

	ctx.ui.setWidget("notify-bar", (_tui, theme) => ({
		invalidate() {},
		render(width: number): string[] {
			const content = `  ${theme.fg("text", "🔔")} ${theme.fg("text", message)}`;
			const truncated = truncateToWidth(content, width);
			const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
			return [`${WIDGET_BG}${truncated}${pad}${WIDGET_RESET}`];
		},
	}));
}

function clearNotifyWidget(ctx: ExtensionContext) {
	if (widgetTimer) { clearTimeout(widgetTimer); widgetTimer = null; }
	if (ctx.hasUI) ctx.ui.setWidget("notify-bar", undefined);
}

function extractSummary(messages: any[]): string | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role !== "assistant") continue;
		const textBlock = msg.content?.find((c: any) => c.type === "text" && c.text?.trim());
		if (!textBlock) continue;
		const firstLine = textBlock.text.trim().split("\n")[0].replace(/^[#*\-]+\s*/, "");
		if (firstLine.length > 80) return firstLine.slice(0, 77) + "…";
		return firstLine;
	}
	return undefined;
}

function sendNotification(_pi: ExtensionAPI, title: string, message: string) {
	const clean = (s: string) => s.replace(/[\x07\x1b]/g, "").slice(0, 200);
	process.stdout.write(`\x1b]777;notify;${clean(title)};${clean(message)}\x07`);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_e, ctx) => {
		sessionTitle = pi.getSessionName?.() ?? "pi";
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!enabled || !ctx.hasUI) return;
		const summary = extractSummary(event.messages);
		const text = summary ?? pi.getSessionName?.() ?? sessionTitle ?? "pi";
		sendNotification(pi, "pilee", `작업 완료 — ${text}`);
		showNotifyWidget(ctx, `작업 완료 — ${text}`);
	});

	pi.on("agent_start", async (_e, ctx) => {
		clearNotifyWidget(ctx);
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
			sendNotification(pi, "pilee", "알림 테스트 — 이 알림이 보이면 정상입니다!");
		},
	});
}
