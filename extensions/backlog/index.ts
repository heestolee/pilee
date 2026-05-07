import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { copyToClipboard, DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";
import { BACKLOG_SESSION_EXPORT_DIR, displayPath, expandHome, exportSessionFileToHtml, openFile } from "../utils/session-export.js";

// ─── Storage ───────────────────────────────────────────────────────────────

const BACKLOG_FILE = join(homedir(), ".pi", "agent", "state", "backlog.json");

type Priority = "high" | "medium" | "low";

interface SourceSession {
	title?: string;
	sessionFile?: string;
	cwd?: string;
	entryId?: string;
	capturedAt: number;
}

interface BacklogItem {
	id: number;
	title: string;
	priority: Priority;
	note?: string;
	status: "open" | "done";
	createdAt: number;
	doneAt?: number;
	sourceSession?: SourceSession;
	/** Human-readable reference kept in storage so future agents can grep the source session hint directly. */
	sourceReference?: string;
}

interface BacklogStore {
	nextId: number;
	items: BacklogItem[];
}

type OverlayAction = { type: "switch-session" | "view-session"; itemId: number };

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

// ─── Source session metadata ───────────────────────────────────────────────

function sourceTitle(source: SourceSession | undefined): string {
	if (source?.title?.trim()) return source.title.trim();
	if (source?.sessionFile) return basename(source.sessionFile, ".jsonl");
	return "기록된 대화";
}

function sourceReferenceTextFor(source: SourceSession | undefined): string {
	if (!source?.sessionFile) return "";
	return [
		"관련 대화:",
		`"${sourceTitle(source)}" 세션의 전문으로 확인`,
		displayPath(source.sessionFile),
	].join("\n");
}

function sourceReferenceText(item: BacklogItem): string {
	return item.sourceReference?.trim() || sourceReferenceTextFor(item.sourceSession);
}

function sourceSessionFile(item: BacklogItem): string | undefined {
	if (item.sourceSession?.sessionFile) return expandHome(item.sourceSession.sessionFile);
	const ref = item.sourceReference ?? item.note ?? "";
	const match = ref.match(/(?:~\/|\/)[^\n\r]+\.jsonl/);
	return match ? expandHome(match[0].trim()) : undefined;
}

function captureSourceSession(ctx: ExtensionCommandContext): SourceSession | undefined {
	const sessionFile = ctx.sessionManager.getSessionFile();
	if (!sessionFile) return undefined;
	const title = ctx.sessionManager.getSessionName()?.trim() || undefined;
	const entryId = ctx.sessionManager.getLeafId() ?? undefined;
	return {
		title,
		sessionFile,
		cwd: ctx.cwd,
		entryId: entryId || undefined,
		capturedAt: Date.now(),
	};
}

function createBacklogItem(store: BacklogStore, title: string, priority: Priority, note: string | undefined, ctx: ExtensionCommandContext): BacklogItem {
	const sourceSession = captureSourceSession(ctx);
	const item: BacklogItem = {
		id: store.nextId++,
		title,
		priority,
		note,
		status: "open",
		createdAt: Date.now(),
		sourceSession,
		sourceReference: sourceReferenceTextFor(sourceSession) || undefined,
	};
	store.items.push(item);
	return item;
}

function itemDescription(item: BacklogItem): string {
	const parts = [item.note?.trim(), sourceReferenceText(item)].filter((part): part is string => !!part?.trim());
	return parts.join("\n\n");
}

async function exportAndOpenSourceSession(pi: ExtensionAPI, ctx: ExtensionCommandContext, item: BacklogItem) {
	const sessionFile = sourceSessionFile(item);
	if (!sessionFile) {
		ctx.ui.notify(`#${item.id}에는 기록된 원 세션이 없습니다.`, "warning");
		return;
	}
	if (!existsSync(sessionFile)) {
		ctx.ui.notify(`원 세션 파일을 찾을 수 없습니다: ${displayPath(sessionFile)}`, "error");
		return;
	}

	const outputPath = await exportSessionFileToHtml(pi, sessionFile, { outputDir: BACKLOG_SESSION_EXPORT_DIR, filenamePrefix: `backlog-${item.id}` });
	await openFile(pi, outputPath);
	ctx.ui.notify(`세션 전문 HTML 열기 → ${displayPath(outputPath)}`, "info");
}

async function switchToSourceSession(ctx: ExtensionCommandContext, item: BacklogItem) {
	const sessionFile = sourceSessionFile(item);
	if (!sessionFile) {
		ctx.ui.notify(`#${item.id}에는 기록된 원 세션이 없습니다.`, "warning");
		return;
	}
	if (!existsSync(sessionFile)) {
		ctx.ui.notify(`원 세션 파일을 찾을 수 없습니다: ${displayPath(sessionFile)}`, "error");
		return;
	}
	if (ctx.sessionManager.getSessionFile() === sessionFile) {
		ctx.ui.notify("이미 이 백로그를 만든 세션에 있습니다.", "info");
		return;
	}
	await ctx.switchSession(sessionFile);
}

function copySourcePath(ctx: ExtensionCommandContext, item: BacklogItem) {
	const sessionFile = sourceSessionFile(item);
	if (!sessionFile) {
		ctx.ui.notify(`#${item.id}에는 복사할 원 세션 경로가 없습니다.`, "warning");
		return;
	}
	void copyToClipboard(sessionFile)
		.then(() => ctx.ui.notify(`세션 경로 복사됨 → ${displayPath(sessionFile)}`, "info"))
		.catch((error) => ctx.ui.notify(`세션 경로 복사 실패: ${error instanceof Error ? error.message : String(error)}`, "error"));
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

// ─── Tasks interop ──────────────────────────────────────────────────────────

function tasksStorePath(ctx: any): string {
	const sessionId = ctx.sessionManager?.getSessionId?.() ?? "default";
	const dir = join(ctx.cwd ?? homedir(), ".pi", "tasks");
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	return join(dir, `tasks-${sessionId}.json`);
}

function loadTasks(ctx: any): { nextId: number; tasks: any[] } {
	const p = tasksStorePath(ctx);
	if (!existsSync(p)) return { nextId: 1, tasks: [] };
	try { return JSON.parse(readFileSync(p, "utf8")); } catch { return { nextId: 1, tasks: [] }; }
}

function saveTasks(ctx: any, store: { nextId: number; tasks: any[] }) {
	writeFileSync(tasksStorePath(ctx), JSON.stringify(store, null, 2));
}

function moveToTasks(ctx: ExtensionCommandContext, store: BacklogStore, item: BacklogItem) {
	const taskStore = loadTasks(ctx);
	taskStore.tasks.push({
		id: String(taskStore.nextId++),
		subject: item.title,
		description: itemDescription(item),
		status: "pending",
		blocks: [],
		blockedBy: [],
		metadata: {
			backlogId: item.id,
			sourceSession: item.sourceSession,
		},
		createdAt: Date.now(),
		updatedAt: Date.now(),
	});
	saveTasks(ctx, taskStore);
	store.items = store.items.filter((i) => i.id !== item.id);
	save(store);
}

// ─── Rendering helpers ─────────────────────────────────────────────────────

function pushWrapped(lines: string[], width: number, prefix: string, text: string, color?: (value: string) => string) {
	const available = Math.max(10, width - visibleWidth(prefix) - 2);
	const rawLines = text.split("\n");
	for (const rawLine of rawLines) {
		const styled = color ? color(rawLine) : rawLine;
		const wrapped = rawLine.length === 0 ? [""] : wrapTextWithAnsi(styled, available);
		for (const line of wrapped) lines.push(`${prefix}${line}`);
	}
}

function footerLine(theme: any, text: string, width: number): string {
	return truncateToWidth(`  ${theme.fg("border", text)}`, width, "");
}

// ─── Overlay ───────────────────────────────────────────────────────────────

async function showOverlay(pi: ExtensionAPI, ctx: ExtensionCommandContext) {
	const store = load();

	let selectedIdx = 0;
	let showDone = false;
	let showHelp = false;
	let inputMode: null | "add" | "note" | "edit-title" | "edit-note" = null;
	let inputBuffer = "";
	let detailId: number | null = null;
	let detailScroll = 0;

	const getVisible = () => {
		const items = showDone ? store.items : store.items.filter((i) => i.status === "open");
		return sorted(items);
	};

	const action = await ctx.ui.custom<OverlayAction | undefined>(
		(tui, theme, _kb, done) => {
			const priorityColor = (p: Priority): ThemeColor => p === "high" ? "error" : p === "medium" ? "warning" : "dim";
			const priorityIcon = (p: Priority) => p === "high" ? "🔴" : p === "medium" ? "🟡" : "⚪";

			const renderHelp = (w: number): string[] => {
				const lines: string[] = [];
				lines.push(...new DynamicBorder((s: string) => theme.fg("accent", s)).render(w));
				lines.push(`  ${theme.bold("KEYBINDINGS")}`);
				lines.push("");
				lines.push(`  ${theme.fg("warning", "↑/↓, k/j")}  ${theme.fg("border", "목록 이동 / 상세 스크롤")}`);
				lines.push(`  ${theme.fg("warning", "PgUp/PgDn")} ${theme.fg("border", "상세 빠른 스크롤")}`);
				lines.push(`  ${theme.fg("warning", "Enter")}     ${theme.fg("border", "상세 보기")}`);
				lines.push(`  ${theme.fg("warning", "s")}         ${theme.fg("border", "백로그를 만든 원 세션으로 전환")}`);
				lines.push(`  ${theme.fg("warning", "v")}         ${theme.fg("border", "원 세션 전문 HTML로 보기")}`);
				lines.push(`  ${theme.fg("warning", "p")}         ${theme.fg("border", "원 세션 파일 경로 복사")}`);
				lines.push(`  ${theme.fg("warning", "n")}         ${theme.fg("border", "새 항목 추가")}`);
				lines.push(`  ${theme.fg("warning", "d")}         ${theme.fg("border", "삭제")}`);
				lines.push(`  ${theme.fg("warning", "Space")}     ${theme.fg("border", "완료/미완료 토글")}`);
				lines.push(`  ${theme.fg("warning", "P")}         ${theme.fg("border", "우선순위 변경 (high→medium→low)")}`);
				lines.push(`  ${theme.fg("warning", "t")}         ${theme.fg("border", "노트 작성/수정")}`);
				lines.push(`  ${theme.fg("warning", "a")}         ${theme.fg("border", "완료 항목 표시/숨김")}`);
				lines.push(`  ${theme.fg("warning", "b")}         ${theme.fg("border", "tasks로 이동")}`);
				lines.push(`  ${theme.fg("warning", ",")}         ${theme.fg("border", "이 도움말")}`);
				lines.push(`  ${theme.fg("warning", "q/Esc")}     ${theme.fg("border", "닫기")}`);
				lines.push("");
				lines.push(`  ${theme.fg("border", "아무 키나 누르면 닫힘")}`);
				lines.push(...new DynamicBorder((s: string) => theme.fg("accent", s)).render(w));
				return lines;
			};

			const renderDetailBody = (item: BacklogItem, w: number): string[] => {
				const lines: string[] = [];
				const statusLabel = item.status === "done" ? theme.fg("success", "완료") : theme.fg("warning", "진행 중");
				lines.push(`  상태:     ${statusLabel}`);
				lines.push(`  우선순위: ${theme.fg(priorityColor(item.priority), item.priority)}`);
				lines.push(`  생성일:   ${theme.fg("borderAccent", new Date(item.createdAt).toLocaleString("ko-KR"))}`);
				if (item.doneAt) lines.push(`  완료일:   ${theme.fg("borderAccent", new Date(item.doneAt).toLocaleString("ko-KR"))}`);
				lines.push("");
				lines.push(`  ${theme.bold("노트")}`);
				if (item.note?.trim()) {
					pushWrapped(lines, w, "    ", item.note, (line) => theme.fg("borderAccent", line));
				} else {
					lines.push(`    ${theme.fg("border", "(노트 없음)")}`);
				}
				lines.push("");
				lines.push(`  ${theme.bold("관련 대화")}`);
				const source = item.sourceSession;
				const sourceFile = sourceSessionFile(item);
				if (sourceFile) {
					pushWrapped(lines, w, "    ", `"${sourceTitle(source)}" 세션의 전문으로 확인`, (line) => theme.fg("accent", line));
					pushWrapped(lines, w, "    ", displayPath(sourceFile), (line) => theme.fg("borderAccent", line));
					if (source?.cwd) pushWrapped(lines, w, "    ", `cwd: ${displayPath(source.cwd)}`, (line) => theme.fg("border", line));
					if (source?.entryId) pushWrapped(lines, w, "    ", `entry: ${source.entryId}`, (line) => theme.fg("border", line));
				} else {
					pushWrapped(lines, w, "    ", "기록 없음 — 새로 추가되는 백로그부터 자동 저장됩니다.", (line) => theme.fg("border", line));
				}
				return lines;
			};

			const renderDetail = (item: BacklogItem, w: number): string[] => {
				const lines: string[] = [];
				const termRows = (tui as any).terminal?.rows ?? 24;
				const overlayRows = Math.max(12, Math.floor(termRows * 0.9));
				const icon = priorityIcon(item.priority);
				lines.push(theme.fg("accent", "─".repeat(w)));
				lines.push(`  ${icon} ${theme.fg("accent", theme.bold(`#${item.id} ${item.title}`))}`);
				lines.push(theme.fg("accent", "─".repeat(w)));

				const body = renderDetailBody(item, w);
				const footerRows = 3;
				const bodyHeight = Math.max(5, overlayRows - lines.length - footerRows);
				const maxScroll = Math.max(0, body.length - bodyHeight);
				detailScroll = Math.max(0, Math.min(detailScroll, maxScroll));
				const end = Math.min(body.length, detailScroll + bodyHeight);
				lines.push(...body.slice(detailScroll, end));

				if (body.length > bodyHeight) {
					lines.push(theme.fg("border", `  · ${detailScroll + 1}-${end}/${body.length} · ↑↓/j/k 또는 PgUp/PgDn으로 더 보기`));
				}
				lines.push(theme.fg("accent", "─".repeat(w)));
				lines.push(footerLine(theme, "Esc 돌아가기 · ↑↓/j/k 스크롤 · s 세션 열기 · v 전문 보기 · p 경로 복사 · e 제목 수정 · t 노트 수정 · P 우선순위 · Space 완료 · b tasks · d 삭제", w));
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
						lines.push(`  ${theme.fg("border", "Enter 확인 · Esc 취소")}`);
						lines.push(theme.fg("accent", "─".repeat(w)));
						return lines;
					}

					if (detailId !== null) {
						const item = store.items.find((i) => i.id === detailId);
						if (item) return renderDetail(item, w);
						detailId = null;
					}

					if (visible.length === 0) {
						lines.push(`  ${theme.fg("border", "백로그가 비어있습니다. n으로 추가하세요.")}`);
					} else {
						const termRows = (tui as any).terminal?.rows ?? 24;
						const visibleHeight = Math.max(5, Math.floor(termRows * 0.9) - 8);
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
							const sourceMark = sourceSessionFile(item) ? theme.fg("accent", " 📎") : "";
							const note = item.note ? theme.fg("borderAccent", ` — ${item.note.slice(0, 30)}`) : "";
							lines.push(truncateToWidth(`${cursor} ${check} ${icon} #${item.id} ${title}${sourceMark}${note}`, w, ""));
						}
					}

					lines.push(theme.fg("accent", "─".repeat(w)));
					lines.push(footerLine(theme, "↑↓ 이동 · Enter 상세 · s 세션 열기 · v 전문 보기 · p 경로 복사 · n 추가 · d 삭제 · Space 완료 · P 우선순위 · t 노트 · a done 표시 · q 닫기", w));
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
										createBacklogItem(store, title, priority, note, ctx);
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
						const page = Math.max(5, Math.floor(((tui as any).terminal?.rows ?? 24) * 0.45));
						if (matchesKey(data, Key.escape)) {
							detailId = null;
							detailScroll = 0;
						} else if ((matchesKey(data, Key.up) || data === "k") && item) {
							detailScroll = Math.max(0, detailScroll - 1);
						} else if ((matchesKey(data, Key.down) || data === "j") && item) {
							detailScroll += 1;
						} else if (matchesKey(data, Key.pageUp) && item) {
							detailScroll = Math.max(0, detailScroll - page);
						} else if (matchesKey(data, Key.pageDown) && item) {
							detailScroll += page;
						} else if (data === "g" && item) {
							detailScroll = 0;
						} else if (data === "G" && item) {
							detailScroll = Number.MAX_SAFE_INTEGER;
						} else if (data === "s" && item) {
							done({ type: "switch-session", itemId: item.id });
							return;
						} else if (data === "v" && item) {
							done({ type: "view-session", itemId: item.id });
							return;
						} else if (data === "p" && item) {
							copySourcePath(ctx, item);
						} else if (data === "e" && item) {
							inputMode = "edit-title";
							inputBuffer = item.title;
						} else if (data === "t" && item) {
							inputMode = "edit-note";
							inputBuffer = item.note ?? "";
						} else if (data === "P" && item) {
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
							detailScroll = 0;
							const newVisible = getVisible();
							if (selectedIdx >= newVisible.length) selectedIdx = Math.max(0, newVisible.length - 1);
						} else if (data === "b" && item) {
							moveToTasks(ctx, store, item);
							detailId = null;
							detailScroll = 0;
							const newVisible = getVisible();
							if (selectedIdx >= newVisible.length) selectedIdx = Math.max(0, newVisible.length - 1);
						}
						(tui as any).requestRender?.();
						return;
					}

					// List view keybindings
					if (data === "q" || matchesKey(data, Key.escape)) { done(undefined); return; }

					if ((matchesKey(data, Key.up) || data === "k") && visible.length > 0) {
						selectedIdx = Math.max(0, selectedIdx - 1);
					} else if ((matchesKey(data, Key.down) || data === "j") && visible.length > 0) {
						selectedIdx = Math.min(visible.length - 1, selectedIdx + 1);
					} else if (matchesKey(data, Key.enter)) {
						const item = visible[selectedIdx];
						if (item) {
							detailId = item.id;
							detailScroll = 0;
						}
					} else if (data === "n") {
						inputMode = "add";
						inputBuffer = "";
					} else if (data === "s") {
						const item = visible[selectedIdx];
						if (item) {
							done({ type: "switch-session", itemId: item.id });
							return;
						}
					} else if (data === "v") {
						const item = visible[selectedIdx];
						if (item) {
							done({ type: "view-session", itemId: item.id });
							return;
						}
					} else if (data === "p") {
						const item = visible[selectedIdx];
						if (item) copySourcePath(ctx, item);
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
					} else if (data === "P") {
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
					} else if (data === "a") {
						showDone = !showDone;
						selectedIdx = 0;
					} else if (data === "b") {
						const item = visible[selectedIdx];
						if (item) {
							moveToTasks(ctx, store, item);
							const newVisible = getVisible();
							if (selectedIdx >= newVisible.length) selectedIdx = Math.max(0, newVisible.length - 1);
						}
					}

					(tui as any).requestRender?.();
				},
				invalidate: () => {},
			};
		},
		{ overlay: true, overlayOptions: { width: "90%", maxHeight: "90%", anchor: "center" } },
	);

	if (!action) return;
	const item = store.items.find((i) => i.id === action.itemId);
	if (!item) {
		ctx.ui.notify(`백로그 #${action.itemId}을 찾을 수 없습니다.`, "error");
		return;
	}
	try {
		if (action.type === "switch-session") await switchToSourceSession(ctx, item);
		else if (action.type === "view-session") await exportAndOpenSourceSession(pi, ctx, item);
	} catch (error) {
		ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
	}
}

// ─── CLI subcommands ───────────────────────────────────────────────────────

function handleAdd(rest: string, ctx: ExtensionCommandContext) {
	if (!rest) { ctx.ui.notify("Usage: /backlog add <title> [--high|--low] [--note \"...\"]", "error"); return; }
	const store = load();
	const { title, priority, note } = parsePriority(rest);
	const item = createBacklogItem(store, title, priority, note, ctx);
	save(store);
	const sourceSuffix = item.sourceSession?.sessionFile ? ` · 관련 대화 기록됨: ${displayPath(item.sourceSession.sessionFile)}` : "";
	ctx.ui.notify(`#${item.id} 추가됨 [${priority}]: ${title}${sourceSuffix}`, "info");
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
		const source = sourceSessionFile(i) ? " 📎" : "";
		const note = i.note ? ` — ${i.note.slice(0, 40)}` : "";
		return `${icon} #${i.id} ${i.title}${source}${note}`;
	});
	ctx.ui.notify(`Backlog (${open.length}):\n${lines.join("\n")}`, "info");
}

// ─── Extension ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	pi.registerCommand("backlog", {
		description: "Manage persistent backlog. Subcommands: (none)=overlay, add, done, list",
		handler: async (args, ctx) => {
			const { sub, rest } = parseArgs(args);
			if (!sub || sub === "open") return showOverlay(pi, ctx);
			if (sub === "add") return handleAdd(rest, ctx);
			if (sub === "done") return handleDone(rest, ctx);
			if (sub === "list" || sub === "ls") return handleList(ctx);
			return showOverlay(pi, ctx);
		},
	});
}
