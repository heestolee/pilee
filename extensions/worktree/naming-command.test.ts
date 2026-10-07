import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { promisify } from "node:util";
import test, { after } from "node:test";
import { createJiti } from "@mariozechner/jiti";

// Import after HOME isolation: registry, profiles and sessions must never touch the user's state.
const home = mkdtempSync(join(tmpdir(), "pilee-naming-command-"));
process.env.HOME = home;
process.env.PI_CODING_AGENT_DIR = join(home, ".pi", "agent");
const extension = await createJiti(import.meta.url, { moduleCache: false }).import<typeof import("./index.ts").default>("./index.ts", { default: true });
const { SessionManager } = await import("@mariozechner/pi-coding-agent");
after(() => rmSync(home, { recursive: true, force: true }));
const exec = promisify(execFile);

for (const action of ["new", "fork"]) {
	test(`/wt ${action} propagates the final name after a late conflict into session and metadata`, async () => {
		const repo = join(home, `repo-${action}`);
		const rootDir = join(home, `targets-${action}`);
		mkdirSync(repo); mkdirSync(rootDir);
		const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
		git("init", "-b", "main"); git("config", "user.email", "test@example.invalid"); git("config", "user.name", "Test");
		git("config", "core.hooksPath", "/dev/null");
		writeFileSync(join(repo, "file.txt"), "baseline"); git("add", "file.txt"); git("commit", "-m", "baseline");
		git("clone", "--bare", repo, join(home, `remote-${action}.git`));
		git("remote", "add", "origin", join(home, `remote-${action}.git`));
		mkdirSync(join(repo, ".pi"));
		writeFileSync(join(repo, ".pi", "worktree.json"), JSON.stringify({ rootDir, baseBranch: "main", namingScheme: "pokemon" }));
		const sourceSession = join(home, `source-${action}.jsonl`);
		const sourceText = JSON.stringify({ type: "session", version: 3, id: `source-${action}`, timestamp: new Date().toISOString(), cwd: repo }) + "\n";
		writeFileSync(sourceSession, sourceText);
		let command: any;
		let firstBranch = "";
		let selected = 0;
		let switched = "";
		const notifications: string[] = [];
		extension({
			on() {}, registerTool() {}, registerShortcut() {},
			registerCommand(name: string, definition: any) { if (name === "wt") command = definition; },
			async exec(cmd: string, args: string[], options: any = {}) {
				assert.equal(cmd, "git", "no real host/panel automation may run");
				if (args[0] === "worktree" && args[1] === "add" && !firstBranch) {
					firstBranch = args[3]; git("branch", firstBranch);
				}
				try { return { ...await exec(cmd, args, { ...options, encoding: "utf8" }), code: 0, killed: false }; }
				catch (error: any) { return { code: typeof error.code === "number" ? error.code : 1, stdout: error.stdout ?? "", stderr: error.stderr ?? error.message, killed: false }; }
			},
		} as any);
		await command.handler(`${action} --minimal-context --ticket TEST-1`, {
			cwd: repo, hasUI: true,
			sessionManager: SessionManager.open(sourceSession),
			ui: {
				notify: (text: string) => notifications.push(text),
				select: async () => { selected++; return "현재 패널"; },
			},
			switchSession: async (path: string) => { switched = path; return { cancelled: false }; },
		});
		assert.ok(switched, notifications.join("\n"));
		const entries = readFileSync(switched, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const target = entries[0].cwd;
		const meta = JSON.parse(readFileSync(join(target, ".pi", "worktree-meta.json"), "utf8"));
		assert.match(meta.name, /^[a-z]+-[a-z]+$/);
		assert.notEqual(meta.branch, firstBranch);
		assert.equal(meta.branch, `feature/TEST-1/${meta.name}`);
		assert.equal(basename(target), meta.name);
		assert.equal(realpathSync(target), realpathSync(join(rootDir, meta.name)));
		assert.equal(git("-C", target, "branch", "--show-current"), meta.branch);
		assert.ok(entries.some((entry) => entry.type === "session_info" && entry.name === `${meta.name} (${meta.branch})`));
		assert.equal(meta.context.targetSessionFile, switched);
		assert.equal(readFileSync(sourceSession, "utf8"), sourceText);
		assert.equal(selected, action === "fork" ? 1 : 0);
		assert.ok(existsSync(target));
	});
}
