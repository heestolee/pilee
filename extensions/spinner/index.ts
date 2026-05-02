import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SPINNER_INTERVAL_MS = 150;

function getSpinnerFrames(accent: (s: string) => string): string[] {
	return [
		accent("·"),
		accent("✦"),
		"🔥",
		accent("✦"),
		accent("·"),
	];
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWorkingIndicator({
			frames: getSpinnerFrames((s) => ctx.ui.theme.fg("accent", s)),
			intervalMs: SPINNER_INTERVAL_MS,
		});
	});
}
