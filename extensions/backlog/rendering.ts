import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export function backlogOverlayRow(text: string, width: number): string {
	const clipped = truncateToWidth(text, width, "");
	return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

export function fillBacklogOverlayLines(lines: string[], width: number, height: number): string[] {
	const targetHeight = Math.max(1, height);
	const filled = lines.slice(0, targetHeight).map((line) => backlogOverlayRow(line, width));
	while (filled.length < targetHeight) filled.push(" ".repeat(Math.max(0, width)));
	return filled;
}
