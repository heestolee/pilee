import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SPINNER_INTERVAL_MS = 150;

function getSpinnerFrames(): string[] {
	return [
		"🔥",
		" 🔥",
		"  🔥",
		" 🔥",
		"🔥",
		"🔥🔥",
		"🔥🔥🔥",
		"🔥🔥",
		"🔥",
	];
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		ctx.ui.setWorkingIndicator({
			frames: getSpinnerFrames(),
			intervalMs: SPINNER_INTERVAL_MS,
		});
	});
}
