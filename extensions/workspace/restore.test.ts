import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { buildCreateScript, buildPresenceScript, receiveRestoreSession, restoreWorkspace } from "./restore.ts";
import { readSessionIdentity } from "./planner.ts";
import { pinSnapshotSelection, readSnapshotSelection } from "./selection.ts";
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
	const actions = [0, 1, 2].map((index) => {
		const sessionFile = join(root, `session-${index}.jsonl`);
		writeFileSync(sessionFile, JSON.stringify({ type: "session", version: 3, id: `session-${index}`, cwd: root }) + "\n");
		const identity = readSessionIdentity(sessionFile);
		return { ...identity, sourcePanelKey: `tab:${index < 2 ? 1 : 2}:source-tab-${index < 2 ? 1 : 2}/panel:${index < 2 ? index + 1 : 1}:source-panel-${index}`, terminalCwd: root, cwd: identity.sessionCwd, command: "echo test-only" };
	});
	const action = actions[0];
	const sessionFile = action.sessionFile;
	const snapshotPath = join(root, "source.json");
	writeFileSync(snapshotPath, JSON.stringify({
		version: 1, host: "ghostty", id: "fixture", name: "fixture", source: "manual", createdAt: 1, updatedAt: 1,
		window: { id: "source-window", name: "window" },
		tabs: [[0, 1], [2]].map((indices, tabIndex) => ({
			id: `source-tab-${tabIndex + 1}`, index: tabIndex + 1, name: "tab", selected: false,
			terminals: indices.map((index, panelIndex) => ({ id: `source-panel-${index}`, index: panelIndex + 1, name: "session", cwd: root, sessionFile: actions[index].sessionFile })),
		})),
	}));
	const source = pinSnapshotSelection(readSnapshotSelection(snapshotPath), root);
	const context = { cwd: root, sessionManager: { getSessionFile: () => sessionFile } } as ExtensionContext;
	const calls: string[] = [];
	const requests: string[] = [];
	const revocations: Array<() => void> = [];
	let tab = 0;
	let terminal = 0;
	let autoReady = true;
	let missing = false;
	let rejected = false;
	let frontFailure = false;
	let beforeCreate: (() => void) | undefined;
	let duplicate = false;
	const acknowledge = (path: string, ctx?: ExtensionContext) => {
		const request = JSON.parse(readFileSync(path, "utf8"));
		ctx ??= { cwd: request.cwd, sessionManager: { getSessionFile: () => request.sessionFile } } as ExtensionContext;
		const env = { PILEE_WORKSPACE_RESTORE_STEP: path };
		revocations.push(receiveRestoreSession(ctx, env)!);
		assert.equal(env.PILEE_WORKSPACE_RESTORE_STEP, undefined);
	};
	const pi = {
		async exec(_command: string, args: string[]) {
			const script = args[1];
			calls.push(script);
			if (script.includes("get id of front window")) return { code: frontFailure ? 1 : 0, stdout: frontFailure ? "" : "window-original", stderr: frontFailure ? "front window unavailable" : "", killed: false };
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
	return { root, action, actions, source, context, pi, calls, requests, revocations, acknowledge,
		set autoReady(value: boolean) { autoReady = value; },
		set missing(value: boolean) { missing = value; },
		set rejected(value: boolean) { rejected = value; },
		set frontFailure(value: boolean) { frontFailure = value; },
		set beforeCreate(value: () => void) { beforeCreate = value; },
		set duplicate(value: boolean) { duplicate = value; },
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
}

test("full preflight rejects an invalid last panel or duplicate before any host call", async () => {
	for (const invalid of ["missing", "empty", "duplicate", "unresolved"] as const) {
		const f = fixture();
		try {
			const tabs = [[f.actions[0], f.actions[1]], [f.actions[2]]];
			if (invalid === "missing") rmSync(f.actions[2].sessionFile);
			if (invalid === "empty") writeFileSync(f.actions[2].sessionFile, "");
			if (invalid === "duplicate") tabs[1][0] = f.actions[0];
			if (invalid === "unresolved") f.actions[2].command = "";
			await assert.rejects(restoreWorkspace(f.pi, tabs, f.root, { source: f.source }), /preflight BLOCKED \(target 0\)/);
			assert.equal(f.calls.length, 0);
		} finally { f.cleanup(); }
	}
});

async function until(check: () => boolean) {
	for (let count = 0; count < 100; count++) {
		if (check()) return;
		await sleep(2);
	}
	assert.fail("test condition timed out");
}

test("each session READY gates the next split and the next tab", async () => {
	const f = fixture();
	try {
		f.autoReady = false;
		const result = restoreWorkspace(f.pi, [[f.actions[0], f.actions[1]], [f.actions[2]]], f.root, { source: f.source, pollMs: 1, timeoutMs: 1000 });
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
		await assert.rejects(restoreWorkspace(f.pi, [[f.actions[0], f.actions[1]], [f.actions[2]]], f.root, { source: f.source }), /종료·전환·리로드/);
		assert.equal(f.requests.length, 2);
	} finally { f.cleanup(); }
});

test("host returning an earlier terminal ID cannot acknowledge another panel", async () => {
	const f = fixture();
	try {
		f.duplicate = true;
		await assert.rejects(restoreWorkspace(f.pi, [[f.actions[0], f.actions[1]], [f.actions[2]]], f.root, { source: f.source }), /고유한 새 탭\/패널 ID/);
		assert.equal(f.requests.length, 2);
	} finally { f.cleanup(); }
});

test("direct launch script preserves cwd and per-launch identity without inherited panel identity", async () => {
	const f = fixture();
	try {
		f.action.command = `cd '${f.root}' && printf '%s\\n' "$PWD" "$PILEE_WORKSPACE_RESTORE_STEP" "\${PI_FORK_PANEL_LABEL-unset}"`;
		await restoreWorkspace(f.pi, [[f.actions[0], f.actions[1]], [f.actions[2]]], f.root, { source: f.source });
		const result = spawnSync("/bin/bash", [`${f.requests[0]}.sh`], { encoding: "utf8", env: { ...process.env, PI_FORK_PANEL_LABEL: "P9" } });
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(result.stdout.trim().split("\n"), [f.root, f.requests[0], "unset"]);
	} finally { f.cleanup(); }
});

test("two READY panels and a timed-out current block retries even after late READY", async () => {
	const f = fixture();
	try {
		f.beforeCreate = () => { if (f.requests.length === 2) f.autoReady = false; };
		const tabs = [[f.actions[0], f.actions[1]], [f.actions[2]]];
		await assert.rejects(restoreWorkspace(f.pi, tabs, f.root, { source: f.source, timeoutMs: 25, pollMs: 1 }), /2개 완료.*READY 시간 초과/s);
		const progressPath = join(f.requests[2], "..", "progress.json");
		const before = readFileSync(progressPath, "utf8");
		const progress = JSON.parse(before);
		assert.deepEqual([progress.total, progress.ready, progress.remaining], [3, 2, 1]);
		assert.equal(progress.source.hash, f.source.hash);
		assert.equal(progress.current.sourcePanelKey, f.actions[2].sourcePanelKey);
		assert.equal(progress.current.target.terminalId, "terminal-3");
		assert.deepEqual(progress.panels.map((panel: { sourcePanelKey: string }) => panel.sourcePanelKey), f.actions.map((action) => action.sourcePanelKey));
		const calls = f.calls.length;
		await assert.rejects(restoreWorkspace(f.pi, tabs, f.root, { source: f.source }), /기존 복구 기록/);
		f.acknowledge(f.requests[2]);
		await assert.rejects(restoreWorkspace(f.pi, tabs, f.root, { source: f.source }), /기존 복구 기록/);
		assert.equal(f.calls.length, calls);
		assert.equal(readFileSync(progressPath, "utf8"), before);
	} finally { f.cleanup(); }
});

test("front-window and claim failures before creation remain retryable", async () => {
	for (const failure of ["front", "claim"] as const) {
		const f = fixture();
		try {
			const tabs = [[f.actions[0], f.actions[1]], [f.actions[2]]];
			if (failure === "front") f.frontFailure = true;
			else writeFileSync(join(f.root, "restore-claims"), "not a directory");
			await assert.rejects(restoreWorkspace(f.pi, tabs, f.root, { source: f.source }));
			assert.equal(f.requests.length, 0);
			if (failure === "front") {
				const run = readdirSync(f.root).find((name) => /^restore-[a-f0-9]{8}-/.test(name))!;
				assert.equal(JSON.parse(readFileSync(join(f.root, run, "progress.json"), "utf8")).targetState, "none");
				f.frontFailure = false;
			} else { assert.equal(f.calls.length, 0); rmSync(join(f.root, "restore-claims")); }
			const report = JSON.parse(readFileSync(await restoreWorkspace(f.pi, tabs, f.root, { source: f.source }), "utf8"));
			assert.equal(report.status, "completed");
			assert.equal(f.requests.length, 3);
		} finally { f.cleanup(); }
	}
});

test("executor rejects a partial plan and changed pin before any host call", async () => {
	const f = fixture();
	try {
		await assert.rejects(restoreWorkspace(f.pi, [[f.actions[0]], [f.actions[2]]], f.root, { source: f.source }), /부분 실행/);
		await assert.rejects(restoreWorkspace(f.pi, [[f.actions[0], f.actions[1]], [f.actions[2]]], f.root, { source: { ...f.source, hash: "b".repeat(64) } }), /fingerprint 불일치/);
		assert.equal(f.calls.length, 0);
		assert.equal(readdirSync(f.root).filter((name) => /^restore-[a-f0-9]{8}-/.test(name)).length, 0);
	} finally { f.cleanup(); }
});

test("TOCTOU header change before first create stops with target zero and allows a corrected retry", async () => {
	const f = fixture();
	try {
		const tabs = [[f.actions[0], f.actions[1]], [f.actions[2]]];
		const original = readFileSync(f.action.sessionFile);
		await assert.rejects(restoreWorkspace(f.pi, tabs, f.root, {
			source: f.source,
			onProgress: () => writeFileSync(f.action.sessionFile, JSON.stringify({ type: "session", version: 3, id: "replaced", cwd: f.root }) + "\n"),
		}), /identity가 변경/);
		assert.equal(f.requests.length, 0);
		assert.equal(f.calls.length, 1); // The only host call was the front-window read.
		writeFileSync(f.action.sessionFile, original);
		await restoreWorkspace(f.pi, tabs, f.root, { source: f.source });
		assert.equal(f.requests.length, 3);
	} finally { f.cleanup(); }
});

test("host creation errors retain an uncertain claim rather than append again", async () => {
	const f = fixture();
	try {
		f.rejected = true;
		const tabs = [[f.actions[0], f.actions[1]], [f.actions[2]]];
		await assert.rejects(restoreWorkspace(f.pi, tabs, f.root, { source: f.source }), /creation failed/);
		const run = readdirSync(f.root).find((name) => /^restore-[a-f0-9]{8}-/.test(name))!;
		const progress = JSON.parse(readFileSync(join(f.root, run, "progress.json"), "utf8"));
		assert.equal(progress.targetState, "possible");
		assert.equal(progress.current.sourcePanelKey, f.action.sourcePanelKey);
		assert.ok(progress.current.requestPath);
		f.rejected = false;
		const calls = f.calls.length;
		await assert.rejects(restoreWorkspace(f.pi, tabs, f.root, { source: f.source }), /기존 복구 기록/);
		assert.equal(f.calls.length, calls);
	} finally { f.cleanup(); }
});

test("failed receipt preserves the original mismatch through repeated lifecycle invalidation", () => {
	const f = fixture();
	try {
		const path = join(f.root, "mismatch.json");
		writeFileSync(path, JSON.stringify({ sessionFile: f.action.sessionFile, cwd: f.root }));
		const revoke = receiveRestoreSession({ ...f.context, cwd: tmpdir() }, { PILEE_WORKSPACE_RESTORE_STEP: path })!;
		const first = JSON.parse(readFileSync(`${path}.receipt`, "utf8"));
		assert.match(first.error, /일치하지 않습니다/);
		revoke(); revoke();
		const last = JSON.parse(readFileSync(`${path}.receipt`, "utf8"));
		assert.equal(last.error, first.error);
		assert.equal(last.status, "failed");
		assert.equal(last.lifecycle.state, "invalidated");
	} finally { f.cleanup(); }
});

for (const failure of ["timeout", "wrong-session", "wrong-cwd", "dead-process", "closed-panel", "host-create", "abort", "session-shutdown"] as const) {
	test(`${failure} stops before the next panel and saves failure progress`, async () => {
		const f = fixture();
		try {
			f.autoReady = false;
			const controller = new AbortController();
			if (failure === "host-create") f.rejected = true;
			const result = restoreWorkspace(f.pi, [[f.actions[0], f.actions[1]], [f.actions[2]]], f.root, { source: f.source, signal: controller.signal, timeoutMs: 25, pollMs: 1 });
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
			const run = readdirSync(f.root).find((name) => /^restore-[a-f0-9]{8}-/.test(name))!;
			const report = JSON.parse(readFileSync(join(f.root, run, "progress.json"), "utf8"));
			assert.equal(report.status, "failed");
			assert.equal(report.completed.length, 0);
			assert.ok(report.error);
		} finally { f.cleanup(); }
	});
}
