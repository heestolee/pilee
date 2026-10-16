import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { nativeProviderFixture } from "../prompt-suggest-lite/native-provider.fixture.ts";

registerHooks({ resolve(specifier, context, next) {
	try { return next(specifier, context); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" && /^\.\.?\//.test(specifier) && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
		throw error;
	}
} });
const { suggestSessionClassification } = await import("./index.ts");

test("archive classification uses the native registry with keyless header auth and preserves raw JSONL", async () => {
	const dir = mkdtempSync(join(fileURLToPath(new URL(".", import.meta.url)), ".pi13-classification-"));
	try {
		const file = join(dir, "session.jsonl");
		const raw = JSON.stringify({ type: "session", version: 3, id: "fixture", cwd: dir }) + "\n" + JSON.stringify({ type: "message", id: "u1", parentId: null, message: { role: "user", content: "검증을 진행해줘" } }) + "\n";
		writeFileSync(file, raw);
		const fixture = await nativeProviderFixture(JSON.stringify({ title: "검증 작업", category: "Verify / Report", tags: ["verify"], summary: "로컬 검증", segments: [{ title: "검증", category: "Verify / Report", summary: "진행", startIndex: 1, endIndex: 1 }] }));
		const result = await suggestSessionClassification(file, { model: fixture.model, modelRegistry: fixture.registry, signal: undefined });
		assert.equal(result.fallbackUsed, false);
		assert.equal(result.classification.title, "검증 작업");
		assert.equal(result.classification.source, "ai-suggestion");
		assert.equal(fixture.calls[0].options?.headers?.["x-fixture-auth"], "local-only");
		assert.equal(fixture.calls[0].options?.env?.FIXTURE_REGION, "local");
		assert.equal(fixture.calls[0].model.baseUrl, "https://fixture.invalid/native");
		assert.equal(readFileSync(file, "utf8"), raw);
		assert.equal((await suggestSessionClassification(file)).fallbackUsed, true);
	} finally { rmSync(dir, { recursive: true, force: true }); }
});
