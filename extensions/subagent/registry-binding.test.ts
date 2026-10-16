import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { nativeProviderFixture } from "../prompt-suggest-lite/native-provider.fixture.ts";
import type { CommandRunState } from "./types.ts";

registerHooks({ resolve(specifier, context, next) {
	try { return next(specifier, context); } catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" && /^\.\.?\//.test(specifier) && specifier.endsWith(".js")) return next(specifier.slice(0, -3) + ".ts", context);
		throw error;
	}
} });
const { refreshDisplayTaskInBackground } = await import("./tool-execute.ts");
const { createStore } = await import("./store.ts");
const { buildSubagentDisplayTaskFallback } = await import("./display-task.ts");

test("background display summary keeps the actual host registry receiver and run identity", async () => {
	const fixture = await nativeProviderFixture("호스트 호환 검증");
	const getAuth = fixture.registry.getApiKeyAndHeaders;
	let authOk: boolean | undefined;
	fixture.registry.getApiKeyAndHeaders = async function (model) {
		const auth = await getAuth.call(this, model);
		authOk = auth.ok;
		return auth;
	};
	const store = createStore();
	const run: CommandRunState = { id: 1, agent: "worker", task: "read /tmp/fixture and follow the instructions", displayTask: "follow instructions", startedAt: 42, lastActivityAt: 42, lastLine: "", status: "running", toolCalls: 0, elapsedMs: 0, turnCount: 1 };
	refreshDisplayTaskInBackground(run, run.task, { cwd: ".", model: fixture.model, modelRegistry: fixture.registry, sessionManager: { getEntries: () => [] } }, store);
	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.equal(fixture.calls.length, 1, "native summary must use the original host provider registry");
	assert.equal(run.displayTask, "호스트 호환 검증");
	assert.equal(run.id, 1);
	assert.equal(run.startedAt, 42);
	assert.equal(run.task, "read /tmp/fixture and follow the instructions");
	assert.equal(run.status, "running");
});

test("background auth failure is quiet and retains the existing display fallback", async () => {
	const fixture = await nativeProviderFixture("unused", false);
	const task = "read /tmp/fixture and follow instructions";
	const fallback = buildSubagentDisplayTaskFallback(task);
	const run: CommandRunState = { id: 2, agent: "worker", task, displayTask: fallback, startedAt: 43, lastActivityAt: 43, lastLine: "", status: "running", toolCalls: 0, elapsedMs: 0, turnCount: 1 };
	refreshDisplayTaskInBackground(run, run.task, { cwd: ".", model: fixture.model, modelRegistry: fixture.registry, sessionManager: { getEntries: () => [] } }, createStore());
	await new Promise((resolve) => setTimeout(resolve, 30));
	assert.equal(run.displayTask, fallback);
	assert.equal(fixture.calls.length, 0);
});
