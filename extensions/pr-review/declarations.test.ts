import assert from "node:assert/strict";
import test from "node:test";
import { captureUnifiedDiff } from "./evidence.ts";
import {
	enrichReviewSourceDeclarations,
	findSmallestReviewDeclaration,
	parseReviewDeclarations,
} from "./declarations.ts";

test("TypeScript 선언 parser는 지역 변수부터 함수, class, test hierarchy를 보존한다", () => {
	const source = [
		"import { render } from '@testing-library/react';",
		"const topLevel = 1;",
		"const RegionForm = () => {",
		"  const localState = createState();",
		"  const onSubmit = async () => {",
		"    return localState;",
		"  };",
		"  return <button onClick={onSubmit}>저장</button>;",
		"};",
		"class RegionService {",
		"  update() {",
		"    const payload = { id: 1 };",
		"    return payload;",
		"  }",
		"}",
		"describe('RegionForm', () => {",
		"  it('저장한다', () => {",
		"    const fixture = { id: 1 };",
		"    render(<RegionForm />);",
		"  });",
		"});",
	].join("\n");
	const declarations = parseReviewDeclarations("src/RegionForm.test.tsx", source);
	const byName = (name: string) => declarations.find((item) => item.name === name);
	assert.equal(byName("RegionForm")?.kind, "component");
	assert.equal(byName("localState")?.kind, "variable");
	assert.equal(byName("localState")?.parentKey, byName("RegionForm")?.key);
	assert.equal(byName("onSubmit")?.kind, "function");
	assert.equal(byName("update")?.kind, "method");
	assert.equal(byName("payload")?.parentKey, byName("update")?.key);
	assert.equal(byName("RegionForm 저장한다")?.kind, "test");
	assert.equal(byName("fixture")?.parentKey, byName("RegionForm 저장한다")?.key);
	assert.deepEqual(
		{ start: byName("localState")?.startLine, end: byName("localState")?.endLine },
		{ start: 4, end: 4 },
	);
});

test("새 파일도 파일 전체가 아니라 가장 작은 선언과 상위 hierarchy로 나뉜다", async () => {
	const source = [
		"const first = 1;",
		"",
		"function second() {",
		"  const local = 2;",
		"  return local;",
		"}",
	].join("\n");
	const diff = [
		"diff --git a/src/new.ts b/src/new.ts",
		"new file mode 100644",
		"--- /dev/null",
		"+++ b/src/new.ts",
		"@@ -0,0 +1,6 @@",
		...source.split("\n").map((line) => `+${line}`),
	].join("\n");
	const bundle = await enrichReviewSourceDeclarations(captureUnifiedDiff(diff), async ({ side }) => side === "after" ? source : undefined);
	const snapshot = bundle.fileSources?.[0];
	assert.ok(snapshot?.after);
	const first = snapshot.declarations.find((item) => item.name === "first");
	const second = snapshot.declarations.find((item) => item.name === "second");
	const local = snapshot.declarations.find((item) => item.name === "local");
	assert.ok(first && second && local);
	assert.equal(local.parentId, second.id);
	assert.equal(findSmallestReviewDeclaration(snapshot, "after", 4)?.id, local.id);
	assert.equal(findSmallestReviewDeclaration(snapshot, "after", 5)?.id, second.id);
	assert.ok(local.evidenceIds.length < second.evidenceIds.length);
	assert.ok(second.evidenceIds.length < snapshot.declarations.find((item) => item.kind === "file")!.evidenceIds.length);
});

test("before와 after의 같은 선언은 하나의 unit으로 짝지어 삭제와 추가 evidence를 함께 가진다", async () => {
	const before = ["function run() {", "  const value = 1;", "  return value;", "}"].join("\n");
	const after = ["function run() {", "  const value = 2;", "  return value;", "}"].join("\n");
	const diff = [
		"diff --git a/src/run.ts b/src/run.ts",
		"--- a/src/run.ts",
		"+++ b/src/run.ts",
		"@@ -1,4 +1,4 @@",
		" function run() {",
		"-  const value = 1;",
		"+  const value = 2;",
		"   return value;",
		" }",
	].join("\n");
	const original = captureUnifiedDiff(diff);
	const bundle = await enrichReviewSourceDeclarations(original, async ({ side }) => side === "before" ? before : after);
	const value = bundle.fileSources?.[0]?.declarations.find((item) => item.name === "value");
	assert.ok(value?.before && value.after);
	assert.equal(value.evidenceIds.length, 2);
	assert.notEqual(bundle.sourceSha256, original.sourceSha256);
});

test("미지원 언어는 declaration snapshot 없이 기존 semantic hunk fallback을 유지한다", async () => {
	const diff = [
		"diff --git a/main.go b/main.go",
		"new file mode 100644",
		"--- /dev/null",
		"+++ b/main.go",
		"@@ -0,0 +1 @@",
		"+package main",
	].join("\n");
	const bundle = await enrichReviewSourceDeclarations(captureUnifiedDiff(diff), async () => "package main");
	assert.deepEqual(bundle.fileSources, []);
});
