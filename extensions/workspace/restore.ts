import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { planWorkspaceRestore, validateRestoreLaunch, type RestoreLaunch } from "./planner.ts";
import { readSnapshotSelection, type PinnedSnapshotSource } from "./selection.ts";
import { claimRestoreSource } from "./restore-claim.ts";
export type { RestoreLaunch } from "./planner.ts";

const RECEIPT_ENV = "PILEE_WORKSPACE_RESTORE_STEP";
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const apple = (value: string) => value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n");

export type RestoreTarget = { windowId: string; tabId: string; terminalId: string };
type Receipt = { status: "ready" | "failed"; sessionFile: string; cwd: string; pid: number; error?: string };

function writeJson(path: string, data: unknown) {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
	renameSync(temporary, path);
}

function readReceipt(path: string): Receipt | undefined {
	try { return JSON.parse(readFileSync(path, "utf8")); } catch { return undefined; }
}

/** The receipt is unique to this launch, not the global session registry. */
export function receiveRestoreSession(ctx: ExtensionContext, env = process.env): (() => void) | undefined {
	const requestPath = env[RECEIPT_ENV];
	if (!requestPath) return;
	delete env[RECEIPT_ENV]; // Do not let a later child process acknowledge this launch.
	const expected: { sessionFile: string; cwd: string } = JSON.parse(readFileSync(requestPath, "utf8"));
	const sessionFile = ctx.sessionManager.getSessionFile() || "";
	const receipt: Receipt = { status: "ready", sessionFile, cwd: ctx.cwd, pid: process.pid };
	try {
		if (realpathSync(sessionFile) !== realpathSync(expected.sessionFile) || realpathSync(ctx.cwd) !== realpathSync(expected.cwd)) {
			throw new Error("복구 대상 session/cwd가 실제 Pi 세션과 일치하지 않습니다.");
		}
	} catch (error) {
		receipt.status = "failed";
		receipt.error = String(error);
	}
	writeJson(`${requestPath}.receipt`, receipt);
	return () => writeJson(`${requestPath}.receipt`, {
		...receipt, status: "failed",
		error: receipt.error || "복구 중 Pi 세션이 종료·전환·리로드되었습니다.",
		lifecycle: { state: "invalidated", at: Date.now(), reason: "Pi 세션 종료·전환·리로드" },
	});
}

export function buildCreateScript(windowId: string, launchPath: string, cwd: string, anchor?: RestoreTarget): string {
	return `tell application "Ghostty"
  set targetWindow to first window whose id is "${apple(windowId)}"
  set launchConfig to new surface configuration
  set initial working directory of launchConfig to "${apple(cwd)}"
  set command of launchConfig to "${apple(quote(launchPath))}"
  set wait after command of launchConfig to true
${anchor ? `  set targetTab to first tab of targetWindow whose id is "${apple(anchor.tabId)}"
  set anchorTerm to first terminal of targetTab whose id is "${apple(anchor.terminalId)}"
  set newTerm to split anchorTerm direction right with configuration launchConfig` : `  set targetTab to new tab in targetWindow with configuration launchConfig
  set newTerm to first terminal of targetTab`}
  return (id of targetTab as text) & (character id 9) & (id of newTerm as text)
end tell`;
}

export function buildPresenceScript(targets: RestoreTarget[]): string {
	return `tell application "Ghostty"
${targets.map((target) => `  set targetWindow to first window whose id is "${apple(target.windowId)}"
  set targetTab to first tab of targetWindow whose id is "${apple(target.tabId)}"
  set targetTerm to first terminal of targetTab whose id is "${apple(target.terminalId)}"
  if (id of targetTerm as text) is not "${apple(target.terminalId)}" then error "복구 대상 패널이 사라졌습니다."`).join("\n")}
  return "present"
end tell`;
}

export async function restoreWorkspace(
	pi: Pick<ExtensionAPI, "exec">,
	tabs: RestoreLaunch[][],
	workspaceDir: string,
	options: { source: PinnedSnapshotSource; signal?: AbortSignal; timeoutMs?: number; pollMs?: number; onProgress?: (message: string) => void },
): Promise<string> {
	const source = { ...options.source };
	tabs = tabs.map((tab) => tab.map((action) => ({ ...action })));
	const assertSource = () => {
		const selected = readSnapshotSelection(source.pinnedPath);
		if (selected.reference.hash !== source.hash || selected.reference.id !== source.id) throw new Error("보존 source fingerprint 불일치");
		return selected.snapshot;
	};
	let total: number;
	try {
		const expected = planWorkspaceRestore(assertSource(), () => "preflight");
		total = expected.total;
		if (!total || expected.blocked || tabs.length !== expected.actions.length) throw new Error("원본 전체 패널이 준비되지 않았습니다.");
		for (const [tabIndex, actions] of tabs.entries()) {
			if (actions.length !== expected.actions[tabIndex].length) throw new Error("원본 패널 수가 다릅니다. 부분 실행은 지원하지 않습니다.");
			for (const [panelIndex, action] of actions.entries()) {
				validateRestoreLaunch(action);
				const original = expected.actions[tabIndex][panelIndex];
				if (action.sourcePanelKey !== original.sourcePanelKey || action.sessionFile !== original.sessionFile ||
					action.headerHash !== original.headerHash || action.terminalCwd !== original.terminalCwd) throw new Error("원본 source panel identity 불일치");
			}
		}
	} catch (error) {
		throw new Error(`전체 preflight BLOCKED (target 0): ${String(error)}`);
	}
	const root = join(workspaceDir, `restore-${randomUUID()}`);
	const reportPath = join(root, "progress.json");
	const releaseClaim = claimRestoreSource(workspaceDir, source, reportPath);
	const completed: Array<RestoreTarget & RestoreLaunch & { requestPath: string }> = [];
	let step = "복구 창 확인";
	let targetState: "none" | "possible" | "created" = "none";
	let current: (RestoreLaunch & { requestPath: string; target?: RestoreTarget }) | undefined;
	const save = (status: string, error?: string) => writeJson(reportPath, {
		status, source, total, ready: completed.length, remaining: total - completed.length,
		panels: tabs.flat().map(({ command: _command, ...panel }) => panel),
		step, completed, current, targetState, error,
	});
	const exec = async (script: string) => {
		options.signal?.throwIfAborted();
		const result = await pi.exec("osascript", ["-e", script], { timeout: 10_000, signal: options.signal });
		if (result.code !== 0 || result.killed) throw new Error((result.stderr || result.stdout || "Ghostty 응답 시간 초과").trim());
		return result.stdout.trim();
	};
	const checkReceipt = (path: string, action: RestoreLaunch): boolean => {
		validateRestoreLaunch(action);
		const receipt = readReceipt(`${path}.receipt`);
		if (!receipt) return false;
		if (receipt.status !== "ready") throw new Error(receipt.error || "세션 READY 확인 실패");
		if (realpathSync(receipt.sessionFile) !== realpathSync(action.sessionFile!) || realpathSync(receipt.cwd) !== realpathSync(action.cwd)) {
			throw new Error("세션 READY 대상 불일치");
		}
		if (!Number.isInteger(receipt.pid) || receipt.pid <= 0) throw new Error("세션 READY 프로세스 정보 없음");
		process.kill(receipt.pid, 0);
		return true;
	};
	const checkCompleted = async () => {
		if (completed.length) await exec(buildPresenceScript(completed));
		for (const item of completed) {
			if (!checkReceipt(item.requestPath, item)) throw new Error("완료한 패널의 세션 READY 기록이 사라졌습니다.");
		}
	};
	try {
		mkdirSync(root, { recursive: true, mode: 0o700 });
		save("running");
		// Capture once. No later step reads focus, selected tab, or the front window.
		const windowId = await exec('tell application "Ghostty" to get id of front window');
		if (!windowId) throw new Error("복구할 Ghostty 창을 찾지 못했습니다.");
		for (const [tabIndex, actions] of tabs.entries()) {
			let anchor: RestoreTarget | undefined;
			for (const [panelIndex, action] of actions.entries()) {
				options.signal?.throwIfAborted();
				await checkCompleted();
				assertSource();
				const identity = validateRestoreLaunch(action);
				step = `탭 ${tabIndex + 1} / 패널 ${panelIndex + 1} 생성`;
				const requestPath = join(root, `step-${tabIndex}-${panelIndex}.json`);
				current = { ...action, requestPath };
				save("running");
				options.onProgress?.(step);
				writeJson(requestPath, { ...identity, cwd: action.cwd, sourcePanelKey: action.sourcePanelKey, sourceHash: source.hash });
				const launchPath = `${requestPath}.sh`;
				writeFileSync(launchPath, `#!/bin/bash\nset -e\nunset PI_FORK_ID PI_FORK_PANEL_LABEL PI_FORK_PARENT\nexport ${RECEIPT_ENV}=${quote(requestPath)}\n${action.command}\n`, { mode: 0o700 });
				const script = buildCreateScript(windowId, launchPath, action.cwd, anchor);
				writeFileSync(`${requestPath}.applescript`, script, { mode: 0o600 });
				options.signal?.throwIfAborted();
				assertSource();
				validateRestoreLaunch(action);
				const previousTargetState = targetState;
				targetState = "possible";
				try { save("running"); } catch (error) { targetState = previousTargetState; throw error; }
				// Uncertainty is durable BEFORE the side effect, including crashes/timeouts.
				const [tabId, terminalId, extra] = (await exec(script)).split("\t");
				if (!tabId || !terminalId || extra !== undefined || (anchor && tabId !== anchor.tabId) || completed.some((item) => item.terminalId === terminalId || (!anchor && item.tabId === tabId))) {
					throw new Error("Ghostty가 고유한 새 탭/패널 ID를 반환하지 않았습니다.");
				}
				const target = { windowId, tabId, terminalId };
				current.target = target;
				targetState = "created";
				step = `탭 ${tabIndex + 1} / 패널 ${panelIndex + 1} 세션 READY 대기`;
				save("running");
				options.onProgress?.(step);
				const deadline = Date.now() + (options.timeoutMs ?? 60_000);
				while (true) {
					await exec(buildPresenceScript([target]));
					if (checkReceipt(requestPath, action)) break;
					if (Date.now() >= deadline) throw new Error("세션 READY 시간 초과 — 다음 탭/패널을 생성하지 않습니다.");
					await sleep(options.pollMs ?? 250, undefined, { signal: options.signal });
				}
				completed.push({ ...action, ...target, requestPath });
				anchor = target;
				save("running");
			}
		}
		await checkCompleted();
		assertSource();
		if (completed.length !== total) throw new Error("원본 전체 패널 READY가 확인되지 않았습니다.");
		step = "복구 완료";
		save("completed");
		return reportPath;
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);
		if (existsSync(root)) save("failed", reason);
		throw new Error(`${step}에서 중단 (${completed.length}개 완료): ${reason}\n기록: ${reportPath}`);
	} finally {
		if (targetState === "none") releaseClaim();
	}
}
