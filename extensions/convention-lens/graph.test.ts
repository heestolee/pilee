import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ConventionLensProfile } from "../utils/private-profiles.ts";
import { captureUnifiedDiff } from "../pr-review/evidence.ts";
import { __test, factsFromDiff, loadConventionGraph, selectConventionLenses } from "./graph.ts";

async function withTempRoot(run: (root: string) => Promise<void>) {
	const root = await mkdtemp(join(tmpdir(), "convention-lens-graph-"));
	try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test("markdown card pack은 기존 card metadata와 signal을 graph node로 읽는다", async () => {
	await withTempRoot(async (root) => {
		const cards = join(root, "cards");
		await mkdir(cards);
		await writeFile(join(cards, "row-lock.md"), `---
id: row-lock
kind: decision-lens
authority: personal-precedent
status: candidate
confidence: medium
applies_to: [backend/**/*.ts]
signals: [FOR UPDATE, LOCK.UPDATE]
relations: [requires:read-transaction]
---
# Row Lock

## Trigger
\`FOR UPDATE\`

## Decision Questions
왜 필요한가?
`);
		await writeFile(join(cards, "read.md"), `---
id: read-transaction
kind: decision-lens
authority: personal-precedent
status: candidate
signals: [Transaction, find]
---
# Read Transaction
`);
		const profile: ConventionLensProfile = {
			id: "fixture",
			packs: [{ id: "cards", kind: "markdown-cards", rootDir: cards, authority: "personal-precedent" }],
		};
		const graph = loadConventionGraph(profile, root);
		assert.deepEqual(graph.errors, []);
		assert.equal(graph.nodes.length, 2);
		assert.deepEqual(graph.nodes.find((node) => node.id === "row-lock")?.relations, [{ type: "requires", target: "read-transaction" }]);
		const bundle = captureUnifiedDiff(`diff --git a/backend/a.ts b/backend/a.ts
--- a/backend/a.ts
+++ b/backend/a.ts
@@ -1 +1,2 @@
-find()
+find({ transaction, lock: Transaction.LOCK.UPDATE })
+// FOR UPDATE
`);
		const selection = selectConventionLenses(graph, factsFromDiff(bundle), { threshold: 4, limit: 3 });
		assert.equal(__test.pathPatternMatches("backend/**/*.ts", "backend/a.ts"), true);
		assert.equal(__test.pathPatternMatches("backend/**/*.ts", "backend/apps/trip/a.ts"), true);
		assert.equal(selection.candidates[0]?.node.id, "row-lock");
		assert.ok(selection.candidates.some((candidate) => candidate.node.id === "read-transaction"));
	});
});

test("sectioned markdown pack은 Bad/Good을 node로 만들지 않고 H3 없는 section을 보존한다", async () => {
	await withTempRoot(async (root) => {
		const source = join(root, "code-convention.md");
		await writeFile(source, `# Convention
## 목차
## 함수
### 함수는 한 가지만 한다
설명
### **Bad**
\`bad()\`
### **Good**
\`good()\`
## 객체와 자료구조
H3 없이 존재하는 규칙
`);
		const profile: ConventionLensProfile = {
			id: "fixture",
			packs: [{ id: "source", kind: "sectioned-markdown", sourcePath: "code-convention.md", authority: "team-convention", defaultStatus: "reviewed" }],
		};
		const graph = loadConventionGraph(profile, root);
		const rules = graph.nodes.filter((node) => node.kind === "rule");
		assert.equal(rules.length, 2);
		assert.deepEqual(rules.map((node) => node.title), ["함수는 한 가지만 한다", "객체와 자료구조"]);
		assert.match(rules[0]?.body ?? "", /### \*\*Bad\*\*/);
		assert.match(rules[0]?.body ?? "", /### \*\*Good\*\*/);
		assert.match(rules[1]?.body ?? "", /H3 없이 존재/);
		const bundle = captureUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-old()\n+handler(mode)\n`);
		const selection = selectConventionLenses(graph, factsFromDiff(bundle), { threshold: 4, limit: 3 });
		assert.ok(selection.candidates.length > 0);
		assert.ok(selection.candidates.every((candidate) => candidate.node.kind !== "category"));
	});
});

test("sectioned source override는 사람이 읽는 stable id와 cross-pack relation을 제공한다", async () => {
	await withTempRoot(async (root) => {
		await writeFile(join(root, "code-convention.md"), `# Convention
## 함수
### 함수는 한 가지만 한다
설명
`);
		await writeFile(join(root, "overrides.json"), JSON.stringify({ nodes: [{
			category: "함수",
			title: "함수는 한 가지만 한다",
			id: "function.single-action",
			signals: ["handler"],
			relations: ["balances:single-use-forwarding-helper"],
		}] }));
		const profile: ConventionLensProfile = {
			id: "fixture",
			packs: [{
				id: "source",
				kind: "sectioned-markdown",
				sourcePath: "code-convention.md",
				overridesPath: "overrides.json",
				authority: "team-convention",
				defaultStatus: "reviewed",
			}],
		};
		const graph = loadConventionGraph(profile, root);
		const node = graph.nodes.find((candidate) => candidate.id === "function.single-action");
		assert.ok(node);
		assert.ok(node.signals.includes("handler"));
		assert.ok(node.relations.some((relation) => relation.type === "balances" && relation.target === "single-use-forwarding-helper"));
	});
});
