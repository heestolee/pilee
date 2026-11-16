import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import workflowGuard from "./index.ts";

type Exec = (command: string, args: string[], options?: { cwd?: string }) => Promise<{ code: number; stdout: string; stderr: string }>;

const realExec: Exec = async (command, args, options) => {
	try {
		const stdout = execFileSync(command, args, { cwd: options?.cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
		return { code: 0, stdout, stderr: "" };
	} catch (error: any) {
		return { code: error.status ?? 1, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? "") };
	}
};

let sequence = 0;

function harness(cwd: string, exec: Exec = realExec) {
	const hooks: Record<string, any> = {};
	const entries: Array<{ type: string; customType?: string; data?: unknown }> = [];
	const sessionFile = `/tmp/workflow-guard-loss-${++sequence}.jsonl`;
	workflowGuard({
		on: (name: string, fn: any) => { hooks[name] = fn; },
		registerTool: () => {},
		exec,
		getThinkingLevel: () => "high",
		setThinkingLevel: () => {},
		appendEntry: (customType: string, data: unknown) => { entries.push({ type: "custom", customType, data }); },
	} as any, { trustedInternalPullRequestRepositories: [], trustedInternalPullRequestOwners: [], worktreeRepoProfiles: [] });
	const ctx = {
		cwd,
		model: { provider: "openai-codex", id: "gpt-6-astra" },
		sessionManager: {
			getSessionFile: () => sessionFile,
			getLeafId: () => "leaf-1",
			getEntries: () => entries,
			getBranch: () => entries,
			appendCustomEntry: (customType: string, data: unknown) => { entries.push({ type: "custom", customType, data }); },
		},
	};
	let call = 0;
	return {
		start: (prompt: string) => hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx),
		bash: async (command: string) => {
			const event = { toolName: "bash", toolCallId: `bash-${++call}`, input: { command } };
			const blocked = await hooks.tool_call(event, ctx);
			const result = blocked ? undefined : await hooks.tool_result({ ...event, content: [] }, ctx);
			return { blocked, note: String(result?.content?.at(-1)?.text ?? "") };
		},
		tool: (toolName: string, input: Record<string, unknown>) => hooks.tool_call({ toolName, toolCallId: `${toolName}-${++call}`, input }, ctx),
		tuiChoice: (selected: string) => hooks.tool_result({
			toolName: "tui_ask", toolCallId: `choice-${++call}`, content: [],
			details: { status: "submitted", selectedOptions: [selected] },
		}, ctx),
	};
}

async function gitFixture() {
	const root = await mkdtemp(join(tmpdir(), "workflow-guard-loss-"));
	const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
	git("init", "-q", "-b", "feature/x");
	await writeFile(join(root, "tracked.txt"), "one\n");
	git("add", "tracked.txt");
	git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init");
	return root;
}

test("reset --hard is blocked only when uncommitted tracked changes would be lost", async () => {
	const root = await gitFixture();
	try {
		const h = harness(root);
		await h.start("정리해줘");
		assert.equal((await h.bash("git reset --hard HEAD")).blocked, undefined, "a clean tree loses nothing");
		await writeFile(join(root, "tracked.txt"), "changed\n");
		const dirty = await h.bash("git reset --hard HEAD");
		assert.equal(dirty.blocked?.block, true);
		assert.match(dirty.blocked.reason, /커밋하지 않은 변경 1개 파일/);
		assert.equal((await h.bash("git stash && git reset --hard HEAD")).blocked, undefined, "stashing first preserves the changes");
		const asked = harness(root);
		await asked.start("변경 버리고 git reset 해줘");
		assert.equal((await asked.bash("git reset --hard HEAD")).blocked, undefined, "the user named the reset");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("git clean is judged by a dry run of the same options", async () => {
	const root = await gitFixture();
	try {
		const h = harness(root);
		await h.start("빌드 산출물 확인해줘");
		assert.equal((await h.bash("git clean -fd")).blocked, undefined, "nothing untracked to remove");
		await writeFile(join(root, "draft.md"), "keep me\n");
		const removing = await h.bash(`git -C ${root} clean -fd`);
		assert.equal(removing.blocked?.block, true);
		assert.match(removing.blocked.reason, /draft\.md/);
		assert.equal((await h.bash("git clean -n")).blocked, undefined, "a dry run is not destructive");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("recursive rm is judged by the resolved target, not by text that looks like rm", async () => {
	// /usr 아래를 가상의 작업 공간으로 두고 판정만 확인한다. 명령은 실행하지 않는다.
	const fakeWorkTree: Exec = async (command, args, options) => command === "git" && args.join(" ") === "rev-parse --show-toplevel" && options?.cwd?.startsWith("/usr")
		? { code: 0, stdout: "/usr\n", stderr: "" }
		: realExec(command, args, options);
	const h = harness("/usr", fakeWorkTree);
	await h.start("작업해줘");
	for (const command of [
		"rm -rf /tmp/wg-scratch /tmp/wg-files*.txt",
		"T=$(mktemp -d /tmp/x.XXXX); rm -rf \"$T\"",
		"B=/tmp/backup; rm -rf \"$B\" && mkdir -p \"$B\"",
		"cd /usr && rm -rf share",
		"rm -rf /usr/does-not-exist",
		"rg -n 'rm -rf|git reset --hard' extensions",
		"cat > /tmp/msg <<'EOF'\nfix: rm -rf ~ 와 git reset --hard 설명\nEOF\ngit commit -F /tmp/msg",
	]) {
		assert.equal((await h.bash(command)).blocked, undefined, command);
	}
	for (const command of ["rm -rf /usr", "rm -rf ~", "cd /usr && rm -rf *"]) {
		const result = await h.bash(command);
		assert.equal(result.blocked?.block, true, command);
		assert.match(result.blocked.reason, /작업 공간이나 임시 폴더 밖/, command);
	}
	const unresolved = await h.bash("rm -rf \"$UNKNOWN_DIR/cache\"");
	assert.equal(unresolved.blocked, undefined, "an unresolvable target warns instead of blocking");
	assert.match(unresolved.note, /lossCheck/);
});
