import assert from "node:assert/strict";
import test from "node:test";
import {
	buildOpenSessionScript,
	buildRepanelScript,
	chooseNewPanelPlacement,
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

test("chooseNewPanelPlacement asks every run and excludes current-panel fallback", async () => {
	const seen: string[][] = [];
	const ctx = {
		hasUI: true,
		ui: {
			async select(_title: string, choices: string[]) {
				seen.push(choices);
				return "새 탭";
			},
		},
	} as any;
	assert.equal(await chooseNewPanelPlacement(ctx), "tab");
	assert.deepEqual(seen[0]?.slice(0, 2), ["오른쪽 분할 패널", "새 탭"]);
	assert.equal(seen[0]?.some((choice) => choice.includes("현재 패널")), false);
	assert.equal(await chooseNewPanelPlacement({ ...ctx, hasUI: false }), null);
});

test("buildOpenSessionScript launches the exact cwd and session and returns terminal id", () => {
	for (const target of ["tab" as const, splitPlacementFromDirections(["right"])]) {
		const script = buildOpenSessionScript(target, "/tmp/work dir", "/tmp/exact session.jsonl", {
			PI_WORKSPACE_ACTIVATION_FILE: "/tmp/activation.json",
		});
		assert.match(script, /cd '\/tmp\/work dir'/);
		assert.match(script, /--session '\/tmp\/exact session\.jsonl'/);
		assert.match(script, /PI_WORKSPACE_ACTIVATION_FILE='\/tmp\/activation\.json'/);
		assert.match(script, /return id of newTerm/);
	}
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
