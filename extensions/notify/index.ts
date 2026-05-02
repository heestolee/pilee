import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

let enabled = true;
let sessionTitle = "";

async function sendNotification(pi: ExtensionAPI, title: string, message: string) {
	const escaped = message.replace(/"/g, '\\"').slice(0, 200);
	const titleEscaped = title.replace(/"/g, '\\"');
	await pi.exec("osascript", [
		"-e",
		`display notification "${escaped}" with title "${titleEscaped}" sound name "Glass"`,
	]);
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_e, ctx) => {
		sessionTitle = pi.getSessionName?.() ?? "pi";
	});

	pi.on("agent_end", async (_e, ctx) => {
		if (!enabled || !ctx.hasUI) return;
		const name = pi.getSessionName?.() ?? sessionTitle ?? "pi";
		await sendNotification(pi, "pilee", `작업 완료 — ${name}`);
	});

	pi.registerCommand("notify", {
		description: "Enable completion notifications for this session. /notify off to disable.",
		handler: async (args, ctx) => {
			const sub = args.trim().toLowerCase();
			if (sub === "off" || sub === "disable") {
				enabled = false;
				ctx.ui.notify("알림 비활성화됨", "info");
				return;
			}
			if (sub === "status") {
				ctx.ui.notify(`알림: ${enabled ? "활성" : "비활성"}`, "info");
				return;
			}
			enabled = true;
			ctx.ui.notify("알림 활성화됨 — 에이전트 작업 끝나면 macOS 알림이 표시됩니다. /notify off로 끔.", "info");

			// Test notification
			await sendNotification(pi, "pilee", "알림 테스트 — 이 알림이 보이면 정상입니다!");
		},
	});
}
