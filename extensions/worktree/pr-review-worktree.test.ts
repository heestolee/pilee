import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readPrReviewWorkspaceMetadata } from "../pr-review/workspace.ts";
import { createWorkspaceActivationContract, explicitWorkspaceAuthorization } from "../utils/workspace-activation-contract.ts";
import { prReviewCurrentPanelHeadNotice, runPrReviewWorktreeFromCommandContext } from "./pr-review.ts";

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

function cleanupReviewTarget(repo: string, targetPath: string, targetSessionDir: string): void {
	if (targetSessionDir) rmSync(targetSessionDir, { recursive: true, force: true });
	if (!targetPath) return;
	const removed = run("git", ["worktree", "remove", "--force", targetPath], repo);
	if (removed.code !== 0) rmSync(targetPath, { recursive: true, force: true });
	run("git", ["worktree", "prune"], repo);
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
	writeFileSync(join(repo, "value.txt"), `head\nfixture=${root}\n`, "utf8");
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
		const placement = input.placement ?? "tab";
		return createWorkspaceActivationContract({
			id: input.id,
			workspaceAction: input.workspaceAction,
			activationTarget: "new-panel",
			placement,
			contextMode: input.contextMode,
			continuation: input.continuation,
			authorization: explicitWorkspaceAuthorization({
				source: "command",
				sourceId: "/pr-review",
				action: input.workspaceAction,
				decision: "allow",
				activationTarget: "new-panel",
				placement,
			}),
		});
	};
}

test("PR review current-panel HEAD notice appears only when the target HEAD differs", () => {
	const requestTarget = { number: 42, headSha: "abcdef1234567890" };
	assert.equal(prReviewCurrentPanelHeadNotice(null, requestTarget), null);
	assert.equal(prReviewCurrentPanelHeadNotice({ head: requestTarget.headSha, branch: "feature/review" }, requestTarget), null);
	const notice = prReviewCurrentPanelHeadNotice({ head: "1111111111111111", branch: "main" }, requestTarget);
	assert.match(notice ?? "", /main \(11111111\)/);
	assert.match(notice ?? "", /PR #42 HEAD abcdef12/);
	assert.match(notice ?? "", /기존 worktree의 branch\/HEAD는 수정하지 않고/);
	assert.match(notice ?? "", /새 탭.*현재 패널은 그대로 유지/);
});

test("PR review offers only current panel or new tab and opens a head-pinned session in a new tab", async () => {
	const f = setupRepository();
	let targetSessionDir = "";
	let targetPath = "";
	try {
		const sourceBefore = readFileSync(f.sourceSession, "utf8");
		const order: string[] = [];
		let activationInput: any;
		let switchCalled = false;
		let selection: { title: string; options: string[] } | undefined;
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
			ui: {
				notify() {},
				async select(title: string, options: string[]) {
					selection = { title, options };
					return "새 탭";
				},
			},
			switchSession() { switchCalled = true; },
		} as any;
		const result = await runPrReviewWorktreeFromCommandContext(pi, ctx, request(f.baseSha, f.headSha), {
			buildContract: contractBuilder(order) as any,
			activate: async (_pi, _ctx, input) => {
				activationInput = input;
				return { status: "activated", contract: input.contract, placement: "tab", terminalId: "term-42", forkId: "fork-42", panelLabel: "P1", readyAt: "2026-08-25T00:00:00.000Z", continuationDispatched: true };
			},
		});
		targetPath = result.path ?? "";
		assert.equal(result.status, "activated");
		if (result.status !== "activated") return;
		targetSessionDir = sessionDirFor(result.path);
		assert.deepEqual(selection?.options, ["현재 패널", "새 탭"]);
		assert.match(selection?.title ?? "", /PR #42 review를 어디에서 열까요/);
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
		assert.equal(activationInput.contract.placement, "tab");
		assert.equal(activationInput.contract.continuation.customType, "pr-review-workspace-ready");
		assert.equal(switchCalled, false);
		const metadata = readPrReviewWorkspaceMetadata(result.path);
		assert.equal(metadata?.targetSessionFile, result.sessionFile);
		assert.equal(metadata?.contextMode, "full-transcript");
		assert.equal(metadata?.activation?.target, "new-panel");
		assert.equal(metadata?.activation?.placement, "tab");
		assert.equal(metadata?.activation?.panelLabel, "P1");
	} finally {
		cleanupReviewTarget(f.repo, targetPath, targetSessionDir);
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("PR review switches the current panel to a fresh target session and warns before changing the panel HEAD", async () => {
	const f = setupRepository();
	let targetSessionDir = "";
	let targetPath = "";
	try {
		rmSync(f.sourceSession, { force: true });
		const order: string[] = [];
		const notifications: Array<{ message: string; level: string }> = [];
		let selection: { title: string; options: string[] } | undefined;
		let switchedSession = "";
		const replacementStatuses: Array<[string, string | undefined]> = [];
		const replacementMessages: Array<{ message: any; options: any }> = [];
		const pi = {
			exec(command: string, args: string[], options?: { cwd?: string }) { return Promise.resolve(run(command, args, options?.cwd ?? f.repo)); },
		} as any;
		const ctx = {
			cwd: f.repo,
			hasUI: true,
			sessionManager: { getSessionFile: () => f.sourceSession, getSessionName: () => undefined, getCwd: () => f.repo },
			ui: {
				notify(message: string, level: string) { notifications.push({ message, level }); },
				async select(title: string, options: string[]) {
					selection = { title, options };
					return "현재 패널";
				},
			},
			async switchSession(sessionPath: string, options: any) {
				switchedSession = sessionPath;
				await options.withSession({
					ui: {
						notify(message: string, level: string) { notifications.push({ message, level }); },
						setStatus(key: string, value?: string) { replacementStatuses.push([key, value]); },
					},
					async sendMessage(message: any, messageOptions: any) { replacementMessages.push({ message, options: messageOptions }); },
				});
				return { cancelled: false };
			},
		} as any;
		const result = await runPrReviewWorktreeFromCommandContext(pi, ctx, request(f.baseSha, f.headSha), {
			buildContract: contractBuilder(order) as any,
			activate: async () => { throw new Error("new-panel activation must not run for current panel"); },
		});
		targetPath = result.path ?? "";
		assert.equal(result.status, "switched", result.status === "switched" ? undefined : result.reason);
		if (result.status !== "switched") return;
		targetSessionDir = sessionDirFor(result.path);
		assert.deepEqual(selection?.options, ["현재 패널", "새 탭"]);
		assert.equal(order.length, 0, "current-panel selection must not build a new-panel contract");
		assert.equal(switchedSession, result.sessionFile);
		assert.equal(result.contract.activationTarget, "current-panel");
		assert.equal(result.contract.placement, undefined);
		const targetSession = readFileSync(result.sessionFile, "utf8");
		const header = JSON.parse(targetSession.split("\n")[0]!);
		assert.equal(header.parentSession, undefined);
		assert.match(targetSession, /fresh review session/);
		assert.doesNotMatch(targetSession, /PR #42를 리뷰해줘/);
		assert.ok(notifications.some((item) => item.level === "warning" && /기존 worktree의 branch\/HEAD는 수정하지 않고/.test(item.message)));
		assert.deepEqual(replacementStatuses, [["meta-review", undefined]]);
		assert.equal(replacementMessages.length, 1);
		assert.equal(replacementMessages[0].message.customType, "pr-review-workspace-ready");
		assert.equal(replacementMessages[0].options.deliverAs, "followUp");
		assert.equal(replacementMessages[0].options.triggerTurn, true);
		const metadata = readPrReviewWorkspaceMetadata(result.path);
		assert.equal(metadata?.sourceSessionFile, undefined);
		assert.equal(metadata?.contextMode, "fresh");
		assert.equal(metadata?.activation?.target, "current-panel");
	} finally {
		cleanupReviewTarget(f.repo, targetPath, targetSessionDir);
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("PR review without interactive UI does not choose the current panel implicitly", async () => {
	const f = setupRepository();
	let targetPath = "";
	try {
		const pi = {
			exec(command: string, args: string[], options?: { cwd?: string }) { return Promise.resolve(run(command, args, options?.cwd ?? f.repo)); },
		} as any;
		const result = await runPrReviewWorktreeFromCommandContext(pi, {
			cwd: f.repo,
			hasUI: false,
			sessionManager: { getSessionFile: () => f.sourceSession },
			ui: { notify() {} },
		} as any, request(f.baseSha, f.headSha));
		targetPath = result.path ?? "";
		assert.equal(result.status, "blocked");
		assert.match(result.status === "blocked" ? result.reason : "", /열기 위치를 선택하지 않아/);
		assert.equal(existsSync(targetPath), false);
	} finally {
		cleanupReviewTarget(f.repo, targetPath, targetPath ? sessionDirFor(targetPath) : "");
		rmSync(f.root, { recursive: true, force: true });
	}
});

test("PR review current-panel switch cancellation rolls back the prepared worktree, session, and branch", async () => {
	const f = setupRepository();
	let targetPath = "";
	let targetSessionDir = "";
	try {
		const pi = {
			exec(command: string, args: string[], options?: { cwd?: string }) { return Promise.resolve(run(command, args, options?.cwd ?? f.repo)); },
		} as any;
		const result = await runPrReviewWorktreeFromCommandContext(pi, {
			cwd: f.repo,
			hasUI: true,
			sessionManager: { getSessionFile: () => f.sourceSession, getSessionName: () => "source review", getCwd: () => f.repo },
			ui: { notify() {}, async select() { return "현재 패널"; } },
			async switchSession() { return { cancelled: true }; },
		} as any, request(f.baseSha, f.headSha));
		targetPath = result.path ?? "";
		targetSessionDir = targetPath ? sessionDirFor(targetPath) : "";
		assert.equal(result.status, "blocked");
		assert.match(result.status === "blocked" ? result.reason : "", /전환을 취소/);
		assert.equal(existsSync(targetPath), false);
		assert.equal(existsSync(targetSessionDir), false);
		assert.equal(run("git", ["show-ref", "--verify", "--quiet", `refs/heads/review/pr-42-${f.headSha.slice(0, 8)}`], f.repo).code, 1);
	} finally {
		cleanupReviewTarget(f.repo, targetPath, targetSessionDir);
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
			ui: { notify() {}, async select() { return "새 탭"; } },
			switchSession() { switchCalled = true; },
		} as any;
		const result = await runPrReviewWorktreeFromCommandContext(pi, ctx, request(f.baseSha, f.headSha), {
			buildContract: contractBuilder(order) as any,
			activate: async (_pi, _ctx, input) => {
				targetPath = input.cwd;
				targetSessionDir = dirnameForSession(input.sessionFile);
				return { status: "failed", reason: "READY timeout", contract: input.contract, placement: "tab", safeToDeleteTarget: true };
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

test("PR review preserves its session and worktree when panel termination is not confirmed", async () => {
	const f = setupRepository();
	let targetSessionDir = "";
	let targetPath = "";
	try {
		let targetSessionFile = "";
		const order: string[] = [];
		const pi = {
			exec(command: string, args: string[], options?: { cwd?: string }) { return Promise.resolve(run(command, args, options?.cwd ?? f.repo)); },
		} as any;
		const ctx = {
			cwd: f.repo,
			hasUI: true,
			sessionManager: { getSessionFile: () => f.sourceSession, getSessionName: () => "source review", getCwd: () => f.repo },
			ui: { notify() {}, async select() { return "새 탭"; } },
		} as any;
		const result = await runPrReviewWorktreeFromCommandContext(pi, ctx, request(f.baseSha, f.headSha), {
			buildContract: contractBuilder(order) as any,
			activate: async (_pi, _ctx, input) => {
				targetPath = input.cwd;
				targetSessionFile = input.sessionFile;
				targetSessionDir = dirnameForSession(input.sessionFile);
				return {
					status: "blocked",
					reason: "terminal close not confirmed",
					contract: input.contract,
					placement: "tab",
					descriptorPath: "/tmp/workspace-activation.json",
					safeToDeleteTarget: false,
				};
			},
		});
		assert.equal(result.status, "blocked");
		assert.match(result.reason, /recovery artifact로 보존/);
		assert.equal(existsSync(targetPath), true);
		assert.equal(existsSync(targetSessionFile), true);
		assert.equal(git(targetPath, ["rev-parse", "HEAD"]), f.headSha);
		assert.equal(readPrReviewWorkspaceMetadata(targetPath)?.targetSessionFile, targetSessionFile);
	} finally {
		cleanupReviewTarget(f.repo, targetPath, targetSessionDir);
		rmSync(f.root, { recursive: true, force: true });
	}
});

function dirnameForSession(sessionFile: string): string {
	return sessionFile.slice(0, sessionFile.lastIndexOf("/"));
}
