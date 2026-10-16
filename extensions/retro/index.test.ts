import assert from "node:assert/strict";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import test, { mock } from "node:test";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

const files = new Map<string, string>();
const writes: string[] = [];
const oldReport = process.env.RETRO_REPORT_DIR;
const oldUpload = process.env.RETRO_UPLOAD_SCRIPT;
process.env.RETRO_REPORT_DIR = "/fixture/reports";
process.env.RETRO_UPLOAD_SCRIPT = "/fixture/upload.py";
mock.method(fs, "existsSync", (path: string) => files.has(String(path)));
mock.method(fs, "readFileSync", (path: string) => files.get(String(path)) || "");
mock.method(fs, "mkdirSync", () => undefined);
mock.method(fs, "writeFileSync", (path: string, data: string) => { files.set(String(path), data); writes.push(String(path)); });
syncBuiltinESMExports();
mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ results: [{ id: "fixture-page", properties: { title: { type: "title", title: [{ plain_text: "테스트 회고" }] } } }] }) }));
const { default: retro } = await import("./index.ts");
if (oldReport === undefined) delete process.env.RETRO_REPORT_DIR; else process.env.RETRO_REPORT_DIR = oldReport;
if (oldUpload === undefined) delete process.env.RETRO_UPLOAD_SCRIPT; else process.env.RETRO_UPLOAD_SCRIPT = oldUpload;
test.after(() => { mock.restoreAll(); syncBuiltinESMExports(); });

type Handler = (event: unknown) => Promise<void> | void;
function harness(uploadCode = 0) {
	files.clear(); writes.length = 0;
	files.set(join("/fixture/reports", "daily-retrospective", "2026-01-01.md"), "원본 회고");
	const events = new Map<string, Set<Handler>>();
	let command: (args: string, ctx: ExtensionCommandContext) => Promise<void>;
	const prompts: string[] = [];
	const uploads: string[][] = [];
	const notices: string[] = [];
	const pi = {
		registerCommand: (_name: string, definition: { handler: typeof command }) => { command = definition.handler; },
		on: (name: string, handler: Handler) => { const handlers = events.get(name) || new Set<Handler>(); handlers.add(handler); events.set(name, handlers); return () => { handlers.delete(handler); }; },
		sendUserMessage: (text: string) => { prompts.push(text); },
		exec: async (_command: string, args: string[]) => { uploads.push(args); return { code: uploadCode, stderr: "fixture failure" }; },
	} as unknown as ExtensionAPI;
	retro(pi);
	const ctx = { ui: { notify: (text: string) => { notices.push(text); } } } as ExtensionCommandContext;
	return { events, prompts, uploads, notices, command: (args: string) => command!(args, ctx), emit: async (name: string, event: unknown = {}) => { for (const handler of [...(events.get(name) || [])]) await handler(event); } };
}
const finalEvent = { message: { role: "assistant", content: [{ type: "text", text: "---RETRO_START---\n교정된 회고\n---RETRO_END---" }] } };

test("retro save consumes once, unsubscribes before upload, and writes through existing cache/upload flow", async () => {
	const h = harness();
	await h.command("2026-01-01");
	await h.command("save");
	const listener = [...h.events.get("message_end")!][0];
	await h.command("save");
	assert.equal(h.prompts.length, 2, "duplicate save does not queue another generation");
	assert.equal(h.events.get("message_end")!.size, 1);
	await Promise.all([listener(finalEvent), listener(finalEvent)]);
	assert.equal(h.events.get("message_end")!.size, 0);
	assert.equal(h.uploads.length, 1);
	assert.equal(writes.length, 2);
	assert.equal(files.get("/fixture/reports/daily-retrospective/2026-01-01.md"), "교정된 회고");
	assert.deepEqual(h.uploads[0].slice(0, 4), ["/fixture/upload.py", "upsert", "--title", "테스트 회고"]);
	assert.ok(h.notices.some((text) => text.includes("Notion 반영 완료")));
});

test("retro ignores non-final messages and idempotent shutdown/start cleanup cancels pending save", async () => {
	const h = harness();
	await h.command("2026-01-01"); await h.command("save");
	const listener = [...h.events.get("message_end")!][0];
	await listener({ message: { role: "user", content: finalEvent.message.content } });
	await listener({ message: { role: "assistant", content: [{ type: "text", text: "---RETRO_START---incomplete" }] } });
	assert.equal(h.uploads.length, 0);
	await h.emit("session_shutdown"); await h.emit("session_shutdown");
	await listener(finalEvent);
	assert.equal(h.uploads.length, 0);
	await h.command("save"); await h.emit("session_start");
	assert.equal(h.events.get("message_end")!.size, 0);
});

test("retro failed upload releases save guard for an explicit retry", async () => {
	const h = harness(1);
	await h.command("2026-01-01"); await h.command("save"); await h.emit("message_end", finalEvent);
	assert.equal(h.uploads.length, 1);
	await h.command("save");
	assert.equal(h.events.get("message_end")!.size, 1);
	assert.ok(h.notices.some((text) => text.includes("Notion 반영 실패")));
	await h.emit("session_shutdown");
});
