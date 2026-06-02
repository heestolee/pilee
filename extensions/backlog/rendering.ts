import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export const BACKLOG_OVERLAY_OPTIONS = { width: "90%", maxHeight: "90%", anchor: "center" } as const;
export const BACKLOG_OVERLAY_BG = "\u001b[48;2;37;41;45m";
export const BACKLOG_OVERLAY_HEIGHT_RATIO = 0.9;

const ANSI_PATTERN = /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export function backlogOverlayHeight(terminalRows: number | undefined, fallbackRows = 24): number {
	const rows = Number.isFinite(terminalRows) && terminalRows && terminalRows > 0
		? Math.floor(terminalRows)
		: fallbackRows;
	return Math.max(1, Math.floor(rows * BACKLOG_OVERLAY_HEIGHT_RATIO));
}

export function backlogInlineText(text: string): string {
	return text
		.replace(ANSI_PATTERN, "")
		.replace(/[\r\n\t]+/g, " ")
		.replace(CONTROL_PATTERN, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function backlogNotePreview(note: string, width = 30): string {
	return backlogInlineText(truncateToWidth(backlogInlineText(note), width, ""));
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
	const painted = options.background
		? clipped.replace(/\u001b\[0m/g, `\u001b[0m${options.background}`).replace(/\u001b\[49m/g, `\u001b[49m${options.background}`)
		: clipped;
	const paddingPrefix = painted ? options.background ?? "" : "";
	return `${prefix}${painted}${paddingPrefix}${padding}`;
}

export function fillBacklogOverlayLines(lines: string[], width: number, height: number, renderToken = ""): string[] {
	const targetHeight = Math.max(1, height);
	const rowOptions = renderToken ? { renderToken, background: BACKLOG_OVERLAY_BG } : undefined;
	const filled = lines.slice(0, targetHeight).map((line) => backlogOverlayRow(line, width, rowOptions));
	while (filled.length < targetHeight) filled.push(backlogOverlayRow("", width, rowOptions));
	return filled;
}
