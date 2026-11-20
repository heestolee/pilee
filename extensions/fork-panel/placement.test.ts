import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareSessionLaunchScript } from "../utils/session-launch.ts";
import {
	openExactSessionInNewPanel,
	parsePanelTargetRequest,
	parseSplitPlacementArgs,
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
		const plan = { launchScriptPath: prepareSessionLaunchScript(workDir, sessionFile, { UNICODE_VALUE: "환경값-한글" }, root).scriptPath };
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
