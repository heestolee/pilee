import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, basename } from "node:path";
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, ThemeColor } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";

// ─── Storage ───────────────────────────────────────────────────────────────

const MEMORY_ROOT = join(homedir(), ".pi", "memory");

type Scope = "user" | "project";

interface Memory {
	id: string;
	scope: Scope;
	topic: string;
	content: string;
	createdAt: number;
	updatedAt: number;
}

interface MemoryIndex {
	memories: Memory[];
}

function userDir(): string { return join(MEMORY_ROOT, "user"); }
function projectDir(projectId: string): string { return join(MEMORY_ROOT, "projects", projectId); }

function ensureDir(dir: string) {
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function indexPath(dir: string): string { return join(dir, "MEMORY.json"); }

function loadIndex(dir: string): MemoryIndex {
	const p = indexPath(dir);
	if (!existsSync(p)) return { memories: [] };
	try { return JSON.parse(readFileSync(p, "utf8")); } catch { return { memories: [] }; }
}

function saveIndex(dir: string, index: MemoryIndex) {
	ensureDir(dir);
	writeFileSync(indexPath(dir), JSON.stringify(index, null, 2));
}

function generateId(): string {
	return `mem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

// ─── Project ID resolution ─────────────────────────────────────────────────

async function resolveProjectId(pi: ExtensionAPI, cwd: string): Promise<string> {
	// Try git remote origin
	const remoteR = await pi.exec("git", ["remote", "get-url", "origin"], { cwd });
	if (remoteR.code === 0 && remoteR.stdout?.trim()) {
		const url = remoteR.stdout.trim();
		return url
			.replace(/^(https?:\/\/|git@|ssh:\/\/)/, "")
			.replace(/\.git$/, "")
			.replace(/:/g, "/")
			.replace(/[^a-zA-Z0-9\-\/]/g, "-")
			.replace(/\/+/g, "--");
	}

	// Try root commit hash
	const commitR = await pi.exec("git", ["rev-list", "--max-parents=0", "HEAD"], { cwd });
	if (commitR.code === 0 && commitR.stdout?.trim()) {
		return `commit-${commitR.stdout.trim().slice(0, 8)}`;
	}

	// Fallback: cwd hash
	const hash = cwd.split("").reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
	return `local-${Math.abs(hash).toString(16).slice(0, 8)}`;
}

// ─── CRUD operations ───────────────────────────────────────────────────────

function getAllMemories(projectId: string): Memory[] {
	const userMems = loadIndex(userDir()).memories;
	const projectMems = loadIndex(projectDir(projectId)).memories;
	return [...userMems, ...projectMems];
}

function addMemory(scope: Scope, projectId: string, topic: string, content: string): Memory {
	const dir = scope === "user" ? userDir() : projectDir(projectId);
	const index = loadIndex(dir);
	const mem: Memory = {
		id: generateId(),
		scope,
		topic: topic || "general",
		content,
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	index.memories.push(mem);
	saveIndex(dir, index);
	return mem;
}

function deleteMemory(id: string, projectId: string): boolean {
	for (const dir of [userDir(), projectDir(projectId)]) {
		const index = loadIndex(dir);
		const before = index.memories.length;
		index.memories = index.memories.filter((m) => m.id !== id);
		if (index.memories.length < before) {
			saveIndex(dir, index);
			return true;
		}
	}
	return false;
}

function searchMemories(query: string, projectId: string): Memory[] {
	const all = getAllMemories(projectId);
	const q = query.toLowerCase();
	return all.filter((m) =>
		m.content.toLowerCase().includes(q) ||
		m.topic.toLowerCase().includes(q) ||
		m.id.includes(q),
	);
}

// ─── System prompt injection ───────────────────────────────────────────────

function buildMemorySnippet(memories: Memory[]): string {
	if (memories.length === 0) return "";
	const lines = ["<memories>", "The following memories are stored from previous sessions:"];
	const byTopic = new Map<string, Memory[]>();
	for (const m of memories) {
		const key = `[${m.scope}] ${m.topic}`;
		if (!byTopic.has(key)) byTopic.set(key, []);
		byTopic.get(key)!.push(m);
	}
	for (const [topic, mems] of byTopic) {
		lines.push(`\n### ${topic}`);
		for (const m of mems) {
			lines.push(`- ${m.content} (id: ${m.id})`);
		}
	}
	lines.push("</memories>");
	return lines.join("\n");
}

// ─── Tools ─────────────────────────────────────────────────────────────────

function text(msg: string) {
	return { content: [{ type: "text" as const, text: msg }], details: {} };
}

// ─── Overlay ───────────────────────────────────────────────────────────────

async function showMemoryOverlay(ctx: ExtensionCommandContext, projectId: string) {
	const allMems = () => getAllMemories(projectId);
	let selectedIdx = 0;
	let showHelp = false;
	let viewingId: string | null = null;
	let searchQuery = "";
	let searchMode = false;
	let scopeFilter: "all" | "user" | "project" = "all";

	const getFiltered = () => {
		let mems = allMems();
		if (scopeFilter !== "all") mems = mems.filter((m) => m.scope === scopeFilter);
		if (searchQuery) {
			const q = searchQuery.toLowerCase();
			mems = mems.filter((m) => m.content.toLowerCase().includes(q) || m.topic.toLowerCase().includes(q));
		}
		return mems;
	};

	await ctx.ui.custom<void>(
		(tui, theme, _kb, done) => {
			const renderHelp = (w: number): string[] => {
				const lines: string[] = [];
				lines.push(...new DynamicBorder((s: string) => theme.fg("accent", s)).render(w));
				lines.push(`  ${theme.bold("KEYBINDINGS")}`);
				lines.push("");
				lines.push(`  ${theme.fg("warning", "↑/↓, k/j")}  항목 이동`);
				lines.push(`  ${theme.fg("warning", "Enter")}     상세 보기`);
				lines.push(`  ${theme.fg("warning", "d")}         삭제`);
				lines.push(`  ${theme.fg("warning", "s")}         scope 변경 (All→Global→Project)`);
				lines.push(`  ${theme.fg("warning", "/")}         검색`);
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
					const mems = getFiltered();
					const lines: string[] = [];
					lines.push(theme.fg("accent", "─".repeat(w)));

					const scopeLabel = scopeFilter === "all" ? "All" : scopeFilter === "user" ? "Global" : "Project";
					lines.push(`  ${theme.bold("Memories")} (${mems.length})  Scope: ${theme.fg("accent", scopeLabel)} [s]  ${searchMode ? theme.fg("warning", `Search: ${searchQuery}│`) : "/ to search"}`);
					lines.push(theme.fg("accent", "─".repeat(w)));

					if (viewingId) {
						const mem = mems.find((m) => m.id === viewingId);
						if (mem) {
							lines.push(`  ${theme.fg("accent", `#${mem.id}`)} [${mem.scope}] ${mem.topic}`);
							lines.push(`  Created: ${new Date(mem.createdAt).toLocaleDateString()}`);
							lines.push("");
							for (const line of mem.content.split("\n")) {
								lines.push(`  ${line}`);
							}
							lines.push("");
							lines.push("  Esc 돌아가기 · d 삭제");
						}
					} else if (mems.length === 0) {
						lines.push(searchQuery ? `  "${searchQuery}" 검색 결과 없음` : "  메모리 없음. /remember로 추가하세요.");
					} else {
						const visibleHeight = Math.max(5, ((tui as any).terminal?.rows ?? 24) - 8);
						let scrollOffset = 0;
						if (selectedIdx >= scrollOffset + visibleHeight) scrollOffset = selectedIdx - visibleHeight + 1;
						if (selectedIdx < scrollOffset) scrollOffset = selectedIdx;

						for (let i = scrollOffset; i < Math.min(mems.length, scrollOffset + visibleHeight); i++) {
							const m = mems[i];
							const sel = i === selectedIdx;
							const cursor = sel ? theme.fg("accent", "▶") : " ";
							const scope = m.scope === "user" ? "G" : theme.fg("accent", "P");
							const topic = m.topic.padEnd(15);
							const preview = m.content.split("\n")[0].slice(0, 60);
							const content = sel ? theme.fg("accent", preview) : preview;
							lines.push(truncateToWidth(`${cursor} ${scope} ${topic} ${content}`, w, ""));
						}
					}

					lines.push(theme.fg("accent", "─".repeat(w)));
					lines.push("  ↑↓ 이동 · Enter 상세 · d 삭제 · s scope · / 검색 · q 닫기");
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

					const mems = getFiltered();

					if (searchMode) {
						if (matchesKey(data, Key.escape) || matchesKey(data, Key.enter)) {
							searchMode = false;
						} else if (matchesKey(data, Key.backspace)) {
							searchQuery = searchQuery.slice(0, -1);
							selectedIdx = 0;
						} else if (data.length === 1 && data >= " ") {
							searchQuery += data;
							selectedIdx = 0;
						}
						(tui as any).requestRender?.();
						return;
					}

					if (viewingId) {
						if (matchesKey(data, Key.escape)) {
							viewingId = null;
						} else if (data === "d") {
							deleteMemory(viewingId, projectId);
							viewingId = null;
							if (selectedIdx >= getFiltered().length) selectedIdx = Math.max(0, getFiltered().length - 1);
						}
						(tui as any).requestRender?.();
						return;
					}

					if (data === "q" || matchesKey(data, Key.escape)) { done(undefined); return; }
					if (matchesKey(data, Key.up) || data === "k") selectedIdx = Math.max(0, selectedIdx - 1);
					else if (matchesKey(data, Key.down) || data === "j") selectedIdx = Math.min(mems.length - 1, selectedIdx + 1);
					else if (matchesKey(data, Key.enter)) {
						const m = mems[selectedIdx];
						if (m) viewingId = m.id;
					} else if (data === "d") {
						const m = mems[selectedIdx];
						if (m) {
							deleteMemory(m.id, projectId);
							if (selectedIdx >= getFiltered().length) selectedIdx = Math.max(0, getFiltered().length - 1);
						}
					} else if (data === "s") {
						scopeFilter = scopeFilter === "all" ? "user" : scopeFilter === "user" ? "project" : "all";
						selectedIdx = 0;
					} else if (data === "/") {
						searchMode = true;
						searchQuery = "";
					}
					(tui as any).requestRender?.();
				},
				invalidate: () => {},
			};
		},
		{ overlay: true, overlayOptions: { width: "90%", maxHeight: "80%", anchor: "center" } },
	);
}

// ─── Extension ─────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	let projectId = "unknown";

	pi.on("session_start", async (_e, ctx) => {
		projectId = await resolveProjectId(pi, ctx.cwd);
	});

	// Inject memories into system prompt each turn
	pi.on("before_agent_start", async (event, ctx) => {
		const all = getAllMemories(projectId);
		if (all.length === 0) return;
		const snippet = buildMemorySnippet(all);
		return { systemPrompt: `${event.systemPrompt}\n\n${snippet}` };
	});

	// Tool: remember
	pi.registerTool({
		name: "remember",
		label: "Remember",
		description: "Save a fact, rule, or lesson to long-term memory. Survives across sessions.",
		parameters: Type.Object({
			content: Type.String({ description: "What to remember" }),
			scope: Type.Optional(Type.Union([Type.Literal("user"), Type.Literal("project")], { description: "user = global, project = this repo only. Default: project" })),
			topic: Type.Optional(Type.String({ description: "Category (e.g. 'coding-rules', 'project-setup', 'debugging'). Default: 'general'" })),
		}),
		async execute(_id, params) {
			const scope = params.scope ?? "project";
			const mem = addMemory(scope, projectId, params.topic ?? "general", params.content);
			return text(`Remembered [${scope}/${mem.topic}]: ${mem.content.slice(0, 80)}… (id: ${mem.id})`);
		},
	});

	// Tool: recall
	pi.registerTool({
		name: "recall",
		label: "Recall",
		description: "Search long-term memories by keyword, or retrieve by ID.",
		parameters: Type.Object({
			query: Type.Optional(Type.String({ description: "Search keyword" })),
			id: Type.Optional(Type.String({ description: "Memory ID to retrieve" })),
		}),
		async execute(_id, params) {
			if (params.id) {
				const all = getAllMemories(projectId);
				const mem = all.find((m) => m.id === params.id);
				return mem ? text(`[${mem.scope}/${mem.topic}] ${mem.content}`) : text(`Memory not found: ${params.id}`);
			}
			if (params.query) {
				const results = searchMemories(params.query, projectId);
				if (results.length === 0) return text(`No memories matching "${params.query}".`);
				return text(results.map((m) => `[${m.scope}/${m.topic}] ${m.content} (id: ${m.id})`).join("\n"));
			}
			// List all
			const all = getAllMemories(projectId);
			if (all.length === 0) return text("No memories stored.");
			return text(all.map((m) => `[${m.scope}/${m.topic}] ${m.content.slice(0, 80)} (id: ${m.id})`).join("\n"));
		},
	});

	// Tool: forget
	pi.registerTool({
		name: "forget",
		label: "Forget",
		description: "Permanently delete a memory by ID.",
		parameters: Type.Object({
			id: Type.String({ description: "Memory ID to delete" }),
		}),
		async execute(_id, params) {
			const ok = deleteMemory(params.id, projectId);
			return text(ok ? `Deleted memory ${params.id}` : `Memory not found: ${params.id}`);
		},
	});

	// Command: /memory — overlay browser
	pi.registerCommand("memory", {
		description: "Browse, search, and manage memories",
		handler: async (_args, ctx) => showMemoryOverlay(ctx, projectId),
	});

	// Command: /remember — quick save
	pi.registerCommand("remember", {
		description: "Quick save a memory. Usage: /remember <content>",
		handler: async (args, ctx) => {
			const content = args.trim();
			if (!content) {
				ctx.ui.notify("Usage: /remember <content>", "error");
				return;
			}
			const mem = addMemory("project", projectId, "general", content);
			ctx.ui.notify(`Remembered: ${content.slice(0, 60)}… (id: ${mem.id})`, "info");
		},
	});
}
