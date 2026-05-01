import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	pi.registerShortcut("ctrl+shift+r", {
		description: "Pre-fill /reload in the editor (press Enter to execute)",
		handler: async (ctx) => {
			ctx.ui.setEditorText("/reload");
		},
	});
}
