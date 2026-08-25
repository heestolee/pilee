import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "index.ts"), "utf8");

function between(start: string, end: string): string {
	const startIndex = source.indexOf(start);
	const endIndex = source.indexOf(end, startIndex + start.length);
	assert.ok(startIndex >= 0 && endIndex > startIndex);
	return source.slice(startIndex, endIndex);
}

const commandNew = between("async function handleNew", "async function listOneRepo");
const commandFork = between("async function handleFork", "export async function runWorktreeForkFromCommandContext");

test("/wt new and /wt fork ask placement before creating and preserve the source panel", () => {
	for (const block of [commandNew, commandFork]) {
		assert.ok(block.indexOf("buildNewPanelActivationContract") < block.indexOf('pi.exec("git", ["fetch"'));
		assert.match(block, /activateWorkspaceInNewPanel/);
		assert.doesNotMatch(block, /switchSessionToWorktree/);
		assert.doesNotMatch(block, /trySwitchSessionToWorktree/);
		assert.match(block, /cleanupCreatedSessionFile/);
		assert.match(block, /cleanupCreatedWorktree/);
	}
});

test("/wt fork keeps full transcript lineage and refuses an empty fallback session", () => {
	assert.match(commandFork, /fullContext: useFullContext/);
	assert.match(commandFork, /fullContextFailure\(useFullContext, session\)/);
	assert.match(source, /SessionManager\.forkFrom\(source\.file, worktreePath\)/);
	assert.match(source, /createEmptySessionFile\(worktreePath, source\.file\)/);
	assert.match(source, /parentSession,/);
});

test("/wt switch remains the explicit current-panel activation path", () => {
	assert.match(source, /currentPanelSwitchContract\(ctx, "command", "\/wt switch"\)/);
	assert.match(source, /resolveWorkspaceActivationAuthorization/);
	assert.match(source, /switchSessionToWorktree\(ctx, resolved\.sessionFile/);
});

test("target READY receiver is registered for new-panel continuation", () => {
	assert.match(source, /registerWorkspacePanelActivationReceiver\(pi\)/);
});
