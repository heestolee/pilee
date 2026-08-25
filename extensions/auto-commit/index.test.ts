import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import autoCommit, {
	assertCommitRecordGate,
	assertLogicalAtomGate,
	buildCommitMessage,
	buildLogicalAtomGateReport,
	evaluateCommitRecordGate,
	evaluateLogicalAtomGate,
	extractGitIndexLockPath,
	extractLsofPids,
	formatResult,
	isRepoStatusGitStatusCommand,
	shouldRemoveStaleIndexLockAfterLsof,
} from "./index.ts";
import { isRepoStatusPaused } from "../utils/repo-status-coordination.ts";

test("extractGitIndexLockPath reads git index.lock errors", () => {
	const stderr = "fatal: Unable to create '/repo/.git/worktrees/foo/index.lock': File exists.";
	assert.equal(extractGitIndexLockPath(stderr), "/repo/.git/worktrees/foo/index.lock");
});

test("extractGitIndexLockPath returns undefined for unrelated git errors", () => {
	assert.equal(extractGitIndexLockPath("fatal: not a git repository"), undefined);
});

test("shouldRemoveStaleIndexLockAfterLsof removes only when owner check is clean", () => {
	assert.equal(shouldRemoveStaleIndexLockAfterLsof({ code: 1, stdout: "", stderr: "" }), true);
	assert.equal(shouldRemoveStaleIndexLockAfterLsof({ code: 0, stdout: "COMMAND  PID USER\nGit 123 me", stderr: "" }), false);
	assert.equal(shouldRemoveStaleIndexLockAfterLsof({ code: 127, stdout: "", stderr: "lsof: command not found" }), false);
});

test("index.lock recovery recognizes repo status polling owners", () => {
	const lsofOutput = "COMMAND   PID USER\ngit     1234 me\nGit     5678 me\n";
	assert.deepEqual(extractLsofPids(lsofOutput), ["1234", "5678"]);
	assert.equal(isRepoStatusGitStatusCommand("/Applications/Xcode.app/Contents/Developer/usr/bin/git status --porcelain=v2 --branch --untracked-files=normal"), true);
	assert.equal(isRepoStatusGitStatusCommand("/Applications/Xcode.app/Contents/Developer/usr/bin/git --no-optional-locks status --porcelain=v2 --branch --untracked-files=normal"), true);
	assert.equal(isRepoStatusGitStatusCommand("git commit -m test"), false);
});

test("logical atom gate warns for small same-cluster three-primary changes", () => {
	const result = evaluateLogicalAtomGate({
		commits: [{
			message: "feat: 작은 fan-out",
			paths: ["extensions/auto-commit/a.ts", "extensions/auto-commit/b.ts", "extensions/auto-commit/c.ts"],
		}],
	}, [[
		{ path: "extensions/auto-commit/a.ts", additions: 3, deletions: 0, changedLines: 3 },
		{ path: "extensions/auto-commit/b.ts", additions: 4, deletions: 0, changedLines: 4 },
		{ path: "extensions/auto-commit/c.ts", additions: 5, deletions: 0, changedLines: 5 },
	]]);

	assert.equal(result.decision, "warn");
	assert.equal(result.blocks.length, 0);
	assert.match(result.warnings.join("\n"), /3 primary paths/);
});

test("logical atom gate blocks large single-file diff", () => {
	const report = buildLogicalAtomGateReport({
		commits: [{
			message: "feat: 큰 단일 파일 변경",
			paths: ["extensions/auto-commit/index.ts"],
		}],
	}, [[{ path: "extensions/auto-commit/index.ts", additions: 1000, deletions: 0, changedLines: 1000 }]]);

	assert.match(report ?? "", /logical atom gate blocked/);
	assert.match(report ?? "", /single primary diff 1000 lines/);
	assert.throws(() => assertLogicalAtomGate({ commits: [{ message: "feat: too large", paths: ["a.ts"] }] }, [[{ path: "a.ts", additions: 1000, deletions: 0, changedLines: 1000 }]]), /logical atom gate blocked/);
});

test("logical atom gate allows primary path with companion files", () => {
	assert.doesNotThrow(() => assertLogicalAtomGate({
		commits: [{
			message: "feat: 온라인 쿠폰 태그 컴포넌트 추가",
			paths: [
				"frontend/apps/web/domain/travel/subdomain/spot/SpotThumbnailCard/parts/SpotThumbnailTags.tsx",
				"frontend/apps/web/domain/travel/subdomain/spot/SpotThumbnailCard/parts/SpotThumbnailTags.test.tsx",
				"frontend/apps/web/domain/travel/subdomain/spot/SpotThumbnailCard/parts/__generated__/SpotThumbnailTags.generated.ts",
				"frontend/apps/admin/src/graphql/generated.tsx",
				"frontend/schema.graphql",
				"package.json",
			],
		}],
	}));
});

test("buildCommitMessage renders only selected causal paragraphs without forced headings", () => {
	const message = buildCommitMessage({
		message: "fix: webhook 재시도 차단",
		paths: ["src/webhook.ts"],
		record: {
			changeTrigger: "결제 운영 이슈 #123에서 반복 알림 원인을 추적했다.",
			situationImpact: "동일 webhook이 재시도되어 수동 대응 알림이 중복 발송됐다.",
			cause: "snapshot mismatch를 이미 처리했지만 컨트롤러가 500을 반환해 PG가 다시 전송했다.",
			solution: "해당 mismatch만 200으로 종료하고 관찰 가능성은 Sentry 기록으로 유지한다.",
			rationale: "다른 webhook 오류의 재시도 계약은 바꾸지 않도록 오류 코드 단위로 분기했다.",
			invariants: ["정상 webhook과 미처리 오류는 기존 응답 정책을 유지한다."],
			references: ["https://github.com/example/repo/issues/123"],
		},
	});

	assert.equal(message, [
		"fix: webhook 재시도 차단",
		"결제 운영 이슈 #123에서 반복 알림 원인을 추적했다.",
		"동일 webhook이 재시도되어 수동 대응 알림이 중복 발송됐다.",
		"snapshot mismatch를 이미 처리했지만 컨트롤러가 500을 반환해 PG가 다시 전송했다.",
		"해당 mismatch만 200으로 종료하고 관찰 가능성은 Sentry 기록으로 유지한다.",
		"다른 webhook 오류의 재시도 계약은 바꾸지 않도록 오류 코드 단위로 분기했다.",
		"정상 webhook과 미처리 오류는 기존 응답 정책을 유지한다.",
		"Refs: https://github.com/example/repo/issues/123",
	].join("\n\n"));
	assert.doesNotMatch(message, /배경:|판단:|검증:/u);
});

test("durable record gate requires causal judgment without forcing every lens", () => {
	const missing = evaluateCommitRecordGate({ commits: [{ message: "fix: 상태 전이 수정", paths: ["src/state.ts"] }] }, "apply");
	assert.equal(missing.blocks.length, 1);
	assert.match(missing.blocks[0] ?? "", /has no durable commit record/);
	assert.throws(() => assertCommitRecordGate({ commits: [{ message: "fix: 상태 전이 수정", paths: ["src/state.ts"] }] }, "apply"), /durable record gate blocked/);

	const shallow = evaluateCommitRecordGate({
		commits: [{
			message: "fix: 상태 전이 수정",
			paths: ["src/state.ts"],
			record: {
				solution: "상태값을 갱신한다.",
				evidence: ["targeted tests passed", "lint passed"],
				references: ["https://github.com/example/repo/pull/42"],
			},
		}],
	}, "apply");
	assert.equal(shallow.blocks.length, 1);
	assert.match(shallow.blocks[0] ?? "", /solution, evidence, references는 보조 정보/u);
	assert.doesNotThrow(() => assertCommitRecordGate({
		commits: [{ message: "refactor: 상태 전이 분리", paths: ["src/state.ts"], record: { rationale: "서로 다른 전이의 실패 경계를 독립적으로 유지하기 위해 분리했다." } }],
	}, "apply"));

	const omitted = assertCommitRecordGate({
		commits: [{ message: "chore: generated schema 동기화", paths: ["schema.generated.ts"], recordOmissionReason: "deterministic generated artifact sync" }],
	}, "apply");
	assert.match(omitted.join("\n"), /durable record 생략/);
	assert.doesNotThrow(() => assertCommitRecordGate({
		commits: [{ message: "fix: 기존 본문 유지\n\n문제가 생긴 이유와 선택한 해결 경계를 자연어로 설명한 본문입니다.", paths: ["src/state.ts"] }],
	}, "apply"));
	assert.doesNotThrow(() => assertCommitRecordGate({ commits: [{ message: "fix: 문구 수정", paths: ["copy.ts"] }] }, "quick"));
});

test("tool guidance keeps record lenses selective and routine verification out of commit bodies", () => {
	let tool: any;
	autoCommit({
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
		registerCommand: () => undefined,
		registerTool: (registered: any) => { tool = registered; },
	} as any);
	const guidance = tool.promptGuidelines.join("\n");
	assert.match(guidance, /optional lenses/u);
	assert.match(guidance, /do not fill every field/u);
	assert.match(guidance, /evidence is optional/u);
	assert.match(guidance, /Do not list routine test\/lint\/typecheck\/build success/u);
});

test("formatResult makes unpushed commits explicit", () => {
	const output = formatResult({
		mode: "quick",
		commits: [{ hash: "abc123", message: "fix: 문구 수정", paths: ["a.tsx"] }],
		leftovers: [],
		pushed: false,
		completion: "committed_not_pushed",
		push: { status: "skipped_no_safe_target", requested: true, policy: "push-if-tracking", error: "safe push target was not detected" },
	} as any);

	assert.match(output, /status: committed_not_pushed/);
	assert.match(output, /push: skipped_no_safe_target/);
	assert.match(output, /지금 바로 push/);
});

test("formatResult reports committed_and_pushed when push succeeds", () => {
	const output = formatResult({
		mode: "apply",
		commits: [{ hash: "def456", message: "fix: 테스트", paths: ["b.ts"] }],
		leftovers: [],
		pushed: true,
		completion: "committed_and_pushed",
		push: { status: "done", requested: true, policy: "push-if-tracking", remote: "origin", branch: "feature/test" },
	} as any);

	assert.match(output, /status: committed_and_pushed/);
	assert.match(output, /push: done origin\/feature\/test/);
	assert.doesNotMatch(output, /next:/);
});

function exec(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { cwd });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => { stdout += chunk; });
		child.stderr.on("data", (chunk) => { stderr += chunk; });
		child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
	});
}

async function git(cwd: string, ...args: string[]) {
	const result = await exec("git", args, cwd);
	if (result.code !== 0) throw new Error(`git ${args.join(" ")} failed\n${result.stderr}\n${result.stdout}`);
	return result.stdout;
}

test("action=status reports commit readiness and ship caveats", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-status-"));
	const repo = join(root, "repo");
	await git(root, "init", "-b", "main", repo);
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test User");
	await writeFile(join(repo, "README.md"), "init\n");
	await git(repo, "add", "README.md");
	await git(repo, "commit", "-m", "chore: init");
	await git(repo, "checkout", "-b", "feature/test");
	await exec("mkdir", ["-p", "backend/apps/trip/migrations", "frontend/apps/admin/src", "frontend/apps/web/domain"], repo);
	await writeFile(join(repo, "backend/apps/trip/migrations/20260527042440-add.js"), "module.exports = {};\n");
	await writeFile(join(repo, "frontend/apps/admin/src/view.tsx"), "export const x = 1;\n");
	await writeFile(join(repo, "frontend/apps/web/domain/view.tsx"), "export const y = 1;\n");
	await writeFile(join(repo, "frontend/schema.graphql"), "type Query { id: ID }\n");

	const tools: Record<string, any> = {};
	autoCommit({
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => exec(command, args, options.cwd ?? repo),
		registerCommand: () => undefined,
		registerTool: (tool: any) => { tools[tool.name] = tool; },
	} as any);

	const result = await tools.auto_commit.execute("call-status", { action: "status" }, new AbortController().signal, () => undefined, { cwd: repo });
	const text = result.content[0].text;
	assert.match(text, /commit readiness: READY_WITH_CAVEATS/);
	assert.match(text, /ship readiness: BLOCKED_BY_CAVEATS/);
	assert.match(text, /split recommendation: RECOMMENDED/);
	assert.match(text, /migration\/DB schema execution may still be pending/);
	assert.match(text, /pending UI capture\/verify-report is a ship evidence caveat/);
});

test("action=split-head rejects missing records before moving HEAD or creating backup", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-split-record-"));
	const repo = join(root, "repo");
	const planPath = join(root, "plan.json");
	await git(root, "init", "-b", "main", repo);
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test User");
	await writeFile(join(repo, "feature.ts"), "export const value = 1;\n");
	await git(repo, "add", "feature.ts");
	await git(repo, "commit", "-m", "chore: init");
	await writeFile(join(repo, "feature.ts"), "export const value = 2;\n");
	await git(repo, "add", "feature.ts");
	await git(repo, "commit", "-m", "feat: bundled change");
	const headBefore = (await git(repo, "rev-parse", "HEAD")).trim();

	const tools: Record<string, any> = {};
	autoCommit({
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => exec(command, args, options.cwd ?? repo),
		registerCommand: () => undefined,
		registerTool: (tool: any) => { tools[tool.name] = tool; },
	} as any);
	await writeFile(planPath, JSON.stringify({
		resetTo: "HEAD~1",
		backupBranch: "backup/split-record-test",
		commits: [{ message: "refactor: bundled change 분리", paths: ["feature.ts"] }],
		pushPolicy: "commit-only",
	}));

	await assert.rejects(() => tools.auto_commit.execute("call-split-record-missing", {
		action: "split-head",
		planPath,
	}, new AbortController().signal, () => undefined, { cwd: repo }), /durable record gate blocked/);
	assert.equal((await git(repo, "rev-parse", "HEAD")).trim(), headBefore);
	assert.equal((await git(repo, "status", "--porcelain")).trim(), "");
	assert.notEqual((await exec("git", ["rev-parse", "--verify", "backup/split-record-test"], repo)).code, 0);
});

test("action=apply blocks shallow records and commits a natural durable body", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-record-"));
	const repo = join(root, "repo");
	const planPath = join(root, "plan.json");
	await git(root, "init", "-b", "main", repo);
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test User");
	await writeFile(join(repo, "feature.ts"), "export const value = 1;\n");
	await git(repo, "add", "feature.ts");
	await git(repo, "commit", "-m", "chore: init");
	await writeFile(join(repo, "feature.ts"), "export const value = 2;\n");

	const tools: Record<string, any> = {};
	autoCommit({
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => exec(command, args, options.cwd ?? repo),
		registerCommand: () => undefined,
		registerTool: (tool: any) => { tools[tool.name] = tool; },
	} as any);

	await writeFile(planPath, JSON.stringify({
		commits: [{ message: "fix: 값 갱신 경로 수정", paths: ["feature.ts"] }],
		pushPolicy: "commit-only",
	}));
	await assert.rejects(() => tools.auto_commit.execute("call-record-missing", {
		action: "apply",
		planPath,
	}, new AbortController().signal, () => undefined, { cwd: repo }), /durable record gate blocked/);
	assert.equal((await git(repo, "rev-list", "--count", "HEAD")).trim(), "1");

	await writeFile(planPath, JSON.stringify({
		commits: [{
			message: "fix: 값 갱신 경로 수정",
			paths: ["feature.ts"],
			record: {
				solution: "값을 먼저 갱신한다.",
				evidence: ["targeted tests passed", "lint passed"],
			},
		}],
		pushPolicy: "commit-only",
	}));
	await assert.rejects(() => tools.auto_commit.execute("call-record-shallow", {
		action: "apply",
		planPath,
	}, new AbortController().signal, () => undefined, { cwd: repo }), /requires at least one causal\/judgment field/);

	await writeFile(planPath, JSON.stringify({
		commits: [{
			message: "fix: 값 갱신 경로 수정",
			paths: ["feature.ts"],
			record: {
				cause: "기존 값이 갱신되지 않아 후속 계산이 오래된 상태를 사용했다.",
				solution: "값을 소비하기 전에 source-of-truth를 먼저 갱신하도록 순서를 고쳤다.",
				references: ["PR #42"],
			},
		}],
		pushPolicy: "commit-only",
	}));
	await assert.rejects(() => tools.auto_commit.execute("call-record-unstable-link", {
		action: "apply",
		planPath,
	}, new AbortController().signal, () => undefined, { cwd: repo }), /stable http\(s\) permalinks/);

	await writeFile(planPath, JSON.stringify({
		commits: [{
			message: "fix: 값 갱신 경로 수정",
			paths: ["feature.ts"],
			record: {
				cause: "기존 값이 갱신되지 않아 후속 계산이 오래된 상태를 사용했다.",
				solution: "값을 소비하기 전에 source-of-truth를 먼저 갱신하도록 순서를 고쳤다.",
				references: ["https://example.com/path\nInjected-Line"],
			},
		}],
		pushPolicy: "commit-only",
	}));
	await assert.rejects(() => tools.auto_commit.execute("call-record-newline-link", {
		action: "apply",
		planPath,
	}, new AbortController().signal, () => undefined, { cwd: repo }), /stable http\(s\) permalinks/);
	assert.equal((await git(repo, "rev-list", "--count", "HEAD")).trim(), "1");

	await writeFile(planPath, JSON.stringify({
		commits: [{
			message: "fix: 값 갱신 경로 수정",
			paths: ["feature.ts"],
			record: {
				changeTrigger: "리뷰 코멘트에서 stale value 소비 가능성이 지적됐다.",
				situationImpact: "후속 계산이 오래된 값으로 실행돼 저장 결과와 응답이 어긋날 수 있었다.",
				cause: "source-of-truth 갱신이 consumer 호출보다 뒤에 있었다.",
				solution: "값을 소비하기 전에 source-of-truth를 먼저 갱신하도록 순서를 고쳤다.",
				rationale: "다른 계산 순서는 유지하고 stale read를 만드는 경계만 이동했다.",
				invariants: ["기존 저장 원자성과 consumer 호출 횟수는 바꾸지 않는다."],
				references: ["https://github.com/example/repo/pull/42"],
			},
		}],
		pushPolicy: "commit-only",
	}));
	const result = await tools.auto_commit.execute("call-record-ok", {
		action: "apply",
		planPath,
	}, new AbortController().signal, () => undefined, { cwd: repo });

	assert.equal(result.details.completion, "committed_not_pushed");
	const body = (await git(repo, "log", "-1", "--format=%B")).trim();
	assert.match(body, /^fix: 값 갱신 경로 수정\n\n리뷰 코멘트에서 stale value 소비 가능성이 지적됐다\./u);
	assert.match(body, /source-of-truth 갱신이 consumer 호출보다 뒤에 있었다\./u);
	assert.match(body, /기존 저장 원자성과 consumer 호출 횟수는 바꾸지 않는다\./u);
	assert.match(body, /Refs: https:\/\/github\.com\/example\/repo\/pull\/42/u);
	assert.doesNotMatch(body, /배경:|판단:|검증:|tests passed|lint passed/u);
});

test("action=quick blocks layer-mixed logical atom plans before commit", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-layer-block-"));
	const repo = join(root, "repo");
	await git(root, "init", "-b", "main", repo);
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test User");
	await writeFile(join(repo, "README.md"), "init\n");
	await git(repo, "add", "README.md");
	await git(repo, "commit", "-m", "chore: init");
	await exec("mkdir", ["-p", "backend/apps/trip/src", "frontend/apps/web/domain", "scripts"], repo);
	await writeFile(join(repo, "backend/apps/trip/src/a.ts"), "export const a = 1;\n");
	await writeFile(join(repo, "frontend/apps/web/domain/b.ts"), "export const b = 1;\n");
	await writeFile(join(repo, "scripts/c.ts"), "export const c = 1;\n");

	const tools: Record<string, any> = {};
	autoCommit({
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => exec(command, args, options.cwd ?? repo),
		registerCommand: () => undefined,
		registerTool: (tool: any) => { tools[tool.name] = tool; },
	} as any);

	await assert.rejects(() => tools.auto_commit.execute("call-quick-layer-mixed", {
		action: "quick",
		message: "feat: too broad",
		paths: ["backend/apps/trip/src/a.ts", "frontend/apps/web/domain/b.ts", "scripts/c.ts"],
	}, new AbortController().signal, () => undefined, { cwd: repo }), /layer-mixed primary paths/);
	assert.equal((await git(repo, "rev-list", "--count", "HEAD")).trim(), "1");
});

test("action=quick allows warning-only same-cluster fanout and reports warning", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-warn-allow-"));
	const repo = join(root, "repo");
	await git(root, "init", "-b", "main", repo);
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test User");
	await writeFile(join(repo, "README.md"), "init\n");
	await git(repo, "add", "README.md");
	await git(repo, "commit", "-m", "chore: init");
	await exec("mkdir", ["-p", "extensions/auto-commit"], repo);
	await writeFile(join(repo, "extensions/auto-commit/a.ts"), "export const a = 1;\n");
	await writeFile(join(repo, "extensions/auto-commit/b.ts"), "export const b = 1;\n");
	await writeFile(join(repo, "extensions/auto-commit/c.ts"), "export const c = 1;\n");

	const tools: Record<string, any> = {};
	autoCommit({
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => exec(command, args, options.cwd ?? repo),
		registerCommand: () => undefined,
		registerTool: (tool: any) => { tools[tool.name] = tool; },
	} as any);

	const result = await tools.auto_commit.execute("call-quick-warning", {
		action: "quick",
		message: "feat: 작은 fan-out",
		paths: ["extensions/auto-commit/a.ts", "extensions/auto-commit/b.ts", "extensions/auto-commit/c.ts"],
		pushPolicy: "commit-only",
	}, new AbortController().signal, () => undefined, { cwd: repo });

	assert.match(result.content[0].text, /warnings:/);
	assert.match(result.content[0].text, /3 primary paths/);
	assert.equal((await git(repo, "rev-list", "--count", "HEAD")).trim(), "2");
});

test("action=quick pauses repo status polling during git mutations", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-pause-"));
	const repo = join(root, "repo");
	const previousStateDir = process.env.PILEE_REPO_STATUS_STATE_DIR;
	process.env.PILEE_REPO_STATUS_STATE_DIR = join(root, "state");
	try {
		await git(root, "init", "-b", "main", repo);
		await git(repo, "config", "user.email", "test@example.com");
		await git(repo, "config", "user.name", "Test User");
		await writeFile(join(repo, "README.md"), "init\n");
		await git(repo, "add", "README.md");
		await git(repo, "commit", "-m", "chore: init");
		await writeFile(join(repo, "copy.txt"), "changed\n");

		const pauseObserved: boolean[] = [];
		const tools: Record<string, any> = {};
		autoCommit({
			exec: async (command: string, args: string[], options: { cwd?: string } = {}) => {
				if (command === "git" && ["reset", "add", "commit"].includes(args[0] ?? "")) {
					pauseObserved.push(await isRepoStatusPaused(options.cwd ?? repo));
				}
				return exec(command, args, options.cwd ?? repo);
			},
			registerCommand: () => undefined,
			registerTool: (tool: any) => { tools[tool.name] = tool; },
		} as any);

		const result = await tools.auto_commit.execute("call-quick-pause", {
			action: "quick",
			message: "fix: 문구 수정",
			paths: ["copy.txt"],
			pushPolicy: "commit-only",
		}, new AbortController().signal, () => undefined, { cwd: repo });

		assert.equal(result.details.completion, "committed_not_pushed");
		assert.ok(pauseObserved.length >= 3);
		assert.deepEqual([...new Set(pauseObserved)], [true]);
		assert.equal(await isRepoStatusPaused(repo), false);
	} finally {
		if (previousStateDir === undefined) delete process.env.PILEE_REPO_STATUS_STATE_DIR;
		else process.env.PILEE_REPO_STATUS_STATE_DIR = previousStateDir;
	}
});

test("action=quick commits explicit paths and pushes to safe upstream", async () => {
	const root = await mkdtemp(join(tmpdir(), "auto-commit-quick-"));
	const repo = join(root, "repo");
	const remote = join(root, "origin.git");
	await git(root, "init", "--bare", remote);
	await git(root, "init", "-b", "main", repo);
	await git(repo, "config", "user.email", "test@example.com");
	await git(repo, "config", "user.name", "Test User");
	await writeFile(join(repo, "README.md"), "init\n");
	await git(repo, "add", "README.md");
	await git(repo, "commit", "-m", "chore: init");
	await git(repo, "remote", "add", "origin", remote);
	await git(repo, "checkout", "-b", "feature/test");
	await git(repo, "push", "-u", "origin", "feature/test");
	await writeFile(join(repo, "copy.txt"), "changed\n");

	const tools: Record<string, any> = {};
	autoCommit({
		exec: async (command: string, args: string[], options: { cwd?: string } = {}) => exec(command, args, options.cwd ?? repo),
		registerCommand: () => undefined,
		registerTool: (tool: any) => { tools[tool.name] = tool; },
	} as any);

	const result = await tools.auto_commit.execute("call-1", {
		action: "quick",
		message: "fix: 문구 수정",
		paths: ["copy.txt"],
	}, new AbortController().signal, () => undefined, { cwd: repo });

	assert.match(result.content[0].text, /status: committed_and_pushed/);
	assert.equal(result.details.completion, "committed_and_pushed");
	assert.equal(result.details.push.status, "done");
	assert.equal((await git(repo, "status", "--porcelain")).trim(), "");
	const localHead = (await git(repo, "rev-parse", "HEAD")).trim();
	const remoteHead = (await git(repo, "rev-parse", "origin/feature/test")).trim();
	assert.equal(localHead, remoteHead);
});
