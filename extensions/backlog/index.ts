import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

// ─── Storage ───────────────────────────────────────────────────────────────

const BACKLOG_FILE = join(homedir(), ".pi", "agent", "state", "backlog.json");

type Priority = "high" | "medium" | "low";

interface BacklogItem {
	id: number;
	title: string;
	priority: Priority;
	note?: string;
	status: "open" | "done";
	createdAt: number;
	doneAt?: number;
}

interface BacklogStore {
	nextId: number;
	items: BacklogItem[];
}

function load(): BacklogStore {
	if (!existsSync(BACKLOG_FILE)) return { nextId: 1, items: [] };
	try { return JSON.parse(readFileSync(BACKLOG_FILE, "utf8")); } catch { return { nextId: 1, items: [] }; }
}

function save(store: BacklogStore) {
	mkdirSync(dirname(BACKLOG_FILE), { recursive: true });
	writeFileSync(BACKLOG_FILE, JSON.stringify(store, null, 2));
}

const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

function sorted(items: BacklogItem[]): BacklogItem[] {
	return [...items].sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.createdAt - b.createdAt);
}

// ─── Arg parsing ───────────────────────────────────────────────────────────

function parseArgs(args: string): { sub: string; rest: string } {
	const trimmed = args.trim();
	const spaceIdx = trimmed.indexOf(" ");
	if (spaceIdx === -1) return { sub: trimmed, rest: "" };
	return { sub: trimmed.slice(0, spaceIdx), rest: trimmed.slice(spaceIdx + 1).trim() };
}

function parsePriority(rest: string): { title: string; priority: Priority; note?: string } {
	let priority: Priority = "medium";
	let note: string | undefined;
	let title = rest;

	const priorityMatch = title.match(/--priority\s+(high|medium|low)/i);
	if (priorityMatch) {
		priority = priorityMatch[1].toLowerCase() as Priority;
		title = title.replace(priorityMatch[0], "").trim();
	} else if (title.match(/--high/i)) { priority = "high"; title = title.replace(/--high/i, "").trim(); }
	else if (title.match(/--low/i)) { priority = "low"; title = title.replace(/--low/i, "").trim(); }

	const noteMatch = title.match(/--note\s+"([^"]+)"/);
	if (noteMatch) {
		note = noteMatch[1];
		title = title.replace(noteMatch[0], "").trim();
	}

	return { title, priority, note };
}

// ─── Overlay ───────────────────────────────────────────────────────────────

async function showOverlay(ctx: ExtensionCommandContext) {
	const store = load();

	let selectedIdx = 0;
	let showDone = false;
	let showHelp = false;
	let inputMode: null | "add" | "note" | "edit-title" | "edit-note" = null;
	let inputBuffer = "";
	let detailId: number | null = null;

	const getVisible = () => {
		const items = showDone ? store.items : store.items.filter((i) => i.status === "open");
		return sorted(items);
	};

	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => {
			const priorityColor = (p: Priority): ThemeColor => p === "high" ? "error" : p === "medium" ? "warning" : "dim";
			const priorityIcon = (p: Priority) => p === "high" ? "🔴" : p === "medium" ? "🟡" : "⚪";

			const renderHelp = (w: number): string[] => {
				const lines: string[] = [];
				lines.push(...new DynamicBorder((s: string) => theme.fg("accent", s)).render(w));
				lines.push(`  ${theme.bold("KEYBINDINGS")}`);
				lines.push("");
				lines.push(`  ${theme.fg("warning", "↑/↓, k/j")}  항목 이동`);
				lines.push(`  ${theme.fg("warning", "Enter")}     상세 보기`);
				lines.push(`  ${theme.fg("warning", "n")}         새 항목 추가`);
				lines.push(`  ${theme.fg("warning", "d")}         삭제`);
				lines.push(`  ${theme.fg("warning", "Space")}     완료/미완료 토글`);
				lines.push(`  ${theme.fg("warning", "p")}         우선순위 변경 (high→medium→low)`);
				lines.push(`  ${theme.fg("warning", "t")}         노트 작성/수정`);
				lines.push(`  ${theme.fg("warning", "v")}         완료 항목 표시/숨김`);
				lines.push(`  ${theme.fg("warning", ",")}         이 도움말`);
				lines.push(`  ${theme.fg("warning", "q/Esc")}     닫기`);
				lines.push("");
				lines.push(`  아무 키나 누르면 닫힘`);
				lines.push(...new DynamicBorder((s: string) => theme.fg("accent", s)).render(w));
				return lines;
			};

			return {
				render: (w: number) => {
					if (showHelp) return renderHelp(w);
					const visible = getVisible();
					const openCount = store.items.filter((i) => i.status === "open").length;
					const doneCount = store.items.filter((i) => i.status === "done").length;

					const lines: string[] = [];
					lines.push(theme.fg("accent", "─".repeat(w)));
					lines.push(`  ${theme.bold("Backlog")} (${openCount} open${doneCount > 0 ? ` · ${doneCount} done` : ""})  ${showDone ? "[showing done]" : ""}`);
					lines.push(theme.fg("accent", "─".repeat(w)));

					if (inputMode) {
						const labels: Record<string, string> = { add: "새 항목", note: "노트", "edit-title": "제목 수정", "edit-note": "노트 수정" };
						lines.push(`  ${theme.fg("warning", `[${labels[inputMode] ?? inputMode}]`)} ${inputBuffer}${theme.fg("accent", "│")}`);
						lines.push("  Enter 확인 · Esc 취소");
						lines.push(theme.fg("accent", "─".repeat(w)));
						return lines;
					}

					if (detailId !== null) {
						const item = store.items.find((i) => i.id === detailId);
						if (!item) { detailId = null; } else {
							const icon = priorityIcon(item.priority);
							const statusLabel = item.status === "done" ? theme.fg("success", "완료") : theme.fg("warning", "진행 중");
							lines.push("");
							lines.push(`  ${icon} ${theme.fg("accent", theme.bold(`#${item.id} ${item.title}`))}`);
							lines.push("");
							lines.push(`  상태:     ${statusLabel}`);
							lines.push(`  우선순위: ${theme.fg(priorityColor(item.priority), item.priority)}`);
							lines.push(`  생성일:   ${new Date(item.createdAt).toLocaleString("ko-KR")}`);
							if (item.doneAt) lines.push(`  완료일:   ${new Date(item.doneAt).toLocaleString("ko-KR")}`);
							lines.push("");
							if (item.note) {
								lines.push(`  노트:`);
								for (const line of item.note.split("\n")) {
									lines.push(`    ${line}`);
								}
							} else {
								lines.push(`  (노트 없음)`);
							}
							lines.push("");
							lines.push(theme.fg("accent", "─".repeat(w)));
							lines.push("  Esc 돌아가기 · e 제목 수정 · t 노트 수정 · p 우선순위 · Space 완료 토글 · d 삭제");
							return lines;
						}
					}

					if (visible.length === 0) {
						lines.push("  백로그가 비어있습니다. n으로 추가하세요.");
					} else {
						const visibleHeight = Math.max(5, ((tui as any).terminal?.rows ?? 24) - 8);
						let scrollOffset = 0;
						if (selectedIdx >= scrollOffset + visibleHeight) scrollOffset = selectedIdx - visibleHeight + 1;
						if (selectedIdx < scrollOffset) scrollOffset = selectedIdx;

						for (let i = scrollOffset; i < Math.min(visible.length, scrollOffset + visibleHeight); i++) {
							const item = visible[i];
							const sel = i === selectedIdx;
							const cursor = sel ? theme.fg("accent", "▶") : " ";
							const check = item.status === "done" ? theme.fg("success", "✓") : " ";
							const icon = priorityIcon(item.priority);
							const title = item.status === "done" ? item.title : sel ? theme.fg("accent", item.title) : item.title;
							const note = item.note ? ` — ${item.note.slice(0, 30)}` : "";
							lines.push(truncateToWidth(`${cursor} ${check} ${icon} #${item.id} ${title}${note}`, w, ""));
						}
					}

					lines.push(theme.fg("accent", "─".repeat(w)));
					lines.push("  ↑↓ 이동 · Enter 상세 · n 추가 · d 삭제 · Space 완료 토글 · p 우선순위 변경 · t 노트 · v done 표시 · q 닫기");
					return lines;
				},
				handleInput: (data: string) => {
					if (showHelp) {
						showHelp = false;
						(tui as any).requestRender?.();
						return;
					}

					if (matchesKey(data, ",")) {
						showHelp = true;
						(tui as any).requestRender?.();
						return;
					}

					const visible = getVisible();

					// Input mode
					if (inputMode) {
						if (matchesKey(data, Key.escape)) {
							inputMode = null;
							inputBuffer = "";
						} else if (matchesKey(data, Key.enter)) {
							if (inputBuffer.trim()) {
								if (inputMode === "add") {
									const { title, priority, note } = parsePriority(inputBuffer);
									if (title) {
										store.items.push({
											id: store.nextId++,
											title,
											priority,
											note,
											status: "open",
											createdAt: Date.now(),
										});
										save(store);
									}
								} else if (inputMode === "note") {
									const item = visible[selectedIdx];
									if (item) {
										item.note = inputBuffer.trim();
										save(store);
									}
								} else if (inputMode === "edit-title") {
									const item = store.items.find((i) => i.id === detailId);
									if (item) {
										item.title = inputBuffer.trim();
										save(store);
									}
								} else if (inputMode === "edit-note") {
									const item = store.items.find((i) => i.id === detailId);
									if (item) {
										item.note = inputBuffer.trim();
										save(store);
									}
								}
							}
							inputMode = null;
							inputBuffer = "";
						} else if (matchesKey(data, Key.backspace)) {
							inputBuffer = inputBuffer.slice(0, -1);
						} else if (data.length === 1 && data >= " ") {
							inputBuffer += data;
						}
						(tui as any).requestRender?.();
						return;
					}

					// Detail view keybindings
					if (detailId !== null) {
						const item = store.items.find((i) => i.id === detailId);
						if (matchesKey(data, Key.escape)) {
							detailId = null;
						} else if (data === "e" && item) {
							inputMode = "edit-title";
							inputBuffer = item.title;
						} else if (data === "t" && item) {
							inputMode = "edit-note";
							inputBuffer = item.note ?? "";
						} else if (data === "p" && item) {
							const cycle: Priority[] = ["high", "medium", "low"];
							const idx = cycle.indexOf(item.priority);
							item.priority = cycle[(idx + 1) % cycle.length];
							save(store);
						} else if (data === " " && item) {
							item.status = item.status === "open" ? "done" : "open";
							item.doneAt = item.status === "done" ? Date.now() : undefined;
							save(store);
						} else if (data === "d" && item) {
							store.items = store.items.filter((i) => i.id !== item.id);
							save(store);
							detailId = null;
							const newVisible = getVisible();
							if (selectedIdx >= newVisible.length) selectedIdx = Math.max(0, newVisible.length - 1);
						}
						(tui as any).requestRender?.();
						return;
					}

					// List view keybindings
					if (data === "q" || matchesKey(data, Key.escape)) { done(undefined); return; }

					if (matchesKey(data, Key.up) || data === "k") {
						selectedIdx = Math.max(0, selectedIdx - 1);
					} else if (matchesKey(data, Key.down) || data === "j") {
						selectedIdx = Math.min(visible.length - 1, selectedIdx + 1);
					} else if (matchesKey(data, Key.enter)) {
						const item = visible[selectedIdx];
						if (item) detailId = item.id;
					} else if (data === "n") {
						inputMode = "add";
						inputBuffer = "";
					} else if (data === " ") {
						const item = visible[selectedIdx];
						if (item) {
							item.status = item.status === "open" ? "done" : "open";
							item.doneAt = item.status === "done" ? Date.now() : undefined;
							save(store);
							const newVisible = getVisible();
							if (selectedIdx >= newVisible.length) selectedIdx = Math.max(0, newVisible.length - 1);
						}
					} else if (data === "d") {
						const item = visible[selectedIdx];
						if (item) {
							store.items = store.items.filter((i) => i.id !== item.id);
							save(store);
							const newVisible = getVisible();
							if (selectedIdx >= newVisible.length) selectedIdx = Math.max(0, newVisible.length - 1);
						}
					} else if (data === "p") {
						const item = visible[selectedIdx];
						if (item) {
							const cycle: Priority[] = ["high", "medium", "low"];
							const idx = cycle.indexOf(item.priority);
							item.priority = cycle[(idx + 1) % cycle.length];
							save(store);
						}
					} else if (data === "t") {
						const item = visible[selectedIdx];
						if (item) {
							inputMode = "note";
							inputBuffer = item.note ?? "";
						}
					} else if (data === "v") {
						showDone = !showDone;
						selectedIdx = 0;
					}

					(tui as any).requestRender?.();
				},
				invalidate: () => {},
			};
		},
		{ overlay: true, overlayOptions: { width: "80%", maxHeight: "70%", anchor: "center" } },
	);
}

// ─── CLI subcommands ───────────────────────────────────────────────────────

function handleAdd(rest: string, ctx: ExtensionCommandContext) {
	if (!rest) { ctx.ui.notify("Usage: /backlog add <title> [--high|--low] [--note \"...\"]", "error"); return; }
	const store = load();
	const { title, priority, note } = parsePriority(rest);
	store.items.push({ id: store.nextId++, title, priority, note, status: "open", createdAt: Date.now() });
	save(store);
	ctx.ui.notify(`#${store.nextId - 1} 추가됨 [${priority}]: ${title}`, "info");
}

function handleDone(rest: string, ctx: ExtensionCommandContext) {
	const id = Number.parseInt(rest);
	if (Number.isNaN(id)) { ctx.ui.notify("Usage: /backlog done <id>", "error"); return; }
	const store = load();
	const item = store.items.find((i) => i.id === id);
	if (!item) { ctx.ui.notify(`#${id} not found`, "error"); return; }
	item.status = "done";
	item.doneAt = Date.now();
	save(store);
	ctx.ui.notify(`#${id} 완료: ${item.title}`, "info");
}

function handleList(ctx: ExtensionCommandContext) {
	const store = load();
	const open = sorted(store.items.filter((i) => i.status === "open"));
	if (open.length === 0) { ctx.ui.notify("백로그가 비어있습니다.", "info"); return; }
	const lines = open.map((i) => {
		const icon = i.priority === "high" ? "🔴" : i.priority === "medium" ? "🟡" : "⚪";
		const note = i.note ? ` — ${i.note.slice(0, 40)}` : "";
		return `${icon} #${i.id} ${i.title}${note}`;
	});
	ctx.ui.notify(`Backlog (${open.length}):\n${lines.join("\n")}`, "info");
}

// ─── Extension ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerCommand("backlog", {
		description: "Manage persistent backlog. Subcommands: (none)=overlay, add, done, list",
		handler: async (args, ctx) => {
			const { sub, rest } = parseArgs(args);
			if (!sub || sub === "open") return showOverlay(ctx);
			if (sub === "add") return handleAdd(rest, ctx);
			if (sub === "done") return handleDone(rest, ctx);
			if (sub === "list" || sub === "ls") return handleList(ctx);
			return showOverlay(ctx);
		},
	});
}
