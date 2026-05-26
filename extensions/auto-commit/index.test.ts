import assert from "node:assert/strict";
import test from "node:test";
import { extractGitIndexLockPath } from "./index.ts";

test("extractGitIndexLockPath reads git index.lock errors", () => {
	const stderr = "fatal: Unable to create '/repo/.git/worktrees/foo/index.lock': File exists.";
	assert.equal(extractGitIndexLockPath(stderr), "/repo/.git/worktrees/foo/index.lock");
});

test("extractGitIndexLockPath returns undefined for unrelated git errors", () => {
	assert.equal(extractGitIndexLockPath("fatal: not a git repository"), undefined);
});
