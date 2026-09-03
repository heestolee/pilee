import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createWorkspaceActivationContract,
	explicitWorkspaceAuthorization,
} from "../utils/workspace-activation-contract.ts";
import { runWorktreeSessionReplacement } from "./session-switch-trust.ts";
import {
	consumeCreatedWorktreeProjectTrust,
	CREATED_WORKTREE_PROJECT_TRUST_ENV,
} from "./project-trust.ts";

function currentPanelCreateContract() {
	return createWorkspaceActivationContract({
		id: "current-panel-behavior",
		workspaceAction: "create-worktree",
		activationTarget: "current-panel",
		contextMode: "clean",
		authorization: explicitWorkspaceAuthorization({
			source: "command",
			sourceId: "/wt new",
			action: "create-worktree",
			decision: "allow",
			activationTarget: "current-panel",
		}),
	});
}

test("current-panel replacement resolves trust before invoking the session switch", async () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-session-switch-trust-"));
	const worktree = join(root, "worktree");
	const sessionFile = join(root, "target.jsonl");
	const trustRoot = join(root, "project-trust");
	const previous = process.env[CREATED_WORKTREE_PROJECT_TRUST_ENV];
	mkdirSync(worktree);
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "target", timestamp: "2026-09-03T00:00:00.000Z", cwd: worktree })}\n`, "utf8");
	let replacementCalls = 0;
	try {
		await runWorktreeSessionReplacement({
			activationContract: currentPanelCreateContract(),
			cwd: worktree,
			sessionFile,
			projectTrustRoot: trustRoot,
			run: async () => {
				replacementCalls += 1;
				assert.deepEqual(
					consumeCreatedWorktreeProjectTrust(worktree, process.env, { root: trustRoot }),
					{ trusted: "yes", remember: true },
					"project trust must resolve before the session switch continues",
				);
			},
		});
		assert.equal(replacementCalls, 1);
		assert.equal(process.env[CREATED_WORKTREE_PROJECT_TRUST_ENV], previous);
	} finally {
		if (previous === undefined) delete process.env[CREATED_WORKTREE_PROJECT_TRUST_ENV];
		else process.env[CREATED_WORKTREE_PROJECT_TRUST_ENV] = previous;
		rmSync(root, { recursive: true, force: true });
	}
});
