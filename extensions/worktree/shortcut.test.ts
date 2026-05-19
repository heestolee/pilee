import assert from "node:assert/strict";
import test from "node:test";
import { registerWorktreeDashboardShortcut } from "./shortcut.ts";

function createHarness() {
	const shortcuts = new Map<string, any>();
	return {
		shortcuts,
		pi: {
			registerShortcut(key: string, shortcut: any) { shortcuts.set(key, shortcut); },
		},
	};
}

test("Ctrl+W runs the worktree dashboard handler immediately", async () => {
	const harness = createHarness();
	const calls: any[] = [];
	registerWorktreeDashboardShortcut(harness.pi as any, async (ctx) => {
		calls.push(ctx);
	});

	const shortcut = harness.shortcuts.get("ctrl+w");
	assert.ok(shortcut, "Ctrl+W worktree shortcut should be registered");
	assert.equal(shortcut.description, "Worktree dashboard");
	const ctx = {
		ui: {
			setEditorText() {
				throw new Error("Ctrl+W must not prefill /wt switch into the editor");
			},
		},
	};
	await shortcut.handler(ctx);
	assert.deepEqual(calls, [ctx]);
});
