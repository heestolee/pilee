import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
	existsSync,
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	createWorkspaceActivationContract,
	explicitWorkspaceAuthorization,
} from "../utils/workspace-activation-contract.ts";
import {
	consumeCreatedWorktreeProjectTrust,
	CREATED_WORKTREE_PROJECT_TRUST_ENV,
	prepareCreatedWorktreeProjectTrust,
} from "./project-trust.ts";

function createContract(id: string) {
	return createWorkspaceActivationContract({
		id,
		workspaceAction: "create-worktree",
		activationTarget: "new-panel",
		placement: "right",
		contextMode: "clean",
		authorization: explicitWorkspaceAuthorization({
			source: "command",
			sourceId: "/wt fork",
			action: "create-worktree",
			decision: "allow",
			activationTarget: "new-panel",
			placement: "right",
		}),
	});
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "pilee-project-trust-concurrency-"));
	const cwd = join(root, "worktree");
	const sessionFile = join(root, "target.jsonl");
	const trustRoot = join(root, "project-trust");
	mkdirSync(cwd);
	writeFileSync(sessionFile, `${JSON.stringify({ type: "session", version: 3, id: "target", timestamp: "2026-09-03T00:00:00.000Z", cwd })}\n`, "utf8");
	return { root, cwd, sessionFile, trustRoot };
}

async function waitUntil(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("parallel consumer barrier timeout");
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
	}
}

function collect(child: ReturnType<typeof spawn>): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
		child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
		child.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

test("symlink aliases cannot consume one trust authorization twice", () => {
	const f = fixture();
	try {
		const prepared = prepareCreatedWorktreeProjectTrust({
			contract: createContract("symlink-alias"),
			cwd: f.cwd,
			sessionFile: f.sessionFile,
			root: f.trustRoot,
		});
		const alias = join(f.trustRoot, "alias.json");
		symlinkSync(prepared.path, alias);
		assert.deepEqual(
			consumeCreatedWorktreeProjectTrust(f.cwd, { [CREATED_WORKTREE_PROJECT_TRUST_ENV]: alias }, { root: f.trustRoot }),
			{ trusted: "undecided" },
		);
		assert.deepEqual(
			consumeCreatedWorktreeProjectTrust(f.cwd, { [CREATED_WORKTREE_PROJECT_TRUST_ENV]: prepared.path }, { root: f.trustRoot }),
			{ trusted: "yes", remember: true },
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("hard-link aliases cannot consume one trust authorization twice", () => {
	const f = fixture();
	try {
		const prepared = prepareCreatedWorktreeProjectTrust({
			contract: createContract("hard-link-alias"),
			cwd: f.cwd,
			sessionFile: f.sessionFile,
			root: f.trustRoot,
		});
		const alias = join(f.trustRoot, "alias.json");
		linkSync(prepared.path, alias);
		assert.deepEqual(
			consumeCreatedWorktreeProjectTrust(f.cwd, { [CREATED_WORKTREE_PROJECT_TRUST_ENV]: alias }, { root: f.trustRoot }),
			{ trusted: "undecided" },
		);
		assert.deepEqual(
			consumeCreatedWorktreeProjectTrust(f.cwd, { [CREATED_WORKTREE_PROJECT_TRUST_ENV]: prepared.path }, { root: f.trustRoot }),
			{ trusted: "yes", remember: true },
		);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("non-file json entries stay undecided and do not poison later preparation", () => {
	const f = fixture();
	try {
		const directoryEntry = join(f.trustRoot, "directory.json");
		mkdirSync(directoryEntry, { recursive: true });
		assert.deepEqual(
			consumeCreatedWorktreeProjectTrust(f.cwd, { [CREATED_WORKTREE_PROJECT_TRUST_ENV]: directoryEntry }, { root: f.trustRoot }),
			{ trusted: "undecided" },
		);
		const prepared = prepareCreatedWorktreeProjectTrust({
			contract: createContract("after-directory"),
			cwd: f.cwd,
			sessionFile: f.sessionFile,
			root: f.trustRoot,
		});
		assert.equal(existsSync(prepared.path), true);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("parallel processes grant exactly one owner for a trust authorization", async () => {
	const f = fixture();
	try {
		const prepared = prepareCreatedWorktreeProjectTrust({
			contract: createContract("parallel-owner"),
			cwd: f.cwd,
			sessionFile: f.sessionFile,
			root: f.trustRoot,
		});
		const descriptor = JSON.parse(readFileSync(prepared.path, "utf8"));
		descriptor.padding = "x".repeat(512 * 1024);
		writeFileSync(prepared.path, `${JSON.stringify(descriptor)}\n`, "utf8");

		const readyDir = join(f.root, "ready");
		const goFile = join(f.root, "go");
		const runner = join(f.root, "consume.mjs");
		mkdirSync(readyDir);
		writeFileSync(runner, `
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { consumeCreatedWorktreeProjectTrust, CREATED_WORKTREE_PROJECT_TRUST_ENV } from ${JSON.stringify(new URL("./project-trust.ts", import.meta.url).href)};
writeFileSync(join(process.env.READY_DIR, process.env.WORKER_ID), "ready");
while (!existsSync(process.env.GO_FILE)) await new Promise((resolve) => setTimeout(resolve, 2));
const decision = consumeCreatedWorktreeProjectTrust(process.env.TARGET_CWD, { [CREATED_WORKTREE_PROJECT_TRUST_ENV]: process.env.TRUST_PATH }, { root: process.env.TRUST_ROOT });
process.stdout.write(JSON.stringify(decision));
`, "utf8");

		const workerCount = 16;
		const runs = Array.from({ length: workerCount }, (_, index) => collect(spawn(process.execPath, ["--experimental-strip-types", runner], {
			env: {
				...process.env,
				READY_DIR: readyDir,
				WORKER_ID: String(index),
				GO_FILE: goFile,
				TARGET_CWD: f.cwd,
				TRUST_PATH: prepared.path,
				TRUST_ROOT: f.trustRoot,
			},
			stdio: ["ignore", "pipe", "pipe"],
		})));
		await waitUntil(() => readdirSync(readyDir).length === workerCount);
		writeFileSync(goFile, "go\n", "utf8");
		const results = await Promise.all(runs);
		for (const result of results) assert.equal(result.code, 0, result.stderr);
		const decisions = results.map((result) => JSON.parse(result.stdout));
		assert.equal(decisions.filter((decision) => decision.trusted === "yes").length, 1);
		assert.equal(decisions.filter((decision) => decision.trusted === "undecided").length, workerCount - 1);
	} finally {
		rmSync(f.root, { recursive: true, force: true });
	}
});
