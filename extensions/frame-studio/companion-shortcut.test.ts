import assert from "node:assert/strict";
import test from "node:test";
import { registerCompanionToggleShortcut } from "./companion-shortcut.ts";

function createHarness() {
	const shortcuts = new Map<string, any>();
	return {
		shortcuts,
		pi: {
			registerShortcut(key: string, shortcut: any) { shortcuts.set(key, shortcut); },
		},
	};
}

test("Ctrl+Shift+G toggles the companion directly instead of prefilling a command", async () => {
	const harness = createHarness();
	const calls: any[] = [];
	registerCompanionToggleShortcut(harness.pi as any, async (ctx) => {
		calls.push(ctx);
	});

	const shortcut = harness.shortcuts.get("ctrl+shift+g");
	assert.ok(shortcut, "Ctrl+Shift+G companion shortcut should be registered");
	const ctx = {
		ui: {
			setEditorText() {
				throw new Error("Ctrl+Shift+G must not prefill a slash command into the editor");
			},
		},
	};
	await shortcut.handler(ctx);
	assert.deepEqual(calls, [ctx]);
});
