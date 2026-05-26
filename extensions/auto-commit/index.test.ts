import assert from "node:assert/strict";
import test from "node:test";
import { extractGitIndexLockPath, shouldRemoveStaleIndexLockAfterLsof } from "./index.ts";

test("extractGitIndexLockPath reads git index.lock errors", () => {
	const stderr = "fatal: Unable to create '/repo/.git/worktrees/foo/index.lock': File exists.";
	assert.equal(extractGitIndexLockPath(stderr), "/repo/.git/worktrees/foo/index.lock");
});

test("extractGitIndexLockPath returns undefined for unrelated git errors", () => {
	assert.equal(extractGitIndexLockPath("fatal: not a git repository"), undefined);
});

test("shouldRemoveStaleIndexLockAfterLsof removes only when owner check is clean", () => {
	assert.equal(shouldRemoveStaleIndexLockAfterLsof({ code: 1, stdout: "", stderr: "" }), true);
	assert.equal(shouldRemoveStaleIndexLockAfterLsof({ code: 0, stdout: "COMMAND  PID USER\nGit 123 me", stderr: "" }), false);
	assert.equal(shouldRemoveStaleIndexLockAfterLsof({ code: 127, stdout: "", stderr: "lsof: command not found" }), false);
});
