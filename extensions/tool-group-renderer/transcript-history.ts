import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { installTranscriptRender } from "./transcript-render.ts";

/** Display projection only; never replace SessionManager's model context. */
export function transcriptEntries(
	branch: SessionEntry[],
	contextEntries: SessionEntry[],
): SessionEntry[] {
	const latestCompaction = branch.findLast((entry) => entry.type === "compaction");
	if (!latestCompaction) return contextEntries;

	// compaction_end appends this summary itself after rendering the kept entries.
	// Initial load/rebuild includes it in the input, so render it chronologically.
	const summaryIncluded = contextEntries.some((entry) => entry.id === latestCompaction.id);
	return summaryIncluded ? branch : branch.filter((entry) => entry.id !== latestCompaction.id);
}

type RenderOptions = { updateFooter?: boolean; populateHistory?: boolean };
type TranscriptRenderer = Partial<Parameters<typeof installTranscriptRender>[0]> & {
	sessionManager: { getBranch(): SessionEntry[] };
	renderSessionEntries(entries: SessionEntry[], options?: RenderOptions): void;
};
const PATCH_STATE = Symbol.for("pilee.tool-group-renderer.transcript-history");
type PatchedRender = TranscriptRenderer["renderSessionEntries"] & {
	[PATCH_STATE]?: { project: typeof transcriptEntries };
};

/** Keep the patch local to the TUI consumer; never patch buildContextEntries. */
export function installTranscriptHistory(proto: TranscriptRenderer): boolean {
	const original: PatchedRender = proto.renderSessionEntries;
	// Older Pi versions use renderSessionContext instead. Leave them unchanged.
	if (typeof original !== "function") return false;
	const installed = original[PATCH_STATE];
	if (installed) {
		installed.project = transcriptEntries;
		return true;
	}

	const state = { project: transcriptEntries };
	const wrapped: PatchedRender = function (this: TranscriptRenderer, entries, options) {
		if (this.chatContainer) installTranscriptRender({
			chatContainer: this.chatContainer, documentContainer: this.documentContainer, renderer: this.renderer,
		});
		return original.call(this, state.project(this.sessionManager.getBranch(), entries), options);
	};
	wrapped[PATCH_STATE] = state;
	proto.renderSessionEntries = wrapped;
	return true;
}
