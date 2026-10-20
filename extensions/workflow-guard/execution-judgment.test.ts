import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import workflowGuard from "./index.ts";

let sequence = 0;
function harness(cwd = "/tmp/execution-judgment-fixture") {
	const hooks: Record<string, any> = {};
	const sessionFile = `/tmp/execution-judgment-${++sequence}.jsonl`;
	const ctx = { cwd, sessionManager: { getSessionFile: () => sessionFile, getBranch: () => [] } };
	workflowGuard({
		on: (name, handler) => { hooks[name] = handler; }, registerTool: () => {}, appendEntry: () => {},
		getThinkingLevel: () => "high",
	} as any, { trustedInternalPullRequestRepositories: [] });
	return {
		start: (prompt = "로컬 기능 구현해줘") => hooks.before_agent_start({ prompt, systemPrompt: "base" }, ctx),
		call: (command: string) => hooks.tool_call({ toolName: "bash", input: { command } }, ctx),
		result: (command: string, code: number, text: string) => hooks.tool_result({
			toolName: "bash", input: { command }, isError: code !== 0,
			content: [{ type: "text", text }], details: { exitCode: code },
		}, ctx),
	};
}
const moduleError = "Error: Cannot find module 'fixture-driver'";

// 실제 shell/Node 모듈 해석 경계를 넘는다. 외부 서비스·설치·DB는 사용하지 않는다.
test("raw Node probe 실패가 정식 wrapper의 실행 권한을 차단하지 않는다", async () => {
	// given
	const root = await mkdtemp(join(tmpdir(), "execution-wrapper-"));
	try {
		await mkdir(join(root, "tools"));
		await mkdir(join(root, "vendor/fixture-driver"), { recursive: true });
		await mkdir(join(root, "node_modules/.bin"), { recursive: true });
		await writeFile(join(root, "package.json"), '{"name":"execution-fixture","private":true}');
		await writeFile(join(root, "vendor/fixture-driver/index.js"), 'module.exports = "fixture-cli 1.0";');
		await writeFile(join(root, "tools/cli.cjs"), 'console.log(require("fixture-driver"));');
		await writeFile(join(root, "node_modules/.bin/fixture-cli"), '#!/bin/sh\nNODE_PATH="$PWD/vendor" exec node "$PWD/tools/cli.cjs" "$@"\n', { mode: 0o755 });
		const h = harness(root);
		await h.start();
		const env = { ...process.env };
		delete env.NODE_PATH;

		// when
		const raw = spawnSync(process.execPath, ["tools/cli.cjs", "--version"], { cwd: root, env, encoding: "utf8" });
		assert.equal(raw.status, 1);
		assert.match(raw.stderr, /Cannot find module 'fixture-driver'/);
		const failure = await h.result("node tools/cli.cjs --version", raw.status!, raw.stderr);
		const official = spawnSync("pnpm", ["exec", "fixture-cli", "--version"], { cwd: root, env, encoding: "utf8" });
		assert.equal(official.status, 0, official.stderr);
		assert.equal(official.stdout.trim(), "fixture-cli 1.0");
		await h.result("pnpm exec fixture-cli --version", official.status!, official.stdout);
		const authorizedBuild = await h.call("pnpm turbo build --filter='@fixture/*'");

		// then - 진단 문자열은 환경 전체의 장애/권한 거부 근거가 아니다.
		assert.equal(authorizedBuild, undefined);
		assert.equal(failure.details.workflowGuard.packageResolveEvidence.status, "failed");
		assert.match(failure.content.at(-1).text, /정식.*wrapper/);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("같은 명령의 성공 이후 새 모듈 실패는 첫 실패로 안내한다", async () => {
	// given
	const h = harness();
	await h.start();
	const command = "pnpm vitest run fixture.test.ts";
	await h.result(command, 1, moduleError);

	// when
	const recovered = await h.result(command, 0, "ready");
	const newFailure = await h.result(command, 1, moduleError);

	// then
	assert.match(newFailure.content.at(-1).text, /narrowRecoveryOnly/);
	assert.doesNotMatch(newFailure.content.at(-1).text, /scopeGateRequired/);
	assert.equal(recovered.details.workflowGuard.packageResolveEvidence.status, "recovered");
	assert.equal(recovered.details.workflowGuard.packageResolveEvidence.remainingCommands, 0);
});

test("설치 성공이나 다른 명령의 성공은 미해결 probe의 증거를 지우지 않는다", async () => {
	// given
	const h = harness();
	await h.start();
	const command = "node tools/cli.cjs --version";
	await h.result(command, 1, moduleError);

	// when
	await h.result("sh setup.sh", 0, "setup ready");
	await h.result("pnpm exec other-cli --version", 0, "other-cli 1.0");
	const repeated = await h.result(command, 1, moduleError);

	// then
	assert.match(repeated.content.at(-1).text, /scopeGateRequired/);
	assert.equal(repeated.details.workflowGuard.packageResolveEvidence.failureCount, 2);
	assert.equal(repeated.details.workflowGuard.packageResolveEvidence.remainingCommands, 1);
});

test("한 명령의 복구가 다른 명령의 실패를 해제하지 않는다", async () => {
	// given
	const h = harness();
	await h.start();
	await h.result("pnpm exec first-cli --check", 1, moduleError);
	await h.result("pnpm exec second-cli --check", 1, "Error: Cannot find module 'second-driver'");

	// when
	const recovered = await h.result("pnpm exec first-cli --check", 0, "ready");
	const remaining = await h.result("pnpm exec second-cli --check", 1, "Error: Cannot find module 'second-driver'");

	// then
	assert.equal(recovered.details.workflowGuard.packageResolveEvidence.remainingCommands, 1);
	assert.equal(remaining.details.workflowGuard.packageResolveEvidence.failureCount, 2);
	assert.deepEqual(remaining.details.workflowGuard.packageResolveEvidence.packages, ["second-driver"]);
});

test("진단 안내에는 명령의 설정값을 복제하지 않는다", async () => {
	// given
	const h = harness();
	await h.start();
	const command = "TOKEN=synthetic-sensitive-value node tools/cli.cjs";

	// when
	const failure = await h.result(command, 1, moduleError);
	const recovered = await h.result(command, 0, "ready");

	// then
	assert.doesNotMatch(JSON.stringify([failure, recovered]), /synthetic-sensitive-value/);
	assert.equal(failure.details.workflowGuard.packageResolveEvidence.commandId, recovered.details.workflowGuard.packageResolveEvidence.commandId);
});

test("모듈 진단 뒤에도 점검-only 요청의 설치 차단은 유지한다", async () => {
	// given
	const h = harness();
	await h.start("실행하지 말고 원인만 조사해줘");
	await h.result("node tools/cli.cjs", 1, moduleError);

	// when
	const install = await h.call("npm install fixture-driver");
	const officialRead = await h.call("pnpm exec fixture-cli --version");

	// then
	assert.equal(install?.block, true);
	assert.match(install.reason, /not explicitly requested/);
	assert.equal(officialRead, undefined);
});

test("light 작업의 넓은 빌드 제한은 진단 안내와 독립적으로 유지한다", async () => {
	// given
	const h = harness();
	await h.start("작은 문구만 수정해줘");
	await h.result("node tools/cli.cjs", 1, moduleError);

	// when
	const build = await h.call("pnpm turbo build --filter='@fixture/*'");

	// then
	assert.equal(build?.block, true);
	assert.match(build.reason, /current request is light/);
});
