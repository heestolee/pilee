import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { attachStudyHardLearningCompanion, loadPersistedStudyHardState, startStudyHardStudio, stopStudyHardStudios } from "../study-hard/studio.ts";
import learningCompanionExtension from "./index.ts";
import { writeLearningCompanionManifest } from "./state.ts";

const originalStateDir = process.env.STUDY_HARD_STATE_DIR;
const stateDir = mkdtempSync(join(tmpdir(), "learning-companion-tool-state-"));
process.env.STUDY_HARD_STATE_DIR = stateDir;

after(() => {
	stopStudyHardStudios();
	rmSync(stateDir, { recursive: true, force: true });
	if (originalStateDir === undefined) delete process.env.STUDY_HARD_STATE_DIR;
	else process.env.STUDY_HARD_STATE_DIR = originalStateDir;
});

function registerToolHarness() {
	let tool: any;
	learningCompanionExtension({ registerTool(candidate: any) { tool = candidate; } } as any);
	return tool;
}

test("learning_companion records meaningful events and checkpoints for the current worktree", async () => {
	const root = mkdtempSync(join(tmpdir(), "learning-companion-tool-worktree-"));
	const piDir = join(root, ".pi");
	mkdirSync(piDir, { recursive: true });
	writeFileSync(join(piDir, "worktree-meta.json"), JSON.stringify({ name: "companion-test", branch: "feature/companion-test" }));
	const runId = "learning-companion-tool";
	const fakePi = { sendMessage() {}, exec() { throw new Error("no browser fallback in test"); } } as any;
	try {
		await startStudyHardStudio(fakePi, { hasUI: false, cwd: root } as any, { url: "https://example.com/companion-tool", runId });
		const linked = writeLearningCompanionManifest({
			storageDir: piDir,
			identityKey: "worktree:companion-test",
			framePath: join(piDir, "frame.json"),
			runId,
			statePath: join(stateDir, `${runId}.json`),
			canonicalHash: "frame-hash",
			now: 100,
		});
		attachStudyHardLearningCompanion(linked.manifest);
		const tool = registerToolHarness();
		const ctx = { cwd: root, sessionManager: { getSessionFile: () => join(root, "session.jsonl"), getSessionName: () => "Companion test" } } as any;

		const status = await tool.execute("status", { action: "status" }, new AbortController().signal, () => {}, ctx);
		assert.equal(status.details.attached, true);
		assert.match(status.content[0].text, /events: 1/);

		const first = await tool.execute("record", {
			action: "record",
			kind: "validation_passed",
			source: "verify",
			summary: "S1 unit test 통과",
			dedupeKey: "validation:S1:unit",
			phase: "verifying",
			sliceId: "S1",
			evidence: ["test 5/5"],
		}, new AbortController().signal, () => {}, ctx);
		assert.equal(first.details.companion.events.length, 2);
		const duplicate = await tool.execute("record-duplicate", {
			action: "record",
			kind: "validation_passed",
			source: "verify",
			summary: "중복",
			dedupeKey: "validation:S1:unit",
		}, new AbortController().signal, () => {}, ctx);
		assert.equal(duplicate.details.companion.events.length, 2);

		const checkpoint = await tool.execute("checkpoint", {
			action: "checkpoint",
			checkpointKind: "slice-complete",
			sliceId: "S1",
			commit: "abc123",
		}, new AbortController().signal, () => {}, ctx);
		assert.equal(checkpoint.details.companion.checkpoints.length, 1);
		assert.equal(checkpoint.details.companion.checkpoints[0].refs.commit, "abc123");

		const persisted = loadPersistedStudyHardState(runId);
		assert.equal(persisted?.companion?.phase, "verifying");
		assert.equal(persisted?.companion?.events.length, 2);
		assert.equal(persisted?.companion?.checkpoints.length, 1);
	} finally {
		stopStudyHardStudios();
		rmSync(root, { recursive: true, force: true });
	}
});

test("missing companion is informational and never blocks the current work", async () => {
	const root = mkdtempSync(join(tmpdir(), "learning-companion-tool-missing-"));
	try {
		const tool = registerToolHarness();
		const ctx = { cwd: root, sessionManager: { getSessionFile: () => join(root, "session.jsonl"), getSessionName: () => "Missing companion" } } as any;
		const result = await tool.execute("status-missing", { action: "status" }, new AbortController().signal, () => {}, ctx);
		assert.equal(result.details.attached, false);
		assert.equal(result.details.blocked, false);
		assert.match(result.content[0].text, /기존 작업 흐름은 계속/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
