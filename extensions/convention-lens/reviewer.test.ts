import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { captureUnifiedDiff } from "../pr-review/evidence.ts";
import {
	buildConventionLensFollowUpMessage,
	CONVENTION_LENS_FOLLOWUP_MARKER,
	writeConventionLensReviewArtifact,
} from "./reviewer.ts";
import type { ConventionLensMode } from "../utils/private-profiles.ts";
import type { ConventionLensReviewTarget, ConventionLensSelection } from "./types.ts";

const DIFF = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = input as unknown as Result;
`;

function fixture(mode: ConventionLensMode, status: "candidate" | "reviewed" = "candidate") {
	const bundle = captureUnifiedDiff(DIFF);
	const target: ConventionLensReviewTarget = {
		kind: "working-diff",
		baseHead: "a".repeat(40),
		currentHead: "a".repeat(40),
		paths: ["src/a.ts"],
		diff: DIFF,
		fingerprint: bundle.sourceSha256,
		bundle,
	};
	const selection: ConventionLensSelection = {
		profileId: "fixture",
		graphVersion: "graph-v1",
		facts: { paths: ["src/a.ts"], terms: ["unknown"], changedLines: ["input as unknown as Result"] },
		candidates: [{
			node: {
				id: "type-contract",
				title: "Type Contract",
				kind: "decision-lens",
				authority: status === "reviewed" ? "team-convention" : "personal-precedent",
				status,
				packId: "fixture",
				appliesTo: ["src/**/*.ts"],
				signals: ["as unknown as"],
				aliases: [],
				relations: [],
				body: "현재 producer/runtime truth를 확인한다.",
				source: { path: "/tmp/type.md", digest: "digest" },
			},
			score: 10,
			matchedSignals: ["as unknown as"],
			matchedPaths: ["src/a.ts"],
			reasons: ["signal:as unknown as"],
		}],
	};
	return { target, selection, mode };
}

test("review artifact는 stable evidence와 selected lens만 저장한다", async () => {
	const root = await mkdtemp(join(tmpdir(), "convention-lens-reviewer-"));
	try {
		const { target, selection, mode } = fixture("review");
		const written = writeConventionLensReviewArtifact(root, "/tmp/repo", mode, target, selection);
		const stored = JSON.parse(await readFile(written.artifactPath, "utf8"));
		assert.equal(stored.target.fingerprint, target.fingerprint);
		assert.equal(stored.lenses[0].id, "type-contract");
		assert.ok(stored.evidence.lines.some((line: any) => /^D\d{6}$/.test(line.id)));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("review mode follow-up은 자동 판정하되 코드 수정을 금지한다", () => {
	const { target, selection, mode } = fixture("review");
	const written = writeConventionLensReviewArtifact(tmpdir(), "/tmp/repo", mode, target, selection);
	const message = buildConventionLensFollowUpMessage(written.artifactPath, written.artifact);
	assert.match(message.content, new RegExp(CONVENTION_LENS_FOLLOWUP_MARKER));
	assert.match(message.content, /review mode에서는 tool 제출 전후 모두 코드를 수정하지 않고/);
	assert.equal(message.details.fingerprint, target.fingerprint);
});

test("repair mode follow-up은 candidate lens 자동 수정과 graph source 수정을 금지한다", () => {
	const { target, selection, mode } = fixture("repair", "candidate");
	const written = writeConventionLensReviewArtifact(tmpdir(), "/tmp/repo", mode, target, selection);
	const message = buildConventionLensFollowUpMessage(written.artifactPath, written.artifact);
	assert.match(message.content, /candidate\/draft\/private-case만 근거인 finding은 AUTO_FIX로 제출하지 않고/);
	assert.match(message.content, /Graph\/card source를 자동 수정하지 않습니다/);
	assert.match(message.content, /가장 가까운 검증/);
});
