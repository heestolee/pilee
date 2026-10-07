import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { beginTerminalTitleProbe, syncTerminalTitle } from "../utils/terminal-title.ts";
import registerSessionTitle from "../session-title/index.ts";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

function fixture(file: string) {
	const titles: string[] = [];
	let stale = false;
	const ctx = {
		hasUI: true, cwd: "/fixture", sessionManager: {
			getSessionFile: () => { if (stale) throw new Error("ctx is stale"); return file; },
			getSessionName: () => "visible session",
		}, ui: { setTitle: (title: string) => { titles.push(title); } },
	} as ExtensionContext;
	return { ctx, titles, invalidate: () => { stale = true; } };
}

test("a pending probe preserves concurrent title updates and restores the latest human-readable title", () => {
	const f = fixture("/title-a.jsonl");
	syncTerminalTitle(f.ctx, "π - original - fixture");
	const restore = beginTerminalTitleProbe(f.ctx, "[pilee:nonce]");
	syncTerminalTitle(f.ctx, "π - renamed - fixture");
	assert.equal(f.titles.at(-1), "π - renamed - fixture [pilee:nonce]");
	restore(); restore();
	assert.equal(f.titles.at(-1), "π - renamed - fixture");
	assert.equal(f.titles.length, 4);
});

test("the real session-title owner preserves a pending probe through rename and shutdown sync", async () => {
	const f = fixture("/actual-title-owner.jsonl");
	const hooks = new Map<string, Function>();
	let name = "original";
	registerSessionTitle({ on: (event, handler) => { hooks.set(event, handler); }, getSessionName: () => name } as ExtensionAPI);
	await hooks.get("session_start")!({ reason: "reload" }, f.ctx);
	const restore = beginTerminalTitleProbe(f.ctx, "[pilee:owner]");
	name = "renamed";
	await hooks.get("agent_end")!({}, f.ctx);
	assert.equal(f.titles.at(-1), "π - renamed - fixture [pilee:owner]");
	await hooks.get("session_shutdown")!({ reason: "reload" }, f.ctx);
	assert.equal(f.titles.at(-1), "π - fixture [pilee:owner]");
	restore();
	assert.equal(f.titles.at(-1), "π - fixture");
});

test("workspace works without session-title, while old probe cleanup cannot replace a new session or reload title", () => {
	const old = fixture("/title-old.jsonl");
	const restoreOld = beginTerminalTitleProbe(old.ctx, "[pilee:old]");
	assert.equal(old.titles[0], "π - visible session - fixture [pilee:old]");
	const fresh = fixture("/title-new.jsonl");
	const restoreNew = beginTerminalTitleProbe(fresh.ctx, "[pilee:new]");
	old.invalidate(); restoreOld();
	assert.equal(fresh.titles.length, 1);
	restoreNew();
	assert.equal(fresh.titles.at(-1), "π - visible session - fixture");
	const reload = beginTerminalTitleProbe(fresh.ctx, "[pilee:reload]");
	fresh.invalidate(); reload();
	assert.equal(fresh.titles.at(-1), "π - visible session - fixture [pilee:reload]");
});
