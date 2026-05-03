import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";


let enabled = true;
let sessionTitle = "";

function showNotifyStatus(ctx: ExtensionContext) {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus("notify", `🔔 ${ctx.ui.theme.fg("accent", "작업 완료")}`);
}

function clearNotifyStatus(ctx: ExtensionContext) {
	if (ctx.hasUI) ctx.ui.setStatus("notify", undefined);
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
	const clean = (s: string) => s.replace(/["'\\`$]/g, "").slice(0, 200);
	const { spawn } = require("child_process");
	const child = spawn("/opt/homebrew/bin/terminal-notifier", [
		"-title", clean(title),
		"-message", clean(message),
		"-sound", "default",
	], { detached: true, stdio: "ignore" });
	child.unref();
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
		showNotifyStatus(ctx);
	});

	pi.on("agent_start", async (_e, ctx) => {
		clearNotifyStatus(ctx);
	});

	pi.on("input", async (_e, ctx) => {
		clearNotifyStatus(ctx);
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
