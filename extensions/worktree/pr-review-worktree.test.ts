import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readPrReviewWorkspaceMetadata } from "../pr-review/workspace.ts";
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

test("PR review command context creates a head-pinned worktree and switches a compact provenance session", async () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-pr-review-worktree-"));
	const origin = join(root, "origin.git");
	const repo = join(root, "repo");
	const worktrees = join(root, "worktrees");
	const sourceSession = join(root, "source-session.jsonl");
	let targetSessionDir = "";
	try {
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

		const messages: any[] = [];
		let switched: { sessionPath: string; options: any } | undefined;
		const pi = {
			exec(command: string, args: string[], options?: { cwd?: string }) { return Promise.resolve(run(command, args, options?.cwd ?? repo)); },
		} as any;
		const ctx = {
			cwd: repo,
			sessionManager: {
				getSessionFile: () => sourceSession,
				getSessionName: () => "source review",
				getCwd: () => repo,
			},
			ui: { notify() {}, select: async () => undefined },
			async switchSession(sessionPath: string, options: any) {
				switched = { sessionPath, options };
				await options.withSession({ ui: { notify() {} }, sendMessage(message: any, delivery: any) { messages.push({ message, delivery }); } });
				return { cancelled: false };
			},
		} as any;

		const result = await runPrReviewWorktreeFromCommandContext(pi, ctx, {
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
			afterSwitchFollowUp: { customType: "pr-review-workspace-ready", content: "open review studio" },
		});
		assert.equal(result.status, "switched");
		if (result.status !== "switched") return;
		targetSessionDir = sessionDirFor(result.path);
		assert.equal(git(result.path, ["rev-parse", "HEAD"]), headSha);
		assert.equal(git(result.path, ["branch", "--show-current"]), "review/pr-42-" + headSha.slice(0, 8));
		const metadata = readPrReviewWorkspaceMetadata(result.path);
		assert.equal(metadata?.baseSha, baseSha);
		assert.equal(metadata?.headSha, headSha);
		assert.equal(metadata?.runId, "acme-repo-pr-42-head-1");
		assert.ok(switched?.sessionPath);
		const targetSession = readFileSync(switched!.sessionPath, "utf8");
		assert.doesNotMatch(targetSession, /PR #42를 리뷰해줘/);
		assert.ok(targetSession.includes(`Source conversation: ${sourceSession}`));
		assert.match(targetSession, /compact-review-handoff/);
		assert.ok(messages.some(({ message }) => message.customType === "worktree-cwd-binding"));
		assert.ok(messages.some(({ message }) => message.customType === "pr-review-workspace-ready"));
	} finally {
		if (targetSessionDir) rmSync(targetSessionDir, { recursive: true, force: true });
		rmSync(root, { recursive: true, force: true });
	}
});
