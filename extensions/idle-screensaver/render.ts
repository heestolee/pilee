import type { ThemeColor } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export interface ScreensaverTheme {
	fg: (color: ThemeColor, text: string) => string;
	bold: (text: string) => string;
}

export interface ScreensaverRenderData {
	title: string;
	subtitle: string;
	metaLines: string[];
	assistantText: string | null;
	spriteLines: string[] | null;
	spritePokemonName: string | null;
}

const CONTENT_MAX_WIDTH = 96;
const ASSISTANT_MAX_LINES = 5;

function fitToWidth(text: string, width: number): string {
	return width <= 0 ? "" : truncateToWidth(text, width, "…", false);
}

export function wrapTextToWidth(text: string, width: number, maxLines: number): string[] {
	const normalized = text.replace(/\s+/g, " ").trim();
	if (!normalized || width <= 0 || maxLines <= 0) return [];
	const words = normalized.split(" ");
	const lines: string[] = [];
	let current = "";
	let consumedAll = true;

	for (const word of words) {
		const candidate = current ? `${current} ${word}` : word;
		if (visibleWidth(candidate) <= width) {
			current = candidate;
			continue;
		}
		if (current) {
			lines.push(current);
			current = word;
		} else {
			lines.push(fitToWidth(word, width));
			current = "";
		}
		if (lines.length >= maxLines) {
			consumedAll = false;
			break;
		}
	}

	if (consumedAll && current) lines.push(current);
	if (lines.length > maxLines) {
		lines.length = maxLines;
		consumedAll = false;
	}
	if (!consumedAll || words.join(" ").length > lines.join(" ").length) {
		const lastIndex = Math.min(lines.length, maxLines) - 1;
		if (lastIndex >= 0) lines[lastIndex] = fitToWidth(`${lines[lastIndex]}…`, width);
	}
	return lines.slice(0, maxLines);
}

export function shouldDismissScreensaver(input: string): boolean {
	return input.length > 0;
}

export function renderScreensaver(width: number, height: number, data: ScreensaverRenderData, theme: ScreensaverTheme): string[] {
	const bc = (s: string) => theme.fg("accent", s);
	const safeWidth = Math.max(2, width);
	const hRule = new DynamicBorder(bc).render(safeWidth)[0] ?? bc("─".repeat(safeWidth));
	const L = bc("│");
	const R = bc("│");
	const innerWidth = Math.max(0, safeWidth - 2);
	const contentWidth = Math.max(1, Math.min(CONTENT_MAX_WIDTH, innerWidth));
	const outerLeftPad = Math.max(0, Math.floor((innerWidth - contentWidth) / 2));
	const outerRightPad = Math.max(0, innerWidth - contentWidth - outerLeftPad);

	const boxLine = (text: string, align: "left" | "center" = "left") => {
		const fitted = fitToWidth(text, contentWidth);
		const textWidth = visibleWidth(fitted);
		const leftPad = align === "center" ? Math.max(0, Math.floor((contentWidth - textWidth) / 2)) : 0;
		const rightPad = Math.max(0, contentWidth - textWidth - leftPad);
		return L
			+ " ".repeat(outerLeftPad)
			+ " ".repeat(leftPad)
			+ fitted
			+ " ".repeat(rightPad)
			+ " ".repeat(outerRightPad)
			+ R;
	};
	const emptyLine = () => L + " ".repeat(innerWidth) + R;
	const centerLine = (text: string) => boxLine(text, "center");
	const leftLine = (text: string) => boxLine(text, "left");

	const compact = data.title.trim();
	const spread = compact.length <= 24 ? compact.split("").join(" ") : compact;
	const titleText = spread || "Pi";
	const separatorWidth = Math.min(contentWidth, Math.max(Math.min(visibleWidth(titleText) + 8, contentWidth), Math.min(24, contentWidth)));
	const separator = bc("─".repeat(Math.max(1, separatorWidth)));

	const contentRows: string[] = [];
	if (data.spriteLines) {
		for (const sl of data.spriteLines) contentRows.push(centerLine(sl));
		if (data.spritePokemonName) contentRows.push(centerLine(theme.fg("dim", data.spritePokemonName)));
		contentRows.push(emptyLine());
	}

	contentRows.push(centerLine(separator));
	contentRows.push(centerLine(theme.fg("accent", titleText)));
	contentRows.push(centerLine(separator));

	if (data.subtitle) {
		contentRows.push(emptyLine());
		contentRows.push(centerLine(theme.fg("muted", data.subtitle)));
	}

	if (data.metaLines.length > 0) {
		contentRows.push(emptyLine());
		for (const line of data.metaLines) contentRows.push(line.trim() ? leftLine(theme.fg("muted", line)) : emptyLine());
	}

	if (data.assistantText) {
		contentRows.push(emptyLine());
		contentRows.push(leftLine(theme.fg("muted", "💬 마지막 응답")));
		const wrapped = wrapTextToWidth(data.assistantText, Math.max(1, contentWidth - 2), ASSISTANT_MAX_LINES);
		for (const line of wrapped) contentRows.push(leftLine(theme.fg("muted", `  ${line}`)));
	}

	const availableInnerHeight = Math.max(0, height - 2);
	const footerLine = centerLine(theme.fg("dim", "Esc / q / Enter / Space 또는 아무 키나 누르면 닫힘"));
	const contentLimit = Math.max(0, availableInnerHeight - 1);
	const topPad = Math.max(0, Math.floor((contentLimit - contentRows.length) / 2));
	const innerRows: string[] = [];
	for (let i = 0; i < topPad; i++) innerRows.push(emptyLine());
	innerRows.push(...contentRows.slice(0, contentLimit));
	while (innerRows.length < contentLimit) innerRows.push(emptyLine());
	if (availableInnerHeight > 0) innerRows.push(footerLine);

	return [hRule, ...innerRows.slice(0, availableInnerHeight), hRule];
}
