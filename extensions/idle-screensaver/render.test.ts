import assert from "node:assert/strict";
import test from "node:test";
import { visibleWidth } from "@mariozechner/pi-tui";
import { renderScreensaver, shouldDismissScreensaver, wrapTextToWidth, type ScreensaverTheme } from "./render.ts";

const plainTheme: ScreensaverTheme = {
	fg: (_color, text) => text,
	bold: (text) => text,
};

function rowContentStart(line: string): number {
	const body = line.slice(1, -1);
	const index = body.search(/\S/);
	return index < 0 ? -1 : index;
}

test("screensaver content block is centered within the full overlay width", () => {
	const lines = renderScreensaver(140, 32, {
		title: "Implement Screensaver",
		subtitle: "main",
		metaLines: ["🕘 마지막 인터랙션 05/19 23:56 · 24초 전"],
		assistantText: "짧은 마지막 응답",
		spriteLines: null,
		spritePokemonName: null,
	}, plainTheme);
	assert.equal(lines.length, 32);
	for (const line of lines) assert.ok(visibleWidth(line) <= 140, `line overflow: ${visibleWidth(line)}`);
	const titleLine = lines.find((line) => line.includes("I m p l e m e n t"));
	assert.ok(titleLine, "title line should render");
	assert.ok(rowContentStart(titleLine) >= 38, `title should be centered inside centered content box: ${titleLine}`);
});

test("assistant summary wraps to at most five content lines instead of one-line truncation", () => {
	const text = "고쳤어. 핵심은 마지막 인터랙션 시간을 runtime fallback이 아니라 세션 transcript 기준으로 계산하게 바꾼 거야. entries를 먼저 보고 없으면 session JSONL을 뒤에서부터 읽고, 그래도 없을 때만 fallback을 써. 그래서 screensaver show 입력 시간이 마지막 대화를 덮지 않아.";
	const wrapped = wrapTextToWidth(text, 34, 5);
	assert.ok(wrapped.length > 1, "long assistant text should wrap");
	assert.ok(wrapped.length <= 5, "assistant text should stay within five lines");
	for (const line of wrapped) assert.ok(visibleWidth(line) <= 34, `wrapped line overflow: ${line}`);

	const rendered = renderScreensaver(92, 34, {
		title: "Implement Screensaver",
		subtitle: "",
		metaLines: [],
		assistantText: text,
		spriteLines: null,
		spritePokemonName: null,
	}, plainTheme).join("\n");
	assert.ok(rendered.includes("💬 마지막 응답"));
	assert.ok(rendered.includes("runtime fallback"));
});

test("dismiss contract accepts normal keys and escape sequences", () => {
	assert.equal(shouldDismissScreensaver("q"), true);
	assert.equal(shouldDismissScreensaver(" "), true);
	assert.equal(shouldDismissScreensaver("\r"), true);
	assert.equal(shouldDismissScreensaver("\u001b"), true);
	assert.equal(shouldDismissScreensaver("\u001b[<0;10;10M"), true);
	assert.equal(shouldDismissScreensaver(""), false);
});
