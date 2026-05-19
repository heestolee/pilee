import assert from "node:assert/strict";
import { platform } from "node:os";
import test from "node:test";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	__resetCompanionWindowStateForTesting,
	__setCompanionWindowOpenForTesting,
	openCompanionHtml,
	openCompanionUrl,
	toggleCompanionWindow,
} from "./companion-window.ts";

class FakeWindow {
	closed = false;
	closeCount = 0;
	writes: Record<string, unknown>[] = [];
	htmlWrites: string[] = [];
	showCalls: Array<{ title?: string }> = [];
	private handlers = new Map<string, Array<() => void>>();

	on(event: "closed" | "message" | "ready", handler: () => void): void {
		const list = this.handlers.get(event) ?? [];
		list.push(handler);
		this.handlers.set(event, list);
	}

	close(): void {
		this.closeCount += 1;
		this.closed = true;
		for (const handler of this.handlers.get("closed") ?? []) handler();
	}

	setHTML(html: string): void {
		this.htmlWrites.push(html);
	}

	show(options?: { title?: string }): void {
		this.showCalls.push(options ?? {});
	}

	_write(message: Record<string, unknown>): void {
		this.writes.push(message);
	}
}

type OpenCall = { html: string; opts: Record<string, unknown>; window: FakeWindow };

function makePi(execResult?: { code: number; stdout: string; stderr?: string }) {
	const execCalls: Array<{ command: string; args: string[]; options?: Record<string, unknown> }> = [];
	const pi = {
		exec: async (command: string, args: string[], options?: Record<string, unknown>) => {
			execCalls.push({ command, args, options });
			return execResult ?? { code: 0, stdout: '{"x":10,"y":20,"width":2000,"height":1000}', stderr: "" };
		},
	} as unknown as ExtensionAPI;
	return { pi, execCalls };
}

function makeCtx(sessionFile = "/tmp/pilee-companion-test.jsonl") {
	return {
		cwd: "/tmp/pilee-companion-cwd",
		sessionManager: {
			getSessionFile: () => sessionFile,
		},
	} as any;
}

function installFakeOpen(calls: OpenCall[]) {
	__setCompanionWindowOpenForTesting((html, opts) => {
		const win = new FakeWindow();
		calls.push({ html, opts, window: win });
		return win as any;
	});
}

test.afterEach(() => {
	__resetCompanionWindowStateForTesting();
});

test("같은 Pi session에서는 companion 창을 새로 만들지 않고 기존 창을 갱신한다", async () => {
	const calls: OpenCall[] = [];
	installFakeOpen(calls);
	const { pi, execCalls } = makePi();
	const ctx = makeCtx();

	const first = await openCompanionHtml(pi, ctx, "<h1>first</h1>", "첫 창", { width: 900, height: 700 });
	assert.equal(first.mode, "glimpse");
	assert.equal(calls.length, 1);
	assert.equal(first.key, "session:/tmp/pilee-companion-test.jsonl");
	assert.equal(calls[0].opts.title, "첫 창");
	assert.equal(calls[0].opts.openLinks, true);
	if (platform() === "darwin") {
		assert.equal(execCalls.length, 1);
		assert.equal(calls[0].opts.width, 1000);
		assert.equal(calls[0].opts.height, 1000);
		assert.equal(calls[0].opts.x, 1010);
		assert.equal(calls[0].opts.y, 20);
	} else {
		assert.equal(execCalls.length, 0);
		assert.equal(calls[0].opts.width, 900);
		assert.equal(calls[0].opts.height, 700);
	}

	const second = await openCompanionHtml(pi, ctx, "<h1>second</h1>", "둘째 창", { width: 900, height: 700 });
	assert.equal(second.mode, "reused");
	assert.equal(calls.length, 1);
	assert.equal(second.window, first.window);
	assert.deepEqual(calls[0].window.htmlWrites, ["<h1>second</h1>"]);
	assert.equal(calls[0].window.showCalls.at(-1)?.title, "둘째 창");
	assert.equal(calls[0].window.writes.at(-2)?.type, "bounds");
	assert.equal(calls[0].window.writes.at(-1)?.type, "resize");
});

test("toggle은 기존 companion을 숨기고 마지막 HTML로 다시 연다", async () => {
	const calls: OpenCall[] = [];
	installFakeOpen(calls);
	const { pi } = makePi();
	const ctx = makeCtx();

	await openCompanionHtml(pi, ctx, "<h1>saved</h1>", "저장된 창", { openLinks: false });
	const hidden = await toggleCompanionWindow(pi, ctx);
	assert.equal(hidden.mode, "hidden");
	assert.equal(hidden.title, "저장된 창");
	assert.equal(calls[0].window.closed, true);
	assert.equal(calls[0].window.closeCount, 1);

	const shown = await toggleCompanionWindow(pi, ctx);
	assert.equal(shown.mode, "shown");
	assert.equal(calls.length, 2);
	assert.equal(calls[1].html, "<h1>saved</h1>");
	assert.equal(calls[1].opts.title, "저장된 창");
	assert.equal(calls[1].opts.openLinks, false);
});

test("저장된 companion이 없으면 toggle은 missing을 반환하고 url open은 redirect shell을 저장한다", async () => {
	const calls: OpenCall[] = [];
	installFakeOpen(calls);
	const { pi } = makePi({ code: 1, stdout: "", stderr: "no screen" });
	const ctx = makeCtx("");

	const missing = await toggleCompanionWindow(pi, ctx);
	assert.equal(missing.mode, "missing");
	assert.equal(missing.key, "cwd:/tmp/pilee-companion-cwd");

	const opened = await openCompanionUrl(pi, ctx, "http://127.0.0.1:1234/?q=1", "URL <창>", { width: 777, height: 555 });
	assert.equal(opened.mode, "glimpse");
	assert.equal(calls[0].html.includes("window.location.replace"), true);
	assert.equal(calls[0].html.includes("http://127.0.0.1:1234/?q=1"), true);
	assert.equal(calls[0].html.includes("URL &lt;창&gt;"), true);
	assert.equal(calls[0].opts.width, 777);
	assert.equal(calls[0].opts.height, 555);
});
