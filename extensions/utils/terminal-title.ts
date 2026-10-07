import { basename } from "node:path";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

const TITLE_STATE = Symbol.for("pilee.workspace.terminal-title");
type TitleState = { sessionFile?: string; title?: string; probe?: { owner: symbol; marker: string } };
function state(): TitleState {
	const root = globalThis as typeof globalThis & { [TITLE_STATE]?: TitleState };
	return root[TITLE_STATE] ??= {};
}

export function formatTerminalTitle(title: string | undefined, cwd: string): string {
	const project = basename(cwd) || "pi";
	return title ? `π - ${title} - ${project}` : `π - ${project}`;
}

/** The title owner and the short-lived workspace probe share only title state, not UI hooks. */
export function syncTerminalTitle(ctx: ExtensionContext, title: string): void {
	if (!ctx.hasUI) return;
	const sessionFile = ctx.sessionManager.getSessionFile(); // Also rejects a stale context.
	const current = state();
	if (current.sessionFile !== sessionFile) current.probe = undefined;
	current.sessionFile = sessionFile;
	current.title = title;
	ctx.ui.setTitle(current.probe ? `${title} ${current.probe.marker}` : title);
}

export function beginTerminalTitleProbe(ctx: ExtensionContext, marker: string): () => void {
	const sessionFile = ctx.sessionManager.getSessionFile();
	const current = state();
	const title = current.sessionFile === sessionFile && current.title !== undefined
		? current.title : formatTerminalTitle(ctx.sessionManager.getSessionName(), ctx.cwd);
	const owner = Symbol("title-probe");
	current.sessionFile = sessionFile;
	current.title = title;
	current.probe = { owner, marker };
	const restore = () => {
		if (current.probe?.owner !== owner) return;
		current.probe = undefined;
		try {
			if (ctx.hasUI && ctx.sessionManager.getSessionFile() === sessionFile) ctx.ui.setTitle(current.title!);
		} catch { /* A replacement runtime owns its own title. */ }
	};
	try { ctx.ui.setTitle(`${title} ${marker}`); } catch (error) { restore(); throw error; }
	return restore;
}
