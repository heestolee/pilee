import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { FrameIdentity } from "../tft-commands/frame-identity.ts";
import { buildInitialFrameV2Note, frameV2RunId, parseFrameV2Args, updateFrameV2ManifestStatus, writeFrameV2Manifest } from "./artifact.ts";

const identity = (storageDir: string): FrameIdentity => ({
	mode: "planning-session",
	key: "planning:session:frame-v2-test",
	displayTitle: "Planning · Frame v2 test",
	storageDir,
	cwd: "/tmp",
	reason: "test",
	sessionFile: "/tmp/session.jsonl",
});

test("Frame v2 supports draft-first and guided modes", () => {
	const draft = parseFrameV2Args("--draft https://example.com/spec checkout", "planning:test") as any;
	assert.equal(draft.mode, "draft");
	assert.equal(draft.topic, "https://example.com/spec checkout");
	assert.equal(draft.sourceUrl, "https://example.com/spec");

	const guided = parseFrameV2Args("결제 정책", "planning:test") as any;
	assert.equal(guided.mode, "guided");
	assert.equal(guided.topic, "결제 정책");
	assert.match(guided.sourceUrl, /^https:\/\/frame-v2\.invalid\//);
	assert.deepEqual(parseFrameV2Args("help", "planning:test"), { help: true });
});

test("Frame v2 seeds a structured learning note instead of a blank board", () => {
	const note = buildInitialFrameV2Note("결제 정책", "draft");
	assert.match(note.title, /Frame v2/);
	assert.deepEqual(note.sections.map((section) => section.id), [
		"frame-v2-overview",
		"frame-v2-mental-model",
		"frame-v2-visuals",
		"frame-v2-contract",
		"frame-v2-open-questions",
	]);
	assert.match(note.sections[2]!.title, /ERD/);
});

test("Frame v2 manifest is identity-scoped and preserves creation time", () => {
	const storageDir = mkdtempSync(join(tmpdir(), "frame-v2-artifact-"));
	try {
		const invocation = parseFrameV2Args("--draft checkout", "planning:test") as any;
		const first = writeFrameV2Manifest({
			identity: identity(storageDir),
			invocation,
			runId: frameV2RunId("planning:test"),
			statePath: "/tmp/study-hard.json",
			sourceUrl: "https://frame-v2.invalid/test",
			now: 100,
		});
		const second = writeFrameV2Manifest({
			identity: identity(storageDir),
			invocation,
			runId: frameV2RunId("planning:test"),
			statePath: "/tmp/study-hard.json",
			sourceUrl: "https://frame-v2.invalid/test",
			now: 200,
		});
		assert.equal(first.path, join(storageDir, "frame-v2.json"));
		assert.equal(second.manifest.createdAt, 100);
		assert.equal(second.manifest.updatedAt, 200);
		assert.equal(second.manifest.framePath, join(storageDir, "frame.json"));
		assert.equal(JSON.parse(readFileSync(second.path, "utf8")).studyHard.sourceUrl, "https://frame-v2.invalid/test");
		const ready = updateFrameV2ManifestStatus(second.path, "ready", 300);
		assert.equal(ready.status, "ready");
		assert.equal(ready.updatedAt, 300);
	} finally {
		rmSync(storageDir, { recursive: true, force: true });
	}
});
