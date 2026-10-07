import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const root = mkdtempSync(join(tmpdir(), "workspace-foreign-identity-"));
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = root;
process.env.TERM_PROGRAM = "test-host";
process.env.PI_FORK_PANEL_LABEL = "P9";
process.env.PI_FORK_ID = "caller-fork";
process.env.PI_FORK_PARENT = join(root, "caller-parent.jsonl");
const { default: registerWorkspace } = await import("./index.ts");

test("foreign fallback identity ignores caller env while current registry retains it; restore does not promote fallback", async () => {
	try {
		const sessions = join(root, "sessions", "fixture");
		mkdirSync(sessions, { recursive: true });
		const sessionFile = join(sessions, "foreign.jsonl");
		writeFileSync(sessionFile, JSON.stringify({ type: "session", version: 3, id: "foreign", cwd: root }) + "\n" + JSON.stringify({ type: "session_info", name: "foreign target" }) + "\n");
		const caller = join(root, "caller.jsonl");
		writeFileSync(caller, JSON.stringify({ type: "session", version: 3, id: "caller", cwd: root }) + "\n");
		const recent = join(root, ".pi", "agent", "fork-panel");
		mkdirSync(recent, { recursive: true });
		writeFileSync(join(recent, "recent.json"), JSON.stringify({ foreign: { sessionFile, panelLabel: "P1", forkId: "foreign-fork", parentSessionFile: join(root, "foreign-parent.jsonl") } }));
		let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
		let calls = 0;
		const messages: string[] = [];
		registerWorkspace({
			on: (_name, _handler) => {}, registerCommand: (_name, options) => { handler = options.handler; },
			sendMessage: (message) => { messages.push(String(message.content)); },
			exec: async (_command, _args) => { calls++; return { code: 0, stdout: `WINDOW\tw\twindow\nTAB\tt\t1\ttrue\ttab\nTERM\tp\t1\tforeign target\t${root}`, stderr: "", killed: false }; },
		} as ExtensionAPI);
		const ctx = { cwd: root, sessionManager: { getSessionFile: () => caller, getSessionName: () => "unrelated caller", getCwd: () => root }, ui: { notify: (_text: string) => {} } } as ExtensionCommandContext;
		await handler("save fixture", ctx);
		const path = messages.at(-1)!.match(/path: (.+)/)![1];
		const snapshot = JSON.parse(readFileSync(path, "utf8"));
		const term = snapshot.tabs[0].terminals[0];
		assert.equal(term.panelLabel, "P1");
		assert.equal(term.forkId, "foreign-fork");
		assert.equal(term.match, "fallback");
		const registry = JSON.parse(readFileSync(join(root, "workspaces", "active-sessions.json"), "utf8"));
		assert.equal(registry.records[0].panelLabel, "P9");
		assert.equal(registry.records[0].forkId, "caller-fork");
		await handler(`restore "${path}" --dry-run`, ctx);
		assert.match(messages.at(-1)!, /추정 fallback/);
		delete term.sessionFile;
		term.match = "none";
		writeFileSync(path, JSON.stringify(snapshot));
		await handler(`restore "${path}"`, ctx);
		assert.match(messages.at(-1)!, /unresolved/);
		assert.match(messages.at(-1)!, /ready 0 \/ blocked 1/);
		assert.equal(calls, 1); // Capture only: neither restore scans/promotes the matching recent session.
	} finally { rmSync(root, { recursive: true, force: true }); }
});
