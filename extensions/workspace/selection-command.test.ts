import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const root = mkdtempSync(join(tmpdir(), "workspace-selection-command-"));
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = root;
process.env.TERM_PROGRAM = "test-host";
const { default: registerWorkspace, parseWorkspaceArgs } = await import("./index.ts");

test("list --all numbers are session-scoped frozen references; completion and explicit path avoid numeric drift", async () => {
	try {
		const snapshots = join(root, "workspaces", "snapshots");
		mkdirSync(snapshots, { recursive: true });
		const sessionFile = join(root, "target.jsonl");
		writeFileSync(sessionFile, JSON.stringify({ type: "session", version: 3, id: "target", cwd: root }) + "\n");
		const snapshot = (id: string, updatedAt: number, name = id) => ({
			version: 1, host: "ghostty", source: id.startsWith("autosave-") ? "auto" : "manual", id, name, createdAt: 1, updatedAt,
			window: { id: "window", name: "window" }, tabs: [{ id: "tab", index: 1, name: "tab", selected: true,
				terminals: [{ id: "panel", index: 1, name: "target", cwd: root, sessionFile, match: "active" }] }],
		});
		const save = (id: string, updatedAt: number, name = id) => {
			const path = join(snapshots, `${id}.json`);
			writeFileSync(path, JSON.stringify(snapshot(id, updatedAt, name)));
			return path;
		};
		for (let index = 1; index <= 18; index++) save(`autosave-20260101T00${String(index).padStart(2, "0")}00`, index);
		const messages: string[] = [];
		const notices: string[] = [];
		let calls = 0;
		let handler!: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
		let complete!: (prefix: string) => Promise<Array<{ value: string }> | null>;
		registerWorkspace({
			on: (_name, _handler) => {}, registerCommand: (_name, options) => { handler = options.handler; complete = async (prefix) => options.getArgumentCompletions!(prefix); },
			sendMessage: (message) => { messages.push(String(message.content)); },
			exec: async (_command, _args): ReturnType<ExtensionAPI["exec"]> => { calls++; throw new Error("host must not run"); },
		} as ExtensionAPI);
		const ctx = { cwd: root, sessionManager: { getSessionFile: () => join(root, "caller.jsonl") }, ui: { notify: (text: string) => { notices.push(text); } } } as ExtensionCommandContext;
		await handler("restore 15 --dry-run", ctx);
		assert.match(notices.at(-1)!, /먼저 \/workspace list/);
		await handler("list --all", ctx);
		const chosenId = messages.at(-1)!.match(/15\. .*\((autosave-\w+)\)/)![1];
		const bytes = readFileSync(join(snapshots, `${chosenId}.json`));
		save("new-top", 1000);
		await handler("restore 15 --dry-run", ctx);
		assert.ok(messages.at(-1)!.includes(`(${chosenId})`));
		const pinnedPath = messages.at(-1)!.match(/pinned source: (.+)/)![1];
		assert.deepEqual(readFileSync(pinnedPath), bytes);
		const other = { ...ctx, sessionManager: { getSessionFile: () => join(root, "other.jsonl") } } as ExtensionCommandContext;
		await handler("restore 15 --dry-run", other);
		assert.match(notices.at(-1)!, /먼저 \/workspace list/);
		await handler("restore --dry-run", ctx);
		assert.match(notices.at(-1)!, /대상을 지정/);
		const completions = (await complete("restore "))!;
		assert.ok(completions.length > 0);
		assert.ok(completions.every((item) => parseWorkspaceArgs(item.value).target!.startsWith(snapshots)));
		save(chosenId, 9999, "replaced alias");
		await handler("restore 15 --dry-run", ctx);
		assert.match(notices.at(-1)!, /stale snapshot/);
		assert.deepEqual(readFileSync(pinnedPath), bytes);
		unlinkSync(join(snapshots, `${chosenId}.json`));
		await handler("restore --all 15 --dry-run", ctx);
		assert.match(notices.at(-1)!, /stale snapshot/);
		const original = join(root, "preserved source.json");
		writeFileSync(original, bytes);
		await handler(`restore "${original}" --dry-run`, ctx);
		assert.ok(messages.at(-1)!.includes(`(${chosenId})`));
		assert.deepEqual(readFileSync(original), bytes);
		save("shared-first", 1, "shared name"); save("shared-second", 2, "shared name");
		await handler("restore shared --dry-run", ctx);
		assert.match(notices.at(-1)!, /여러 snapshot/);
		await handler("restore shared-first --dry-run", ctx);
		assert.ok(messages.at(-1)!.includes("(shared-first)"));
		const blocked = snapshot("blocked", 1);
		blocked.tabs[0].terminals.push({ ...blocked.tabs[0].terminals[0], id: "missing", sessionFile: join(root, "lost.jsonl") });
		writeFileSync(join(snapshots, "blocked.json"), JSON.stringify(blocked));
		await handler("restore blocked --dry-run", ctx);
		assert.match(messages.at(-1)!, /total 2 \/ ready 1 \/ blocked 1/);
		assert.match(messages.at(-1)!, /panel:2:missing/);
		await handler("restore blocked", ctx);
		assert.match(notices.at(-1)!, /전체 preflight BLOCKED/);
		assert.equal(calls, 0);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
