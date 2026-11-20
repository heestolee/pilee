import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { basename } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { beginTerminalTitleProbe } from "../utils/terminal-title.ts";
import { ghosttyBindingScript, parseBindingOutput, rememberOwnTerminal } from "../utils/ghostty-panels.ts";
import { resolveForkPanelIdentity } from "../utils/fork-panel-identity.ts";
import { readSessionIdentity } from "./planner.ts";
import { readProcessStarts, removeRegistration, writeRegistration, type SessionRegistration, type TerminalBinding } from "./registry.ts";

const PROCESS_STATE = Symbol.for("pilee.workspace.registration");
type ProcessState = { token: string; startedAt?: string; owner?: string; stop?: () => void };
function processState(): ProcessState {
	const root = globalThis as typeof globalThis & { [PROCESS_STATE]?: ProcessState };
	return root[PROCESS_STATE] ??= { token: randomUUID() };
}

export type RegistrationEnvironment = { platform: string; termProgram?: string; stdinTTY: boolean; stdoutTTY: boolean };
export function supportsRegistration(ctx: ExtensionContext, environment: RegistrationEnvironment = {
	platform: process.platform, termProgram: process.env.TERM_PROGRAM,
	stdinTTY: Boolean(process.stdin.isTTY), stdoutTTY: Boolean(process.stdout.isTTY),
}): boolean {
	try {
		// Older SDKs have no mode property and report hasUI=false for RPC. New SDKs require the explicit TUI guard.
		return environment.platform === "darwin" && environment.termProgram === "ghostty" && environment.stdinTTY && environment.stdoutTTY &&
			ctx.hasUI && (!("mode" in ctx) || ctx.mode === "tui") && !/[\\/]subagents[\\/]/u.test(ctx.sessionManager.getSessionFile() || "");
	} catch { return false; }
}

export function createSessionRegistration(pi: Pick<ExtensionAPI, "exec">, workspaceDir: string, environment?: RegistrationEnvironment) {
	const shared = processState();
	let generation = "";
	let activeCtx: ExtensionContext | undefined;
	let sessionFile: string | undefined;
	let binding: TerminalBinding | undefined;
	let error: string | undefined;
	let controller: AbortController | undefined;
	let restoreTitle: (() => void) | undefined;
	let lastRecord: SessionRegistration | undefined;
	const isCurrent = () => {
		try { return Boolean(activeCtx && generation && shared.owner === generation && supportsRegistration(activeCtx, environment) && activeCtx.sessionManager.getSessionFile() === sessionFile); }
		catch { return false; }
	};
	const refresh = (ctx = activeCtx) => {
		if (!ctx || !isCurrent()) return;
		try {
			if (ctx.sessionManager.getSessionFile() !== sessionFile) return;
			activeCtx = ctx;
			const file = sessionFile || "";
			let identityError: string | undefined;
			let cwd = ctx.sessionManager.getCwd();
			let canonicalFile = file;
			try {
				const identity = readSessionIdentity(file);
				if (identity.sessionCwd !== realpathSync(cwd)) throw new Error("현재 cwd와 session header cwd가 다릅니다.");
				canonicalFile = identity.sessionFile;
				cwd = identity.sessionCwd;
			} catch (failure) { identityError = String(failure); }
			const identity = resolveForkPanelIdentity({ sessionFile: file });
			const record: SessionRegistration = {
				version: 1, pid: process.pid, processStartedAt: shared.startedAt || "", processToken: shared.token, generation, updatedAt: Date.now(),
				sessionFile: canonicalFile, cwd, title: ctx.sessionManager.getSessionName() || basename(file),
				panelLabel: identity.panelLabel, forkId: identity.forkId, parentSessionFile: identity.parentSessionFile,
				binding, error: error || identityError,
			};
			if (!isCurrent()) return;
			writeRegistration(workspaceDir, record);
			lastRecord = record;
		} catch (failure) {
			if (!isCurrent()) return;
			throw failure;
		}
	};
	const stop = () => {
		if (!generation || shared.owner !== generation) return;
		controller?.abort();
		restoreTitle?.();
		restoreTitle = undefined;
		activeCtx = undefined;
		shared.owner = undefined;
		shared.stop = undefined;
		if (lastRecord) removeRegistration(workspaceDir, lastRecord);
	};
	return {
		isCurrent, refresh, stop,
		async start(ctx: ExtensionContext): Promise<void> {
			if (!supportsRegistration(ctx, environment)) return;
			shared.stop?.();
			generation = randomUUID();
			shared.owner = generation;
			shared.stop = stop;
			activeCtx = ctx;
			sessionFile = ctx.sessionManager.getSessionFile();
			binding = undefined;
			error = "패널 등록 중";
			controller = new AbortController();
			const attempt = generation;
			const signal = controller.signal;
			const marker = `[pilee:${shared.token.slice(0, 8)}-${attempt.slice(0, 8)}]`;
			try {
				shared.startedAt ??= readProcessStarts([process.pid]).get(process.pid);
				if (!shared.startedAt) throw new Error("OS 프로세스 시작 시각을 확인하지 못해 정확한 패널 등록을 중단했습니다.");
				refresh();
				restoreTitle = beginTerminalTitleProbe(ctx, marker);
				for (let retry = 0; retry < 3; retry++) {
					if (!isCurrent() || generation !== attempt) return;
					const result = await pi.exec("osascript", ["-e", ghosttyBindingScript(marker)], { timeout: 1000, signal });
					if (!isCurrent() || generation !== attempt) return;
					if (result.code !== 0 || result.killed) throw new Error(result.stderr || "Ghostty 패널 등록 시간 초과");
					binding = parseBindingOutput(result.stdout);
					if (binding) break;
					if (retry < 2) await sleep(100, undefined, { signal });
				}
				if (!binding) throw new Error("등록 표식과 일치하는 Ghostty 패널이 없습니다. /reload 후 권한·제목 설정을 확인하세요.");
				rememberOwnTerminal(binding.terminalId);
				error = undefined;
			} catch (failure) {
				if (!isCurrent() || generation !== attempt) return;
				error = failure instanceof Error ? failure.message : String(failure);
			} finally {
				if (generation === attempt && shared.owner === attempt) {
					restoreTitle?.();
					restoreTitle = undefined;
					refresh();
				}
			}
		},
	};
}
