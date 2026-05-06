export function getForkPanelLabel(env: Record<string, string | undefined> = process.env): string {
	return env.PI_FORK_PANEL_LABEL?.trim() || "P0";
}
