import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildHandsFreeUpdateMessage, summarizeInteractiveResult } from "./notification-utils.ts";

const backgroundUpdate = buildHandsFreeUpdateMessage({
	status: "backgrounded",
	sessionId: "dev-server",
	runtime: 24_000,
	tail: [],
	tailTruncated: false,
	backgroundId: "dev-server",
	userTookOver: false,
});

assert.ok(backgroundUpdate, "backgrounded hands-free update should produce a visible message");
assert.match(backgroundUpdate.content, /moved to background/);
assert.doesNotMatch(backgroundUpdate.content, /user took over/i);
assert.equal(backgroundUpdate.details.status, "backgrounded");
assert.equal(backgroundUpdate.details.backgroundId, "dev-server");

const backgroundSummary = summarizeInteractiveResult("pnpm dev", {
	exitCode: null,
	backgrounded: true,
	backgroundId: "dev-server",
	cancelled: false,
	userTookOver: false,
});

assert.match(backgroundSummary, /running in background/);
assert.doesNotMatch(backgroundSummary, /User took over/i);

const overlaySource = readFileSync(fileURLToPath(new URL("./overlay-component.ts", import.meta.url)), "utf8");
const ctrlBBlock = overlaySource.match(/Ctrl\+B: Quick background[\s\S]*?this\.finishWithBackground\(\);[\s\S]*?return;\n\t\t}/)?.[0];
assert.ok(ctrlBBlock, "Ctrl+B background block should exist");
assert.doesNotMatch(ctrlBBlock, /triggerUserTakeover/, "Ctrl+B background must not emit user takeover");

console.log("interactive-shell background notification regression passed");
