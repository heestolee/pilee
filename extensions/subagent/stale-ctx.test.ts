import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

registerHooks({
	resolve(specifier, context, nextResolve) {
		try {
			return nextResolve(specifier, context);
		} catch (error) {
			if (
				(error as { code?: string }).code === "ERR_MODULE_NOT_FOUND" &&
				specifier.endsWith(".js") &&
				(specifier.startsWith("./") || specifier.startsWith("../"))
			) {
				return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
			}
			throw error;
		}
	},
});

const { createStore } = await import("./store.ts");
const {
	__hasCommandRunsWidgetTimerForTesting,
	cleanupCommandRunsWidgetState,
	isStaleExtensionContextError,
	runIgnoringStaleExtensionContextError,
	updateCommandRunsWidget,
} = await import("./widget.ts");

type SubagentStore = ReturnType<typeof createStore>;
type CommandRunState = SubagentStore["commandRuns"] extends Map<number, infer Run> ? Run : never;
type WidgetRenderCtx = Parameters<typeof updateCommandRunsWidget>[1];

const STALE_MESSAGE =
	"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.switchSession().";

function makeRun(overrides: Partial<CommandRunState> = {}): CommandRunState {
	return {
		id: 1,
		agent: "worker",
		task: "stale ctx smoke",
		status: "running",
		startedAt: Date.now() - 1_000,
		elapsedMs: 1_000,
		toolCalls: 0,
		lastLine: "running",
		turnCount: 0,
		lastActivityAt: Date.now(),
		...overrides,
	} as CommandRunState;
}

function makeStoreWithRun(run: CommandRunState = makeRun()): SubagentStore {
	const store = createStore();
	store.commandRuns.set(run.id, run);
	return store;
}

function makeTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		bg: (_color: string, text: string) => text,
	};
}

test.afterEach(() => {
	cleanupCommandRunsWidgetState(createStore());
});

test("subagent widget recognizes Pi stale extension context errors", () => {
	assert.equal(isStaleExtensionContextError(new Error(STALE_MESSAGE)), true);
	assert.equal(isStaleExtensionContextError(new Error("ordinary failure")), false);
});

test("subagent widget drops stale command ctx and stops spinner timer", () => {
	const store = makeStoreWithRun();
	const widgets = new Map<string, unknown>();
	const activeCtx = {
		hasUI: true,
		ui: {
			setWidget: (key: string, value: unknown) => widgets.set(key, value),
		},
	} satisfies WidgetRenderCtx;

	updateCommandRunsWidget(store, activeCtx);
	assert.equal(store.commandWidgetCtx, activeCtx);
	assert.equal(__hasCommandRunsWidgetTimerForTesting(), true);

	store.commandWidgetCtx = {
		get hasUI() {
			throw new Error(STALE_MESSAGE);
		},
	} as WidgetRenderCtx;

	assert.doesNotThrow(() => updateCommandRunsWidget(store));
	assert.equal(store.commandWidgetCtx, null);
	assert.equal(__hasCommandRunsWidgetTimerForTesting(), false);
});

test("subagent widget render swallows stale ctx access without hiding other failures", () => {
	const store = makeStoreWithRun(
		makeRun({
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 10, turns: 1 },
			model: "openai-codex/gpt-5.5",
		}),
	);
	const widgets = new Map<string, unknown>();
	const activeCtx = {
		hasUI: true,
		ui: {
			setWidget: (key: string, value: unknown) => widgets.set(key, value),
		},
		model: { contextWindow: 100 },
		modelRegistry: {
			getAll: () => {
				throw new Error(STALE_MESSAGE);
			},
		},
	} satisfies WidgetRenderCtx;

	updateCommandRunsWidget(store, activeCtx);
	const factory = widgets.get("sub-1") as (
		tui: unknown,
		theme: ReturnType<typeof makeTheme>,
	) => { render: (width: number) => string[] };
	assert.equal(typeof factory, "function");

	assert.doesNotThrow(() => factory({}, makeTheme()).render(80));
	assert.equal(store.commandWidgetCtx, null);
	assert.equal(__hasCommandRunsWidgetTimerForTesting(), false);
});

test("stale guard swallows stale follow-up sendMessage but rethrows ordinary failures", () => {
	let sendAttempts = 0;
	const staleResult = runIgnoringStaleExtensionContextError(() => {
		sendAttempts += 1;
		throw new Error(STALE_MESSAGE);
	});
	assert.equal(sendAttempts, 1);
	assert.equal(staleResult, false);

	assert.throws(
		() =>
			runIgnoringStaleExtensionContextError(() => {
				throw new Error("ordinary sendMessage failure");
			}),
		/ordinary sendMessage failure/,
	);
});
