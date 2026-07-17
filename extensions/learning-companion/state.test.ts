import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	createLearningCompanionState,
	learningCompanionManifestPath,
	readLearningCompanionManifest,
	recordLearningCheckpoint,
	recordLearningEvent,
	retargetLearningCompanionManifest,
	updateLearningProposalStatus,
	upsertLearningProposal,
	writeLearningCompanionManifest,
} from "./state.ts";

test("companion manifest atomically links frame and Study Hard canonicals", () => {
	const root = mkdtempSync(join(tmpdir(), "learning-companion-"));
	try {
		const first = writeLearningCompanionManifest({
			storageDir: root,
			identityKey: "planning:ticket:PROJ-1",
			framePath: join(root, "frame.json"),
			runId: "frame-v2-proj-1",
			statePath: "/tmp/study-hard/frame-v2-proj-1.json",
			canonicalHash: "frame-hash-1",
			origin: { kind: "frame-v2", manifestPath: join(root, "frame-v2.json") },
			now: 100,
		});
		const second = writeLearningCompanionManifest({
			storageDir: root,
			identityKey: "planning:ticket:PROJ-1",
			framePath: join(root, "frame.json"),
			runId: "ignored-new-run-id",
			statePath: "/tmp/study-hard/frame-v2-proj-1.json",
			canonicalHash: "frame-hash-2",
			now: 200,
		});

		assert.equal(first.path, learningCompanionManifestPath(root));
		assert.equal(second.manifest.companionId, first.manifest.companionId);
		assert.equal(second.manifest.runId, "frame-v2-proj-1");
		assert.equal(second.manifest.createdAt, 100);
		assert.equal(second.manifest.updatedAt, 200);
		assert.equal(second.manifest.frame.initialCanonicalHash, "frame-hash-1");
		assert.equal(second.manifest.frame.latestCanonicalHash, "frame-hash-2");
		assert.deepEqual(readLearningCompanionManifest(second.path), second.manifest);
		assert.deepEqual(JSON.parse(readFileSync(second.path, "utf8")), second.manifest);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("malformed companion sidecar degrades to missing instead of throwing", () => {
	const root = mkdtempSync(join(tmpdir(), "learning-companion-malformed-"));
	try {
		const path = learningCompanionManifestPath(root);
		writeFileSync(path, "{not-json", "utf8");
		assert.equal(readLearningCompanionManifest(path), undefined);
		writeFileSync(path, JSON.stringify({ schemaVersion: 1, runId: "missing-fields" }), "utf8");
		assert.equal(readLearningCompanionManifest(path), undefined);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("worktree retarget preserves stable companion identity and Study Hard run", () => {
	const sourceRoot = mkdtempSync(join(tmpdir(), "learning-companion-source-"));
	const targetRoot = mkdtempSync(join(tmpdir(), "learning-companion-target-"));
	try {
		const source = writeLearningCompanionManifest({
			storageDir: sourceRoot,
			identityKey: "planning:ticket:PROJ-2",
			framePath: join(sourceRoot, "frame.json"),
			runId: "frame-v2-proj-2",
			statePath: "/tmp/study-hard/frame-v2-proj-2.json",
			canonicalHash: "planning-hash",
			now: 100,
		}).manifest;
		const target = retargetLearningCompanionManifest(source, {
			storageDir: join(targetRoot, ".pi"),
			identityKey: "worktree:target",
			framePath: join(targetRoot, ".pi", "frame.json"),
			canonicalHash: "worktree-hash",
			now: 200,
		}).manifest;

		assert.equal(target.companionId, source.companionId);
		assert.equal(target.runId, source.runId);
		assert.equal(target.studyHard.statePath, source.studyHard.statePath);
		assert.equal(target.frame.initialCanonicalHash, "planning-hash");
		assert.equal(target.frame.latestCanonicalHash, "worktree-hash");
		assert.equal(target.frame.identityKey, "worktree:target");
		assert.equal(target.phase, "implementing");
	} finally {
		rmSync(sourceRoot, { recursive: true, force: true });
		rmSync(targetRoot, { recursive: true, force: true });
	}
});

test("learning events are append-only and deduplicated", () => {
	const root = mkdtempSync(join(tmpdir(), "learning-companion-events-"));
	try {
		const manifest = writeLearningCompanionManifest({
			storageDir: root,
			identityKey: "planning:session:event-test",
			framePath: join(root, "frame.json"),
			runId: "frame-v2-events",
			statePath: "/tmp/study-hard/frame-v2-events.json",
			now: 10,
		}).manifest;
		const initial = createLearningCompanionState(manifest, 10);
		const first = recordLearningEvent(initial, {
			kind: "frame_ready",
			summary: "Frame 계약 확정",
			source: "frame",
			dedupeKey: "frame-ready:hash-1",
			occurredAt: 20,
		});
		const duplicate = recordLearningEvent(first.state, {
			kind: "frame_ready",
			summary: "중복 입력",
			source: "frame",
			dedupeKey: "frame-ready:hash-1",
			occurredAt: 30,
		});
		const second = recordLearningEvent(duplicate.state, {
			kind: "slice_started",
			summary: "S1 시작",
			source: "work-context",
			refs: { sliceId: "S1" },
			dedupeKey: "slice-started:S1",
			occurredAt: 40,
		});

		assert.equal(first.added, true);
		assert.equal(duplicate.added, false);
		assert.equal(duplicate.event.id, first.event.id);
		assert.equal(second.state.events.length, 2);
		assert.deepEqual(second.state.events.map((event) => event.sequence), [1, 2]);
		assert.equal(second.state.events[0]?.summary, "Frame 계약 확정");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("checkpoints and proposals preserve learning history without mutating work canonicals", () => {
	const root = mkdtempSync(join(tmpdir(), "learning-companion-proposal-"));
	try {
		const manifest = writeLearningCompanionManifest({
			storageDir: root,
			identityKey: "planning:session:proposal-test",
			framePath: join(root, "frame.json"),
			runId: "frame-v2-proposals",
			statePath: "/tmp/study-hard/frame-v2-proposals.json",
			now: 10,
		}).manifest;
		const initial = createLearningCompanionState(manifest, 10);
		const withCheckpoint = recordLearningCheckpoint(initial, {
			kind: "frame-ready",
			revision: 3,
			noteHash: "note-hash",
			eventRange: { from: 1, to: 1 },
			createdAt: 20,
		});
		const proposed = upsertLearningProposal(withCheckpoint, {
			summary: "verification focus 보강",
			rationale: "학습 중 누락된 경계를 발견함",
			target: "verification",
			proposedChange: "모바일 경계 검증 추가",
			createdAt: 30,
		});

		assert.equal(proposed.proposal.status, "proposed");
		assert.equal(proposed.state.frame.path, manifest.frame.path);
		assert.equal(proposed.state.checkpoints.length, 1);
		assert.throws(() => updateLearningProposalStatus(proposed.state, proposed.proposal.id, "applied", { now: 40 }), /적용 ref/);
		const applied = updateLearningProposalStatus(proposed.state, proposed.proposal.id, "applied", { appliedRefs: { taskId: "task-1" }, now: 40 });
		assert.equal(applied.proposals[0]?.status, "applied");
		assert.equal(applied.proposals[0]?.appliedRefs?.taskId, "task-1");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
