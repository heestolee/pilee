import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export const BACKLOG_OVERLAY_OPTIONS = { width: "100%", maxHeight: "100%", anchor: "top-left" } as const;
export const BACKLOG_OVERLAY_BG = "\u001b[48;2;37;41;45m";

export function backlogOverlayHeight(terminalRows: number | undefined, fallbackRows = 24): number {
	const rows = Number.isFinite(terminalRows) && terminalRows && terminalRows > 0
		? Math.floor(terminalRows)
		: fallbackRows;
	return Math.max(1, rows);
}

export function backlogOverlayRenderToken(renderSeq: number): string {
	return renderSeq % 2 === 0 ? "\u001b[0m" : "\u001b[39m\u001b[49m";
}

interface BacklogOverlayRowOptions {
	renderToken?: string;
	background?: string;
}

export function backlogOverlayRow(text: string, width: number, options: BacklogOverlayRowOptions = {}): string {
	const clipped = truncateToWidth(text, width, "");
	const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
	if (!options.renderToken && !options.background) return `${clipped}${padding}`;

	const prefix = `${options.renderToken ?? ""}${options.background ?? ""}`;
	const paddingPrefix = clipped ? options.background ?? "" : "";
	return `${prefix}${clipped}${paddingPrefix}${padding}`;
}

export function fillBacklogOverlayLines(lines: string[], width: number, height: number, renderToken = ""): string[] {
	const targetHeight = Math.max(1, height);
	const rowOptions = renderToken ? { renderToken, background: BACKLOG_OVERLAY_BG } : undefined;
	const filled = lines.slice(0, targetHeight).map((line) => backlogOverlayRow(line, width, rowOptions));
	while (filled.length < targetHeight) filled.push(backlogOverlayRow("", width, rowOptions));
	return filled;
}
