import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { buildCreateScript, buildPresenceScript, receiveRestoreSession, restoreWorkspace } from "./restore.ts";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

test("host scripts bind explicit IDs and start a process without keyboard/focus injection", () => {
	const target = { windowId: "window-1", tabId: "tab-1", terminalId: "terminal-1" };
	const tab = buildCreateScript(target.windowId, "/tmp/work dir/launch.sh", "/tmp/work dir");
	const split = buildCreateScript(target.windowId, "/tmp/launch.sh", "/tmp", target);
	assert.match(tab, /new tab in targetWindow with configuration launchConfig/);
	assert.match(tab, /set command of launchConfig/);
	// `tab` is Ghostty's Gtab class inside its tell block, not a delimiter.
	assert.match(tab, /\& \(character id 9\) \&/);
	assert.match(split, /\& \(character id 9\) \&/);
	assert.match(split, /first terminal of targetTab whose id is "terminal-1"/);
	assert.match(split, /split anchorTerm direction right with configuration launchConfig/);
	for (const script of [tab, split, buildPresenceScript([target])]) {
		assert.doesNotMatch(script, /System Events|keystroke|send key|input text|initial input|focused terminal|selected tab|front window|\bdelay\b/);
	}
});

test("native response delimiter remains a character after AppleScript compilation", { skip: process.platform !== "darwin" || !existsSync("/Applications/Ghostty.app") }, () => {
	const root = mkdtempSync(join(tmpdir(), "workspace-applescript-"));
	try {
		const target = { windowId: "window-1", tabId: "tab-1", terminalId: "terminal-1" };
		for (const [index, script] of [buildCreateScript(target.windowId, "/tmp/launch.sh", "/tmp"), buildCreateScript(target.windowId, "/tmp/launch.sh", "/tmp", target)].entries()) {
			const source = join(root, `${index}.applescript`);
			const compiled = join(root, `${index}.scpt`);
			writeFileSync(source, script);
			const compilation = spawnSync("osacompile", ["-o", compiled, source], { encoding: "utf8" });
			assert.equal(compilation.status, 0, compilation.stderr);
			const decompiled = spawnSync("osadecompile", [compiled], { encoding: "utf8" });
			assert.equal(decompiled.status, 0, decompiled.stderr);
			assert.match(decompiled.stdout, /return .*\& \(character id 9\) \&/);
			assert.doesNotMatch(decompiled.stdout, /\& (?:tab|«class Gtab») \&/);
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});

function fixture() {
	const root = mkdtempSync(join(tmpdir(), "workspace-restore-"));
	const sessionFile = join(root, "session.jsonl");
	writeFileSync(sessionFile, "{}");
	const action = { cwd: root, sessionFile, command: "echo test-only" };
	const context = { cwd: root, sessionManager: { getSessionFile: () => sessionFile } } as ExtensionContext;
	const calls: string[] = [];
	const requests: string[] = [];
	const revocations: Array<() => void> = [];
	let tab = 0;
	let terminal = 0;
	let autoReady = true;
	let missing = false;
	let rejected = false;
	let beforeCreate: (() => void) | undefined;
	let duplicate = false;
	const acknowledge = (path: string, ctx = context) => {
		const env = { PILEE_WORKSPACE_RESTORE_STEP: path };
		revocations.push(receiveRestoreSession(ctx, env)!);
		assert.equal(env.PILEE_WORKSPACE_RESTORE_STEP, undefined);
	};
	const pi = {
		async exec(_command: string, args: string[]) {
			const script = args[1];
			calls.push(script);
			if (script.includes("get id of front window")) return { code: 0, stdout: "window-original", stderr: "", killed: false };
			if (script.includes("new surface configuration")) {
				beforeCreate?.();
				if (rejected) return { code: 1, stdout: "", stderr: "creation failed", killed: false };
				if (script.includes("new tab in")) tab++;
				terminal++;
				const launchPath = script.match(/set command of launchConfig to "'(.+)'"/)![1];
				const requestPath = launchPath.slice(0, -3);
				requests.push(requestPath);
				if (autoReady) acknowledge(requestPath);
				return { code: 0, stdout: `tab-${tab}\tterminal-${duplicate ? 1 : terminal}`, stderr: "", killed: false };
			}
			return { code: missing ? 1 : 0, stdout: "present", stderr: missing ? "target missing" : "", killed: false };
		},
	};
	return { root, action, context, pi, calls, requests, revocations, acknowledge,
		set autoReady(value: boolean) { autoReady = value; },
		set missing(value: boolean) { missing = value; },
		set rejected(value: boolean) { rejected = value; },
		set beforeCreate(value: () => void) { beforeCreate = value; },
		set duplicate(value: boolean) { duplicate = value; },
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

async function until(check: () => boolean) {
	for (let count = 0; count < 100; count++) {
		if (check()) return;
		await sleep(2);
	}
	assert.fail("test condition timed out");
}

test("each session READY gates the next split and the next tab; skipped entries do not create targets", async () => {
	const f = fixture();
	try {
		f.autoReady = false;
		const result = restoreWorkspace(f.pi, [[{ cwd: f.root }, f.action, f.action], [f.action]], f.root, { pollMs: 1, timeoutMs: 1000 });
		await until(() => f.requests.length === 1);
		await sleep(10);
		assert.equal(f.requests.length, 1);
		f.acknowledge(f.requests[0]);
		await until(() => f.requests.length === 2);
		await sleep(10);
		assert.equal(f.requests.length, 2);
		f.acknowledge(f.requests[1]);
		await until(() => f.requests.length === 3);
		f.acknowledge(f.requests[2]);
		const report = JSON.parse(readFileSync(await result, "utf8"));
		assert.equal(report.status, "completed");
		assert.equal(report.completed.length, 3);
		const creates = f.calls.filter((script) => script.includes("new surface configuration"));
		assert.match(creates[0], /new tab in targetWindow/);
		assert.match(creates[1], /id is "tab-1"/);
		assert.match(creates[1], /id is "terminal-1"/);
		assert.match(creates[2], /new tab in targetWindow/);
		assert.ok(creates.every((script) => script.includes('id is "window-original"')));
		assert.equal(f.calls.filter((script) => script.includes("front window")).length, 1);
	} finally { f.cleanup(); }
});

test("a previously completed session shutting down blocks overall success", async () => {
	const f = fixture();
	try {
		f.beforeCreate = () => { if (f.requests.length === 1) f.revocations[0](); };
		await assert.rejects(restoreWorkspace(f.pi, [[f.action, f.action], [f.action]], f.root), /종료·전환·리로드/);
		assert.equal(f.requests.length, 2);
	} finally { f.cleanup(); }
});

test("host returning an earlier terminal ID cannot acknowledge another panel", async () => {
	const f = fixture();
	try {
		f.duplicate = true;
		await assert.rejects(restoreWorkspace(f.pi, [[f.action, f.action], [f.action]], f.root), /고유한 새 탭\/패널 ID/);
		assert.equal(f.requests.length, 2);
	} finally { f.cleanup(); }
});

test("direct launch script preserves cwd and per-launch identity without inherited panel identity", async () => {
	const f = fixture();
	try {
		f.action.command = `cd '${f.root}' && printf '%s\\n' "$PWD" "$PILEE_WORKSPACE_RESTORE_STEP" "\${PI_FORK_PANEL_LABEL-unset}"`;
		await restoreWorkspace(f.pi, [[f.action]], f.root);
		const result = spawnSync("/bin/bash", [`${f.requests[0]}.sh`], { encoding: "utf8", env: { ...process.env, PI_FORK_PANEL_LABEL: "P9" } });
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(result.stdout.trim().split("\n"), [f.root, f.requests[0], "unset"]);
	} finally { f.cleanup(); }
});

for (const failure of ["timeout", "wrong-session", "wrong-cwd", "dead-process", "closed-panel", "host-create", "abort", "session-shutdown"] as const) {
	test(`${failure} stops before the next panel and saves failure progress`, async () => {
		const f = fixture();
		try {
			f.autoReady = false;
			const controller = new AbortController();
			if (failure === "host-create") f.rejected = true;
			const result = restoreWorkspace(f.pi, [[f.action, f.action], [f.action]], f.root, { signal: controller.signal, timeoutMs: 25, pollMs: 1 });
			const rejection = assert.rejects(result, /중단.*0개 완료/s);
			if (failure !== "host-create") {
				await until(() => f.requests.length === 1);
				if (failure === "wrong-session") f.acknowledge(f.requests[0], { ...f.context, sessionManager: { getSessionFile: () => "/missing-session" } } as ExtensionContext);
				if (failure === "wrong-cwd") f.acknowledge(f.requests[0], { ...f.context, cwd: tmpdir() });
				if (failure === "dead-process") writeFileSync(`${f.requests[0]}.receipt`, JSON.stringify({ status: "ready", pid: 99999999, cwd: f.root, sessionFile: f.action.sessionFile }));
				if (failure === "closed-panel") f.missing = true;
				if (failure === "abort") controller.abort();
				if (failure === "session-shutdown") { f.acknowledge(f.requests[0]); f.revocations[0](); }
			}
			await rejection;
			assert.ok(f.requests.length <= 1);
			const run = readdirSync(f.root).find((name) => name.startsWith("restore-"))!;
			const report = JSON.parse(readFileSync(join(f.root, run, "progress.json"), "utf8"));
			assert.equal(report.status, "failed");
			assert.equal(report.completed.length, 0);
			assert.ok(report.error);
		} finally { f.cleanup(); }
	});
}
