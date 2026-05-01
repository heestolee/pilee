import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerShortcut("ctrl+shift+r", {
		description: "Reload extensions, skills, prompts, and themes",
		handler: async (ctx) => {
			const anyCtx = ctx as any;
			// Debug: dump available methods/props
			const methods = Object.keys(anyCtx).filter((k) => typeof anyCtx[k] === "function");
			const props = Object.keys(anyCtx).filter((k) => typeof anyCtx[k] !== "function");
			ctx.ui.notify(
				`ctx methods: ${methods.join(", ")}\nctx props: ${props.join(", ")}`,
				"info",
			);

			// Try every plausible reload-ish method
			for (const name of ["reload", "_reload", "runtimeReload"]) {
				if (typeof anyCtx[name] === "function") {
					try {
						ctx.ui.notify(`Calling ctx.${name}()…`, "info");
						await anyCtx[name]();
						ctx.ui.notify(`✓ ${name} worked`, "info");
						return;
					} catch (e) {
						ctx.ui.notify(`${name} failed: ${e instanceof Error ? e.message : e}`, "error");
					}
				}
			}

			// Fallback
			ctx.ui.setEditorText("/reload");
			ctx.ui.notify("Press Enter to reload (no reload method found on ctx)", "warning");
		},
	});
}
