import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { claimRestoreSource } from "./restore-claim.ts";

const source = { id: "fixture", path: "/source.json", realPath: "/source.json", pinnedPath: "/pinned.json", hash: "a".repeat(64) };

test("separate processes atomically claim a source; losers cannot create or replace an attempt", async () => {
	const root = mkdtempSync(join(tmpdir(), "workspace-claim-"));
	try {
		const script = `
			import { claimRestoreSource } from ${JSON.stringify(new URL("./restore-claim.ts", import.meta.url).href)};
			try {
				claimRestoreSource(${JSON.stringify(root)}, ${JSON.stringify(source)}, ${JSON.stringify(join(root, "progress.json"))});
				console.log("claimed");
			} catch (error) {
				if (!error.message.includes("기존 복구 기록")) throw error;
				console.log("blocked");
			}
		`;
		const run = () => promisify(execFile)(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], { env: { ...process.env, HOME: root, PI_CODING_AGENT_DIR: root } });
		const results = await Promise.all([run(), run()]);
		assert.deepEqual(results.map((result) => result.stdout.trim()).sort(), ["blocked", "claimed"]);
		const claims = join(root, "restore-claims");
		assert.equal(readdirSync(claims).length, 1);
		const attempt = JSON.parse(readFileSync(join(claims, source.hash, "attempt.json"), "utf8"));
		assert.equal(attempt.source.hash, source.hash);
		assert.throws(() => claimRestoreSource(root, source, "other.json"), /기존 복구 기록/);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("no-target owner may release a claim and retry; validation/claim failure does not leave an owned attempt", () => {
	const root = mkdtempSync(join(tmpdir(), "workspace-claim-release-"));
	try {
		assert.throws(() => claimRestoreSource(root, { ...source, hash: "invalid" }, "invalid.json"), /SHA256/);
		assert.equal(existsSync(join(root, "restore-claims")), false);
		claimRestoreSource(root, source, "first.json")();
		const release = claimRestoreSource(root, source, "second.json");
		assert.equal(JSON.parse(readFileSync(join(root, "restore-claims", source.hash, "attempt.json"), "utf8")).reportPath, "second.json");
		release();
	} finally { rmSync(root, { recursive: true, force: true }); }
});
