import assert from "node:assert/strict";
import test from "node:test";
import shortcutAtlasExtension from "./index.ts";

const plainTheme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function createHarness() {
	const commands = new Map<string, any>();
	return {
		commands,
		pi: {
			registerCommand(name: string, command: any) { commands.set(name, command); },
		},
	};
}

test("/shortcuts command renders the atlas with Ctrl+Shift+O and conflict summary", async () => {
	const harness = createHarness();
	shortcutAtlasExtension(harness.pi as any);
	const command = harness.commands.get("shortcuts");
	assert.ok(command, "/shortcuts command should be registered");
	assert.equal(command.description.includes("단축키 atlas"), true);

	let rendered = "";
	const ctx = {
		ui: {
			custom(factory: any) {
				const component = factory({ requestRender() {} }, plainTheme, {}, () => {});
				rendered = component.render(120, 28).join("\n");
				return Promise.resolve();
			},
		},
	};
	await command.handler("custom", ctx);
	assert.match(rendered, /Shortcut Atlas/);
	assert.match(rendered, /ctrl\+shift\+o/);
	assert.match(rendered, /우상단 tasks work-map overlay show\/hide/);
	assert.match(rendered, /source scan/);
});

test("/shortcuts render still shows rows when Pi passes only width", async () => {
	const harness = createHarness();
	shortcutAtlasExtension(harness.pi as any);
	const command = harness.commands.get("shortcuts");
	assert.ok(command, "/shortcuts command should be registered");

	let rendered = "";
	const ctx = {
		ui: {
			custom(factory: any) {
				const component = factory({ requestRender() {}, terminal: { rows: 16 } }, plainTheme, {}, () => {});
				// Pi custom components can call render(width) without a height argument.
				rendered = component.render(120).join("\n");
				return Promise.resolve();
			},
		},
	};
	await command.handler("custom", ctx);
	assert.match(rendered, /Shortcut Atlas/);
	assert.match(rendered, /ctrl\+shift\+o/);
	assert.match(rendered, /우상단 tasks work-map overlay show\/hide/);
});
