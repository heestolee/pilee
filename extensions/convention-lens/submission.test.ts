import assert from "node:assert/strict";
import test from "node:test";
import { captureUnifiedDiff } from "../pr-review/evidence.ts";
import { validateConventionLensSubmission } from "./submission.ts";
import type { ConventionLensReviewArtifact } from "./reviewer.ts";

function artifact(status: "candidate" | "reviewed"): { value: ConventionLensReviewArtifact; evidenceId: string } {
	const evidence = captureUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1 +1 @@
-export const value = 1;
+export const value = input as unknown as Result;
`);
	return {
		evidenceId: evidence.lines.find((line) => line.kind === "addition")!.id,
		value: {
			schemaVersion: 1,
			profileId: "fixture",
			mode: "repair",
			cwd: "/tmp/repo",
			target: { kind: "working-diff", baseHead: "a", currentHead: "a", fingerprint: evidence.sourceSha256, paths: ["src/a.ts"] },
			evidence,
			lenses: [{ id: "type-contract", title: "Type", authority: status === "reviewed" ? "team-convention" : "personal-precedent", status, score: 10, reasons: [], body: "", source: {} }],
		},
	};
}

function input(evidenceId: string) {
	return {
		verdict: "AUTO_FIX",
		summary: "과한 assertion",
		findings: [{ id: "CL-1", verdict: "AUTO_FIX", lensIds: ["type-contract"], evidenceIds: [evidenceId], confidence: "high", recommendation: "실제 타입으로 좁힌다" }],
	};
}

test("candidate-only AUTO_FIX는 ASK로 강등하고 repair를 승인하지 않는다", () => {
	const fixture = artifact("candidate");
	const result = validateConventionLensSubmission(input(fixture.evidenceId), fixture.value, "repair");
	assert.equal(result.verdict, "ASK");
	assert.equal(result.findings[0]?.verdict, "ASK");
	assert.equal(result.repairAuthorized, false);
});

test("reviewed high-confidence evidence finding만 repair를 승인한다", () => {
	const fixture = artifact("reviewed");
	const result = validateConventionLensSubmission(input(fixture.evidenceId), fixture.value, "repair");
	assert.equal(result.verdict, "AUTO_FIX");
	assert.equal(result.repairAuthorized, true);
});

test("artifact 밖 evidence와 lens는 제출을 거부한다", () => {
	const fixture = artifact("reviewed");
	assert.throws(() => validateConventionLensSubmission(input("D999999"), fixture.value, "repair"), /unknown or empty evidenceIds/);
	const unknown = input(fixture.evidenceId); unknown.findings[0].lensIds = ["unknown"];
	assert.throws(() => validateConventionLensSubmission(unknown, fixture.value, "repair"), /unknown or empty lensIds/);
});
