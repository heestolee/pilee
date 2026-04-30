import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SPINNER_INTERVAL_MS = 120;

function getSpinnerFrames(): string[] {
	const term = process.env.TERM;
	const chars =
		term === "xterm-ghostty"
			? ["·", "✢", "✳", "✶", "✻", "*"]
			: process.platform === "darwin"
				? ["·", "✢", "✳", "✶", "✻", "✽"]
				: ["·", "✢", "*", "✶", "✻", "✽"];
	return [...chars, ...chars.reverse()];
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWorkingIndicator({
			frames: getSpinnerFrames().map((f) => ctx.ui.theme.fg("accent", f)),
			intervalMs: SPINNER_INTERVAL_MS,
		});
	});
}
