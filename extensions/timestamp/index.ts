import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

const STATUS_KEY = "timestamp";

function formatTime(date: Date): string {
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export default function (pi: ExtensionAPI) {
	let enabled = false;

	function update(ctx: ExtensionContext, label?: string) {
		if (!enabled || !ctx.hasUI) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(STATUS_KEY, label ?? `🕐 ${formatTime(new Date())}`);
	}

	pi.on("message_start", async (event, ctx) => {
		if (!enabled) return;
		const role = (event.message as any)?.role;
		const time = formatTime(new Date());
		if (role === "user") {
			update(ctx, `🕐 user ${time}`);
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (!enabled) return;
		const role = (event.message as any)?.role;
		const time = formatTime(new Date());
		if (role === "assistant") {
			update(ctx, `🕐 assistant ${time}`);
		}
	});

	pi.registerCommand("timestamp", {
		description: "Toggle message timestamp display on/off",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			if (enabled) {
				update(ctx, `🕐 ${formatTime(new Date())} — on`);
				ctx.ui.notify("Timestamp ON", "info");
			} else {
				ctx.ui.setStatus(STATUS_KEY, undefined);
				ctx.ui.notify("Timestamp OFF", "info");
			}
		},
	});

	pi.registerShortcut("ctrl+alt+t", {
		description: "Toggle timestamp display",
		handler: async (ctx) => {
			enabled = !enabled;
			if (enabled) {
				update(ctx, `🕐 ${formatTime(new Date())} — on`);
			} else {
				ctx.ui.setStatus(STATUS_KEY, undefined);
			}
		},
	});
}
