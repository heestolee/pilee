import assert from "node:assert/strict";
import test from "node:test";
import * as Host from "@mariozechner/pi-coding-agent";
import register from "./index.ts";

test("renderer patches the exact host classes and discards foreign prototype originals", async () => {
	const Mode = Reflect.get(Host, "InteractiveMode");
	const Tool = Reflect.get(Host, "ToolExecutionComponent");
	assert.equal(typeof Mode, "function");
	const key = Symbol.for("pilee.tool-group-renderer.patch-state");
	const globals = globalThis as Record<symbol, any>;
	const oldState = globals[key];
	const proto = Mode.prototype;
	const originals = { handleEvent: proto.handleEvent, renderSessionContext: proto.renderSessionContext, addMessageToChat: proto.addMessageToChat };
	const foreign = () => { throw new Error("foreign runtime must never own this prototype"); };
	globals[key] = { originals: { handleEvent: foreign, renderSessionContext: foreign, addMessageToChat: foreign } };
	const hooks = new Map<string, Function>();
	try {
		await register({ on: (name: string, hook: Function) => hooks.set(name, hook) } as any);
		assert.equal(proto.handleEvent.name, "handleEventPatched");
		assert.equal(globals[key].prototype, proto);
		assert.equal(globals[key].toolExecutionComponent, Tool);
		assert.equal(globals[key].originals.handleEvent, originals.handleEvent);
		await hooks.get("session_start")?.({}, { hasUI: true, ui: { theme: { fg: (_: string, s: string) => s, bg: (_: string, s: string) => s, bold: (s: string) => s } } });
		await register({ on: (name: string, hook: Function) => hooks.set(name, hook) } as any);
		assert.equal(globals[key].originals.handleEvent, originals.handleEvent, "reload must not layer patches or retain another host's originals");
	} finally {
		Object.assign(proto, originals);
		if (oldState === undefined) delete globals[key]; else globals[key] = oldState;
	}
});
