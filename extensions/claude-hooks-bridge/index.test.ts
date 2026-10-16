import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import claudeHooks from "./index.ts";

test("UserPromptSubmit runs for user/explicit command only, with the original request", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi13-hooks-"));
	try {
		const hooks: Record<string, any> = {};
		claudeHooks({ on: (event: string, handler: any) => { hooks[event] = handler; } } as any);
		await mkdir(join(root, ".claude"));
		const output = join(root, "submitted.jsonl");
		const script = join(root, "hook.cjs");
		await writeFile(script, `let text=''; process.stdin.on('data', c => text += c); process.stdin.on('end', () => require('node:fs').appendFileSync(${JSON.stringify(output)}, text));`);
		const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
		await writeFile(join(root, ".claude/settings.json"), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `${quote(process.execPath)} ${quote(script)}` }] }] } }));
		const ctx = { cwd: root, hasUI: false };
		await hooks.before_agent_start({ messageType: "user", prompt: "실제 사용자 요청" }, ctx);
		for (const customType of ["unknown", "worktree-dependency-bootstrap", "pilee-worktree-fork-continuation"]) {
			await hooks.before_agent_start({ messageType: "custom", message: { customType, content: [{ type: "text", text: "internal implementation" }] } }, ctx);
		}
		await hooks.before_agent_start({ messageType: "custom", message: { customType: "pilee-ship-command-shim", content: [{ type: "text", text: "inlined skill noise" }], details: { command: "pr-ship", args: "7" } } }, ctx);
		const submitted = (await readFile(output, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
		assert.deepEqual(submitted.map((entry) => entry.prompt), ["실제 사용자 요청", "/pr-ship 7"]);
		assert.ok(submitted.every((entry) => entry.hook_event_name === "UserPromptSubmit"));
		await hooks.session_shutdown();
	} finally { await rm(root, { recursive: true, force: true }); }
});
