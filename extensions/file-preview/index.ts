import { pathToFileURL } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getCapabilities } from "@mariozechner/pi-tui";
import { startPreviewBridge, type PreviewBridge } from "./bridge.ts";
import { localPath, readPreview, safeDisplay } from "./files.ts";
import { handlerReady } from "./handler.mjs";
import { LinkCatalog } from "./links.ts";
import { FileViewer } from "./viewer.ts";

interface PreviewSession {
	ctx: ExtensionContext;
	catalog: LinkCatalog;
	bridge?: PreviewBridge;
	busy: boolean;
	closeView?: () => void;
}

export default function filePreview(
	pi: ExtensionAPI,
	isClickReady: () => Promise<boolean> = async () => getCapabilities().hyperlinks && await handlerReady(),
) {
	let active: PreviewSession | undefined;
	let revision = 0;
	const supportsTransform = typeof pi.registerMarkdownTransformer === "function";

	async function release(state: PreviewSession | undefined) {
		if (!state) return;
		state.closeView?.();
		await state.bridge?.close();
	}

	function discover(state: PreviewSession) {
		// Read once at session/tree load, and explicitly on /preview list; never during render.
		for (const entry of state.ctx.sessionManager.getBranch()) {
			if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) continue;
			const content = entry.message.content;
			if (typeof content === "string") state.catalog.transform(content);
			else for (const block of content) if (block.type === "text") state.catalog.transform(block.text);
		}
	}

	async function show(state: PreviewSession, path: string) {
		try {
			const file = await readPreview(pathToFileURL(path).href, state.ctx.cwd);
			if (active !== state) return;
			await state.ctx.ui.custom<void>((tui, theme, _keys, done) => {
				const finish = () => { state.closeView = undefined; done(); };
				state.closeView = finish;
				return new FileViewer(file, theme, () => tui.requestRender(), () => tui.terminal.rows, finish);
			}, { overlay: true, overlayOptions: { anchor: "center", width: "95%", maxHeight: "90%" } });
		} catch (error) {
			if (active === state) state.ctx.ui.notify(safeDisplay(error instanceof Error ? error.message : "파일 미리보기를 열 수 없습니다."), "error");
		} finally { state.busy = false; state.closeView = undefined; }
	}

	function requestOpen(state: PreviewSession, path: string): Promise<void> | undefined {
		if (active !== state) return;
		if (state.busy || !state.ctx.isIdle()) {
			state.ctx.ui.notify("세션이 사용 중입니다. 미리보기를 닫거나 작업이 끝난 뒤 다시 열어 주세요.", "info");
			return;
		}
		state.busy = true; // Synchronous guard before IO: duplicate clicks cannot stack overlays.
		return show(state, path);
	}

	async function start(ctx: ExtensionContext) {
		const current = ++revision;
		const previous = active;
		active = undefined;
		await release(previous);
		if (current !== revision || ctx.mode !== "tui" || !ctx.hasUI) return;
		const state: PreviewSession = { ctx, catalog: new LinkCatalog(ctx.cwd), busy: false };
		active = state;
		if (supportsTransform && await isClickReady()) {
			if (active !== state) return;
			try {
				const bridge = await startPreviewBridge((path) => Boolean(requestOpen(state, path)));
				if (active !== state) { await bridge.close(); return; }
				state.bridge = bridge;
				state.catalog = new LinkCatalog(ctx.cwd, bridge.register);
			} catch {
				if (active === state) ctx.ui.notify("클릭 연결을 준비하지 못했습니다. /preview <경로>를 사용하세요.", "warning");
			}
		}
		if (active !== state) return;
		discover(state);
		ctx.ui.setStatus("file-preview", state.bridge ? "파일 클릭 → TUI" : "파일 미리보기: /preview (클릭 연결 미사용)");
	}

	if (supportsTransform) pi.registerMarkdownTransformer((markdown) => active?.catalog.transform(markdown) ?? markdown);
	pi.on("session_start", async (_event, ctx) => { await start(ctx); });
	pi.on("session_tree", async (_event, ctx) => { await start(ctx); });
	pi.on("session_shutdown", async () => {
		++revision;
		const previous = active;
		active = undefined;
		await release(previous);
	});

	pi.registerCommand("preview", {
		description: "로컬 파일을 읽기 전용 TUI로 미리보기 · 경로 없으면 세션 파일 목록",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui" || !ctx.hasUI) { ctx.ui.notify("파일 미리보기는 Pi TUI에서 /preview <경로>로 사용하세요.", "info"); return; }
			if (!active) await start(ctx);
			const state = active;
			if (!state) return;
			state.ctx = ctx;
			if (state.busy || !ctx.isIdle()) { ctx.ui.notify("이미 미리보기를 열었거나 세션이 사용 중입니다.", "info"); return; }
			let path = args.trim();
			if (!path) {
				discover(state);
				const paths = state.catalog.list();
				if (!paths.length) { ctx.ui.notify("세션에서 로컬 파일 링크를 찾지 못했습니다. /preview <경로>를 사용하세요.", "info"); return; }
				const labels = paths.map((value, index) => `${index + 1}. ${safeDisplay(value)}`);
				state.busy = true;
				let selected: string | undefined;
				try { selected = await ctx.ui.select("현재 세션의 로컬 파일", labels); }
				finally { state.busy = false; }
				if (active !== state || !selected) return;
				path = paths[labels.indexOf(selected)];
				if (!path) return;
			} else {
				if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) path = path.slice(1, -1);
				const resolved = localPath(path, ctx.cwd);
				if (!resolved) { ctx.ui.notify("로컬 파일 경로만 미리 볼 수 있습니다.", "error"); return; }
				path = resolved;
			}
			await requestOpen(state, path);
		},
	});
}
