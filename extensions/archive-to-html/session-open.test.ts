import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildOpenSessionTabScript, buildSessionLaunchCommand, openArchiveSessionHere, resolveSessionHeaderCwd } from "./session-open.ts";
import type { ExtensionCommandContext, ReplacedSessionContext } from "@mariozechner/pi-coding-agent";

test("buildSessionLaunchCommand quotes cwd, env, and session path", () => {
	const command = buildSessionLaunchCommand("/tmp/work dir", "/tmp/session file.jsonl", { PI_FORK_PANEL_LABEL: "P1", EMPTY: undefined });
	assert.match(command, /^cd '\/tmp\/work dir' && /);
	assert.match(command, /PI_FORK_PANEL_LABEL='P1'/);
	assert.match(command, /--session '\/tmp\/session file\.jsonl'/);
});

test("buildOpenSessionTabScript opens Ghostty tab and types session command", () => {
	const script = buildOpenSessionTabScript("/tmp/work", "/tmp/session.jsonl");
	assert.match(script, /keystroke "t" using command down/);
	assert.match(script, /--session '\/tmp\/session\.jsonl'/);
	assert.match(script, /key code 36/);
});

async function fixture(run: (file: string, cwd: string, raw: string) => Promise<void>) {
	const cwd = mkdtempSync(join(fileURLToPath(new URL(".", import.meta.url)), ".pi13-resume-"));
	const file = join(cwd, "session.jsonl");
	const raw = JSON.stringify({ type: "session", version: 3, id: "source", cwd }) + "\n";
	writeFileSync(file, raw);
	try { await run(file, cwd, raw); } finally { rmSync(cwd, { recursive: true, force: true }); }
}

test("same-header resume uses only supported options and notifies through fresh context", async () => {
	await fixture(async (file, cwd, raw) => {
		const notices: string[] = [];
		const ctx = { switchSession: async (source, options) => {
			assert.equal(source, file);
			assert.deepEqual(Object.keys(options!), ["withSession"]);
			await options?.withSession?.({ cwd, ui: { notify: (text: string) => notices.push(text) } } as ReplacedSessionContext);
			return { cancelled: false };
		} } satisfies Pick<ExtensionCommandContext, "switchSession">;
		assert.deepEqual(await openArchiveSessionHere(ctx, file, cwd, "원본"), { cancelled: false });
		assert.equal(notices.length, 1);
		assert.equal(readFileSync(file, "utf8"), raw);
	});
});

test("missing/header-mismatched cwd blocks before switch without rewriting source", async () => {
	await fixture(async (file, cwd, raw) => {
		let switches = 0;
		const ctx = { switchSession: async () => { switches++; return { cancelled: false }; } };
		await assert.rejects(openArchiveSessionHere(ctx, file, fileURLToPath(new URL(".", import.meta.url)), "불일치"), /cwd가 달라/);
		assert.equal(switches, 0);
		assert.equal(readFileSync(file, "utf8"), raw);
		const missing = raw.replace(JSON.stringify(cwd), JSON.stringify(join(cwd, "deleted")));
		writeFileSync(file, missing);
		assert.throws(() => resolveSessionHeaderCwd(file), /cwd override를 지원하지 않아/);
		await assert.rejects(openArchiveSessionHere(ctx, file, cwd, "없음"), /cwd override/);
		assert.equal(switches, 0);
		assert.equal(readFileSync(file, "utf8"), missing);
	});
});

test("cancelled or wrong-context resume never announces success", async () => {
	await fixture(async (file, cwd) => {
		const cancelled = { switchSession: async () => ({ cancelled: true }) };
		assert.deepEqual(await openArchiveSessionHere(cancelled, file, cwd, "취소"), { cancelled: true });
		const notices: string[] = [];
		const ctx = { switchSession: async (_source, options) => {
			await options?.withSession?.({ cwd: fileURLToPath(new URL(".", import.meta.url)), ui: { notify: (text: string) => notices.push(text) } } as ReplacedSessionContext);
			return { cancelled: false };
		} } satisfies Pick<ExtensionCommandContext, "switchSession">;
		await assert.rejects(openArchiveSessionHere(ctx, file, cwd, "잘못된 경로"), /성공으로 처리하지 않았습니다/);
		assert.equal(notices.length, 0);
	});
});