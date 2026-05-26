import assert from "node:assert/strict";
import test from "node:test";
import { buildOpenSessionTabScript, buildSessionLaunchCommand } from "./session-open.ts";

test("buildSessionLaunchCommand quotes cwd, env, and session path", () => {
	const command = buildSessionLaunchCommand("/tmp/work dir", "/tmp/session file.jsonl", { PI_FORK_PANEL_LABEL: "P1", EMPTY: undefined });
	assert.match(command, /^cd '\/tmp\/work dir' && /);
	assert.match(command, /PI_FORK_PANEL_LABEL='P1'/);
	assert.match(command, /--session '\/tmp\/session file\.jsonl'/);
});

test("buildOpenSessionTabScript opens Ghostty tab and types session command", () => {
	const script = buildOpenSessionTabScript("/tmp/work", "/tmp/session.jsonl");
	assert.match(script, /keystroke "t" using command down/);
	assert.match(script, /--session '\/tmp\/session\.jsonl'/);
	assert.match(script, /key code 36/);
});