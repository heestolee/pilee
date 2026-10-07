import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { WorkspaceSnapshot, WorkspaceTerminalSnapshot } from "./index.ts";

export type SessionIdentity = { sessionFile: string; sessionId: string; sessionCwd: string; headerHash: string };
export type RestoreLaunch = Partial<SessionIdentity> & {
	sourcePanelKey: string;
	terminalCwd: string;
	cwd: string;
	command?: string;
	blockedReason?: string;
};
export type RestoreAction = RestoreLaunch & { tabName: string; terminalName: string; panelLabel: string };
export type RestorePlan = {
	snapshot: WorkspaceSnapshot;
	actions: RestoreAction[][];
	total: number;
	ready: number;
	blocked: number;
	mode: "append";
};

/** Header only: SessionManager.open may initialize or migrate the source file. */
export function readSessionIdentity(sessionFile: string): SessionIdentity {
	if (!isAbsolute(sessionFile)) throw new Error("sessionFile은 절대경로여야 합니다.");
	const file = realpathSync(sessionFile);
	const fd = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
	try {
		if (!fstatSync(fd).isFile()) throw new Error("sessionFile이 일반 파일이 아닙니다.");
		const buffer = Buffer.alloc(64 * 1024);
		const length = readSync(fd, buffer, 0, buffer.length, 0);
		const newline = buffer.subarray(0, length).indexOf(10);
		if (newline < 0 && length === buffer.length) throw new Error("session header가 너무 큽니다.");
		const line = buffer.subarray(0, newline < 0 ? length : newline).toString("utf8");
		let header;
		try { header = JSON.parse(line); } catch { throw new Error("유효한 session header가 없습니다."); }
		if (header?.type !== "session" || typeof header.id !== "string" || !header.id.trim() ||
			typeof header.cwd !== "string" || !isAbsolute(header.cwd)) throw new Error("session header의 type/id/cwd가 유효하지 않습니다.");
		// Pi migrates older headers on open; that would mutate the source after preflight.
		if (header.version !== 3) throw new Error(`지원하지 않는 session version: ${header.version ?? "없음"}. v3만 복구하며, 구형 세션 변환은 별도로 확인해야 합니다.`);
		if (!statSync(header.cwd).isDirectory()) throw new Error("session cwd가 디렉터리가 아닙니다.");
		return { sessionFile: file, sessionId: header.id, sessionCwd: realpathSync(header.cwd), headerHash: createHash("sha256").update(line).digest("hex") };
	} finally { closeSync(fd); }
}

export function validateRestoreLaunch(action: RestoreLaunch): SessionIdentity {
	if (action.blockedReason || !action.command || !action.sessionFile || !action.sourcePanelKey) {
		throw new Error(action.blockedReason || "실행할 session/command/source panel 정보가 없습니다.");
	}
	const identity = readSessionIdentity(action.sessionFile);
	if (identity.sessionFile !== action.sessionFile || identity.sessionId !== action.sessionId || identity.headerHash !== action.headerHash ||
		identity.sessionCwd !== action.sessionCwd || identity.sessionCwd !== action.cwd) throw new Error("preflight 이후 session header/cwd identity가 변경되었습니다.");
	return identity;
}

export function planWorkspaceRestore(snapshot: WorkspaceSnapshot, launch: (term: WorkspaceTerminalSnapshot) => string | undefined): RestorePlan {
	const actions = snapshot.tabs.map((tab, tabIndex) => tab.terminals.map((term, panelIndex): RestoreAction => {
		const action: RestoreAction = {
			sourcePanelKey: `tab:${tabIndex + 1}:${tab.id}/panel:${panelIndex + 1}:${term.id}`,
			tabName: tab.name || `tab ${tabIndex + 1}`, terminalName: term.name || `terminal ${panelIndex + 1}`,
			terminalCwd: term.cwd, cwd: term.cwd, sessionFile: term.sessionFile, panelLabel: term.panelLabel || "P0",
		};
		try {
			if (!term.sessionFile) throw new Error("unresolved: 원본에 연결된 Pi sessionFile 없음");
			if (term.match === "fallback") throw new Error("추정 fallback 연결: 승인된 원본 identity가 아니므로 실행 차단");
			const identity = readSessionIdentity(term.sessionFile);
			Object.assign(action, identity, { cwd: identity.sessionCwd });
			action.command = launch({ ...term, cwd: identity.sessionCwd, sessionFile: identity.sessionFile });
			if (!action.command) throw new Error("session 실행 명령이 없습니다.");
		} catch (error) {
			action.command = undefined;
			action.blockedReason = error instanceof Error ? error.message : String(error);
		}
		return action;
	}));
	const flat = actions.flat();
	const byFile = new Map<string, RestoreAction[]>();
	for (const action of flat) {
		if (!action.sessionFile) continue;
		let key: string;
		try { key = realpathSync(action.sessionFile); } catch { continue; }
		const group = byFile.get(key) || [];
		group.push(action);
		byFile.set(key, group);
	}
	for (const group of byFile.values()) {
		if (group.length < 2) continue;
		for (const action of group) {
			action.command = undefined;
			action.blockedReason = [action.blockedReason, `동일 sessionFile 중복: ${group.map((item) => item.sourcePanelKey).join(", ")}`].filter(Boolean).join("; ");
		}
	}
	const ready = flat.filter((action) => action.command && !action.blockedReason).length;
	return { snapshot, actions, total: flat.length, ready, blocked: flat.length - ready, mode: "append" };
}
