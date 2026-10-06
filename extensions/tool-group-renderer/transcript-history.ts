import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { installTranscriptRender } from "./transcript-render.ts";

type RenderOptions = { updateFooter?: boolean; populateHistory?: boolean };
type TranscriptRenderer = Partial<Parameters<typeof installTranscriptRender>[0]> & {
	renderSessionEntries(entries: SessionEntry[], options?: RenderOptions): void;
};
const PATCH_STATE = Symbol.for("pilee.tool-group-renderer.transcript-history");
const contextEntriesOnly = (_branch: SessionEntry[], entries: SessionEntry[]) => entries;
type PatchedRender = TranscriptRenderer["renderSessionEntries"] & {
	[PATCH_STATE]?: { project: typeof contextEntriesOnly };
};

/** Keep the render optimization, but let Pi choose the entries for initial load/rebuild. */
export function installTranscriptHistory(proto: TranscriptRenderer): boolean {
	const original: PatchedRender = proto.renderSessionEntries;
	// Older Pi versions use renderSessionContext instead. Leave them unchanged.
	if (typeof original !== "function") return false;
	const installed = original[PATCH_STATE];
	if (installed) {
		// A pre-update wrapper may survive /reload. Disable its full-branch projection too.
		installed.project = contextEntriesOnly;
		return true;
	}

	const wrapped: PatchedRender = function (this: TranscriptRenderer, entries, options) {
		if (this.chatContainer) installTranscriptRender({
			chatContainer: this.chatContainer, documentContainer: this.documentContainer, renderer: this.renderer,
		});
		return original.call(this, entries, options);
	};
	wrapped[PATCH_STATE] = { project: contextEntriesOnly };
	proto.renderSessionEntries = wrapped;
	return true;
}

const COMPACTION_METHODS = new Set<PropertyKey>([
	"init", "clearStatusIndicator", "addMessageToChat", "addCompactionCostNotice", "flushCompactionQueue",
]);

/**
 * A receiver for the successful compaction handler only: suppress its clear/replay,
 * not the original handler's cleanup, summary, cost notice or queue/retry handling.
 * Other methods stay bound to the real mode so reentrant queue commands can still
 * rebuild/switch sessions. Never replace live methods across an async boundary.
 */
export function preserveCompactionScreen<T extends { chatContainer: { clear(): void } }>(mode: T): T {
	const keepScreen = () => {};
	const chat = new Proxy(mode.chatContainer, {
		get(target, key) {
			if (key === "clear") return keepScreen;
			const value = Reflect.get(target, key, target);
			return typeof value === "function" ? value.bind(target) : value;
		},
	});
	return new Proxy(mode, {
		get(target, key) {
			if (key === "chatContainer") return chat;
			if (key === "renderSessionEntries") return keepScreen;
			const value = Reflect.get(target, key, target);
			// Callback fields (notably autoCompactionEscapeHandler) must keep their identity.
			return COMPACTION_METHODS.has(key) && typeof value === "function" ? value.bind(target) : value;
		},
		set(target, key, value) {
			return Reflect.set(target, key, value, target);
		},
	});
}
