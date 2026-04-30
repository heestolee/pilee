import type { ExtensionAPI, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

interface DiffFile {
	path: string;
	status: string;
}

interface DiffState {
	files: DiffFile[];
	selectedIndex: number;
	scrollOffset: number;
	diff: string;
	diffScroll: number;
	focus: "files" | "diff";
}

function statusIcon(s: string): string {
	if (s.startsWith("A") || s === "??") return "+";
	if (s.startsWith("D")) return "-";
	if (s.startsWith("R")) return "→";
	return "~";
}

function statusColor(s: string): ThemeColor {
	if (s.startsWith("A") || s === "??") return "success";
	if (s.startsWith("D")) return "error";
	return "warning";
}

function colorDiffLine(fg: (c: ThemeColor, t: string) => string, line: string): string {
	if (line.startsWith("+")) return fg("success", line);
	if (line.startsWith("-")) return fg("error", line);
	if (line.startsWith("@@")) return fg("accent", line);
	if (line.startsWith("diff ") || line.startsWith("index ")) return fg("dim", line);
	return line;
}

async function getChangedFiles(pi: ExtensionAPI, cwd: string): Promise<DiffFile[]> {
	const r = await pi.exec("git", ["status", "--porcelain", "-uall"], { cwd });
	if (r.code !== 0 || !r.stdout) return [];
	return r.stdout
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => ({
			status: line.slice(0, 2).trim(),
			path: line.slice(3),
		}));
}

async function getFileDiff(pi: ExtensionAPI, cwd: string, file: DiffFile): Promise<string> {
	if (file.status === "??") {
		const r = await pi.exec("cat", [file.path], { cwd });
		return r.code === 0
			? (r.stdout ?? "")
					.split("\n")
					.map((l) => `+ ${l}`)
					.join("\n")
			: "(cannot read file)";
	}
	const head = await pi.exec("git", ["diff", "--no-color", "HEAD", "--", file.path], { cwd });
	if (head.code === 0 && head.stdout?.trim()) return head.stdout.trim();
	const working = await pi.exec("git", ["diff", "--no-color", "--", file.path], { cwd });
	if (working.code === 0 && working.stdout?.trim()) return working.stdout.trim();
	const staged = await pi.exec("git", ["diff", "--cached", "--no-color", "--", file.path], { cwd });
	if (staged.code === 0 && staged.stdout?.trim()) return staged.stdout.trim();
	return "(no diff available)";
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("diff", {
		description: "Git diff overlay — view changed files and diffs",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const root = await (async () => {
				const r = await pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd: ctx.cwd });
				return r.code === 0 ? r.stdout?.trim() ?? null : null;
			})();

			if (!root) {
				if (ctx.hasUI) ctx.ui.notify("Not a git repository", "error");
				return;
			}

			const files = await getChangedFiles(pi, root);
			if (files.length === 0) {
				if (ctx.hasUI) ctx.ui.notify("No changes detected", "info");
				return;
			}

			const firstDiff = await getFileDiff(pi, root, files[0]);

			const st: DiffState = {
				files,
				selectedIndex: 0,
				scrollOffset: 0,
				diff: firstDiff,
				diffScroll: 0,
				focus: "files",
			};

			if (!ctx.hasUI) {
				for (const f of files) console.log(`${statusIcon(f.status)} ${f.path}`);
				return;
			}

			await ctx.ui.custom<void>(
				(tui, theme, _kb, done) => {
					const t = theme;
					let loading = false;

					const loadDiff = async (index: number) => {
						if (loading || index < 0 || index >= st.files.length) return;
						loading = true;
						st.diff = await getFileDiff(pi, root, st.files[index]);
						st.diffScroll = 0;
						loading = false;
						(tui as any).requestRender?.();
					};

					return {
						render: (w: number) => {
							const rows = (tui as any).terminal?.rows ?? 30;
							const headerH = 3;
							const footerH = 2;
							const bodyH = Math.max(3, rows - headerH - footerH);
							const leftW = Math.max(12, Math.min(Math.floor(w * 0.3), 40));
							const rightW = Math.max(10, w - leftW - 3);

							const lines: string[] = [];

							// Header
							const branch = (() => {
								return t.fg("muted", "working tree");
							})();
							lines.push(t.fg("accent", "─".repeat(w)));
							lines.push(
								`  ${t.fg("accent", t.bold("DIFF"))} ${t.fg("dim", "|")} ${branch} · ${t.fg("muted", `${files.length} file${files.length !== 1 ? "s" : ""}`)}`,
							);
							lines.push(
								t.fg(
									"dim",
									st.focus === "files"
										? "  ↑/↓ select · Enter → diff · q/Esc close"
										: "  ↑/↓/j/k scroll · Esc → files · q close",
								),
							);

							// File list
							const fileLines: string[] = [];
							const maxFiles = bodyH;
							if (st.selectedIndex < st.scrollOffset) st.scrollOffset = st.selectedIndex;
							if (st.selectedIndex >= st.scrollOffset + maxFiles)
								st.scrollOffset = st.selectedIndex - maxFiles + 1;

							for (let i = st.scrollOffset; i < Math.min(files.length, st.scrollOffset + maxFiles); i++) {
								const f = files[i];
								const sel = i === st.selectedIndex;
								const cursor = sel ? (st.focus === "files" ? t.fg("accent", "▶") : t.fg("muted", "▸")) : " ";
								const ic = t.fg(statusColor(f.status), statusIcon(f.status));
								const name = sel && st.focus === "files" ? t.fg("accent", f.path) : f.path;
								fileLines.push(truncateToWidth(`${cursor} ${ic} ${name}`, leftW, ""));
							}
							while (fileLines.length < bodyH) fileLines.push("");

							// Diff content
							const diffLines = st.diff.split("\n");
							const maxDiff = bodyH;
							const maxScroll = Math.max(0, diffLines.length - maxDiff);
							if (st.diffScroll > maxScroll) st.diffScroll = maxScroll;

							const diffRendered: string[] = [];
							for (let i = st.diffScroll; i < Math.min(diffLines.length, st.diffScroll + maxDiff); i++) {
								diffRendered.push(truncateToWidth(colorDiffLine(t.fg.bind(t), diffLines[i]), rightW, ""));
							}
							while (diffRendered.length < bodyH) diffRendered.push("");

							// Compose
							for (let i = 0; i < bodyH; i++) {
								const left = fileLines[i] ?? "";
								const pad = " ".repeat(Math.max(0, leftW - visibleWidth(left)));
								const right = diffRendered[i] ?? "";
								lines.push(`${left}${pad} ${t.fg("dim", "│")} ${right}`);
							}

							// Footer
							lines.push(t.fg("accent", "─".repeat(w)));

							return lines;
						},
						handleInput: (data: string) => {
							if (data === "q" || (matchesKey(data, Key.escape) && st.focus === "files")) {
								done(undefined);
								return;
							}

							if (st.focus === "files") {
								if (matchesKey(data, Key.up) || data === "k") {
									if (st.selectedIndex > 0) {
										st.selectedIndex--;
										void loadDiff(st.selectedIndex);
									}
								} else if (matchesKey(data, Key.down) || data === "j") {
									if (st.selectedIndex < files.length - 1) {
										st.selectedIndex++;
										void loadDiff(st.selectedIndex);
									}
								} else if (matchesKey(data, Key.enter)) {
									st.focus = "diff";
								}
							} else {
								if (matchesKey(data, Key.escape)) {
									st.focus = "files";
								} else if (matchesKey(data, Key.up) || data === "k") {
									st.diffScroll = Math.max(0, st.diffScroll - 1);
								} else if (matchesKey(data, Key.down) || data === "j") {
									st.diffScroll++;
								} else if (matchesKey(data, Key.pageUp)) {
									st.diffScroll = Math.max(0, st.diffScroll - 20);
								} else if (matchesKey(data, Key.pageDown)) {
									st.diffScroll += 20;
								}
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
