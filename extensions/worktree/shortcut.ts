import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

type OpenWorktreeDashboard = (ctx: ExtensionCommandContext) => Promise<void> | void;

export function registerWorktreeDashboardShortcut(pi: ExtensionAPI, openDashboard: OpenWorktreeDashboard): void {
	pi.registerShortcut("ctrl+w", {
		description: "Worktree dashboard",
		handler: async (ctx) => {
			await openDashboard(ctx);
		},
	});
}
