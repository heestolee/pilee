import assert from "node:assert/strict";
import { test } from "node:test";
import { captureUnifiedDiff, renderInspectionChunk, validateEvidenceIds } from "./evidence.ts";

const DIFF = `diff --git a/src/example.ts b/src/example.ts
index 1111111..2222222 100644
--- a/src/example.ts
+++ b/src/example.ts
@@ -1,4 +1,5 @@
 export function visible(status: string) {
-  return status !== "HIDDEN";
+  const allowed = new Set(["OPEN", "READY"]);
+  return allowed.has(status);
 }
`;

test("captureUnifiedDiff assigns stable evidence ids and source line numbers", () => {
	const bundle = captureUnifiedDiff(DIFF, { kind: "github-pr", number: 1 });
	assert.equal(bundle.stats.files, 1);
	assert.equal(bundle.stats.additions, 2);
	assert.equal(bundle.stats.deletions, 1);
	assert.equal(bundle.files[0]?.path, "src/example.ts");
	assert.deepEqual(bundle.lines.map((line) => line.id), bundle.lines.map((_, index) => `D${String(index + 1).padStart(6, "0")}`));
	const deletion = bundle.lines.find((line) => line.kind === "deletion");
	const additions = bundle.lines.filter((line) => line.kind === "addition");
	assert.equal(deletion?.oldLine, 2);
	assert.deepEqual(additions.map((line) => line.newLine), [2, 3]);
	assert.equal(bundle.sourceSha256, captureUnifiedDiff(DIFF).sourceSha256);
});

test("captureUnifiedDiff chunks large changes without changing evidence ids", () => {
	const body = Array.from({ length: 180 }, (_, index) => `+export const value${index} = ${index};`).join("\n");
	const largeDiff = `diff --git a/src/large.ts b/src/large.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/large.ts\n@@ -0,0 +1,180 @@\n${body}\n`;
	const bundle = captureUnifiedDiff(largeDiff, {}, { chunkBytes: 4_096 });
	assert.ok(bundle.chunks.length > 1);
	const rendered = renderInspectionChunk(bundle, bundle.chunks[1]!.id);
	assert.match(rendered, /\*D000001\|/);
	assert.match(rendered, /\*D000005\|/);
	assert.equal(new Set(bundle.lines.map((line) => line.id)).size, bundle.lines.length);
});

test("validateEvidenceIds rejects unknown and uninspected evidence", () => {
	const bundle = captureUnifiedDiff(DIFF);
	const addition = bundle.lines.find((line) => line.kind === "addition")!;
	assert.deepEqual(validateEvidenceIds(bundle, [], [addition.id]), [
		`evidence ${addition.id} belongs to uninspected chunk ${bundle.chunks[0]!.id}`,
	]);
	assert.deepEqual(validateEvidenceIds(bundle, [bundle.chunks[0]!.id], [addition.id]), []);
	assert.deepEqual(validateEvidenceIds(bundle, [bundle.chunks[0]!.id], ["D999999"]), ["unknown evidence id: D999999"]);
});

test("captureUnifiedDiff rejects combined diff input", () => {
	assert.throws(() => captureUnifiedDiff("diff --cc src/example.ts\n@@@ -1,1 -1,1 +1,1 @@@\n"), /combined diffs/);
});
