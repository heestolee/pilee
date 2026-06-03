import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import registerPileeUpdate, { createPileeUpdateHandler, parsePileeUpdateArgs } from "./index.ts";

function createCtx() {
	const notifications: Array<{ message: string; level: string }> = [];
	let reloadCount = 0;
	const ctx = {
		ui: {
			notify(message: string, level: string) {
				notifications.push({ message, level });
			},
		},
		reload: async () => {
			reloadCount += 1;
		},
	} as unknown as ExtensionCommandContext;
	return { ctx, notifications, get reloadCount() { return reloadCount; } };
}

test("parsePileeUpdateArgs detects help and no-reload", () => {
	assert.deepEqual(parsePileeUpdateArgs(""), { noReload: false, help: false });
	assert.deepEqual(parsePileeUpdateArgs("--no-reload"), { noReload: true, help: false });
	assert.deepEqual(parsePileeUpdateArgs("help"), { noReload: false, help: true });
	assert.deepEqual(parsePileeUpdateArgs("-h --no-reload"), { noReload: true, help: true });
});

test("pilee-update registers slash command", () => {
	const commands = new Map<string, { description: string; handler: unknown }>();
	registerPileeUpdate({
		registerCommand(name: string, command: { description: string; handler: unknown }) {
			commands.set(name, command);
		},
	} as never);

	assert.ok(commands.has("pilee-update"));
	assert.match(commands.get("pilee-update")?.description ?? "", /update.*reload/);
});

test("pilee-update runs update then reloads current session", async () => {
	const state = createCtx();
	let updateCount = 0;
	const handler = createPileeUpdateHandler(async () => {
		updateCount += 1;
		return { code: 0, stdout: "Updated packages\n", stderr: "" };
	});

	await handler("", state.ctx);

	assert.equal(updateCount, 1);
	assert.equal(state.reloadCount, 1);
	assert.match(state.notifications.at(-1)?.message ?? "", /현재 세션을 reload합니다/);
	assert.equal(state.notifications.at(-1)?.level, "success");
});

test("pilee-update can skip reload", async () => {
	const state = createCtx();
	const handler = createPileeUpdateHandler(async () => ({ code: 0, stdout: "Updated packages\n", stderr: "" }));

	await handler("--no-reload", state.ctx);

	assert.equal(state.reloadCount, 0);
	assert.match(state.notifications.at(-1)?.message ?? "", /reload는 생략/);
});

test("pilee-update does not reload after update failure", async () => {
	const state = createCtx();
	const handler = createPileeUpdateHandler(async () => ({ code: 1, stdout: "", stderr: "network failed" }));

	await handler("", state.ctx);

	assert.equal(state.reloadCount, 0);
	assert.equal(state.notifications.at(-1)?.level, "error");
	assert.match(state.notifications.at(-1)?.message ?? "", /network failed/);
});
