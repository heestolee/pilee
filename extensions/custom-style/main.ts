import type { ExtensionAPI, ExtensionContext, KeybindingsManager } from "@mariozechner/pi-coding-agent";
import type { EditorTheme, TUI } from "@mariozechner/pi-tui";
import { type CustomStyleConfig, ensureConfigExists, loadConfig } from "./config.ts";
import { installFooter } from "./footer.ts";
import { isCodexFastModeEnabled, shouldUseCodexFastBadge } from "./footer-state.ts";
import { promptSuggestLiteStore } from "../prompt-suggest-lite/shared.ts";
import { readCompactionDisplaySettings, formatCompactionStatus } from "./context-pressure.ts";
import { getForkPanelLabel } from "./panel-label.ts";
import { PolishedEditor } from "./ui.ts";

type SyncedState = {
	modelLabel: string;
	panelLabel: string;
};

function syncState(ctx: ExtensionContext): SyncedState {
	try {
		return {
			modelLabel: ctx.model?.id ?? "no-model",
			panelLabel: getForkPanelLabel(process.env, ctx.sessionManager.getSessionFile()),
		};
	} catch (err) {
		if (isStaleCtxError(err)) return { modelLabel: "no-model", panelLabel: getForkPanelLabel() };
		throw err;
	}
}

const COMPACTION_STATUS_KEY = "custom-style:compaction";
const COMPACTION_STATUS_CLEAR_MS = 8_000;

let currentEditor: PolishedEditor | undefined;
let compactionStatusClearTimer: ReturnType<typeof setTimeout> | undefined;

function isStaleCtxError(err: unknown): boolean {
	return String((err as Error)?.message ?? err).includes("ctx is stale");
}

function hasUiIfActive(ctx: ExtensionContext): boolean {
	try {
		return ctx.hasUI;
	} catch (err) {
		if (isStaleCtxError(err)) return false;
		throw err;
	}
}

function setFooterStatus(ctx: ExtensionContext, text: string | undefined) {
	try {
		ctx.ui.setStatus(COMPACTION_STATUS_KEY, text);
	} catch {
		// Ignore stale UI contexts after reload/session replacement.
	}
}

function clearCompactionStatusLater(ctx: ExtensionContext) {
	if (compactionStatusClearTimer) clearTimeout(compactionStatusClearTimer);
	compactionStatusClearTimer = setTimeout(() => {
		setFooterStatus(ctx, undefined);
		compactionStatusClearTimer = undefined;
	}, COMPACTION_STATUS_CLEAR_MS);
}

function setCompactionStatus(ctx: ExtensionContext, prefix: string, tokensBefore: number, reserveTokens: number) {
	if (!hasUiIfActive(ctx)) return;
	const status = formatCompactionStatus(tokensBefore, ctx.model?.contextWindow, reserveTokens, ctx.model);
	setFooterStatus(ctx, `${prefix} · ${status}`);
}

function installEditor(pi: ExtensionAPI, ctx: ExtensionContext, getState: () => SyncedState) {
	if (!hasUiIfActive(ctx)) return;

	let autocompleteFixed = false;

	type AutocompleteEditorInternals = {
		autocompleteProvider?: unknown;
	};

	const editorFactory = (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
		currentEditor?.dispose();
		const editor = new PolishedEditor(
			tui,
			theme,
			keybindings,
			ctx.ui.theme,
			() => {
				const state = getState();
				const modelLabel = shouldUseCodexFastBadge(ctx.model?.provider, isCodexFastModeEnabled())
					? `${state.modelLabel} ⚡`
					: state.modelLabel;
				const panelPrefix = `${ctx.ui.theme.fg("accent", state.panelLabel)}${ctx.ui.theme.fg("border", " · ")}`;
				return `${panelPrefix}${ctx.ui.theme.fg("accent", modelLabel)}`;
			},
			() => pi.getThinkingLevel(),
			{
				getSuggestion: () => promptSuggestLiteStore.getSuggestion(),
				getSuggestionRevision: () => promptSuggestLiteStore.getRevision(),
				getAcceptKeys: () => promptSuggestLiteStore.getAcceptKeys(),
				subscribe: (listener) => promptSuggestLiteStore.subscribe(listener),
			},
		);
		currentEditor = editor;

		const originalHandleInput = editor.handleInput.bind(editor);
		editor.handleInput = (data: string) => {
			const editorInternals = editor as unknown as AutocompleteEditorInternals;
			if (!autocompleteFixed && !editorInternals.autocompleteProvider) {
				autocompleteFixed = true;
				ctx.ui.setEditorComponent(editorFactory);
				currentEditor?.handleInput(data);
				return;
			}
			originalHandleInput(data);
		};

		return editor;
	};

	ctx.ui.setEditorComponent(editorFactory);
}

export default function (pi: ExtensionAPI) {
	let currentConfig: CustomStyleConfig = loadConfig();
	let latestSyncedState: SyncedState = {
		modelLabel: "no-model",
		panelLabel: getForkPanelLabel(),
	};

	const doSync = (ctx: ExtensionContext) => {
		latestSyncedState = syncState(ctx);
	};

	const installUi = (ctx: ExtensionContext) => {
		if (!hasUiIfActive(ctx)) return;
		ensureConfigExists();
		currentConfig = loadConfig();
		doSync(ctx);
		installFooter(pi, ctx, currentConfig);
		installEditor(pi, ctx, () => latestSyncedState);
	};

	pi.on("session_start", async (_event, ctx) => {
		installUi(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		installUi(ctx);
	});

	pi.on("agent_start", async (_event, ctx) => {
		doSync(ctx);
	});

	pi.on("agent_end", async (_event, ctx) => {
		doSync(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		doSync(ctx);
	});

	pi.on("message_end", async (_event, ctx) => {
		doSync(ctx);
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		doSync(ctx);
	});

	pi.on("session_before_compact", async (event, ctx) => {
		setCompactionStatus(ctx, "압축 중", event.preparation.tokensBefore, event.preparation.settings.reserveTokens);
	});

	pi.on("session_compact", async (event, ctx) => {
		const settings = readCompactionDisplaySettings(ctx.sessionManager.getCwd());
		setCompactionStatus(ctx, "압축 완료", event.compactionEntry.tokensBefore, settings.reserveTokens);
		clearCompactionStatusLater(ctx);
		doSync(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		currentEditor?.dispose();
		currentEditor = undefined;
		if (compactionStatusClearTimer) {
			clearTimeout(compactionStatusClearTimer);
			compactionStatusClearTimer = undefined;
		}
		if (!hasUiIfActive(ctx)) return;
		try {
			setFooterStatus(ctx, undefined);
			ctx.ui.setFooter(undefined);
			ctx.ui.setEditorComponent(undefined);
		} catch (err) {
			if (!isStaleCtxError(err)) throw err;
		}
	});
}
