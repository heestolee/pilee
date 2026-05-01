import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerShortcut("ctrl+shift+r", {
		description: "Reload extensions, skills, prompts, and themes",
		handler: async (ctx) => {
			try {
				ctx.ui.notify("Reloading…", "info");
				await ctx.reload();
				ctx.ui.notify("✓ Reloaded", "info");
			} catch (e) {
				ctx.ui.notify(`Reload failed: ${e instanceof Error ? e.message : e}`, "error");
			}
		},
	});
}
