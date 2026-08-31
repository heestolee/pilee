import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	buildOpenSessionPlan,
	buildRepanelScript,
	chooseNewPanelPlacement,
	openExactSessionInNewPanel,
	parsePanelTargetRequest,
	parseSplitPlacementArgs,
	splitPlacementFromDirections,
} from "./index.ts";

test("parsePanelTargetRequest treats leading directions as anchor path and preserves prompt", () => {
	const parsed = parsePanelTargetRequest("right down 화면 비교해줘");
	assert.deepEqual(parsed.target, { anchorPath: ["right"], splitDirection: "down" });
	assert.equal(parsed.prompt, "화면 비교해줘");
});

test("parsePanelTargetRequest defaults to right split and preserves non-direction prompt", () => {
	const parsed = parsePanelTargetRequest("이 작업을 이어서 봐줘");
	assert.deepEqual(parsed.target, { anchorPath: [], splitDirection: "right" });
	assert.equal(parsed.prompt, "이 작업을 이어서 봐줘");
});

test("parseSplitPlacementArgs accepts repanel anchor-path syntax only", () => {
	assert.deepEqual(parseSplitPlacementArgs("right down"), { anchorPath: ["right"], splitDirection: "down" });
	assert.deepEqual(parseSplitPlacementArgs("down"), { anchorPath: [], splitDirection: "down" });
	assert.equal(parseSplitPlacementArgs("right later"), null);
});

test("chooseNewPanelPlacement stays scoped to composed new-panel workflows", async () => {
	const seen: string[][] = [];
	const ctx = {
		hasUI: true,
		ui: {
			async select(_title: string, choices: string[]) {
				seen.push(choices);
				return "새 탭";
			},
		},
	} as any;
	assert.equal(await chooseNewPanelPlacement(ctx), "tab");
	assert.deepEqual(seen[0]?.slice(0, 2), ["오른쪽 분할 패널", "새 탭"]);
	assert.equal(seen[0]?.some((choice) => choice.includes("현재 패널")), false);
	assert.equal(await chooseNewPanelPlacement({ ...ctx, hasUI: false }), null);
});

test("buildOpenSessionScript uses a short ASCII script command while preserving exact Unicode launch data", () => {
	const launchRoot = mkdtempSync(join(tmpdir(), "pilee-panel-transport-"));
	try {
		for (const target of ["tab" as const, splitPlacementFromDirections(["right"])]) {
			const plan = buildOpenSessionPlan(target, "/tmp/한글 work dir", "/tmp/정확한 session.jsonl", {
				PI_WORKSPACE_ACTIVATION_FILE: "/tmp/활성화.json",
			}, launchRoot);
			const command = plan.script.match(/set command of launchConfig to "([^"]+)"/)?.[1] ?? "";
			assert.equal(command, plan.launchScriptPath);
			assert.equal([...command].every((char) => char.charCodeAt(0) < 128), true, "Ghostty command must be ASCII-only");
			assert.ok(command.length < 256, "Ghostty command must stay short");
			assert.doesNotMatch(plan.script, /set initial input|base64|dquote/);
			assert.equal(existsSync(plan.launchScriptPath), true);
			const launchScript = readFileSync(plan.launchScriptPath, "utf8");
			assert.ok(launchScript.includes("/tmp/한글 work dir"));
			assert.ok(launchScript.includes("/tmp/정확한 session.jsonl"));
			assert.ok(launchScript.includes("PI_WORKSPACE_ACTIVATION_FILE="));
			assert.ok(launchScript.includes("/tmp/활성화.json"));
			assert.ok(launchScript.indexOf("rm -f --") < launchScript.indexOf("exec /bin/bash"));
			assert.match(plan.script, /return id of newTerm/);
		}

		const tabScript = buildOpenSessionPlan("tab", "/tmp/work dir", "/tmp/exact session.jsonl", {}, launchRoot).script;
		assert.match(tabScript, /set launchConfig to new surface configuration/);
		assert.match(tabScript, /set initial working directory of launchConfig to "\/tmp\/work dir"/);
		assert.match(tabScript, /set command of launchConfig to "\/.*launch-.*\.sh"/);
	assert.match(tabScript, /set newTab to new tab in front window with configuration launchConfig/);
	assert.match(tabScript, /select tab newTab/);
	assert.match(tabScript, /set newTerm to focused terminal of newTab/);
	assert.doesNotMatch(tabScript, /make new tab|input text|send key/);

		const splitScript = buildOpenSessionPlan(splitPlacementFromDirections(["right"]), "/tmp/work dir", "/tmp/exact session.jsonl", {}, launchRoot).script;
		assert.match(splitScript, /split anchorTerm direction right with configuration launchConfig/);
		assert.doesNotMatch(splitScript, /input text|send key/);
	} finally {
		rmSync(launchRoot, { recursive: true, force: true });
	}
});

test("short launch script runs in a background PTY with exact Unicode cwd, env, and session", () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-panel-pty-"));
	const workDir = join(root, "한글 작업공간");
	const sessionFile = join(root, "정확한 세션.jsonl");
	const marker = join(root, "result.txt");
	const fakePi = join(root, "fake-pi.sh");
	mkdirSync(workDir);
	writeFileSync(sessionFile, "{}\n", "utf8");
	writeFileSync(fakePi, `#!/bin/bash\n{\n  printf 'cwd=%s\\n' "$PWD"\n  printf 'env=%s\\n' "$UNICODE_VALUE"\n  printf 'args=%s\\n' "$*"\n  if test -t 0; then printf 'tty=yes\\n'; else printf 'tty=no\\n'; fi\n} > ${JSON.stringify(marker)}\n`, { encoding: "utf8", mode: 0o700 });
	chmodSync(fakePi, 0o700);
	const previousPiBin = process.env.PILEE_PI_BIN;
	try {
		process.env.PILEE_PI_BIN = fakePi;
		const plan = buildOpenSessionPlan("tab", workDir, sessionFile, { UNICODE_VALUE: "환경값-한글" }, root);
		const ptyRunner = [
			"import os,pty,sys",
			"pid,fd=pty.fork()",
			"if pid==0: os.execv(sys.argv[1],[sys.argv[1]])",
			"while True:",
			"  try:",
			"    data=os.read(fd,4096)",
			"    if not data: break",
			"  except OSError: break",
			"_,status=os.waitpid(pid,0)",
			"sys.exit(os.waitstatus_to_exitcode(status))",
		].join("\n");
		const run = spawnSync("/usr/bin/python3", ["-c", ptyRunner, plan.launchScriptPath], { encoding: "utf8", timeout: 10_000 });
		assert.equal(run.status, 0, run.stderr || run.stdout);
		assert.equal(existsSync(plan.launchScriptPath), false, "launch script must delete itself before exec");
		const result = readFileSync(marker, "utf8");
		assert.ok(result.includes(`cwd=${workDir}\n`));
		assert.match(result, /env=환경값-한글/);
		assert.ok(result.includes(`args=--session ${sessionFile}`));
		assert.match(result, /tty=yes/);
	} finally {
		if (previousPiBin === undefined) delete process.env.PILEE_PI_BIN;
		else process.env.PILEE_PI_BIN = previousPiBin;
		rmSync(root, { recursive: true, force: true });
	}
});

test("host script failure is unsafe because Ghostty may have already created a surface", async () => {
	const root = mkdtempSync(join(tmpdir(), "pilee-panel-open-failure-"));
	try {
		const sessionFile = join(root, "target.jsonl");
		writeFileSync(sessionFile, "{}\n");
		let execCalls = 0;
		const result = await openExactSessionInNewPanel({
			exec: async () => {
				execCalls += 1;
				return { code: 1, stdout: "", stderr: "surface created before id lookup failed" };
			},
		} as any, {
			activationId: "partial-host-open",
			placement: "tab",
			cwd: root,
			sessionFile,
			title: "Partial host open",
			host: { platform: "darwin", termProgram: "ghostty" },
		});
		assert.equal(execCalls, 1, "clean activation without a source session must reach the host adapter");
		assert.equal(result.status, "failed");
		if (result.status === "failed") assert.equal(result.safeToDeleteTarget, false);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("buildRepanelScript resolves anchor before closing current terminal", () => {
	const launchRoot = mkdtempSync(join(tmpdir(), "pilee-repanel-transport-"));
	try {
		const script = buildRepanelScript(
			splitPlacementFromDirections(["right", "down"]),
			"/tmp/example",
			"/tmp/session.jsonl",
			{},
			"old-terminal-id",
			launchRoot,
		);

		const navigationIndex = script.indexOf('perform action "goto_split:right"');
		const closeIndex = script.indexOf("close oldTerm");
		const splitIndex = script.indexOf("split anchorTerm direction down");

		assert.ok(navigationIndex > -1, "script should navigate to the right anchor");
		assert.ok(closeIndex > navigationIndex, "script must not close the current terminal before anchor resolution");
		assert.ok(script.includes("set anchorTerm to first terminal whose id is anchorId"));
		assert.ok(splitIndex > closeIndex, "script should split the resolved anchor after closing the old terminal");
	} finally {
		rmSync(launchRoot, { recursive: true, force: true });
	}
});
