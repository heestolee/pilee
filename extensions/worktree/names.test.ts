import assert from "node:assert/strict";
import test from "node:test";
import { conflictingBranch, WORD_NAMES, worktreeNameCandidates } from "./names.ts";

test("word names are unique, readable branch/path components and expand after exhaustion", () => {
	const names = worktreeNameCandidates("words", 0);
	const first = Array.from({ length: WORD_NAMES.length }, () => names.next().value);
	assert.equal(new Set(first).size, WORD_NAMES.length);
	assert.ok(first.every((name) => /^[a-z]+-[a-z]+$/.test(name!)));
	assert.equal(names.next().value, `${WORD_NAMES[0]}-2`);
	for (let i = 1; i < WORD_NAMES.length; i++) names.next();
	assert.equal(names.next().value, `${WORD_NAMES[0]}-3`);
});

test("legacy pokemon settings use words; explicit city/none settings still work", () => {
	assert.equal(worktreeNameCandidates("pokemon", 0).next().value, "calm-river");
	assert.equal(worktreeNameCandidates("city", 0).next().value, "manila");
	const none = worktreeNameCandidates("none");
	const first = none.next().value;
	assert.match(first!, /^wt-[0-9a-f-]+$/);
	assert.notEqual(first, none.next().value);
});

test("Git ref conflicts include exact, ancestor and descendant but not similar prefixes", () => {
	assert.equal(conflictingBranch("feature/amber-fox", new Set(["feature/amber-fox"])), "feature/amber-fox");
	assert.equal(conflictingBranch("feature/amber-fox", new Set(["feature"])), "feature");
	assert.equal(conflictingBranch("feature/amber-fox", new Set(["feature/amber-fox/fix"])), "feature/amber-fox/fix");
	assert.equal(conflictingBranch("feature/amber-fox", new Set(["feature/amber-fox-2", "features"])), undefined);
});
