import assert from "node:assert/strict";
import test from "node:test";
import type { WorktreeRepoProfile } from "../utils/private-profiles.ts";
import { WORKSPACE_ACTIVATION_READY_ENTRY_TYPE } from "../utils/workspace-activation-contract.ts";
import {
	getBootstrapDomains,
	getPostCreateBootstrapRequest,
	pendingPostCreateActivationId,
	POST_CREATE_BOOTSTRAP_ENTRY_TYPE,
} from "./bootstrap-domains.ts";

const profile: WorktreeRepoProfile = {
	name: "fixture",
	bootstrap: {
		enabled: true,
		defaultDomains: ["root"],
		onCreateDomains: ["frontend"],
		domains: [
			{ name: "root", marker: "node_modules/.ready", command: "true" },
			{ name: "frontend", marker: "frontend/node_modules/.ready", command: "true" },
		],
	},
};

function readyEntry(activationId = "activation-1") {
	return {
		type: "custom",
		customType: WORKSPACE_ACTIVATION_READY_ENTRY_TYPE,
		data: { activationId, workspaceAction: "create-worktree", readyAt: "2026-08-25T00:00:00.000Z" },
	};
}

test("ordinary bootstrap uses defaultDomains while post-create READY uses onCreateDomains", () => {
	assert.deepEqual(getBootstrapDomains(profile, "구현을 시작한다", null), ["root"]);
	assert.deepEqual(getPostCreateBootstrapRequest(profile, [readyEntry()]), {
		activationId: "activation-1",
		domains: ["frontend"],
	});
});

test("post-create domains cannot be selected before target READY", () => {
	assert.equal(pendingPostCreateActivationId([]), null);
	assert.equal(getPostCreateBootstrapRequest(profile, []), null);
	assert.equal(getPostCreateBootstrapRequest(profile, [{
		type: "custom",
		customType: "workspace-activation-prepared",
		data: { activationId: "activation-1", workspaceAction: "create-worktree" },
	}]), null);
});

test("post-create bootstrap request is consumed once per activation", () => {
	const entries = [
		readyEntry("activation-once"),
		{
			type: "custom",
			customType: POST_CREATE_BOOTSTRAP_ENTRY_TYPE,
			data: { activationId: "activation-once", domains: ["frontend"], consumedAt: "2026-08-25T00:00:01.000Z" },
		},
	];
	assert.equal(pendingPostCreateActivationId(entries), null);
	assert.equal(getPostCreateBootstrapRequest(profile, entries), null);
});
