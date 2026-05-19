import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type ShortcutLayer = "terminal" | "pi" | "pilee";
export type ShortcutSeverity = "error" | "warning" | "info";

export interface ShortcutEntry {
	key: string;
	action: string;
	layer: ShortcutLayer;
	scope: string;
	source: string;
	description?: string;
}

export interface ShortcutIssue {
	severity: ShortcutSeverity;
	type: "custom-collision" | "reserved-overlap" | "core-duplicate";
	key: string;
	entries: ShortcutEntry[];
	message: string;
}

export interface ShortcutAtlas {
	entries: ShortcutEntry[];
	issues: ShortcutIssue[];
	summary: {
		total: number;
		terminal: number;
		pi: number;
		pilee: number;
		errors: number;
		warnings: number;
	};
}

const MODIFIER_ORDER = ["cmd", "ctrl", "alt", "shift"] as const;
const KEY_ALIASES: Record<string, string> = {
	command: "cmd",
	meta: "cmd",
	option: "alt",
	esc: "escape",
	return: "enter",
	pgup: "pageup",
	pgdn: "pagedown",
	spacebar: "space",
};

function one(key: string, action: string, layer: ShortcutLayer, scope: string, source: string, description?: string): ShortcutEntry {
	return { key, action, layer, scope, source, description };
}

function many(keys: string[], action: string, layer: ShortcutLayer, scope: string, source: string, description?: string): ShortcutEntry[] {
	return keys.map((key) => one(key, action, layer, scope, source, description));
}

export const TERMINAL_SHORTCUTS: ShortcutEntry[] = [
	one("cmd+t", "새 터미널 탭", "terminal", "Ghostty/macOS", "terminal-host"),
	one("cmd+n", "새 터미널 윈도우", "terminal", "Ghostty/macOS", "terminal-host"),
	one("cmd+w", "현재 탭/윈도우 닫기", "terminal", "Ghostty/macOS", "terminal-host"),
	one("cmd+d", "오른쪽 분할", "terminal", "Ghostty/macOS", "terminal-host"),
	one("cmd+shift+d", "아래쪽 분할", "terminal", "Ghostty/macOS", "terminal-host"),
	one("cmd+k", "터미널 화면 지우기", "terminal", "Ghostty/macOS", "terminal-host"),
	one("cmd+c", "복사", "terminal", "Ghostty/macOS", "terminal-host"),
	one("cmd+v", "붙여넣기", "terminal", "Ghostty/macOS", "terminal-host"),
	one("cmd+=", "확대", "terminal", "Glimpse/WebView host", "terminal-host"),
	one("cmd+-", "축소", "terminal", "Glimpse/WebView host", "terminal-host"),
	one("cmd+0", "확대/축소 초기화", "terminal", "Glimpse/WebView host", "terminal-host"),
];

export const PI_CORE_SHORTCUTS: ShortcutEntry[] = [
	...many(["up"], "커서 위", "pi", "editor", "pi keybindings"),
	...many(["down"], "커서 아래", "pi", "editor", "pi keybindings"),
	...many(["left", "ctrl+b"], "커서 왼쪽", "pi", "editor", "pi keybindings"),
	...many(["right", "ctrl+f"], "커서 오른쪽", "pi", "editor", "pi keybindings"),
	...many(["alt+left", "ctrl+left", "alt+b"], "단어 왼쪽", "pi", "editor", "pi keybindings"),
	...many(["alt+right", "ctrl+right", "alt+f"], "단어 오른쪽", "pi", "editor", "pi keybindings"),
	...many(["home", "ctrl+a"], "라인 시작", "pi", "editor", "pi keybindings"),
	...many(["end", "ctrl+e"], "라인 끝", "pi", "editor", "pi keybindings"),
	...many(["ctrl+]"], "문자 앞으로 점프", "pi", "editor", "pi keybindings"),
	...many(["ctrl+alt+]"], "문자 뒤로 점프", "pi", "editor", "pi keybindings"),
	...many(["pageup"], "페이지 위", "pi", "editor", "pi keybindings"),
	...many(["pagedown"], "페이지 아래", "pi", "editor", "pi keybindings"),
	...many(["backspace"], "뒤 문자 삭제", "pi", "editor", "pi keybindings"),
	...many(["delete", "ctrl+d"], "앞 문자 삭제", "pi", "editor", "pi keybindings"),
	...many(["ctrl+w", "alt+backspace"], "앞 단어 삭제", "pi", "editor", "pi keybindings"),
	...many(["alt+d", "alt+delete"], "뒤 단어 삭제", "pi", "editor", "pi keybindings"),
	...many(["ctrl+u"], "라인 시작까지 삭제", "pi", "editor", "pi keybindings"),
	...many(["ctrl+k"], "라인 끝까지 삭제", "pi", "editor", "pi keybindings"),
	...many(["shift+enter"], "새 줄 입력", "pi", "input", "pi keybindings"),
	...many(["enter"], "입력 제출", "pi", "input", "pi keybindings"),
	...many(["tab"], "자동완성/탭", "pi", "input", "pi keybindings"),
	...many(["ctrl+y"], "삭제 ring 붙여넣기", "pi", "editor", "pi keybindings"),
	...many(["alt+y"], "삭제 ring 순환", "pi", "editor", "pi keybindings"),
	...many(["ctrl+-"], "입력 undo", "pi", "editor", "pi keybindings"),
	...many(["ctrl+c"], "선택 복사 / 취소", "pi", "clipboard/select", "pi keybindings"),
	...many(["escape"], "취소/abort", "pi", "app", "pi keybindings"),
	...many(["ctrl+d"], "빈 editor에서 종료", "pi", "app", "pi keybindings"),
	...many(["ctrl+z"], "프로세스 suspend", "pi", "app", "pi keybindings"),
	...many(["ctrl+g"], "외부 editor 열기", "pi", "app", "pi keybindings"),
	...many(["ctrl+v"], "이미지 붙여넣기", "pi", "app", "pi keybindings"),
	...many(["ctrl+p"], "path 표시 / 다음 모델", "pi", "session/model", "pi keybindings"),
	...many(["ctrl+s"], "session sort / model 저장", "pi", "session/model", "pi keybindings"),
	...many(["ctrl+n"], "named filter", "pi", "session", "pi keybindings"),
	...many(["ctrl+r"], "session 이름 변경", "pi", "session", "pi keybindings"),
	...many(["ctrl+backspace"], "query 비었을 때 session 삭제", "pi", "session", "pi keybindings"),
	...many(["ctrl+l"], "모델 선택", "pi", "model", "pi keybindings"),
	...many(["ctrl+shift+p"], "이전 모델", "pi", "model", "pi keybindings"),
	...many(["shift+tab"], "thinking level 순환", "pi", "thinking", "pi keybindings"),
	...many(["ctrl+t"], "thinking 접기/펼치기", "pi", "thinking", "pi keybindings"),
	...many(["ctrl+o"], "도구 출력 접기/펼치기", "pi", "display", "pi keybindings"),
	...many(["alt+enter"], "follow-up message queue", "pi", "message queue", "pi keybindings"),
	...many(["alt+up"], "queued message 복원", "pi", "message queue", "pi keybindings"),
	...many(["ctrl+left", "alt+left"], "tree fold/up", "pi", "tree", "pi keybindings"),
	...many(["ctrl+right", "alt+right"], "tree unfold/down", "pi", "tree", "pi keybindings"),
	...many(["shift+l"], "tree label 편집", "pi", "tree", "pi keybindings"),
	...many(["shift+t"], "tree timestamp 토글", "pi", "tree", "pi keybindings"),
	...many(["ctrl+u"], "tree user-only filter", "pi", "tree", "pi keybindings"),
	...many(["ctrl+o"], "tree filter forward", "pi", "tree", "pi keybindings"),
	...many(["ctrl+shift+o"], "tree filter backward", "pi", "tree", "pi keybindings"),
	...many(["ctrl+x"], "scoped models clear all", "pi", "scoped models", "pi keybindings"),
	...many(["alt+down"], "scoped model reorder down", "pi", "scoped models", "pi keybindings"),
];

export const PILEE_CUSTOM_SHORTCUTS: ShortcutEntry[] = [
	one("ctrl+w", "워크트리 대시보드", "pilee", "global", "extensions/worktree"),
	one("ctrl+shift+right", "fork-panel 오른쪽 분할", "pilee", "global", "extensions/fork-panel"),
	one("ctrl+shift+left", "fork-panel 왼쪽 분할", "pilee", "global", "extensions/fork-panel"),
	one("ctrl+shift+up", "fork-panel 위쪽 분할", "pilee", "global", "extensions/fork-panel"),
	one("ctrl+shift+down", "fork-panel 아래쪽 분할", "pilee", "global", "extensions/fork-panel"),
	one("ctrl+shift+n", "fork-panel 새 탭", "pilee", "global", "extensions/fork-panel"),
	one("ctrl+shift+g", "companion WebView 토글", "pilee", "global", "extensions/frame-studio"),
	one("ctrl+shift+t", "중앙 tasks overlay 열기", "pilee", "global", "extensions/tasks"),
	one("ctrl+shift+o", "우상단 tasks work-map overlay show/hide", "pilee", "global", "extensions/tasks"),
];

export function normalizeShortcutKey(key: string): string {
	const rawParts = String(key || "").trim().toLowerCase().split("+").map((part) => KEY_ALIASES[part] || part).filter(Boolean);
	const modifiers: string[] = [];
	const rest: string[] = [];
	for (const part of rawParts) {
		if ((MODIFIER_ORDER as readonly string[]).includes(part)) modifiers.push(part);
		else rest.push(part);
	}
	const uniqueModifiers = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier));
	return [...uniqueModifiers, rest.join("+")].filter(Boolean).join("+");
}

export function shortcutSortKey(entry: ShortcutEntry): string {
	const layerRank = { pilee: 1, pi: 2, terminal: 3 }[entry.layer] ?? 9;
	return `${layerRank}:${normalizeShortcutKey(entry.key)}:${entry.scope}:${entry.action}`;
}

export function analyzeShortcuts(entries: ShortcutEntry[]): ShortcutIssue[] {
	const byKey = new Map<string, ShortcutEntry[]>();
	for (const entry of entries) {
		const normalized = normalizeShortcutKey(entry.key);
		byKey.set(normalized, [...(byKey.get(normalized) ?? []), entry]);
	}

	const issues: ShortcutIssue[] = [];
	for (const [key, sameKey] of byKey.entries()) {
		const custom = sameKey.filter((entry) => entry.layer === "pilee");
		const reserved = sameKey.filter((entry) => entry.layer !== "pilee");
		if (custom.length > 1) {
			issues.push({ severity: "error", type: "custom-collision", key, entries: custom, message: `pilee custom shortcut ${key}가 ${custom.length}개 action에 등록되어 있습니다.` });
			continue;
		}
		if (custom.length === 1 && reserved.length > 0) {
			issues.push({ severity: "warning", type: "reserved-overlap", key, entries: sameKey, message: `${key}는 pilee custom과 Pi/terminal 기본 단축키가 겹칩니다. 실제 우선순위를 확인하세요.` });
			continue;
		}
		if (custom.length === 0 && sameKey.length > 1) {
			issues.push({ severity: "info", type: "core-duplicate", key, entries: sameKey, message: `${key}는 Pi/terminal 내부 scoped shortcut에서 중복 사용됩니다.` });
		}
	}
	return issues.sort((a, b) => {
		const severityRank = { error: 1, warning: 2, info: 3 }[a.severity] - { error: 1, warning: 2, info: 3 }[b.severity];
		return severityRank || a.key.localeCompare(b.key);
	});
}

export function buildShortcutAtlas(extraCustom: ShortcutEntry[] = []): ShortcutAtlas {
	const entries = [...TERMINAL_SHORTCUTS, ...PI_CORE_SHORTCUTS, ...PILEE_CUSTOM_SHORTCUTS, ...extraCustom]
		.map((entry) => ({ ...entry, key: normalizeShortcutKey(entry.key) }))
		.sort((a, b) => shortcutSortKey(a).localeCompare(shortcutSortKey(b)));
	const issues = analyzeShortcuts(entries);
	return {
		entries,
		issues,
		summary: {
			total: entries.length,
			terminal: entries.filter((entry) => entry.layer === "terminal").length,
			pi: entries.filter((entry) => entry.layer === "pi").length,
			pilee: entries.filter((entry) => entry.layer === "pilee").length,
			errors: issues.filter((issue) => issue.severity === "error").length,
			warnings: issues.filter((issue) => issue.severity === "warning").length,
		},
	};
}

function walkFiles(dir: string, out: string[] = []): string[] {
	if (!existsSync(dir)) return out;
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
		const path = join(dir, entry.name);
		if (entry.isDirectory()) walkFiles(path, out);
		else if (/\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) out.push(path);
	}
	return out;
}

export function isKeyboardShortcutLike(key: string): boolean {
	return /^(cmd|ctrl|alt|shift)(\+|$)/.test(normalizeShortcutKey(key)) || /^(enter|escape|tab|space|up|down|left|right|pageup|pagedown|home|end|f\d+)$/i.test(key);
}

export function collectLiteralShortcutKeys(rootDir: string): ShortcutEntry[] {
	const entries: ShortcutEntry[] = [];
	const extensionRoot = join(rootDir, "extensions");
	for (const file of walkFiles(extensionRoot)) {
		const text = readFileSync(file, "utf8");
		const regex = /registerShortcut\(\s*["'`]([^"'`]+)["'`]/g;
		for (const match of text.matchAll(regex)) {
			const key = normalizeShortcutKey(match[1]);
			if (!isKeyboardShortcutLike(key)) continue;
			entries.push(one(key, "source literal", "pilee", "source-scan", file.replace(`${rootDir}/`, "")));
		}
	}
	return entries;
}

export function customShortcutCoverage(rootDir: string): { missing: ShortcutEntry[]; scanned: ShortcutEntry[] } {
	const scanned = collectLiteralShortcutKeys(rootDir);
	const known = new Set(PILEE_CUSTOM_SHORTCUTS.map((entry) => normalizeShortcutKey(entry.key)));
	const missing = scanned.filter((entry) => !known.has(normalizeShortcutKey(entry.key)));
	return { missing, scanned };
}
