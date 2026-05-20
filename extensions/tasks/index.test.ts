import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import tasksExtension from "./index.ts";

type RegisteredShortcut = { description?: string; handler: (ctx: any) => Promise<void> | void };
type RegisteredCommand = { description?: string; handler: (args: string, ctx: any) => Promise<void> | void };
type RegisteredTool = { name: string; execute: (id: string, params: any, signal: any, onUpdate: any, ctx: any) => Promise<any> | any };

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	strikethrough: (text: string) => `~~${text}~~`,
};

function createPiHarness() {
	const shortcuts = new Map<string, RegisteredShortcut>();
	const commands = new Map<string, RegisteredCommand>();
	const tools = new Map<string, RegisteredTool>();
	return {
		shortcuts,
		commands,
		tools,
		pi: {
			registerTool(tool: RegisteredTool) { tools.set(tool.name, tool); },
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

function createCtx(cwd: string, sessionFile = join(cwd, "session.jsonl")) {
	const notifications: Array<{ message: string; level?: string }> = [];
	const editorTexts: string[] = [];
	const customCalls: Array<{ doneCalled: boolean }> = [];
	let hideCalls = 0;

	const ctx = {
		cwd,
		hasUI: true,
		sessionManager: {
			getSessionId: () => "test-session",
			getSessionFile: () => sessionFile,
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

test("fork-panel child tasks are seeded from parent but saved session-locally", async () => {
	const cwd = createGitWorkdir();
	const parentTasksPath = join(cwd, ".pi", "work-tasks.json");
	const childSession = join(cwd, "child-session.jsonl");
	writeFileSync(childSession, `${JSON.stringify({ type: "session", id: "child-session", cwd, parentSession: join(cwd, "parent-session.jsonl") })}\n`);
	const previousLabel = process.env.PI_FORK_PANEL_LABEL;
	const previousForkId = process.env.PI_FORK_ID;
	try {
		process.env.PI_FORK_PANEL_LABEL = "P1";
		process.env.PI_FORK_ID = "child-task-test";

		const harness = createPiHarness();
		tasksExtension(harness.pi as any);
		const childCtx = createCtx(cwd, childSession).ctx;
		const listBefore = await harness.tools.get("TaskList")!.execute("list", {}, undefined, undefined, childCtx);
		assert.match(listBefore.content[0].text, /FE 작업 확인/, "child should inherit the parent task board as an initial seed");
		assert.notEqual(listBefore.details.tasksPath, parentTasksPath, "child task store must not be the parent worktree file");
		assert.equal(existsSync(listBefore.details.tasksPath), false, "seed reads must not eagerly create a child task file");

		await harness.tools.get("TaskCreate")!.execute("create", {
			subject: "P1 전용 조사",
			description: "자식 패널에서만 추적할 작업",
			area: "pilee",
			source: "user",
		}, undefined, undefined, childCtx);

		const parentStoreText = readFileSync(parentTasksPath, "utf8");
		const childStoreText = readFileSync(listBefore.details.tasksPath, "utf8");
		assert.doesNotMatch(parentStoreText, /P1 전용 조사/, "child-created tasks must not be written back to the parent board");
		assert.match(childStoreText, /FE 작업 확인/, "child local board keeps the inherited parent snapshot");
		assert.match(childStoreText, /P1 전용 조사/, "child-created task is stored in the child-local board");
	} finally {
		if (previousLabel === undefined) delete process.env.PI_FORK_PANEL_LABEL;
		else process.env.PI_FORK_PANEL_LABEL = previousLabel;
		if (previousForkId === undefined) delete process.env.PI_FORK_ID;
		else process.env.PI_FORK_ID = previousForkId;
		rmSync(cwd, { recursive: true, force: true });
	}
});
