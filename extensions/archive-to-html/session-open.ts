import { closeSync, openSync, readSync, realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { launchSessionInGhostty } from "../fork-panel/index.ts";

export type ArchiveSessionOpenTarget = "tab" | "here";

/** A resume must use the source header, never a guessed workspace or current cwd. */
export function resolveSessionHeaderCwd(sessionFile: string, expectedCwd?: string): string {
	const fd = openSync(sessionFile, "r");
	let header: { type?: string; cwd?: string };
	try {
		const buffer = Buffer.alloc(256 * 1024);
		const count = readSync(fd, buffer, 0, buffer.length, 0);
		const line = buffer.toString("utf8", 0, count).split(/\r?\n/).find((value) => value.trim());
		header = JSON.parse(line || "{}");
	} finally {
		closeSync(fd);
	}
	if (header.type !== "session" || typeof header.cwd !== "string" || !isAbsolute(header.cwd)) {
		throw new Error("원본 Pi session header의 cwd를 확인할 수 없어 전환을 차단했습니다.");
	}
	let cwd: string;
	try {
		cwd = realpathSync(header.cwd);
		if (!statSync(cwd).isDirectory()) throw new Error("not a directory");
	} catch {
		throw new Error("원본 세션 cwd가 없습니다. 현행 Pi 공개 resume API는 cwd override를 지원하지 않아 다른 경로로 대신 열지 않았습니다.");
	}
	if (expectedCwd && realpathSync(expectedCwd) !== cwd) {
		throw new Error("Archive metadata와 원본 session header의 cwd가 달라 전환을 차단했습니다.");
	}
	return cwd;
}

export async function openArchiveSessionHere(
	ctx: Pick<ExtensionCommandContext, "switchSession">,
	sessionFile: string,
	openCwd: string,
	label: string,
): Promise<{ cancelled: boolean }> {
	const cwd = resolveSessionHeaderCwd(sessionFile, openCwd);
	return ctx.switchSession(sessionFile, {
		withSession: async (nextCtx) => {
			if (realpathSync(nextCtx.cwd) !== cwd) {
				throw new Error("세션 전환 후 cwd가 원본과 다릅니다. 재개 성공으로 처리하지 않았습니다.");
			}
			nextCtx.ui.notify(`${label} 세션 재개 → 현재 패널`, "info");
		},
	});
}

// 새 탭 열기는 fork-panel과 같은 Ghostty 화면 생성 방식을 쓴다. 키 입력으로 명령을 치지 않는다.
export async function openSessionInGhosttyTab(pi: ExtensionAPI, cwd: string, sessionFile: string, env: Record<string, string | undefined> = {}) {
	if (process.platform !== "darwin" || process.env.TERM_PROGRAM !== "ghostty") {
		throw new Error("새 탭 열기는 macOS Ghostty에서만 지원합니다.");
	}
	const launched = await launchSessionInGhostty(pi, "tab", cwd, sessionFile, env);
	if (!launched.ok) throw new Error(launched.reason);
}
