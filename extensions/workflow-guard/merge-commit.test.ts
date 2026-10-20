import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import workflowGuard from "./index.ts";
import autoCommit from "../auto-commit/index.ts";
import tuiAsk, { singleCommitApprovalPrompt } from "../tui-ask/index.ts";

function execute(command: string, args: string[], options: { cwd?: string } = {}) {
	const result = spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });
	return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
function git(cwd: string, ...args: string[]) {
	const result = execute("git", args, { cwd });
	assert.equal(result.code, 0, `${args.join(" ")}: ${result.stderr}`);
	return result.stdout.trim();
}
async function fixture(t: any, options: { conflict?: boolean; files?: number; merge?: boolean } = {}) {
	const cwd = await mkdtemp(join(tmpdir(), "merge-guard-"));
	t.after(() => rm(cwd, { recursive: true, force: true }));
	git(cwd, "init", "-b", "main");
	git(cwd, "config", "user.email", "test@example.invalid");
	git(cwd, "config", "user.name", "Synthetic Test");
	git(cwd, "config", "core.hooksPath", join(cwd, ".git", "hooks"));
	await writeFile(join(cwd, "note.txt"), "base\n");
	git(cwd, "add", "."); git(cwd, "commit", "-m", "initial");
	git(cwd, "checkout", "-b", "upstream");
	for (let i = 0; i < (options.files ?? 16); i++) {
		const area = join(cwd, `area-${i % 5}`);
		await mkdir(area, { recursive: true });
		await writeFile(join(area, `file-${i}.txt`), "upstream\n".repeat(70));
	}
	if (options.conflict) await writeFile(join(cwd, "note.txt"), "upstream\n");
	git(cwd, "add", "."); git(cwd, "commit", "-m", "upstream changes");
	const upstream = git(cwd, "rev-parse", "HEAD");
	git(cwd, "checkout", "main");
	await writeFile(join(cwd, options.conflict ? "note.txt" : "local.txt"), "local\n");
	git(cwd, "add", "."); git(cwd, "commit", "-m", "local change");
	const head = git(cwd, "rev-parse", "HEAD");
	if (options.merge !== false) {
		const result = execute("git", ["merge", "--no-commit", "--no-ff", "upstream"], { cwd });
		assert.equal(result.code, options.conflict ? 1 : 0, result.stderr);
	}
	return { cwd, head, upstream };
}
let sequence = 0;
function harness(cwd: string, execOverride?: (command: string, args: string[], options: any) => ReturnType<typeof execute> | undefined) {
	const hooks: Record<string, any> = {}, tools: Record<string, any> = {}, entries: any[] = [];
	const pi = {
		events: new EventEmitter(),
		on: (name: string, handler: any) => { hooks[name] = handler; },
		registerTool: (tool: any) => { tools[tool.name] = tool; }, registerCommand() {},
		exec: async (command: string, args: string[], options: any) => execOverride?.(command, args, options) ?? execute(command, args, options),
		getThinkingLevel: () => "high", appendEntry: (customType: string, data: any) => entries.push({ type: "custom", customType, data }),
	};
	workflowGuard(pi as any, { trustedInternalPullRequestRepositories: [] });
	autoCommit(pi as any); tuiAsk(pi as any);
	const ctx = { cwd, hasUI: true, sessionManager: { getBranch: () => entries } } as any;
	const sessionFile = join(cwd, `session-${++sequence}.jsonl`);
	ctx.sessionManager.getSessionFile = () => sessionFile;
	return { hooks, tools, ctx, entries };
}
async function start(h: ReturnType<typeof harness>, prompt = "변경을 커밋해줘") {
	const result = await h.hooks.before_agent_start({ prompt, systemPrompt: "base" }, h.ctx);
	if (result?.message) h.entries.push({ type: "custom_message", ...structuredClone(result.message) });
}
async function commitCheck(h: ReturnType<typeof harness>, command = "git commit -m 'merge changes'", id = "commit-call") {
	return h.hooks.tool_call({ toolName: "bash", toolCallId: id, input: { command } }, h.ctx);
}
async function approve(h: ReturnType<typeof harness>, label?: string, command = "git commit -m approved", key = "1") {
	const input = label ? { question: "현재 index를 하나의 커밋으로 저장할까요?", options: [label, "취소"] }
		: { question: "현재 index 저장", approval: { kind: "single-commit", command } };
	const toolCallId = "commit-decision";
	assert.equal(await h.hooks.tool_call({ toolName: "tui_ask", toolCallId, input }, h.ctx), undefined);
	const result = await h.tools.tui_ask.execute(toolCallId, input, undefined, undefined, {
		...h.ctx, ui: { custom: (factory: any) => new Promise((done) => {
			const overlay = factory({}, {}, {}, done);
			overlay.render(100);
			overlay.handleInput(key);
		}) },
	});
	await h.hooks.tool_result({ toolName: "tui_ask", toolCallId, input, ...result }, h.ctx);
}

test("큰 upstream의 정상 병합은 신규 대규모 커밋으로 막지 않고 parents를 보존한다", async (t) => {
	// given
	const repo = await fixture(t); const h = harness(repo.cwd); await start(h);
	// when
	const blocked = await commitCheck(h);
	// then
	assert.equal(blocked, undefined);
	git(repo.cwd, "commit", "-m", "merge upstream");
	assert.equal(git(repo.cwd, "show", "-s", "--format=%P"), `${repo.head} ${repo.upstream}`);
});

test("작은 충돌 해결은 upstream 규모와 독립적으로 허용한다", async (t) => {
	// given
	const repo = await fixture(t, { conflict: true });
	await writeFile(join(repo.cwd, "note.txt"), "resolved\n"); git(repo.cwd, "add", "note.txt");
	const h = harness(repo.cwd); await start(h);
	// when
	const blocked = await commitCheck(h);
	// then
	assert.equal(blocked, undefined);
	assert.equal(git(repo.cwd, "rev-parse", "MERGE_HEAD"), repo.upstream);
	git(repo.cwd, "commit", "-m", "merge resolved");
	assert.equal(git(repo.cwd, "show", "-s", "--format=%P"), `${repo.head} ${repo.upstream}`);
});

test("병합 중 upstream 파일에 숨긴 큰 추가 변경은 차단한다", async (t) => {
	// given
	const repo = await fixture(t);
	await writeFile(join(repo.cwd, "area-0/file-0.txt"), "extra\n".repeat(1000)); git(repo.cwd, "add", ".");
	const h = harness(repo.cwd); await start(h);
	// when
	const blocked = await commitCheck(h);
	// then
	assert.equal(blocked?.block, true); assert.match(blocked.reason, /large|too large/);
});

test("미해결 충돌은 단일 커밋 요청으로 우회할 수 없다", async (t) => {
	// given
	const repo = await fixture(t, { conflict: true }); const h = harness(repo.cwd); await start(h, "단일 커밋으로 커밋해줘");
	// when
	const blocked = await commitCheck(h);
	// then
	assert.equal(blocked?.block, true); assert.match(blocked.reason, /unresolved|미해결/);
});

test("실제 TUI 선택은 현재 index의 대규모 커밋 승인으로 한 번만 적용된다", async (t) => {
	// given
	const repo = await fixture(t, { merge: false });
	await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
	const h = harness(repo.cwd); await start(h);
	assert.equal((await commitCheck(h))?.block, true);
	await approve(h);
	// when
	const blocked = await commitCheck(h);
	// then
	assert.equal(blocked, undefined);
	assert.equal((await commitCheck(h, undefined, "another-call"))?.block, true);
});

test("F1 일반 TUI의 단일 커밋 대신 분리 선택은 승인하지 않는다", async (t) => {
	const repo = await fixture(t, { merge: false, files: 1 });
	await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
	const h = harness(repo.cwd); await start(h);
	assert.equal((await commitCheck(h))?.block, true);
	await approve(h, "단일 커밋 대신 파일별로 분리해서 저장");
	assert.equal((await commitCheck(h))?.block, true);
});

test("F2 conflicted source 대신 git -C의 clean target만 검사한다", async (t) => {
	const source = await fixture(t, { conflict: true, files: 1 });
	const target = await fixture(t, { merge: false, files: 1 });
	await writeFile(join(target.cwd, "small.txt"), "small\n"); git(target.cwd, "add", ".");
	const h = harness(source.cwd); await start(h);
	assert.equal(await commitCheck(h, `git -C '${target.cwd}' commit -m small`), undefined);
});

for (const label of ["단일 커밋", "단일 커밋 아닌 분리 저장", "single commit 대신 split", "unknown 단일 커밋", "단일 커밋 거절"]) {
	test(`generic TUI ${label}는 승인 권한이 없다`, async (t) => {
		const repo = await fixture(t, { merge: false, files: 1 });
		await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
		const h = harness(repo.cwd); await start(h); await approve(h, label);
		assert.equal((await commitCheck(h))?.block, true);
	});
}
for (const key of ["2", "3", "q"]) {
	test(`canonical TUI ${key} split/deny/cancel은 승인 0`, async (t) => {
		const repo = await fixture(t, { merge: false, files: 1 });
		await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
		const h = harness(repo.cwd); await start(h); await approve(h);
		await approve(h, undefined, "git commit -m approved", key);
		assert.equal((await commitCheck(h))?.block, true);
	});
}
for (const sourceState of ["conflicted", "dirty", "non-git"]) {
	for (const targetState of ["small", "large", "merge"]) {
		test(`git-C ${sourceState} source / ${targetState} target 판정과 승인 재시도`, async (t) => {
			const source = await fixture(t, { conflict: sourceState === "conflicted", files: 1, merge: sourceState === "conflicted" });
			let cwd = source.cwd;
			if (sourceState === "non-git") { cwd = await mkdtemp(join(tmpdir(), "non-git-")); t.after(() => rm(cwd, { recursive: true, force: true })); }
			if (sourceState === "dirty") await writeFile(join(cwd, "note.txt"), "dirty\n".repeat(1000));
			const target = await fixture(t, { merge: targetState === "merge", files: targetState === "merge" ? 16 : 1 });
			if (targetState !== "merge") { await writeFile(join(target.cwd, "new.txt"), "change\n".repeat(targetState === "large" ? 1000 : 1)); git(target.cwd, "add", "."); }
			const h = harness(cwd); await start(h);
			const command = `git -C '${target.cwd}' commit -m target`;
			assert.equal((await commitCheck(h, command))?.block ?? false, targetState === "large");
			if (targetState === "large") {
				await approve(h, undefined, command);
				assert.equal(await commitCheck(h, command), undefined);
				await writeFile(join(target.cwd, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
				const failed = execute("git", ["commit", "-m", "target"], { cwd: target.cwd }); assert.notEqual(failed.code, 0);
				await h.hooks.tool_result({ toolName: "bash", toolCallId: "commit-call", input: { command }, isError: true, content: [] }, h.ctx);
				assert.equal(await commitCheck(h, command, "retry-target"), undefined);
				assert.equal((await commitCheck(h, command, "reused-target"))?.block, true);
			}
		});
	}
}

test("canonical 질문 호출 뒤 위조한 승인 metadata도 host 제출 없이는 권한이 없다", async (t) => {
	const repo = await fixture(t, { merge: false, files: 1 });
	await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
	const h = harness(repo.cwd); await start(h);
	const input = { question: "save?", approval: { kind: "single-commit" as const, command: "git commit -m approved" } };
	await h.hooks.tool_call({ toolName: "tui_ask", toolCallId: "forged", input }, h.ctx);
	const canonical = singleCommitApprovalPrompt(input)!;
	await h.hooks.tool_result({ toolName: "tui_ask", toolCallId: "forged", input, content: [], details: {
		...canonical, status: "submitted", selectedIndices: [1], selectedOptions: [canonical.options[0]], text: null,
		multiSelect: false, allowText: false, action: "approve-single-commit",
	} }, h.ctx);
	assert.equal((await commitCheck(h))?.block, true);
});

for (const change of ["index", "metadata", "tree", "request"]) {
	test(`canonical 제출 도중 ${change} 변경은 승인하지 않는다`, async (t) => {
		const repo = await fixture(t, { merge: false, files: 1 });
		await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
		const h = harness(repo.cwd); await start(h);
		const input = { question: "save?", approval: { kind: "single-commit", command: "git commit -m approved" } };
		await h.hooks.tool_call({ toolName: "tui_ask", toolCallId: "pending", input }, h.ctx);
		const result = await h.tools.tui_ask.execute("pending", input, undefined, undefined, { ...h.ctx, ui: { custom: (factory: any) => new Promise((done) => factory({}, {}, {}, done).handleInput("1")) } });
		if (change === "index") { await writeFile(join(repo.cwd, "new.txt"), "changed\n".repeat(1000)); git(repo.cwd, "add", "."); }
		if (change === "metadata") result.details.action = "approve-single-commit";
		if (change === "tree") await h.hooks.session_tree({}, h.ctx);
		if (change === "request") await start(h, "다른 변경을 커밋해줘");
		await h.hooks.tool_result({ toolName: "tui_ask", toolCallId: "pending", input, ...result }, h.ctx);
		assert.equal((await commitCheck(h))?.block, true);
	});
}

test("approval action mapping/unknown 종류/자유 라벨은 canonical 승인을 바꾸지 못한다", async (t) => {
	const repo = await fixture(t, { merge: false, files: 1 });
	await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
	const h = harness(repo.cwd); await start(h);
	for (const extra of [ { approval: { kind: "single-commit", command: "git commit -m approved", action: "approve-single-commit" } },
		{ approval: { kind: "unknown", command: "git commit -m approved" } },
		{ approval: { kind: "single-commit", command: "git commit -m approved" }, options: ["분리 저장"], actions: ["approve-single-commit"] } ]) {
		const input = { question: "save?", ...extra };
		assert.equal((await h.hooks.tool_call({ toolName: "tui_ask", toolCallId: "bad-mapping", input }, h.ctx))?.block, true);
		await assert.rejects(() => h.tools.tui_ask.execute("bad-mapping", input, undefined, undefined, h.ctx), /host-owned/);
	}
	assert.equal((await commitCheck(h))?.block, true);
});

test("git-C 상대/복수-C와 harmless env, 원 사용자 명시 단일커밋 대상 snapshot을 보존한다", async (t) => {
	const source = await fixture(t, { conflict: true, files: 1 });
	const target = await fixture(t, { merge: false, files: 1 });
	await writeFile(join(target.cwd, "new.txt"), "large\n".repeat(1000)); git(target.cwd, "add", ".");
	const command = `GIT_OPTIONAL_LOCKS=0 git -C '${relative(source.cwd, dirname(target.cwd))}' -C '${basename(target.cwd)}' commit -m target`;
	const h = harness(source.cwd); await start(h, `단일 커밋으로 커밋해줘\n${command}`);
	assert.equal(await commitCheck(h, command), undefined);
	const other = harness(source.cwd); await start(other); await approve(other, undefined, command);
	for (const env of ["GIT_DIR=.git", "GIT_WORK_TREE=.", "GIT_INDEX_FILE=.git/index", "GIT_CONFIG_COUNT=1"]) {
		assert.equal((await commitCheck(other, `${env} ${command}`))?.block, true);
	}
	assert.equal(await commitCheck(other, command), undefined);
});

test("generic auto_commit은 pending merge를 reset 전에 거절한다", async (t) => {
	// given
	const repo = await fixture(t, { files: 1 }); const h = harness(repo.cwd);
	const tree = git(repo.cwd, "write-tree");
	// when
	const run = () => h.tools.auto_commit.execute("auto", { action: "quick", message: "merge: upstream", paths: ["area-0/file-0.txt"], pushPolicy: "commit-only" }, undefined, undefined, h.ctx);
	// then
	await assert.rejects(run, /pending merge|병합 진행/);
	assert.equal(git(repo.cwd, "rev-parse", "HEAD"), repo.head);
	assert.equal(git(repo.cwd, "rev-parse", "MERGE_HEAD"), repo.upstream);
	assert.equal(git(repo.cwd, "write-tree"), tree);
});

for (const change of ["index", "branch", "request", "expiry", "repo", "alternate-index"] as const) {
	test(`승인 후 ${change}가 달라지면 대규모 커밋을 다시 차단한다`, async (t) => {
		// given
		const repo = await fixture(t, { merge: false, files: 1 });
		await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
		const h = harness(repo.cwd); await start(h); await approve(h);
		let command = "git commit -m approved";
		if (change === "index") { await writeFile(join(repo.cwd, "new.txt"), "changed\n".repeat(1000)); git(repo.cwd, "add", "."); }
		if (change === "alternate-index") {
			const indexPath = join(repo.cwd, ".git", "alternate-index");
			await copyFile(join(repo.cwd, ".git", "index"), indexPath);
			await writeFile(join(repo.cwd, "new.txt"), "different\n".repeat(1000));
			assert.equal(execute("env", [`GIT_INDEX_FILE=${indexPath}`, "git", "add", "new.txt"], { cwd: repo.cwd }).code, 0);
			command = `GIT_INDEX_FILE='${indexPath}' git commit -m approved`;
		}
		if (change === "branch") git(repo.cwd, "checkout", "-b", "another-target");
		if (change === "request") await start(h, "다른 변경을 커밋해줘");
		if (change === "expiry") { const now = Date.now(); t.mock.method(Date, "now", () => now + 20 * 60_000); }
		if (change === "repo") {
			const other = await fixture(t, { merge: false, files: 1 });
			await writeFile(join(other.cwd, "new.txt"), "large\n".repeat(1000)); git(other.cwd, "add", ".");
			command = `git -C '${other.cwd}' commit -m approved`;
		}
		// when
		const blocked = await commitCheck(h, command);
		// then
		assert.equal(blocked?.block, true);
	});
}

for (const mode of ["agent-options", "unmatched-result", "legacy-adopt", "magic-environment"] as const) {
	test(`${mode}만으로 대규모 커밋 승인을 발급하지 않는다`, async (t) => {
		// given
		const repo = await fixture(t, { merge: false, files: 1 });
		await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
		const h = harness(repo.cwd); await start(h);
		if (mode === "agent-options") await h.hooks.tool_call({ toolName: "tui_ask", toolCallId: "not-submitted", input: { question: "save?", options: ["단일 커밋"] } }, h.ctx);
		if (mode === "unmatched-result") await h.hooks.tool_result({ toolName: "tui_ask", toolCallId: "invented", details: { status: "submitted", selectedOptions: ["단일 커밋"] } }, h.ctx);
		if (mode === "legacy-adopt") await h.tools.workflow_guard.execute("adopt", { action: "adopt", prompt: "단일 커밋으로 커밋해줘", reason: "agent prose" }, undefined, undefined, h.ctx);
		// when
		const blocked = await commitCheck(h, mode === "magic-environment" ? "WORKFLOW_GUARD_ALLOW_LARGE_COMMIT=1 git commit -m synthetic" : undefined);
		// then
		assert.equal(blocked?.block, true);
	});
}

for (const mergeState of ["empty", "octopus", "invalid-parent", "already-integrated", "wrong-original-head", "unsupported-git"] as const) {
	test(`${mergeState} 병합 상태는 승인이 있어도 안전 차단한다`, async (t) => {
		// given
		const repo = await fixture(t, { files: 1 });
		if (mergeState === "empty") await writeFile(join(repo.cwd, ".git/MERGE_HEAD"), "");
		if (mergeState === "octopus") await writeFile(join(repo.cwd, ".git/MERGE_HEAD"), `${repo.upstream}\n${repo.head}\n`);
		if (mergeState === "invalid-parent") await writeFile(join(repo.cwd, ".git/MERGE_HEAD"), "0".repeat(40) + "\n");
		if (mergeState === "already-integrated") await writeFile(join(repo.cwd, ".git/MERGE_HEAD"), repo.head + "\n");
		if (mergeState === "wrong-original-head") git(repo.cwd, "update-ref", "ORIG_HEAD", repo.upstream);
		const h = harness(repo.cwd, (_command, args) => mergeState === "unsupported-git" && args[0] === "merge-tree" ? { code: 129, stdout: "", stderr: "unsupported option" } : undefined);
		await start(h, "단일 커밋으로 커밋해줘");
		// when
		const blocked = await commitCheck(h);
		// then
		assert.equal(blocked?.block, true);
		assert.equal(git(repo.cwd, "rev-parse", "HEAD"), repo.head);
	});
}

test("커밋만 허용한 요청에서 TUI 단일 커밋 선택이 push 권한을 만들지 않는다", async (t) => {
	// given
	const repo = await fixture(t, { merge: false, files: 1 });
	await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
	const h = harness(repo.cwd); await start(h, "커밋해줘. 푸시하지 마"); await approve(h);
	// when
	const commit = await commitCheck(h);
	const push = await h.hooks.tool_call({ toolName: "bash", input: { command: "git push origin HEAD:other" } }, h.ctx);
	// then
	assert.equal(commit, undefined); assert.equal(push?.block, true); assert.match(push.reason, /push/);
});

test("한 bash 호출의 stage와 commit은 미실행 경계를 명확히 알린다", async (t) => {
	// given
	const repo = await fixture(t, { conflict: true }); const h = harness(repo.cwd); await start(h);
	const index = git(repo.cwd, "ls-files", "--stage");
	// when
	const blocked = await commitCheck(h, "git add note.txt && git commit -m merge");
	// then
	assert.equal(blocked?.block, true); assert.match(blocked.reason, /No command.*executed/);
	assert.equal(git(repo.cwd, "ls-files", "--stage"), index);
});

for (const failure of ["stage", "diff", "hook"] as const) {
	test(`${failure} 실패 뒤 auto_commit은 commit 또는 push 성공을 보고하지 않는다`, async (t) => {
		// given
		const repo = await fixture(t, { merge: false, files: 1 });
		await writeFile(join(repo.cwd, "small.txt"), "small\n");
		if (failure === "hook") await writeFile(join(repo.cwd, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
		let pushAttempted = false;
		const h = harness(repo.cwd, (command, args) => {
			if (command === "git" && args[0] === "push") pushAttempted = true;
			if (failure === "diff" && command === "git" && args.join(" ") === "diff --cached --quiet") return { code: 2, stdout: "", stderr: "synthetic index read failure" };
			return undefined;
		});
		const before = git(repo.cwd, "rev-parse", "HEAD");
		// when
		const run = () => h.tools.auto_commit.execute("auto", { action: "quick", message: "fix: small", paths: [failure === "stage" ? "missing.txt" : "small.txt"], allowLeftovers: true, pushPolicy: "push" }, undefined, undefined, h.ctx);
		// then
		await assert.rejects(run, failure === "stage" ? /git add.*failed/ : failure === "diff" ? /git diff.*failed/ : /git commit.*failed/);
		assert.equal(git(repo.cwd, "rev-parse", "HEAD"), before); assert.equal(pushAttempted, false);
	});
}

test("hook 실패 뒤 Git snapshot이 같으면 승인된 커밋을 재승인 없이 재시도한다", async (t) => {
	// given
	const repo = await fixture(t, { merge: false, files: 1 });
	await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
	const h = harness(repo.cwd); await start(h); await approve(h);
	assert.equal(await commitCheck(h), undefined);
	await writeFile(join(repo.cwd, ".git/hooks/pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
	const failed = execute("git", ["commit", "-m", "approved"], { cwd: repo.cwd });
	assert.notEqual(failed.code, 0);
	// when
	await h.hooks.tool_result({ toolName: "bash", toolCallId: "commit-call", input: { command: "git commit -m approved" }, details: { exitCode: failed.code }, isError: true, content: [] }, h.ctx);
	const blocked = await commitCheck(h, undefined, "retry");
	// then
	assert.equal(blocked, undefined);
});

test("다음 TUI 취소 선택은 이전 미사용 커밋 승인을 회수한다", async (t) => {
	// given
	const repo = await fixture(t, { merge: false, files: 1 });
	await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
	const h = harness(repo.cwd); await start(h); await approve(h);
	const input = { question: "다시 선택", approval: { kind: "single-commit", command: "git commit -m approved" } };
	await h.hooks.tool_call({ toolName: "tui_ask", toolCallId: "cancel", input }, h.ctx);
	// when
	await h.hooks.tool_result({ toolName: "tui_ask", toolCallId: "cancel", input, content: [], details: { status: "cancelled" } }, h.ctx);
	// then
	assert.equal((await commitCheck(h))?.block, true);
});

test("동일 요청 continuation은 미사용 승인 snapshot을 보존한다", async (t) => {
	// given
	const repo = await fixture(t, { merge: false, files: 1 });
	await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
	const h = harness(repo.cwd); await start(h); await approve(h);
	// when
	await h.hooks.before_agent_start({ messageType: "custom", systemPrompt: "base", message: { customType: "until-prompt", content: "continue", details: { agentStart: { kind: "continuation", request: "변경을 커밋해줘" } } } }, h.ctx);
	// then
	assert.equal(await commitCheck(h), undefined);
});

for (const action of ["apply", "split-head"] as const) {
	test(`auto_commit ${action}도 pending merge의 index와 parents를 보존한다`, async (t) => {
		// given
		const repo = await fixture(t, { files: 1 }); const h = harness(repo.cwd);
		const index = git(repo.cwd, "ls-files", "--stage");
		const planPath = join(repo.cwd, ".git", "plan.json");
		await writeFile(planPath, JSON.stringify({ commits: [{ message: "merge: upstream", paths: ["area-0/file-0.txt"], recordOmissionReason: "synthetic merge" }], pushPolicy: "commit-only" }));
		// when
		const run = () => h.tools.auto_commit.execute("auto", { action, planPath }, undefined, undefined, h.ctx);
		// then
		await assert.rejects(run, /pending merge/);
		assert.equal(git(repo.cwd, "rev-parse", "HEAD"), repo.head);
		assert.equal(git(repo.cwd, "rev-parse", "MERGE_HEAD"), repo.upstream);
		assert.equal(git(repo.cwd, "ls-files", "--stage"), index);
	});
}

test("실패 결과는 commit save point나 push 완료로 표시하지 않는다", async (t) => {
	// given
	const repo = await fixture(t, { files: 1, merge: false }); const h = harness(repo.cwd); await start(h, "커밋 푸시해줘");
	// when
	const failed = await h.hooks.tool_result({ toolName: "auto_commit", toolCallId: "failed", content: [], isError: true,
		details: { completion: "committed_and_pushed", pushed: true, commits: [{ hash: "synthetic" }] } }, h.ctx);
	const next = await h.hooks.tool_call({ toolName: "read", input: { path: "note.txt" } }, h.ctx);
	// then
	assert.equal(failed?.details?.workflowGuard?.terminalActionRequired ?? false, false);
	assert.equal(failed?.details?.workflowGuard?.commitCompleteStopLine ?? false, false);
	assert.equal(next, undefined);
});

test("SDK의 실제 loader와 nested tool pipeline이 병합과 TUI 승인을 끝까지 실행한다", async (t) => {
	// given — isolated SDK runtime; no model request, user settings, network or window.
	const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import("@mariozechner/pi-coding-agent");
	const repo = await fixture(t);
	const agentDir = join(repo.cwd, ".git", "sdk-agent");
	await mkdir(agentDir, { recursive: true });
	const settingsManager = SettingsManager.inMemory({ packages: [] });
	const loader = new DefaultResourceLoader({ cwd: repo.cwd, agentDir, settingsManager,
		noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
		additionalExtensionPaths: ["./index.ts", "../auto-commit/index.ts", "../tui-ask/index.ts"].map((path) => fileURLToPath(new URL(path, import.meta.url))),
	});
	await loader.reload();
	assert.deepEqual(loader.getExtensions().errors, []);
	const manager = SessionManager.inMemory(repo.cwd);
	// Restore a synthetic assistant-issued parent from the canonical session, as nested calls require.
	manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "synthetic", model: "synthetic", stopReason: "toolUse", timestamp: 0,
		content: [{ type: "toolCall", id: "test-driver", name: "workflow_guard", arguments: { action: "status" } }],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	});
	const { session } = await createAgentSession({ cwd: repo.cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: manager,
		model: { id: "synthetic", name: "Synthetic", provider: "synthetic", api: "openai-completions", baseUrl: "https://example.invalid", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 256 },
		tools: ["bash", "workflow_guard", "auto_commit", "tui_ask"],
	});
	try {
		const errors: any[] = [];
		await session.bindExtensions({ onError: (error) => errors.push(error) });
		const runner = session.extensionRunner;
		let answerKey = "1";
		runner.setUIContext({ ...runner.getUIContext(), custom: (factory: any) => new Promise((done) => {
			const overlay = factory({}, {}, {}, done); overlay.render(100); overlay.handleInput(answerKey);
		}) } as any, "tui");
		const begin = async () => {
			const result = await runner.emitBeforeAgentStart({ messageType: "user", prompt: "커밋해줘" }, { cwd: repo.cwd, customPrompt: "synthetic" });
			for (const message of result.messages) manager.appendCustomMessageEntry(message.customType, message.content, message.display ?? false, message.details);
		};
		const caller = runner.createToolContext("test-driver", new AbortController().signal);
		await begin();
		// when — the real registered auto_commit refuses reset; real bash preserves merge parents.
		const auto = await caller.executeTool("auto_commit", { action: "quick", message: "merge: upstream", paths: ["area-0/file-0.txt"], pushPolicy: "commit-only" });
		assert.equal(auto.isError, true); assert.match(JSON.stringify(auto.result.content), /pending merge/);
		const merged = await caller.executeTool("bash", { command: "git commit -m 'merge upstream'" });
		assert.equal(merged.isError, false, JSON.stringify(merged.result.content));
		assert.equal(git(repo.cwd, "show", "-s", "--format=%P"), `${repo.head} ${repo.upstream}`);
		await writeFile(join(repo.cwd, "new.txt"), "large\n".repeat(1000)); git(repo.cwd, "add", ".");
		await begin();
		const blocked = await caller.executeTool("bash", { command: "git commit -m 'large change'" });
		assert.equal(blocked.isError, true); assert.match(JSON.stringify(blocked.result.content), /too large/);
		const split = await caller.executeTool("tui_ask", { question: "현재 index 저장", options: ["단일 커밋 대신 파일별로 분리해서 저장", "취소"] });
		assert.equal(split.isError, false);
		assert.equal((await caller.executeTool("bash", { command: "git commit -m 'large change'" })).isError, true);
		for (const key of ["2", "3", "q"]) {
			answerKey = key;
			await caller.executeTool("tui_ask", { question: "현재 index 저장", approval: { kind: "single-commit", command: "git commit -m 'approved change'" } });
			assert.equal((await caller.executeTool("bash", { command: "git commit -m 'large change'" })).isError, true);
		}
		answerKey = "1";
		const selection = await caller.executeTool("tui_ask", { question: "현재 index 저장", approval: { kind: "single-commit", command: "git commit -m 'approved change'" } });
		assert.equal(selection.isError, false);
		const committed = await caller.executeTool("bash", { command: "git commit -m 'approved change'" });
		// then
		assert.equal(committed.isError, false, JSON.stringify(committed.result.content));
		assert.equal(git(repo.cwd, "show", "-s", "--format=%s"), "approved change");
		// A conflicted source must not affect another repository selected by git -C.
		git(repo.cwd, "checkout", "-b", "sdk-conflict");
		await writeFile(join(repo.cwd, "note.txt"), "incoming\n"); git(repo.cwd, "add", "."); git(repo.cwd, "commit", "-m", "incoming");
		git(repo.cwd, "checkout", "main");
		await writeFile(join(repo.cwd, "note.txt"), "local-conflict\n"); git(repo.cwd, "add", "."); git(repo.cwd, "commit", "-m", "local conflict");
		assert.equal(execute("git", ["merge", "sdk-conflict"], { cwd: repo.cwd }).code, 1);
		const target = await fixture(t, { merge: false, files: 1 });
		await writeFile(join(target.cwd, "small.txt"), "small\n"); git(target.cwd, "add", ".");
		const targetCommand = `git -C '${target.cwd}' commit -m target`;
		await begin();
		assert.equal((await caller.executeTool("bash", { command: "git commit -m source" })).isError, true);
		const smallTarget = await caller.executeTool("bash", { command: targetCommand });
		assert.equal(smallTarget.isError, false, JSON.stringify(smallTarget.result.content));
		await writeFile(join(target.cwd, "large.txt"), "large\n".repeat(1000)); git(target.cwd, "add", ".");
		assert.equal((await caller.executeTool("bash", { command: targetCommand })).isError, true);
		await caller.executeTool("tui_ask", { question: "target 승인", approval: { kind: "single-commit", command: targetCommand } });
		const largeTarget = await caller.executeTool("bash", { command: targetCommand });
		assert.equal(largeTarget.isError, false, JSON.stringify(largeTarget.result.content));
		assert.deepEqual(errors, []);
	} finally { session.dispose(); }
});

test("SDK non-Git cwd에서도 git-C 대상의 small/large/merge만 판정한다", async (t) => {
	const { createAgentSession, DefaultResourceLoader, SessionManager, SettingsManager } = await import("@mariozechner/pi-coding-agent");
	const cwd = await mkdtemp(join(tmpdir(), "sdk-non-git-")); t.after(() => rm(cwd, { recursive: true, force: true }));
	const agentDir = join(cwd, "agent"); await mkdir(agentDir);
	const settingsManager = SettingsManager.inMemory({ packages: [] });
	const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager,
		noExtensions: true, noSkills: true, noThemes: true, noPromptTemplates: true, noContextFiles: true,
		additionalExtensionPaths: ["./index.ts", "../tui-ask/index.ts"].map((path) => fileURLToPath(new URL(path, import.meta.url))),
	});
	await loader.reload(); assert.deepEqual(loader.getExtensions().errors, []);
	const manager = SessionManager.inMemory(cwd);
	manager.appendMessage({ role: "assistant", api: "openai-completions", provider: "synthetic", model: "synthetic", stopReason: "toolUse", timestamp: 0,
		content: [{ type: "toolCall", id: "test-driver", name: "workflow_guard", arguments: { action: "status" } }],
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	});
	const { session } = await createAgentSession({ cwd, agentDir, settingsManager, resourceLoader: loader, sessionManager: manager,
		model: { id: "synthetic", name: "Synthetic", provider: "synthetic", api: "openai-completions", baseUrl: "https://example.invalid", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8192, maxTokens: 256 },
		tools: ["bash", "workflow_guard", "tui_ask"],
	});
	try {
		const errors: any[] = []; await session.bindExtensions({ onError: (error) => errors.push(error) });
		const runner = session.extensionRunner;
		runner.setUIContext({ ...runner.getUIContext(), custom: (factory: any) => new Promise((done) => {
			const overlay = factory({}, {}, {}, done); overlay.render(100); overlay.handleInput("1");
		}) } as any, "tui");
		const started = await runner.emitBeforeAgentStart({ messageType: "user", prompt: "커밋해줘" }, { cwd, customPrompt: "synthetic" });
		for (const message of started.messages) manager.appendCustomMessageEntry(message.customType, message.content, message.display ?? false, message.details);
		const caller = runner.createToolContext("test-driver", new AbortController().signal);
		const target = await fixture(t, { merge: false, files: 1 });
		const command = `git -C '${relative(cwd, dirname(target.cwd))}' -C '${basename(target.cwd)}' commit -m target`;
		await writeFile(join(target.cwd, "small.txt"), "small\n"); git(target.cwd, "add", ".");
		const small = await caller.executeTool("bash", { command }); assert.equal(small.isError, false, JSON.stringify(small.result.content));
		await writeFile(join(target.cwd, "large.txt"), "large\n".repeat(1000)); git(target.cwd, "add", ".");
		assert.equal((await caller.executeTool("bash", { command })).isError, true);
		await caller.executeTool("tui_ask", { question: "target 승인", approval: { kind: "single-commit", command } });
		const large = await caller.executeTool("bash", { command }); assert.equal(large.isError, false, JSON.stringify(large.result.content));
		const merge = await fixture(t);
		const merged = await caller.executeTool("bash", { command: `git -C '${merge.cwd}' commit -m merge` });
		assert.equal(merged.isError, false, JSON.stringify(merged.result.content));
		assert.equal(git(merge.cwd, "show", "-s", "--format=%P"), `${merge.head} ${merge.upstream}`);
		assert.deepEqual(errors, []);
	} finally { session.dispose(); }
});
