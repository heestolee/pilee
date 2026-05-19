import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import tasksExtension from "./index.ts";

type RegisteredShortcut = { description?: string; handler: (ctx: any) => Promise<void> | void };
type RegisteredCommand = { description?: string; handler: (args: string, ctx: any) => Promise<void> | void };

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	strikethrough: (text: string) => `~~${text}~~`,
};

function createPiHarness() {
	const shortcuts = new Map<string, RegisteredShortcut>();
	const commands = new Map<string, RegisteredCommand>();
	return {
		shortcuts,
		commands,
		pi: {
			registerTool() {},
			registerCommand(name: string, command: RegisteredCommand) {
				commands.set(name, command);
			},
			registerShortcut(key: string, shortcut: RegisteredShortcut) {
				shortcuts.set(key, shortcut);
			},
			on() {},
		},
	};
}

function createGitWorkdir(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pilee-tasks-shortcut-"));
	execFileSync("git", ["init", "--quiet"], { cwd });
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "work-tasks.json"), JSON.stringify({
		nextId: 2,
		tasks: [{
			id: "1",
			subject: "FE 작업 확인",
			description: "",
			status: "pending",
			kind: "slice",
			area: "FE",
			blocks: [],
			blockedBy: [],
			metadata: {},
			createdAt: 1,
			updatedAt: 1,
		}],
	}, null, 2));
	return cwd;
}

function createCtx(cwd: string) {
	const notifications: Array<{ message: string; level?: string }> = [];
	const editorTexts: string[] = [];
	const customCalls: Array<{ doneCalled: boolean }> = [];
	let hideCalls = 0;

	const ctx = {
		cwd,
		hasUI: true,
		sessionManager: {
			getSessionId: () => "test-session",
			getSessionFile: () => join(cwd, "session.jsonl"),
		},
		ui: {
			notify(message: string, level?: string) {
				notifications.push({ message, level });
			},
			setEditorText(text: string) {
				editorTexts.push(text);
			},
			setWidget() {},
			custom(factory: any, _options: any) {
				const record = { doneCalled: false };
				customCalls.push(record);
				const done = () => { record.doneCalled = true; };
				factory({ requestRender() {} }, plainTheme, {}, done);
				_options?.onHandle?.({ hide: () => { hideCalls++; } });
				return _options?.overlayOptions?.nonCapturing ? new Promise<void>(() => {}) : Promise.resolve();
			},
		},
	};
	return {
		ctx,
		notifications,
		editorTexts,
		customCalls,
		get hideCalls() { return hideCalls; },
	};
}

test("Ctrl+Shift+T opens the interactive tasks overlay immediately", async () => {
	const cwd = createGitWorkdir();
	try {
		const harness = createPiHarness();
		tasksExtension(harness.pi as any);

		assert.ok(harness.shortcuts.has("ctrl+shift+t"), "Ctrl+Shift+T should open the interactive tasks overlay");
		const view = createCtx(cwd);
		await harness.shortcuts.get("ctrl+shift+t")!.handler(view.ctx);
		assert.deepEqual(view.editorTexts, [], "Ctrl+Shift+T must not prefill /tasks into the editor");
		assert.equal(view.customCalls.length, 1, "Ctrl+Shift+T should open the tasks overlay directly");
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("Ctrl+Shift+O toggles the passive tasks overlay", async () => {
	const cwd = createGitWorkdir();
	try {
		const harness = createPiHarness();
		tasksExtension(harness.pi as any);

		assert.ok(harness.shortcuts.has("ctrl+shift+o"), "Ctrl+Shift+O should be registered for passive overlay toggle");
		assert.equal(harness.shortcuts.get("ctrl+shift+o")?.description, "Toggle passive tasks work-map overlay");

		const view = createCtx(cwd);
		await harness.shortcuts.get("ctrl+shift+o")!.handler(view.ctx);
		assert.equal(view.customCalls.length, 0, "first toggle hides the currently-shown passive overlay state");
		assert.match(view.notifications.at(-1)?.message ?? "", /숨겼습니다/);

		await harness.shortcuts.get("ctrl+shift+o")!.handler(view.ctx);
		assert.equal(view.customCalls.length, 1, "second toggle shows the passive overlay when tasks exist");
		assert.match(view.notifications.at(-1)?.message ?? "", /표시합니다/);

		await harness.shortcuts.get("ctrl+shift+o")!.handler(view.ctx);
		assert.equal(view.hideCalls, 1, "third toggle hides the existing passive overlay handle");
		assert.equal(view.customCalls[0].doneCalled, true, "hiding should close the passive overlay component");
		assert.match(view.notifications.at(-1)?.message ?? "", /숨겼습니다/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});

test("/tasks show/hide/status uses the same passive overlay visibility state", async () => {
	const cwd = createGitWorkdir();
	try {
		const harness = createPiHarness();
		tasksExtension(harness.pi as any);
		const tasksCommand = harness.commands.get("tasks");
		assert.ok(tasksCommand, "/tasks command should be registered");

		const view = createCtx(cwd);
		await tasksCommand!.handler("hide", view.ctx);
		assert.match(view.notifications.at(-1)?.message ?? "", /숨겼습니다/);

		await tasksCommand!.handler("status", view.ctx);
		assert.match(view.notifications.at(-1)?.message ?? "", /hidden/);

		await tasksCommand!.handler("show", view.ctx);
		assert.match(view.notifications.at(-1)?.message ?? "", /표시합니다/);
		assert.equal(view.customCalls.length, 1, "show should reopen the passive overlay when tasks exist");

		await tasksCommand!.handler("status", view.ctx);
		assert.match(view.notifications.at(-1)?.message ?? "", /shown/);
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
