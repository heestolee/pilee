import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { receiveRestoreSession } from "./restore.ts";

const root = mkdtempSync(join(tmpdir(), "workspace-command-"));
process.env.PI_CODING_AGENT_DIR = root;
const { default: registerWorkspace } = await import("./index.ts");

test("/workspace connects the sequential restore runner and only reports completion after receipts", async () => {
	try {
		const sessionFile = join(root, "target.jsonl");
		writeFileSync(sessionFile, '{}\n');
		const snapshots = join(root, "workspaces", "snapshots");
		mkdirSync(snapshots, { recursive: true });
		writeFileSync(join(snapshots, "fixture.json"), JSON.stringify({
			version: 1, id: "fixture", name: "fixture", source: "manual", host: "ghostty", createdAt: Date.now(), updatedAt: Date.now(),
			window: { id: "old-window", name: "old" },
			tabs: [{ id: "old-tab", index: 1, name: "old", selected: true, terminals: [
				{ id: "old-terminal", index: 1, name: "target", cwd: root, sessionFile, panelLabel: "P0", match: "active" },
			] }],
		}));
		const messages: string[] = [];
		const notices: string[] = [];
		const statuses: Array<string | undefined> = [];
		const calls: string[] = [];
		let fail = false;
		let autoReady = true;
		const requests: string[] = [];
		const hooks = new Map<string, Function>();
		let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
		const ctx = {
			cwd: root, hasUI: true,
			sessionManager: { getSessionFile: () => sessionFile, getSessionName: () => "fixture", getCwd: () => root },
			ui: { notify: (text: string) => notices.push(text), setStatus: (_key: string, text?: string) => statuses.push(text) },
		} as ExtensionCommandContext;
		registerWorkspace({
			on: (name, handler) => { hooks.set(name, handler); },
			registerCommand: (_name, options) => { handler = options.handler; },
			sendMessage: (message) => { messages.push(String(message.content)); },
			exec: async (_command, args) => {
				const script = args[1];
				calls.push(script);
				if (fail) return { code: 1, stdout: "", stderr: "host unavailable", killed: false };
				if (script.includes("get id of front window")) return { code: 0, stdout: "window-target", stderr: "", killed: false };
				if (script.includes("new surface configuration")) {
					assert.ok(!messages.some((m) => m.includes("restore 완료")));
					const launchPath = script.match(/set command of launchConfig to "'(.+)'"/)![1];
					requests.push(launchPath.slice(0, -3));
					if (autoReady) receiveRestoreSession(ctx, { PILEE_WORKSPACE_RESTORE_STEP: launchPath.slice(0, -3) });
					return { code: 0, stdout: "new-tab\tnew-terminal", stderr: "", killed: false };
				}
				return { code: 0, stdout: "present", stderr: "", killed: false };
			},
		} as ExtensionAPI);
		await handler("restore fixture --dry-run", ctx);
		assert.equal(calls.length, 0);
		assert.match(messages[0], /restore dry-run/);
		await handler("restore fixture", ctx);
		assert.match(messages.at(-1)!, /restore 완료/);
		assert.match(notices.at(-1)!, /세션 READY 확인/);
		assert.ok(statuses.some((text) => text?.includes("READY 대기")));
		assert.equal(statuses.at(-1), undefined);
		const reportPath = messages.at(-1)!.split("진행 기록: ")[1];
		assert.equal(JSON.parse(readFileSync(reportPath, "utf8")).status, "completed");
		fail = true;
		await handler("restore fixture", ctx);
		assert.match(messages.at(-1)!, /restore 중단/);
		assert.match(notices.at(-1)!, /host unavailable/);

		// Invoke the real command and shutdown hooks while a restore is pending.
		fail = false;
		autoReady = false;
		messages.length = 0;
		const pending = handler("restore fixture", ctx);
		for (let count = 0; requests.length < 2 && count < 100; count++) await sleep(2);
		assert.equal(requests.length, 2);
		await handler("restore fixture", ctx);
		assert.match(notices.at(-1)!, /이미 진행 중/);
		assert.equal(requests.length, 2);
		await hooks.get("session_shutdown")!({ reason: "reload" }, ctx);
		await pending;
		assert.ok(!messages.some((message) => message.includes("restore 완료")));
		autoReady = true;
		await handler("restore fixture", ctx);
		assert.match(messages.at(-1)!, /restore 완료/);

		const childRequest = join(root, "child.json");
		writeFileSync(childRequest, JSON.stringify({ sessionFile, cwd: root }));
		process.env.PILEE_WORKSPACE_RESTORE_STEP = childRequest;
		await hooks.get("session_start")!({ reason: "startup" }, ctx);
		assert.equal(JSON.parse(readFileSync(`${childRequest}.receipt`, "utf8")).status, "ready");
		assert.equal(process.env.PILEE_WORKSPACE_RESTORE_STEP, undefined);
		await hooks.get("session_shutdown")!({ reason: "reload" }, ctx);
		await hooks.get("session_start")!({ reason: "reload" }, ctx);
		assert.equal(JSON.parse(readFileSync(`${childRequest}.receipt`, "utf8")).status, "failed");
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
