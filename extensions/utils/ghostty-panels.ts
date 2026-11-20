import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { appleScriptString as esc } from "./session-launch.ts";
import { beginTerminalTitleProbe } from "./terminal-title.ts";

// Ghostty 화면을 열고 닫고 입력하는 AppleScript는 모두 이 모듈에서 만든다.
// 기준은 요청이 나온 패널(이 Pi가 실행 중인 패널)이며, 포커스된 패널·맨 앞 창은 그 패널을 못 찾았을 때만 쓴다.

export const SPLIT_DIRECTIONS = ["right", "left", "down", "up"] as const;
export type SplitDirection = (typeof SPLIT_DIRECTIONS)[number];
export interface SplitPlacement {
	anchorPath: SplitDirection[];
	splitDirection: SplitDirection;
}
export type PanelOpenTarget = "tab" | SplitPlacement;
/** source=요청이 나온 패널 기준, group=같은 요청에서 먼저 연 패널에 이어 붙임, focused=출처 패널을 못 찾아 포커스된 패널 기준. */
export type PanelAnchor = "source" | "group" | "focused";

type Exec = Pick<ExtensionAPI, "exec">;

const OPPOSITE: Record<SplitDirection, SplitDirection> = { right: "left", left: "right", down: "up", up: "down" };
// 같은 요청에서 같은 방향으로 여러 개를 열면 출처 패널을 계속 반으로 나누지 않고, 첫 패널 쪽에서 수직 방향으로 쌓는다.
const STACK: Record<SplitDirection, SplitDirection> = { right: "down", left: "down", down: "right", up: "right" };

type PanelState = {
	ownTerminalId?: string;
	probing?: Promise<string | undefined>;
	queue: Promise<unknown>;
	request?: { groups: Map<string, string> };
};

const STATE = Symbol.for("pilee.ghostty-panels");
function state(): PanelState {
	const root = globalThis as typeof globalThis & { [STATE]?: PanelState };
	return root[STATE] ??= { queue: Promise.resolve() };
}

// 같은 Pi 안에서 화면 조작이 섞이지 않도록 한 번에 하나씩 실행한다.
function serialize<T>(task: () => Promise<T>): Promise<T> {
	const current = state();
	const run = current.queue.then(task, task);
	current.queue = run.catch(() => undefined);
	return run;
}

// ─── 자기 패널 찾기 ───────────────────────────────────────────────

export function ghosttyBindingScript(marker: string): string {
	if (!/^\[pilee:[a-f0-9-]+\]$/u.test(marker)) throw new Error("잘못된 등록 표식");
	return `tell application "Ghostty"
  if not running then error "Ghostty is not running"
  set matches to ""
  repeat with targetWindow in windows
    repeat with targetTab in tabs of targetWindow
      repeat with targetTerm in terminals of targetTab
        if (name of targetTerm as text) contains "${marker}" then
          set matches to matches & (id of targetWindow as text) & (character id 9) & (id of targetTerm as text) & (character id 10)
        end if
      end repeat
    end repeat
  end repeat
  return matches
end tell`;
}

export function parseBindingOutput(output: string): { windowId: string; terminalId: string } | undefined {
	const lines = output.trim().split(/\r?\n/u).filter(Boolean);
	if (lines.length > 1) throw new Error("등록 표식이 여러 Ghostty 패널에 있습니다. 정확한 연결을 확정할 수 없습니다.");
	if (!lines.length) return;
	const [windowId, terminalId, extra] = lines[0].split("\t");
	if (!windowId || !terminalId || extra !== undefined) throw new Error("Ghostty 등록 응답 형식이 잘못되었습니다.");
	return { windowId, terminalId };
}

/** workspace 패널 등록이 찾은 결과를 같이 쓴다. Pi 프로세스는 자기 패널을 옮겨 다니지 않으므로 프로세스 단위로 기억한다. */
export function rememberOwnTerminal(terminalId: string | undefined): void {
	state().ownTerminalId = terminalId || undefined;
}

function canProbe(ctx: ExtensionContext): boolean {
	try {
		return process.platform === "darwin" && process.env.TERM_PROGRAM === "ghostty" && ctx.hasUI
			&& !/[\\/]subagents[\\/]/u.test(ctx.sessionManager.getSessionFile() || "");
	} catch {
		return false;
	}
}

async function probeOwnTerminal(pi: Exec, ctx: ExtensionContext): Promise<string | undefined> {
	const marker = `[pilee:${randomUUID().slice(0, 8)}-${randomUUID().slice(0, 8)}]`;
	let restore: (() => void) | undefined;
	try {
		restore = beginTerminalTitleProbe(ctx, marker);
		for (let attempt = 0; attempt < 3; attempt++) {
			const result = await pi.exec("osascript", ["-e", ghosttyBindingScript(marker)], { timeout: 1000 });
			if (result.code !== 0 || result.killed) return undefined;
			const binding = parseBindingOutput(result.stdout ?? "");
			if (binding) {
				rememberOwnTerminal(binding.terminalId);
				return binding.terminalId;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
	} catch {
		return undefined;
	} finally {
		restore?.();
	}
	return undefined;
}

/** 이 Pi가 실행 중인 Ghostty 패널 id. 기억한 값이 없을 때만 패널 제목 표식으로 한 번 찾는다. */
export async function findOwnTerminal(pi: Exec, ctx?: ExtensionContext): Promise<string | undefined> {
	const current = state();
	if (current.ownTerminalId) return current.ownTerminalId;
	if (!ctx || !canProbe(ctx)) return undefined;
	current.probing ??= probeOwnTerminal(pi, ctx).finally(() => { current.probing = undefined; });
	return current.probing;
}

// ─── 한 요청 안에서 연 패널 묶기 ──────────────────────────────────

/** 한 요청 = 사용자가 메시지를 보낸 뒤 에이전트 응답이 끝날 때까지. 그 안에서 연 패널만 묶는다. */
export function beginPanelRequest(): void {
	state().request = { groups: new Map() };
}

export function endPanelRequest(): void {
	state().request = undefined;
}

export function registerPanelRequestScope(pi: Pick<ExtensionAPI, "on">): void {
	pi.on("agent_start", () => beginPanelRequest());
	pi.on("agent_end", () => endPanelRequest());
}

export function panelGroupKey(target: PanelOpenTarget): string {
	return target === "tab" ? "tab" : `split:${[...target.anchorPath, target.splitDirection].join(">")}`;
}

// ─── 스크립트 ────────────────────────────────────────────────────

function indent(lines: string[], depth = 1): string[] {
	return lines.map((line) => `${"  ".repeat(depth)}${line}`);
}

/**
 * 터미널 id로 그 터미널이 있는 탭·창을 찾는다.
 * 창·탭을 순번으로 훑으면 그사이 창 순서가 바뀔 때 다른 창을 가리키므로, id 목록을 먼저 받아 id로만 찾는다.
 */
function locateTerminalLines(targets: Array<{ id: string; prefix: string }>): string[] {
	if (targets.length === 0) return [];
	const lines: string[] = [];
	for (const { prefix } of targets) lines.push(`set ${prefix}TermId to ""`, `set ${prefix}TabId to ""`, `set ${prefix}WindowId to ""`);
	lines.push(
		// whose 조건 안의 식은 앱 쪽에서 해석되므로, 비교할 id는 미리 변수로 꺼낸다.
		"set candidateWindowIds to id of every window",
		"repeat with windowIndex from 1 to (count candidateWindowIds)",
		"  set candidateWindowId to (item windowIndex of candidateWindowIds) as text",
		"  try",
		"    set candidateWindow to first window whose id is candidateWindowId",
		"    set candidateTabIds to id of every tab of candidateWindow",
		"    repeat with tabIndex from 1 to (count candidateTabIds)",
		"      set candidateTabId to (item tabIndex of candidateTabIds) as text",
		"      set candidateTermIds to id of every terminal of (first tab of candidateWindow whose id is candidateTabId)",
	);
	for (const { id, prefix } of targets) {
		lines.push(
			`      if candidateTermIds contains "${esc(id)}" then`,
			`        set ${prefix}TermId to "${esc(id)}"`,
			`        set ${prefix}TabId to candidateTabId`,
			`        set ${prefix}WindowId to candidateWindowId`,
			"      end if",
		);
	}
	lines.push("    end repeat", "  end try", "end repeat");
	for (const { prefix } of targets) {
		lines.push(
			`set ${prefix}Term to missing value`,
			`if ${prefix}TermId is not "" then`,
			`  set ${prefix}Window to first window whose id is ${prefix}WindowId`,
			`  set ${prefix}Tab to first tab of ${prefix}Window whose id is ${prefix}TabId`,
			`  set ${prefix}Term to first terminal of ${prefix}Tab whose id is ${prefix}TermId`,
			"end if",
		);
	}
	return lines;
}

function navigationLines(anchorPath: SplitDirection[], tabVar: string, label: string): string[] {
	const lines = ["set anchorTerm to srcTerm"];
	for (const direction of anchorPath) {
		lines.push(
			"set previousAnchorId to id of anchorTerm",
			`set navigationOk to perform action "goto_split:${direction}" on anchorTerm`,
			"delay 0.1",
			`set nextAnchorTerm to focused terminal of ${tabVar}`,
			`if navigationOk is false then error "Ghostty goto_split:${direction} failed for ${esc(label)}"`,
			`if (id of nextAnchorTerm) is previousAnchorId then error "Ghostty anchor path ${esc(label)} did not move from " & previousAnchorId`,
			"set anchorTerm to nextAnchorTerm",
		);
	}
	return lines;
}

function placementLabel(placement: SplitPlacement): string {
	return [...placement.anchorPath, placement.splitDirection].join(" ");
}

export interface OpenPanelScriptInput {
	target: PanelOpenTarget;
	cwd: string;
	launchScriptPath: string;
	sourceTerminalId?: string;
	groupTerminalId?: string;
}

/**
 * 새 탭·분할 화면을 출처 패널 기준으로 열고, 사용자의 포커스는 열기 전으로 되돌린다.
 * Ghostty가 맨 앞이면 원래 패널에 focus를 걸고, 뒤에 있으면 앞으로 끌어오지 않는 동작만 쓴다.
 * 결과: "<새 terminal id>\t<source|group|focused>"
 */
export function buildOpenPanelScript(input: OpenPanelScriptInput): string {
	const { target } = input;
	const targets = [
		...(input.sourceTerminalId ? [{ id: input.sourceTerminalId, prefix: "src" }] : []),
		...(input.groupTerminalId ? [{ id: input.groupTerminalId, prefix: "group" }] : []),
	];
	const hasGroup = Boolean(input.groupTerminalId);
	const lines: string[] = [
		"set appWasFront to frontmost",
		"set userTerm to missing value",
		"if appWasFront then",
		"  try",
		"    set userTerm to focused terminal of selected tab of front window",
		"  end try",
		"end if",
		...locateTerminalLines(targets),
		...(input.sourceTerminalId ? [] : ["set srcTerm to missing value"]),
		...(hasGroup ? [] : ["set groupTerm to missing value"]),
		'set anchorKind to "source"',
		"if srcTerm is missing value then",
		'  set anchorKind to "focused"',
		"  set srcWindow to front window",
		"  set srcTab to selected tab of srcWindow",
		"  set srcTerm to focused terminal of srcTab",
		"end if",
		"set launchConfig to new surface configuration",
		`set initial working directory of launchConfig to "${esc(input.cwd)}"`,
		`set command of launchConfig to "${esc(input.launchScriptPath)}"`,
	];

	if (target === "tab") {
		lines.push(
			"if groupTerm is not missing value then",
			'  set anchorKind to "group"',
			"  set newTerm to split groupTerm direction right with configuration launchConfig",
			"  delay 0.1",
			'  perform action "equalize_splits" on newTerm',
			"else",
			"  set previousTab to selected tab of srcWindow",
			"  set previousPid to 0",
			"  set previousFrontWindowId to \"\"",
			"  if not appWasFront then",
			"    try",
			"      set previousFrontWindowId to (id of front window) as text",
			'      tell application "System Events" to set previousPid to unix id of first process whose frontmost is true',
			"    end try",
			"  end if",
			"  set newTab to new tab in srcWindow with configuration launchConfig",
			"  set newTerm to focused terminal of newTab",
			// 새 탭 만들기는 그 창의 선택 탭을 바꾸고 Ghostty를 앞으로 끌어온다. 탭 선택과(뒤에 있었다면) 원래 앱을 되돌린다.
			"  select tab previousTab",
			"  if not appWasFront then",
			// 앱을 다시 뒤로 보내도 Ghostty 안의 맨 앞 창은 바뀐 채 남는다. 돌아왔을 때 원래 창이 보이도록 되돌린다.
			"    if previousFrontWindowId is not \"\" and previousFrontWindowId is not ((id of srcWindow) as text) then",
			"      try",
			"        activate window (first window whose id is previousFrontWindowId)",
			"      end try",
			"    end if",
			"    if previousPid is not 0 then",
			"      try",
			'        tell application "System Events" to set frontmost of (first process whose unix id is previousPid) to true',
			"      end try",
			"    end if",
			"  end if",
			"end if",
		);
	} else {
		const returnPath = [OPPOSITE[target.splitDirection], ...[...target.anchorPath].reverse().map((direction) => OPPOSITE[direction])];
		lines.push(
			"set workTab to srcTab",
			"if groupTerm is not missing value then",
			'  set anchorKind to "group"',
			"  set workTab to groupTab",
			`  set newTerm to split groupTerm direction ${STACK[target.splitDirection]} with configuration launchConfig`,
			"else",
			...indent(navigationLines(target.anchorPath, "srcTab", placementLabel(target))),
			`  set newTerm to split anchorTerm direction ${target.splitDirection} with configuration launchConfig`,
			"end if",
			// 분할은 그 탭의 포커스를 새 패널로 옮긴다. Ghostty를 끌어오지 않는 goto_split로 출처 패널 쪽으로 되돌린다.
			"set cursorTerm to newTerm",
			`repeat with stepDirection in {${returnPath.map((direction) => `"${direction}"`).join(", ")}}`,
			"  try",
			'    perform action ("goto_split:" & (contents of stepDirection)) on cursorTerm',
			"    delay 0.05",
			"    set cursorTerm to focused terminal of workTab",
			"  end try",
			"end repeat",
		);
	}

	lines.push(
		"if appWasFront and userTerm is not missing value then focus userTerm",
		"return ((id of newTerm) as text) & (character id 9) & anchorKind",
	);
	return ['tell application "Ghostty"', ...indent(lines), "end tell"].join("\n");
}

export type PanelOpenResult =
	| { ok: true; terminalId: string; anchor: PanelAnchor }
	| { ok: false; reason: string };

export interface PanelOpenRequest {
	target: PanelOpenTarget;
	cwd: string;
	launchScriptPath: string;
	/** 기억한 자기 패널이 없을 때 패널 제목 표식으로 찾는 데 쓴다. */
	ctx?: ExtensionContext;
}

function isAnchor(value: string | undefined): value is PanelAnchor {
	return value === "source" || value === "group" || value === "focused";
}

export function openPanel(pi: Exec, request: PanelOpenRequest): Promise<PanelOpenResult> {
	return serialize(async () => {
		const sourceTerminalId = await findOwnTerminal(pi, request.ctx);
		const scope = state().request;
		const key = panelGroupKey(request.target);
		const script = buildOpenPanelScript({
			target: request.target,
			cwd: request.cwd,
			launchScriptPath: request.launchScriptPath,
			sourceTerminalId,
			groupTerminalId: scope?.groups.get(key),
		});
		const result = await pi.exec("osascript", ["-e", script]);
		if (result.code !== 0) {
			return { ok: false, reason: result.stderr?.trim() || result.stdout?.trim() || "Ghostty panel open failed" };
		}
		const [terminalId, anchor] = (result.stdout ?? "").trim().split("\t");
		if (!terminalId || !isAnchor(anchor)) return { ok: false, reason: "Ghostty가 새 terminal id를 반환하지 않았습니다." };
		if (scope && state().request === scope) scope.groups.set(key, terminalId);
		return { ok: true, terminalId, anchor };
	});
}

export function describePanelAnchor(anchor: PanelAnchor): string | undefined {
	return anchor === "focused" ? "요청한 패널을 찾지 못해 포커스된 패널 기준으로 열었습니다." : undefined;
}

// ─── 닫기·입력·재배치 (대상은 터미널 id로만 정한다) ──────────────────

export function buildCloseTerminalScript(terminalId: string, delaySeconds = 0): string {
	const close = `tell application "Ghostty"\n  close (first terminal whose id is "${esc(terminalId)}")\nend tell`;
	return delaySeconds > 0 ? `delay ${delaySeconds}\n${close}` : close;
}

export function buildInputTerminalScript(terminalId: string, text: string, delaySeconds = 0): string {
	const input = `tell application "Ghostty"
  set targetTerm to first terminal whose id is "${esc(terminalId)}"
  input text "${esc(text)}" to targetTerm
  send key "enter" to targetTerm
end tell`;
	return delaySeconds > 0 ? `delay ${delaySeconds}\n${input}` : input;
}

export async function closeTerminal(pi: Exec, terminalId: string): Promise<{ closed: boolean; reason?: string }> {
	const result = await serialize(() => pi.exec("osascript", ["-e", buildCloseTerminalScript(terminalId)]));
	return result.code === 0
		? { closed: true }
		: { closed: false, reason: result.stderr?.trim() || result.stdout?.trim() || "Ghostty terminal close failed" };
}

export async function inputToTerminal(pi: Exec, terminalId: string, text: string, delaySeconds = 0): Promise<boolean> {
	const result = await pi.exec("osascript", ["-e", buildInputTerminalScript(terminalId, text, delaySeconds)]);
	return result.code === 0;
}

/** 자기 패널이 있는 탭의 패널 수. 패널을 못 찾으면 null. */
export async function countTerminalsInTabOf(pi: Exec, terminalId: string): Promise<number | null> {
	const script = ['tell application "Ghostty"', ...indent([
		...locateTerminalLines([{ id: terminalId, prefix: "own" }]),
		"if ownTerm is missing value then return \"\"",
		"return (count terminals of ownTab) as text",
	]), "end tell"].join("\n");
	const result = await pi.exec("osascript", ["-e", script]);
	if (result.code !== 0) return null;
	const count = Number.parseInt(result.stdout?.trim() ?? "", 10);
	return Number.isFinite(count) ? count : null;
}

/** 자기 패널을 닫고, 같은 탭의 남은 패널(또는 anchorPath로 찾은 패널) 옆에 같은 세션을 다시 연다. */
export function buildRepanelScript(ownTerminalId: string, placement: SplitPlacement, cwd: string, launchScriptPath: string): string {
	const label = placementLabel(placement);
	const lines = [
		...locateTerminalLines([{ id: ownTerminalId, prefix: "own" }]),
		'if ownTerm is missing value then error "Refusing to repanel: own terminal not found"',
	];
	if (placement.anchorPath.length === 0) {
		lines.push(
			"close ownTerm",
			"delay 0.7",
			"set anchorTerm to focused terminal of ownTab",
		);
	} else {
		lines.push(
			"set srcTerm to ownTerm",
			...navigationLines(placement.anchorPath, "ownTab", label),
			"set anchorId to id of anchorTerm",
			`if anchorId is (id of ownTerm) then error "Refusing to repanel: anchor path ${esc(label)} resolved to the current terminal"`,
			"close ownTerm",
			"delay 0.7",
			"set anchorTerm to first terminal whose id is anchorId",
		);
	}
	lines.push(
		"set launchConfig to new surface configuration",
		`set initial working directory of launchConfig to "${esc(cwd)}"`,
		`set command of launchConfig to "${esc(launchScriptPath)}"`,
		`split anchorTerm direction ${placement.splitDirection} with configuration launchConfig`,
	);
	return ['tell application "Ghostty"', ...indent(lines), "end tell"].join("\n");
}
