import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";
import { buildHandlerBundle } from "./install-handler.mjs";
import { isOwnedHandler } from "./handler.mjs";

test("미등록 helper bundle을 독립 임시 디렉터리에 빌드한다", { skip: process.platform !== "darwin" }, async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-app-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const app = join(dir, "Preview.app");
	// when
	await buildHandlerBundle(app);
	const { stdout } = await promisify(execFile)("/usr/bin/plutil", ["-lint", join(app, "Contents", "Info.plist")]);
	// then
	assert.match(stdout, /OK/u);
	assert.equal(await isOwnedHandler(app), true);
	await access(join(app, "Contents", "Resources", "node"));
	await promisify(execFile)("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
	const { stdout: version } = await promisify(execFile)(join(app, "Contents", "Resources", "node"), ["--version"]);
	assert.match(version, /^v\d+\./u);
	await assert.rejects(promisify(execFile)(join(app, "Contents", "Resources", "node"), [join(app, "Contents", "Resources", "dispatcher.mjs"), "pilee-preview://invalid;echo unsafe"]), (error) => {
		assert.equal(error.code, 1);
		assert.match(error.stderr, /파일 미리보기를 열지 못했습니다/u);
		return true;
	});
	await assert.rejects(buildHandlerBundle(app), /기존 경로/u);
});

test("본인 marker가 없는 기존 앱을 소유 대상으로 판단하지 않는다", async (t) => {
	// given
	const dir = await mkdtemp(join(tmpdir(), "preview-app-"));
	t.after(() => rm(dir, { recursive: true, force: true }));
	await writeFile(join(dir, "unrelated"), "keep");
	// when
	const owned = await isOwnedHandler(dir);
	// then
	assert.equal(owned, false);
	assert.equal(await readFile(join(dir, "unrelated"), "utf8"), "keep");
});
