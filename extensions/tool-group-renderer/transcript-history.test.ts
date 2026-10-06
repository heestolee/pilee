import assert from "node:assert/strict";
import test from "node:test";
import type { SessionEntry } from "@mariozechner/pi-coding-agent";
import { installTranscriptHistory, preserveCompactionScreen } from "./transcript-history.ts";

test("initial/rebuild rendering passes Pi's selected entries and options through without reading the full branch", () => {
	const entries: SessionEntry[] = [];
	const options = { populateHistory: true };
	let calls = 0;
	const mode = {
		sessionManager: { getBranch() { throw new Error("full branch must not be requested"); } },
		renderSessionEntries(selected: SessionEntry[], selectedOptions?: typeof options) {
			assert.equal(this, mode);
			assert.equal(selected, entries);
			assert.equal(selectedOptions, options);
			calls++;
		},
	};
	assert.equal(installTranscriptHistory(mode), true);
	const installed = mode.renderSessionEntries;
	assert.equal(installTranscriptHistory(mode), true);
	assert.equal(mode.renderSessionEntries, installed, "reload does not stack wrappers");
	mode.renderSessionEntries(entries, options);
	assert.equal(calls, 1);
});

test("reload disables the full-branch projection of an already installed legacy wrapper", () => {
	const branch: SessionEntry[] = [];
	const selected: SessionEntry[] = [];
	const state = { project: (full: SessionEntry[], _context: SessionEntry[]) => full };
	let displayed: SessionEntry[] = [];
	const legacy = Object.assign((entries: SessionEntry[]) => {
		displayed = state.project(branch, entries);
	}, { [Symbol.for("pilee.tool-group-renderer.transcript-history")]: state });
	const mode = { renderSessionEntries: legacy };
	mode.renderSessionEntries(selected);
	assert.equal(displayed, branch);
	installTranscriptHistory(mode);
	mode.renderSessionEntries(selected);
	assert.equal(mode.renderSessionEntries, legacy);
	assert.equal(displayed, selected, "old wrapper no longer expands the display to the entire branch");
});

test("older Pi without the entry renderer is left unchanged", () => {
	assert.equal(installTranscriptHistory({} as Parameters<typeof installTranscriptHistory>[0]), false);
});

test("successful compaction receiver suppresses only direct clear/replay and never mutates live methods", async () => {
	let clears = 0;
	let replays = 0;
	const mode = {
		chatContainer: { clear() { clears++; } },
		status: "compacting",
		renderSessionEntries() { replays++; },
		async flushCompactionQueue() {
			assert.equal(this, mode, "queue reentry uses the actual mode, not the preservation receiver");
			// A queued command can rebuild even before its first await.
			this.chatContainer.clear();
			this.renderSessionEntries();
			await Promise.resolve();
			this.chatContainer.clear();
		},
	};
	const clear = mode.chatContainer.clear;
	const render = mode.renderSessionEntries;
	const receiver = preserveCompactionScreen(mode);
	receiver.chatContainer.clear();
	receiver.renderSessionEntries();
	assert.equal(clears, 0);
	assert.equal(replays, 0);
	receiver.status = "ready";
	assert.equal(mode.status, "ready", "core cleanup writes must persist on the actual mode");
	assert.equal(mode.chatContainer.clear, clear);
	assert.equal(mode.renderSessionEntries, render);
	await receiver.flushCompactionQueue();
	assert.equal(clears, 2);
	assert.equal(replays, 1);
	assert.throws(() => {
		receiver.chatContainer.clear();
		throw new Error("handler failed");
	}, /handler failed/);
	mode.chatContainer.clear();
	assert.equal(clears, 3, "a handler error cannot leave a global no-op installed");
});
