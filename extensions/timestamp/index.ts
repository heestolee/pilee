import type { ExtensionAPI, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

function formatTime(ts: string | number): string {
	const d = new Date(ts);
	const pad = (n: number) => String(n).padStart(2, "0");
	return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function elapsed(prev: number, curr: number): string {
	const diff = Math.floor((curr - prev) / 1000);
	if (diff < 60) return `${diff}s`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s`;
	return `${Math.floor(diff / 3600)}h ${Math.floor((diff % 3600) / 60)}m`;
}

interface TimelineEntry {
	time: string;
	role: string;
	preview: string;
	elapsedFromPrev: string;
	rawTs: number;
}

function buildTimeline(entries: any[]): TimelineEntry[] {
	const result: TimelineEntry[] = [];
	let prevTs = 0;

	for (const e of entries) {
		if (e?.type !== "message") continue;
		const role = e.message?.role;
		if (role !== "user" && role !== "assistant") continue;

		const ts = e.timestamp ? new Date(e.timestamp).getTime() : 0;
		const content = Array.isArray(e.message?.content)
			? e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim()
			: typeof e.message?.content === "string" ? e.message.content.trim() : "";

		const preview = content.replace(/\s+/g, " ").slice(0, 200);

		result.push({
			time: ts ? formatTime(ts) : "??",
			role,
			preview,
			elapsedFromPrev: prevTs && ts ? `+${elapsed(prevTs, ts)}` : "",
			rawTs: ts,
		});
		prevTs = ts || prevTs;
	}
	return result;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("timestamp", {
		description: "Open timeline overlay — shows all messages with timestamps and elapsed time",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) return;

			const entries = ctx.sessionManager.getEntries();
			const timeline = buildTimeline(entries);

			if (timeline.length === 0) {
				ctx.ui.notify("No messages in this session", "info");
				return;
			}

			let selectedIndex = timeline.length - 1;
			let scrollOffset = Math.max(0, timeline.length - 10);

			await ctx.ui.custom<void>(
				(tui, theme, _kb, done) => {
					return {
						render: (w: number) => {
							const rows = (tui as any).terminal?.rows ?? 30;
							const headerH = 3;
							const footerH = 2;
							const bodyH = Math.max(3, rows - headerH - footerH);
							const lines: string[] = [];

							// Header
							lines.push(theme.fg("accent", "─".repeat(w)));
							const total = timeline.length;
							const first = timeline[0]?.time ?? "?";
							const last = timeline[timeline.length - 1]?.time ?? "?";
							const totalElapsed = timeline[0]?.rawTs && timeline[timeline.length - 1]?.rawTs
								? elapsed(timeline[0].rawTs, timeline[timeline.length - 1].rawTs)
								: "?";
							lines.push(`  ${theme.fg("accent", theme.bold("TIMELINE"))} ${theme.fg("dim", "|")} ${theme.fg("muted", `${total} messages`)} ${theme.fg("dim", "·")} ${theme.fg("muted", `${first} → ${last}`)} ${theme.fg("dim", "·")} ${theme.fg("muted", `total ${totalElapsed}`)}`);
							lines.push(theme.fg("dim", "  ↑/↓ select · q/Esc close"));

							// Body
							if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
							if (selectedIndex >= scrollOffset + bodyH) scrollOffset = selectedIndex - bodyH + 1;

							for (let i = scrollOffset; i < Math.min(timeline.length, scrollOffset + bodyH); i++) {
								const entry = timeline[i];
								const sel = i === selectedIndex;
								const cursor = sel ? theme.fg("accent", "▶") : " ";
								const timeStr = theme.fg("dim", entry.time);
								const elapsedStr = entry.elapsedFromPrev ? theme.fg("warning", ` ${entry.elapsedFromPrev}`) : "";
								const roleColor: ThemeColor = entry.role === "user" ? "accent" : "success";
								const roleStr = theme.fg(roleColor, entry.role.padEnd(10));
								const previewW = Math.max(10, w - 40);
								const preview = entry.preview.slice(0, previewW);
								const previewStr = sel ? theme.fg("text", preview) : theme.fg("muted", preview);
								lines.push(truncateToWidth(`${cursor} ${timeStr}${elapsedStr} ${roleStr} ${previewStr}`, w, ""));
							}

							while (lines.length < headerH + bodyH) lines.push("");

							// Footer
							lines.push(theme.fg("accent", "─".repeat(w)));

							return lines;
						},
						handleInput: (data: string) => {
							if (data === "q" || matchesKey(data, Key.escape)) {
								done(undefined);
								return;
							}
							if (matchesKey(data, Key.up) || data === "k") {
								if (selectedIndex > 0) selectedIndex--;
							} else if (matchesKey(data, Key.down) || data === "j") {
								if (selectedIndex < timeline.length - 1) selectedIndex++;
							} else if (data === "g") {
								selectedIndex = 0;
							} else if (data === "G") {
								selectedIndex = timeline.length - 1;
							} else if (matchesKey(data, Key.pageUp)) {
								selectedIndex = Math.max(0, selectedIndex - 10);
							} else if (matchesKey(data, Key.pageDown)) {
								selectedIndex = Math.min(timeline.length - 1, selectedIndex + 10);
							}
							(tui as any).requestRender?.();
						},
						invalidate: () => {},
					};
				},
				{ overlay: true, overlayOptions: { width: "100%", maxHeight: "100%", anchor: "center" } },
			);
		},
	});
}
