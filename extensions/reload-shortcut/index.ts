import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerShortcut("ctrl+shift+r", {
		description: "Reload extensions, skills, prompts, and themes",
		handler: async (ctx) => {
			const anyCtx = ctx as any;
			// Try direct reload (if runtime ctx supports it)
			if (typeof anyCtx.reload === "function") {
				try {
					ctx.ui.notify("Reloading…", "info");
					await anyCtx.reload();
					ctx.ui.notify("✓ Reloaded", "info");
					return;
				} catch (e) {
					ctx.ui.notify(`Reload failed: ${e instanceof Error ? e.message : e}`, "error");
					return;
				}
			}
			// Fallback: pre-fill /reload in editor — user just presses Enter
			ctx.ui.setEditorText("/reload");
			ctx.ui.notify("Press Enter to reload", "info");
		},
	});
}
