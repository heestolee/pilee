import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { readProcessStarts, readRegistrations, removeRegistration, writeRegistration } from "./registry.ts";
import { listSnapshots } from "./store.ts";

const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-identity-command-")));
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = root;
process.env.TERM_PROGRAM = "test-host";
process.env.PI_FORK_PANEL_LABEL = "P9";
process.env.PI_FORK_ID = "caller-fork";
process.env.PI_FORK_PARENT = join(root, "caller-parent.jsonl");
const { default: registerWorkspace } = await import("./index.ts");
const environment = { platform: "darwin", termProgram: "ghostty", stdinTTY: true, stdoutTTY: true };

test("save uses registered exact identities, never caller metadata or recent-session fallback for another panel", async () => {
	const hooks = new Map<string, Function>();
	try {
		const file = (name: string) => {
			const path = join(root, `${name}.jsonl`);
			writeFileSync(path, JSON.stringify({ type: "session", version: 3, id: "same-header", cwd: root }) + "\n");
			return path;
		};
		const caller = file("caller"); const foreign = file("foreign");
		let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
		const messages: string[] = []; const notices: string[] = []; const titles: string[] = [];
		let calls = 0;
		registerWorkspace({
			on: (name, handler) => { hooks.set(name, handler); }, registerCommand: (_name, options) => { handler = options.handler; },
			sendMessage: (message) => { messages.push(String(message.content)); },
			exec: async (_command, args) => {
				calls++;
				return { code: 0, stdout: args[1].includes("repeat with targetWindow in windows") ? "window\tcaller" :
					`WINDOW\twindow\twindow\nTAB\ttab\t1\ttrue\ttab\nTERM\tcaller\t1\tsame\t${root}\nTERM\tforeign\t2\tsame\t${root}`, stderr: "", killed: false };
			},
		} as ExtensionAPI, environment);
		const ctx = { mode: "tui", hasUI: true, cwd: root,
			sessionManager: { getSessionFile: () => caller, getSessionName: () => "same", getCwd: () => root },
			ui: { notify: (text: string) => { notices.push(text); }, setTitle: (title: string) => { titles.push(title); } },
		} as ExtensionCommandContext;
		await hooks.get("session_start")!({ reason: "startup" }, ctx);
		assert.equal(calls, 1); // Registration only, not an initial autosave.
		assert.doesNotMatch(titles.at(-1)!, /\[pilee:/);
		writeRegistration(join(root, "workspaces"), {
			version: 1, pid: process.pid, processStartedAt: readProcessStarts([process.pid]).get(process.pid)!, processToken: "aaa", generation: "foreign", updatedAt: 1,
			sessionFile: foreign, cwd: root, title: "same", panelLabel: "P1", forkId: "foreign-fork",
			binding: { windowId: "window", terminalId: "foreign" },
		});
		await handler("save fixture", ctx);
		const path = messages.at(-1)!.match(/path: (.+)/)![1];
		const snapshot = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(snapshot.complete, true);
		assert.deepEqual(snapshot.tabs[0].terminals.map((term: { panelLabel: string; match: string; sessionFile: string }) => [term.panelLabel, term.match, term.sessionFile]), [
			["P9", "exact", caller], ["P1", "exact", foreign],
		]);
		const foreignRecord = readRegistrations(join(root, "workspaces")).find((item) => item.generation === "foreign")!;
		removeRegistration(join(root, "workspaces"), foreignRecord);
		writeFileSync(join(root, "workspaces", "active-sessions.json"), JSON.stringify({ records: [{ ...foreignRecord, updatedAt: Date.now() }] }));
		await handler("save incomplete", ctx);
		assert.match(notices.at(-1)!, /panel 2.*정확한 live binding 없음/s);
		assert.equal(listSnapshots(join(root, "workspaces")).length, 1);
		const before = calls;
		await handler(`restore "${path}" --dry-run`, ctx);
		assert.match(messages.at(-1)!, /ready 2 \/ blocked 0/);
		assert.equal(calls, before);
		await handler("help", ctx);
		assert.doesNotMatch(notices.at(-1)!, /--all|leader|30~60/);
	} finally { await hooks.get("session_shutdown")?.({ reason: "quit" }); rmSync(root, { recursive: true, force: true }); }
});
