import assert from "node:assert/strict";
import test from "node:test";
import {
	buildRepanelScript,
	parsePanelTargetRequest,
	parseSplitPlacementArgs,
	splitPlacementFromDirections,
} from "./index.ts";

test("parsePanelTargetRequest treats leading directions as anchor path and preserves prompt", () => {
	const parsed = parsePanelTargetRequest("right down 화면 비교해줘");
	assert.deepEqual(parsed.target, { anchorPath: ["right"], splitDirection: "down" });
	assert.equal(parsed.prompt, "화면 비교해줘");
});

test("parsePanelTargetRequest defaults to right split and preserves non-direction prompt", () => {
	const parsed = parsePanelTargetRequest("이 작업을 이어서 봐줘");
	assert.deepEqual(parsed.target, { anchorPath: [], splitDirection: "right" });
	assert.equal(parsed.prompt, "이 작업을 이어서 봐줘");
});

test("parseSplitPlacementArgs accepts repanel anchor-path syntax only", () => {
	assert.deepEqual(parseSplitPlacementArgs("right down"), { anchorPath: ["right"], splitDirection: "down" });
	assert.deepEqual(parseSplitPlacementArgs("down"), { anchorPath: [], splitDirection: "down" });
	assert.equal(parseSplitPlacementArgs("right later"), null);
});

test("buildRepanelScript resolves anchor before closing current terminal", () => {
	const script = buildRepanelScript(
		splitPlacementFromDirections(["right", "down"]),
		"/tmp/example",
		"/tmp/session.jsonl",
		{},
		"old-terminal-id",
	);

	const navigationIndex = script.indexOf('perform action "goto_split:right"');
	const closeIndex = script.indexOf("close oldTerm");
	const splitIndex = script.indexOf("split anchorTerm direction down");

	assert.ok(navigationIndex > -1, "script should navigate to the right anchor");
	assert.ok(closeIndex > navigationIndex, "script must not close the current terminal before anchor resolution");
	assert.ok(script.includes("set anchorTerm to first terminal whose id is anchorId"));
	assert.ok(splitIndex > closeIndex, "script should split the resolved anchor after closing the old terminal");
});
