import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { SessionManager } from "@mariozechner/pi-coding-agent";

const root = realpathSync(mkdtempSync(join(tmpdir(), "revive-cwd-")));
process.env.HOME = root;
process.env.TERM_PROGRAM = "test-host";
delete process.env.PI_FORK_ID;
const { default: registerFork } = await import("./index.ts");

test("revive uses supported header transition and verifies fresh host cwd before success", async (t) => {
	let processCwd = root;
	t.mock.method(process, "cwd", () => processCwd);
	t.mock.method(process, "chdir", (cwd: string) => { processCwd = cwd; });
	const targetCwd = join(root, "target");
	const sessionFile = join(root, "session.jsonl");
	const handoffDir = join(root, ".pi/agent/fork-panel");
	mkdirSync(targetCwd, { recursive: true });
	mkdirSync(handoffDir, { recursive: true });
	const tail = JSON.stringify({ type: "message", id: "message", parentId: null, timestamp: new Date().toISOString(), message: { role: "user", content: [{ type: "text", text: "원문 보존" }], timestamp: Date.now() } });
	writeFileSync(join(handoffDir, "recent.json"), JSON.stringify({ fixture: { forkId: "fixture", label: "fixture", panelLabel: "P2", sessionFile, cwd: targetCwd, createdAt: Date.now(), preview: "fixture", title: "fixture" } }));
	try {
		for (const behavior of ["correct", "wrong", "cancel", "fail", "bad-header"]) {
			writeFileSync(sessionFile, (behavior === "bad-header" ? "{}" : JSON.stringify({ type: "session", version: 3, id: "fixture", timestamp: new Date().toISOString(), cwd: root })) + "\n" + tail + "\n");
			processCwd = root;
			const commands = new Map<string, any>();
			const notices: Array<{ text: string; level: string }> = [];
			let stale = false;
			let switches = 0;
			const ui = { notify(text: string, level: string) { notices.push({ text, level }); } };
			const ctx = { cwd: root, hasUI: false, get ui() { assert.equal(stale, false, "old context must not be used after replacement"); return ui; },
				sessionManager: { getSessionFile: () => undefined, getEntries: () => [] },
				async switchSession(path: string, options: any) {
					switches++;
					assert.deepEqual(Object.keys(options), ["withSession"], "cwdOverride is not an extension command option");
					if (behavior === "cancel") return { cancelled: true };
					if (behavior === "fail") throw new Error("fixture switch failed");
					// This is the actual current host header reader, not a copied cwd resolver.
					const manager = SessionManager.open(path);
					assert.equal(resolve(manager.getCwd()), targetCwd);
					stale = true;
					await options.withSession({ cwd: behavior === "wrong" ? root : manager.getCwd(), sessionManager: manager, ui });
					return { cancelled: false };
				} };
			registerFork({ on() {}, registerCommand: (name: string, value: any) => commands.set(name, value), registerShortcut() {},
				exec: async () => { throw new Error("host call forbidden"); } } as any, new EventEmitter() as any);
			await commands.get("revive").handler("fixture here", ctx);
			assert.equal(readFileSync(sessionFile, "utf8").split("\n")[1], tail, "only the existing header correction may change source bytes");
			if (behavior === "correct") {
				assert.ok(notices.some(({ text, level }) => text.includes("세션 재개 → 현재 패널") && level === "info"), JSON.stringify(notices));
				assert.equal(processCwd, targetCwd);
			} else {
				assert.ok(!notices.some(({ text }) => text.includes("세션 재개 → 현재 패널")), `${behavior} must not report success`);
				if (behavior === "wrong") assert.ok(notices.some(({ text, level }) => text.includes("cwd 불일치") && level === "error"));
				if (["cancel", "fail", "bad-header"].includes(behavior)) assert.equal(processCwd, root);
				if (behavior === "bad-header") assert.equal(switches, 0);
			}
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});
