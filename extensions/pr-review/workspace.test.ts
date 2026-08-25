import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	prReviewWorktreeIdentity,
	readPrReviewWorkspaceMetadata,
	writePrReviewWorkspaceMetadata,
	type PrReviewWorkspaceMetadata,
} from "./workspace.ts";

function metadata(cwd: string): PrReviewWorkspaceMetadata {
	return {
		schemaVersion: 1,
		runId: "acme-repo-pr-42-head1234-1000",
		runDir: "/tmp/pr-review/runs/acme-repo-pr-42-head1234-1000",
		prUrl: "https://github.com/acme/repo/pull/42",
		repository: "acme/repo",
		number: 42,
		title: "Review target",
		baseRefName: "main",
		baseSha: "base1234567890",
		headRefName: "feature/review-target",
		headSha: "abcdef1234567890",
		branch: "review/pr-42-abcdef12",
		worktreeName: "review-pr-42-abcdef12",
		worktreePath: cwd,
		createdAt: 1000,
	};
}

test("PR review workspace metadata round-trips under .pi", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pilee-pr-review-workspace-"));
	try {
		assert.equal(readPrReviewWorkspaceMetadata(cwd), null);
		writePrReviewWorkspaceMetadata(cwd, metadata(cwd));
		assert.deepEqual(readPrReviewWorkspaceMetadata(cwd), metadata(cwd));
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("PR review workspace preserves full-context new-panel activation provenance", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pilee-pr-review-workspace-activation-"));
	try {
		const value: PrReviewWorkspaceMetadata = {
			...metadata(cwd),
			sourceSessionFile: "/tmp/source.jsonl",
			targetSessionFile: "/tmp/target.jsonl",
			contextMode: "full-transcript",
			activationContractId: "pr-review-42-abcdef12",
			activation: {
				target: "new-panel",
				placement: "right",
				panelLabel: "P1",
				forkId: "fork-42",
				readyAt: "2026-08-25T00:00:00.000Z",
			},
		};
		writePrReviewWorkspaceMetadata(cwd, value);
		assert.deepEqual(readPrReviewWorkspaceMetadata(cwd), value);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("PR review worktree identity is deterministic and head-pinned", () => {
	assert.deepEqual(prReviewWorktreeIdentity(4919, "9530FE4449F15F9464F0387BAB7A28B69304A6BC"), {
		name: "review-pr-4919-9530fe44",
		branch: "review/pr-4919-9530fe44",
		remoteRef: "refs/remotes/origin/pilee-review/pr-4919",
	});
});
