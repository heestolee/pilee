import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

type ToggleCompanion = (ctx: ExtensionCommandContext) => Promise<void> | void;

export function registerCompanionToggleShortcut(pi: ExtensionAPI, toggleCompanion: ToggleCompanion): void {
	pi.registerShortcut("ctrl+shift+g", {
		description: "현재 Pi 패널의 WebView companion 토글",
		handler: async (ctx) => {
			await toggleCompanion(ctx);
		},
	});
}
