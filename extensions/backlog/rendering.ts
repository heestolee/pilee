import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export const BACKLOG_OVERLAY_OPTIONS = { width: "100%", maxHeight: "100%", anchor: "top-left" } as const;

export function backlogOverlayHeight(terminalRows: number | undefined, fallbackRows = 24): number {
	const rows = Number.isFinite(terminalRows) && terminalRows && terminalRows > 0
		? Math.floor(terminalRows)
		: fallbackRows;
	return Math.max(1, rows);
}

export function backlogOverlayRenderToken(renderSeq: number): string {
	return renderSeq % 2 === 0 ? "\u001b[0m" : "\u001b[39m\u001b[49m";
}

export function backlogOverlayRow(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

export function fillBacklogOverlayLines(lines: string[], width: number, height: number, renderToken = ""): string[] {
	const targetHeight = Math.max(1, height);
	const withToken = (line: string) => `${line}${renderToken}`;
	const filled = lines.slice(0, targetHeight).map((line) => withToken(backlogOverlayRow(line, width)));
	while (filled.length < targetHeight) filled.push(withToken(" ".repeat(Math.max(0, width))));
	return filled;
}
