import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { WorkspaceSnapshot } from "./index.ts";
import { readSessionIdentity } from "./planner.ts";
import { readRegistrations } from "./registry.ts";

export type GhosttyTerminal = { id: string; index: number; name: string; cwd: string };
export type GhosttyTab = { id: string; index: number; selected: boolean; name: string; terminals: GhosttyTerminal[] };
export type GhosttyWindow = { id: string; name: string; tabs: GhosttyTab[] };

export function bindCapturedWindow(window: GhosttyWindow, workspaceDir: string): WorkspaceSnapshot["tabs"] {
	const records = readRegistrations(workspaceDir);
	const issues: string[] = [];
	const seen = new Set<string>();
	if (!window.id || !window.tabs.length) issues.push("Ghostty 창/탭 정보가 없습니다.");
	const tabs = window.tabs.map((tab) => ({ ...tab, terminals: tab.terminals.map((term) => {
		const key = `tab ${tab.index} / panel ${term.index} (${term.id || "ID 없음"})`;
		try {
			if (!tab.id || !term.id || seen.has(term.id)) throw new Error("패널 ID 누락·중복");
			seen.add(term.id);
			const matches = records.filter((record) => record.binding?.windowId === window.id && record.binding.terminalId === term.id);
			if (matches.length !== 1) throw new Error(matches.length ? "여러 live process의 중복 binding" : "정확한 live binding 없음 (미등록·종료·이전 runtime)");
			const record = matches[0];
			if (record.error) throw new Error(record.error);
			const identity = readSessionIdentity(record.sessionFile);
			if (identity.sessionFile !== record.sessionFile || identity.sessionCwd !== record.cwd) throw new Error("등록 후 session/cwd identity가 변경됨");
			return { ...term, sessionFile: identity.sessionFile, sessionTitle: record.title, panelLabel: record.panelLabel,
				forkId: record.forkId, parentSessionFile: record.parentSessionFile, match: "exact" as const };
		} catch (error) {
			issues.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
			return term;
		}
	}) }));
	if (tabs.some((tab) => !tab.terminals.length)) issues.push("패널이 없는 탭이 있습니다.");
	if (issues.length) throw new Error(`불완전 capture — 저장·자동본 정리를 하지 않습니다. 해당 패널에서 /reload 후 /workspace status를 확인하세요.\n${issues.join("\n")}`);
	return tabs;
}

export function parseGhosttySnapshotOutput(stdout: string): GhosttyWindow {
	const window: GhosttyWindow = { id: "", name: "", tabs: [] };
	let currentTab: GhosttyTab | undefined;
	for (const line of stdout.split(/\r?\n/u)) {
		if (!line.trim()) continue;
		const [kind, ...parts] = line.split("\t");
		if (kind === "WINDOW" && !window.id && parts.length === 2) {
			[window.id, window.name] = parts;
		} else if (kind === "TAB" && window.id && parts.length === 4 && /^[1-9]\d*$/u.test(parts[1])) {
			currentTab = { id: parts[0], index: Number(parts[1]), selected: parts[2] === "true", name: parts[3], terminals: [] };
			window.tabs.push(currentTab);
		} else if (kind === "TERM" && currentTab && parts.length === 4 && /^[1-9]\d*$/u.test(parts[1])) {
			currentTab.terminals.push({ id: parts[0], index: Number(parts[1]), name: parts[2], cwd: parts[3] });
		} else throw new Error("Ghostty capture 응답이 불완전합니다.");
	}
	return window;
}

export function ghosttySnapshotScript(): string {
	return `property tabChar : character id 9
property newlineChar : character id 10

on cleanText(value)
  set s to value as text
  set s to my replaceText(tabChar, " ", s)
  set s to my replaceText(newlineChar, " ", s)
  set s to my replaceText(return, " ", s)
  return s
end cleanText

on replaceText(findText, replaceText, sourceText)
  set AppleScript's text item delimiters to findText
  set textItems to text items of sourceText
  set AppleScript's text item delimiters to replaceText
  set sourceText to textItems as text
  set AppleScript's text item delimiters to ""
  return sourceText
end replaceText

tell application "Ghostty"
  if not running then error "Ghostty is not running"
  set targetWindow to front window
  set out to "WINDOW" & tabChar & (id of targetWindow as text) & tabChar & my cleanText(name of targetWindow) & newlineChar
  repeat with targetTab in tabs of targetWindow
    set out to out & "TAB" & tabChar & (id of targetTab as text) & tabChar & (index of targetTab as text) & tabChar & (selected of targetTab as text) & tabChar & my cleanText(name of targetTab) & newlineChar
    set termIndex to 0
    repeat with targetTerm in terminals of targetTab
      set termIndex to termIndex + 1
      set termCwd to ""
      try
        set termCwd to working directory of targetTerm as text
      end try
      set out to out & "TERM" & tabChar & (id of targetTerm as text) & tabChar & (termIndex as text) & tabChar & my cleanText(name of targetTerm) & tabChar & my cleanText(termCwd) & newlineChar
    end repeat
  end repeat
  return out
end tell`;
}

export async function captureGhosttyWindow(pi: Pick<ExtensionAPI, "exec">, signal?: AbortSignal): Promise<GhosttyWindow> {
	const result = await pi.exec("osascript", ["-e", ghosttySnapshotScript()], { timeout: 5000, signal });
	if (result.code !== 0 || result.killed) throw new Error((result.stderr || "Ghostty capture 시간 초과").trim());
	const window = parseGhosttySnapshotOutput(result.stdout);
	if (!window.id || !window.tabs.length) throw new Error("Ghostty 창/탭을 찾지 못했습니다.");
	return window;
}
