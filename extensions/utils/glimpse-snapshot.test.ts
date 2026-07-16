import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { captureGlimpseHtmlPng, patchDarwinWebViewShortcutSupport, setGlimpseOpenForTests, type GlimpseOpen, type GlimpseWindow } from "./glimpse.ts";

test("Glimpse macOS host patch adds a native WKWebView snapshot command", () => {
	const require = createRequire(import.meta.url);
	const glimpseEntry = require.resolve("glimpseui");
	const source = readFileSync(join(dirname(glimpseEntry), "glimpse.swift"), "utf-8");
	const patched = patchDarwinWebViewShortcutSupport(source);
	assert.ok(patched);
	assert.match(patched, /case "snapshot":/);
	assert.match(patched, /WKSnapshotConfiguration\(\)/);
	assert.match(patched, /webView\.takeSnapshot/);
	assert.match(patched, /data:image\/png;base64,/);
});

test("captureGlimpseHtmlPng requests a bounded snapshot and returns its PNG response", async () => {
	const listeners = new Map<string, Array<(data?: any) => void>>();
	const commands: Record<string, unknown>[] = [];
	let closeCount = 0;
	const emit = (event: string, data?: unknown) => {
		for (const listener of listeners.get(event) || []) listener(data);
	};
	const fakeWindow: GlimpseWindow = {
		on(event, handler) {
			const current = listeners.get(event) || [];
			current.push(handler as (data?: unknown) => void);
			listeners.set(event, current);
		},
		close() { closeCount += 1; },
		_write(message) {
			commands.push(message);
			if (message.type === "resize") queueMicrotask(() => emit("message", { type: "tft-visual-ready", width: message.width, height: message.height }));
			if (message.type === "snapshot") {
				queueMicrotask(() => emit("message", {
					type: "snapshot",
					requestId: message.requestId,
					width: 800,
					height: 600,
					pixelWidth: 1600,
					pixelHeight: 1200,
					dataUrl: "data:image/png;base64,iVBORw0KGgo=",
				}));
			}
		},
	};
	const fakeOpen: GlimpseOpen = () => {
		queueMicrotask(() => emit("message", { type: "tft-visual-ready", width: 800, height: 600 }));
		return fakeWindow;
	};
	setGlimpseOpenForTests(fakeOpen);
	try {
		const result = await captureGlimpseHtmlPng("<!doctype html>", { timeoutMs: 2_000 });
		assert.equal(result.width, 800);
		assert.equal(result.height, 600);
		assert.equal(result.pixelWidth, 1600);
		assert.match(result.dataUrl, /^data:image\/png;base64,/);
		assert.equal(commands.length, 2);
		assert.deepEqual(commands[0], { type: "resize", width: 800, height: 600 });
		assert.deepEqual(commands[1], { type: "snapshot", requestId: commands[1]?.requestId, x: 0, y: 0, width: 800, height: 600, pixelWidth: 1600 });
		assert.equal(closeCount, 1);
	} finally {
		setGlimpseOpenForTests(undefined);
	}
});
