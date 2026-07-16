import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveStudyHardRuntimeConfig } from "./runtime-config.ts";

test("Study Hard runtime env overrides private profiles", () => {
	const previousScript = process.env.STUDY_HARD_SYNC_SCRIPT;
	const previousDownloadDir = process.env.STUDY_HARD_DOWNLOAD_DIR;
	process.env.STUDY_HARD_SYNC_SCRIPT = "/tmp/study-hard-sync.py";
	process.env.STUDY_HARD_DOWNLOAD_DIR = "/tmp/study-hard-downloads";
	try {
		assert.deepEqual(resolveStudyHardRuntimeConfig("/tmp/repo"), {
			syncScript: "/tmp/study-hard-sync.py",
			downloadDir: "/tmp/study-hard-downloads",
		});
	} finally {
		if (previousScript === undefined) delete process.env.STUDY_HARD_SYNC_SCRIPT;
		else process.env.STUDY_HARD_SYNC_SCRIPT = previousScript;
		if (previousDownloadDir === undefined) delete process.env.STUDY_HARD_DOWNLOAD_DIR;
		else process.env.STUDY_HARD_DOWNLOAD_DIR = previousDownloadDir;
	}
});
