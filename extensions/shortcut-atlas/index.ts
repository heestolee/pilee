import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionCommandContext, Theme, ThemeColor } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { buildShortcutAtlas, customShortcutCoverage, type ShortcutAtlas, type ShortcutEntry, type ShortcutIssue, type ShortcutLayer } from "./registry.ts";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const LAYER_LABEL: Record<ShortcutLayer, string> = {
	pilee: "pilee custom",
	pi: "Pi 기본",
	terminal: "터미널/host",
};

const LAYER_COLOR: Record<ShortcutLayer, ThemeColor> = {
	pilee: "accent",
	pi: "success",
	terminal: "warning",
};

function issueColor(issue: ShortcutIssue): ThemeColor {
	if (issue.severity === "error") return "error";
	if (issue.severity === "warning") return "warning";
	return "border";
}

function issueIcon(issue: ShortcutIssue): string {
	if (issue.severity === "error") return "✕";
	if (issue.severity === "warning") return "⚠";
	return "ℹ";
}

function layerOrder(layer: ShortcutLayer): number {
	return { pilee: 1, pi: 2, terminal: 3 }[layer] ?? 9;
}

function filterEntries(atlas: ShortcutAtlas, filter: string, query: string): ShortcutEntry[] {
	const lower = query.trim().toLowerCase();
	return atlas.entries.filter((entry) => {
		if (filter !== "all" && entry.layer !== filter) return false;
		if (!lower) return true;
		return [entry.key, entry.action, entry.scope, entry.source, entry.description].some((part) => String(part || "").toLowerCase().includes(lower));
	});
}

function filterIssues(atlas: ShortcutAtlas, query: string): ShortcutIssue[] {
	const lower = query.trim().toLowerCase();
	return atlas.issues.filter((issue) => {
		if (!lower) return true;
		return issue.key.includes(lower) || issue.message.toLowerCase().includes(lower) || issue.entries.some((entry) => entry.action.toLowerCase().includes(lower));
	});
}

function row(theme: Theme, width: number, text: string): string {
	return truncateToWidth(text, width, "…", true);
}

function renderShortcutLine(theme: Theme, width: number, entry: ShortcutEntry): string {
	const key = theme.fg(LAYER_COLOR[entry.layer], entry.key.padEnd(18));
	const layer = theme.fg("muted", LAYER_LABEL[entry.layer].padEnd(14));
	const scope = theme.fg("border", entry.scope.padEnd(16));
	const source = theme.fg("dim", entry.source);
	return row(theme, width, `  ${key} ${layer} ${scope} ${entry.action} ${source ? ` · ${source}` : ""}`);
}

function renderIssueLine(theme: Theme, width: number, issue: ShortcutIssue): string {
	const color = issueColor(issue);
	const actions = issue.entries.map((entry) => `${LAYER_LABEL[entry.layer]}:${entry.action}`).join(" / ");
	return row(theme, width, `  ${theme.fg(color, issueIcon(issue))} ${theme.fg(color, issue.key.padEnd(18))} ${issue.message} ${theme.fg("dim", actions)}`);
}

async function showShortcutAtlasOverlay(ctx: ExtensionCommandContext, initialFilter: string): Promise<void> {
	const atlas = buildShortcutAtlas();
	const sourceCoverage = customShortcutCoverage(REPO_ROOT);
	let selectedFilter = ["all", "pilee", "pi", "terminal", "issues"].includes(initialFilter) ? initialFilter : "all";
	let query = "";
	let inputMode = false;
	let scroll = 0;

	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => ({
			render: (width: number, height: number) => {
				const bodyHeight = Math.max(6, height - 7);
				const lines: string[] = [];
				lines.push(theme.fg("accent", "─".repeat(width)));
				const status = atlas.summary.errors > 0
					? theme.fg("error", `${atlas.summary.errors} error`)
					: atlas.summary.warnings > 0
						? theme.fg("warning", `${atlas.summary.warnings} warning`)
						: theme.fg("success", "no custom collision");
				lines.push(row(theme, width, `  ${theme.bold("Shortcut Atlas")} · ${atlas.summary.total} keys · custom ${atlas.summary.pilee} · Pi ${atlas.summary.pi} · terminal ${atlas.summary.terminal} · ${status}`));
				if (sourceCoverage.missing.length > 0) {
					lines.push(row(theme, width, `  ${theme.fg("warning", "⚠ source scan")}: registry에 없는 literal custom shortcut ${sourceCoverage.missing.length}개`));
				} else {
					lines.push(row(theme, width, `  ${theme.fg("success", "✓ source scan")}: literal custom shortcuts covered`));
				}
				lines.push(row(theme, width, `  filter: ${theme.fg("accent", selectedFilter)} · search: ${query || theme.fg("dim", "없음")} ${inputMode ? theme.fg("warning", "[검색 입력]") : ""}`));
				lines.push(theme.fg("accent", "─".repeat(width)));

				if (inputMode) {
					lines.push(row(theme, width, `  / ${query}${theme.fg("accent", "│")}`));
					lines.push(row(theme, width, `  ${theme.fg("border", "Enter: 검색 적용 · Esc: 취소")}`));
					lines.push(theme.fg("accent", "─".repeat(width)));
					return lines;
				}

				let body: string[] = [];
				if (selectedFilter === "issues") {
					const issues = filterIssues(atlas, query);
					if (issues.length === 0) body.push(`  ${theme.fg("success", "표시할 충돌/경고가 없습니다.")}`);
					else body = issues.flatMap((issue) => [renderIssueLine(theme, width, issue), ...issue.entries.map((entry) => renderShortcutLine(theme, width, entry))]);
				} else {
					const entries = filterEntries(atlas, selectedFilter, query).sort((a, b) => layerOrder(a.layer) - layerOrder(b.layer) || a.key.localeCompare(b.key));
					if (entries.length === 0) body.push(`  ${theme.fg("border", "검색 결과가 없습니다.")}`);
					else body = entries.map((entry) => renderShortcutLine(theme, width, entry));
				}
				const maxScroll = Math.max(0, body.length - bodyHeight);
				scroll = Math.min(scroll, maxScroll);
				lines.push(...body.slice(scroll, scroll + bodyHeight));
				while (lines.length < height - 2) lines.push("");
				lines.push(theme.fg("accent", "─".repeat(width)));
				lines.push(row(theme, width, `  ↑↓/jk scroll · PgUp/PgDn page · a all · c custom · p Pi · t terminal · i issues · / search · q close`));
				return lines;
			},
			handleInput: (data: string) => {
				if (inputMode) {
					if (matchesKey(data, Key.escape)) inputMode = false;
					else if (matchesKey(data, Key.enter)) inputMode = false;
					else if (matchesKey(data, Key.backspace)) query = query.slice(0, -1);
					else if (data.length === 1 && data >= " ") query += data;
					scroll = 0;
					(tui as any).requestRender?.();
					return;
				}
				if (matchesKey(data, Key.escape) || data === "q") {
					done(undefined);
					return;
				}
				if (matchesKey(data, Key.up) || data === "k") scroll = Math.max(0, scroll - 1);
				else if (matchesKey(data, Key.down) || data === "j") scroll += 1;
				else if (matchesKey(data, Key.pageUp)) scroll = Math.max(0, scroll - 12);
				else if (matchesKey(data, Key.pageDown)) scroll += 12;
				else if (data === "a") { selectedFilter = "all"; scroll = 0; }
				else if (data === "c") { selectedFilter = "pilee"; scroll = 0; }
				else if (data === "p") { selectedFilter = "pi"; scroll = 0; }
				else if (data === "t") { selectedFilter = "terminal"; scroll = 0; }
				else if (data === "i") { selectedFilter = "issues"; scroll = 0; }
				else if (data === "/") { inputMode = true; query = ""; scroll = 0; }
				(tui as any).requestRender?.();
			},
			invalidate: () => {},
		}),
		{ overlay: true, overlayOptions: { width: "90%", maxHeight: "80%", anchor: "center" } },
	);
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("shortcuts", {
		description: "터미널/Pi/pilee custom 단축키 atlas와 충돌 검사를 봅니다. Args: all|custom|pi|terminal|issues",
		getArgumentCompletions(prefix: string) {
			const values = ["all", "custom", "pi", "terminal", "issues"];
			const normalized = prefix.trim().toLowerCase();
			return values.filter((value) => value.startsWith(normalized)).map((value) => ({ value, label: value }));
		},
		handler: async (args, ctx) => {
			const raw = args.trim().toLowerCase();
			const initialFilter = raw === "custom" ? "pilee" : raw || "all";
			await showShortcutAtlasOverlay(ctx, initialFilter);
		},
	});
}
