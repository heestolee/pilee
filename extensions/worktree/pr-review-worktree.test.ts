import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readPrReviewWorkspaceMetadata } from "../pr-review/workspace.ts";
import { createWorkspaceActivationContract, explicitWorkspaceAuthorization } from "../utils/workspace-activation-contract.ts";
import { runPrReviewWorktreeFromCommandContext } from "./pr-review.ts";

function run(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, { cwd, encoding: "utf8" });
	if (result.error) throw result.error;
	return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function git(cwd: string, args: string[]): string {
	const result = run("git", args, cwd);
	if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed\n${result.stderr}`);
	return result.stdout.trim();
}

function sessionDirFor(path: string): string {
	return join(homedir(), ".pi", "agent", "sessions", `--${path.slice(1).replace(/\//g, "-")}--`);
}

function setupRepository() {
	const root = mkdtempSync(join(tmpdir(), "pilee-pr-review-worktree-"));
	const origin = join(root, "origin.git");
	const repo = join(root, "repo");
	const worktrees = join(root, "worktrees");
	const sourceSession = join(root, "source-session.jsonl");
	git(root, ["init", "--bare", origin]);
	mkdirSync(repo, { recursive: true });
	git(repo, ["init", "-q"]);
	git(repo, ["config", "user.name", "PR Review Test"]);
	git(repo, ["config", "user.email", "pr-review@example.invalid"]);
	writeFileSync(join(repo, ".gitignore"), ".pi/\n", "utf8");
	writeFileSync(join(repo, "value.txt"), "base\n", "utf8");
	git(repo, ["add", "."]);
	git(repo, ["commit", "-q", "-m", "base"]);
	git(repo, ["branch", "-M", "main"]);
	git(repo, ["remote", "add", "origin", origin]);
	git(repo, ["push", "-q", "-u", "origin", "main"]);
	const baseSha = git(repo, ["rev-parse", "HEAD"]);
	git(repo, ["switch", "-q", "-c", "feature/review"]);
	writeFileSync(join(repo, "value.txt"), "head\n", "utf8");
	git(repo, ["add", "value.txt"]);
	git(repo, ["commit", "-q", "-m", "head"]);
	const headSha = git(repo, ["rev-parse", "HEAD"]);
	git(repo, ["push", "-q", "origin", `${headSha}:refs/pull/42/head`]);
	git(repo, ["switch", "-q", "main"]);
	mkdirSync(join(repo, ".pi"), { recursive: true });
	writeFileSync(join(repo, ".pi", "worktree.json"), JSON.stringify({ rootDir: worktrees, baseBranch: "main", productionBranch: "production", branchPrefix: "feature", namingScheme: "none" }), "utf8");
	writeFileSync(sourceSession, [
		JSON.stringify({ type: "session", version: 3, id: "source", timestamp: new Date().toISOString(), cwd: repo }),
		JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "PR #42를 리뷰해줘" }] } }),
	].join("\n") + "\n", "utf8");
	return { root, repo, worktrees, sourceSession, baseSha, headSha };
}

function request(baseSha: string, headSha: string) {
	return {
		repo: "",
		runId: "acme-repo-pr-42-head-1",
		runDir: "/tmp/pr-review/acme-repo-pr-42-head-1",
		prUrl: "https://github.com/acme/repo/pull/42",
		repository: "acme/repo",
		number: 42,
		title: "Review target",
		baseRefName: "main",
		baseSha,
		headRefName: "feature/review",
		headSha,
		afterSwitchFollowUp: { customType: "pr-review-workspace-ready", content: "open review studio and enable /diff" },
	};
}

function contractBuilder(order: string[]) {
	return async (input: any) => {
		order.push("contract");
		return createWorkspaceActivationContract({
			id: input.id,
			workspaceAction: input.workspaceAction,
			activationTarget: "new-panel",
			placement: "right",
			contextMode: input.contextMode,
			continuation: input.continuation,
			authorization: explicitWorkspaceAuthorization({
				source: "command",
				sourceId: "/pr-review",
				action: input.workspaceAction,
				decision: "allow",
				activationTarget: "new-panel",
				placement: "right",
			}),
		});
	};
}

test("PR review creates a head-pinned worktree and activates a full-lineage exact session in a new panel", async () => {
	const f = setupRepository();
	let targetSessionDir = "";
	try {
		const sourceBefore = readFileSync(f.sourceSession, "utf8");
		const order: string[] = [];
		let activationInput: any;
		let switchCalled = false;
		const pi = {
			exec(command: string, args: string[], options?: { cwd?: string }) {
				if (command === "git" && args[0] === "fetch") order.push("fetch");
				return Promise.resolve(run(command, args, options?.cwd ?? f.repo));
			},
		} as any;
		const ctx = {
			cwd: f.repo,
			hasUI: true,
			sessionManager: { getSessionFile: () => f.sourceSession, getSessionName: () => "source review", getCwd: () => f.repo },
			ui: { notify() {} },
			switchSession() { switchCalled = true; },
		} as any;
		const result = await runPrReviewWorktreeFromCommandContext(pi, ctx, request(f.baseSha, f.headSha), {
			buildContract: contractBuilder(order) as any,
			activate: async (_pi, _ctx, input) => {
				activationInput = input;
				return { status: "activated", contract: input.contract, placement: "right", terminalId: "term-42", forkId: "fork-42", panelLabel: "P1", readyAt: "2026-08-25T00:00:00.000Z", continuationDispatched: true };
			},
		});
		assert.equal(result.status, "activated");
		if (result.status !== "activated") return;
		targetSessionDir = sessionDirFor(result.path);
		assert.ok(order.indexOf("contract") >= 0 && order.indexOf("contract") < order.indexOf("fetch"), "placement contract must be fixed before worktree creation");
		assert.equal(git(result.path, ["rev-parse", "HEAD"]), f.headSha);
		assert.equal(git(result.path, ["branch", "--show-current"]), "review/pr-42-" + f.headSha.slice(0, 8));
		const targetSession = readFileSync(result.sessionFile, "utf8");
		const header = JSON.parse(targetSession.split("\n")[0]!);
		assert.equal(header.parentSession, f.sourceSession);
		assert.match(targetSession, /PR #42를 리뷰해줘/);
		assert.match(targetSession, /full-transcript/);
		assert.equal(readFileSync(f.sourceSession, "utf8"), sourceBefore, "source session must remain immutable");
		assert.equal(activationInput.sessionFile, result.sessionFile);
		assert.equal(activationInput.cwd, result.path);
		assert.equal(activationInput.contract.contextMode, "full");
		assert.equal(activationInput.contract.continuation.customType, "pr-review-workspace-ready");
		assert.equal(switchCalled, false);
		const metadata = readPrReviewWorkspaceMetadata(result.path);
		assert.equal(metadata?.targetSessionFile, result.sessionFile);
		assert.equal(metadata?.contextMode, "full-transcript");
		assert.equal(metadata?.activation?.target, "new-panel");
		assert.equal(metadata?.activation?.panelLabel, "P1");
	} finally {
		if (targetSessionDir) rmSync(targetSessionDir, { recursive: true, force: true });
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("PR review activation failure removes its new session/worktree and never falls back to current panel", async () => {
	const f = setupRepository();
	let targetSessionDir = "";
	try {
		let switchCalled = false;
		let targetPath = "";
		const order: string[] = [];
		const pi = {
			exec(command: string, args: string[], options?: { cwd?: string }) { return Promise.resolve(run(command, args, options?.cwd ?? f.repo)); },
		} as any;
		const ctx = {
			cwd: f.repo,
			hasUI: true,
			sessionManager: { getSessionFile: () => f.sourceSession, getSessionName: () => "source review", getCwd: () => f.repo },
			ui: { notify() {} },
			switchSession() { switchCalled = true; },
		} as any;
		const result = await runPrReviewWorktreeFromCommandContext(pi, ctx, request(f.baseSha, f.headSha), {
			buildContract: contractBuilder(order) as any,
			activate: async (_pi, _ctx, input) => {
				targetPath = input.cwd;
				targetSessionDir = dirnameForSession(input.sessionFile);
				return { status: "failed", reason: "READY timeout", contract: input.contract, placement: "right" };
			},
		});
		assert.equal(result.status, "failed");
		assert.match(result.reason, /READY timeout/);
		assert.equal(switchCalled, false);
		assert.equal(existsSync(targetPath), false);
		assert.equal(run("git", ["show-ref", "--verify", "--quiet", `refs/heads/review/pr-42-${f.headSha.slice(0, 8)}`], f.repo).code, 1);
		assert.equal(existsSync(targetSessionDir), false);
	} finally {
		if (targetSessionDir) rmSync(targetSessionDir, { recursive: true, force: true });
		rmSync(f.root, { recursive: true, force: true });
	}
});

function dirnameForSession(sessionFile: string): string {
	return sessionFile.slice(0, sessionFile.lastIndexOf("/"));
}
