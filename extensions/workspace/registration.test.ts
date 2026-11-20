import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { createSessionRegistration, supportsRegistration, type RegistrationEnvironment } from "./registration.ts";
import { ghosttyBindingScript, parseBindingOutput } from "../utils/ghostty-panels.ts";
import { readRegistrations } from "./registry.ts";
import { syncTerminalTitle } from "../utils/terminal-title.ts";

const environment: RegistrationEnvironment = { platform: "darwin", termProgram: "ghostty", stdinTTY: true, stdoutTTY: true };
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "workspace-binding-"));
	const titles: string[] = [];
	let stale = false;
	const file = join(root, "session.jsonl");
	writeFileSync(file, JSON.stringify({ type: "session", version: 3, id: "fixture", cwd: root }) + "\n");
	const ctx = {
		mode: "tui", hasUI: true, cwd: root,
		sessionManager: { getSessionFile: () => { if (stale) throw new Error("ctx is stale"); return file; }, getSessionName: () => "visible", getCwd: () => root },
		ui: { setTitle: (title: string) => { titles.push(title); } },
	} as ExtensionContext;
	return { root, titles, ctx, file, invalidate: () => { stale = true; }, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
const response = (stdout: string) => ({ code: 0, stdout, stderr: "", killed: false });

test("binding searches all windows without focus reads and compiled script preserves text delimiters", () => {
	const script = ghosttyBindingScript("[pilee:aabb-ccdd]");
	assert.match(script, /repeat with targetWindow in windows/);
	assert.match(script, /repeat with targetTab in tabs of targetWindow/);
	assert.doesNotMatch(script, /front window|focused|selected|activate|keystroke|System Events|new tab|split/);
	assert.throws(() => parseBindingOutput("w\tt\nw\tt2"), /여러 Ghostty/);
	assert.throws(() => parseBindingOutput("w\tt\textra"), /형식/);
	if (process.platform === "darwin" && existsSync("/Applications/Ghostty.app")) {
		const f = fixture();
		try {
			const path = join(f.root, "binding.applescript");
			writeFileSync(path, script);
			const result = spawnSync("osacompile", ["-o", join(f.root, "binding.scpt"), path], { encoding: "utf8" });
			assert.equal(result.status, 0, result.stderr);
		} finally { f.cleanup(); }
	}
});

test("success binds exact terminal and restores a concurrent session-title update", async () => {
	const f = fixture();
	let calls = 0;
	const registration = createSessionRegistration({ exec: async (_command, args, options) => {
		calls++;
		assert.equal(options?.timeout, 1000);
		assert.ok(options?.signal);
		const marker = args[1].match(/\[pilee:[a-f0-9-]+\]/u)![0];
		assert.ok(f.titles.at(-1)!.includes(marker));
		syncTerminalTitle(f.ctx, "π - renamed - project");
		assert.ok(f.titles.at(-1)!.includes(marker));
		return response("other-window\texact-terminal\n");
	} }, f.root, environment);
	try {
		await registration.start(f.ctx);
		assert.equal(calls, 1);
		assert.equal(f.titles.at(-1), "π - renamed - project");
		const [record] = readRegistrations(f.root);
		assert.deepEqual(record.binding, { windowId: "other-window", terminalId: "exact-terminal" });
		assert.equal(record.error, undefined);
		registration.refresh();
		assert.equal(readRegistrations(f.root).length, 1);
	} finally { registration.stop(); f.cleanup(); }
});

for (const failure of ["no-match", "duplicate", "timeout", "exception"] as const) {
	test(`${failure} leaves an explicit unbound reason and restores the readable title`, async () => {
		const f = fixture();
		let calls = 0;
		const registration = createSessionRegistration({ exec: async () => {
			calls++;
			if (failure === "exception") throw new Error("host unavailable");
			if (failure === "timeout") return { ...response(""), killed: true };
			return response(failure === "duplicate" ? "w\tt\nw\tu" : "");
		} }, f.root, environment);
		try {
			await registration.start(f.ctx);
			assert.equal(calls, failure === "no-match" ? 3 : 1);
			assert.ok(readRegistrations(f.root)[0].error);
			assert.equal(readRegistrations(f.root)[0].binding, undefined);
			assert.doesNotMatch(f.titles.at(-1)!, /\[pilee:/);
		} finally { registration.stop(); f.cleanup(); }
	});
}

test("session replacement/reload and late shutdown cannot publish or remove the new generation", async () => {
	const old = fixture(); const fresh = fixture();
	let finish!: (value: ReturnType<typeof response>) => void;
	const first = createSessionRegistration({ exec: () => new Promise((resolve) => { finish = resolve; }) }, old.root, environment);
	const second = createSessionRegistration({ exec: async () => response("w\tfresh") }, old.root, environment);
	try {
		const pending = first.start(old.ctx);
		await second.start(fresh.ctx);
		const [expected] = readRegistrations(old.root);
		old.invalidate();
		finish(response("w\told"));
		await pending;
		first.refresh(); first.stop();
		assert.deepEqual(readRegistrations(old.root), [expected]);
		assert.equal(expected.sessionFile, readRegistrations(old.root)[0].sessionFile);
		assert.equal(expected.binding?.terminalId, "fresh");
		assert.doesNotMatch(fresh.titles.at(-1)!, /\[pilee:/);
	} finally { second.stop(); first.stop(); old.cleanup(); fresh.cleanup(); }
});

test("shutdown and a stale context during probe prevent late binding writes", async () => {
	for (const shutdown of [false, true]) {
		const f = fixture();
		let finish!: (value: ReturnType<typeof response>) => void;
		const registration = createSessionRegistration({ exec: () => new Promise((resolve) => { finish = resolve; }) }, f.root, environment);
		try {
			const pending = registration.start(f.ctx);
			const path = join(f.root, "registrations", readdirSync(join(f.root, "registrations"))[0]);
			const before = readFileSync(path);
			if (shutdown) registration.stop(); else f.invalidate();
			finish(response("w\tlate")); await pending;
			assert.equal(registration.isCurrent(), false);
			if (shutdown) assert.deepEqual(readRegistrations(f.root), []);
			else assert.deepEqual(readFileSync(path), before);
		} finally { registration.stop(); f.cleanup(); }
	}
});

test("unsupported host, no TTY, headless, RPC and subagent contexts make no host/title/registry calls", async () => {
	const f = fixture();
	try {
		const variants = [
			{ ctx: f.ctx, env: { ...environment, platform: "linux" } },
			{ ctx: f.ctx, env: { ...environment, termProgram: "other" } },
			{ ctx: f.ctx, env: { ...environment, stdinTTY: false } },
			{ ctx: f.ctx, env: { ...environment, stdoutTTY: false } },
			{ ctx: { ...f.ctx, hasUI: false }, env: environment },
			{ ctx: { ...f.ctx, mode: "rpc" }, env: environment },
			{ ctx: { ...f.ctx, sessionManager: { ...f.ctx.sessionManager, getSessionFile: () => "/sessions/subagents/fixture.jsonl" } }, env: environment },
		];
		for (const variant of variants) {
			assert.equal(supportsRegistration(variant.ctx, variant.env), false);
			await createSessionRegistration({ exec: async () => { throw new Error("must not call host"); } }, f.root, variant.env).start(variant.ctx);
		}
		assert.deepEqual(f.titles, []);
		assert.equal(existsSync(join(f.root, "registrations")), false);
	} finally { f.cleanup(); }
});
