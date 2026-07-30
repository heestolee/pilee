import assert from "node:assert/strict";
import test from "node:test";

import type { Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";

import { renderAlignedLine } from "./footer.ts";

const theme = {
	fg: (_color: string, text: string) => text,
} as Theme;

const crashRight =
	"● deps ai:backend-trip-ready+ios-pods+mobile-metro+codegen…   MCP 5/5 · 58 tools   압축 [■■□□□□□□□□] 17%";

test("107열 경계에서 footer가 터미널 폭을 넘지 않는다", () => {
	const rendered = renderAlignedLine(theme, 107, "partner-notification-activation", crashRight);

	assert.ok(visibleWidth(rendered) <= 107, `${visibleWidth(rendered)} > 107`);
});

test("모든 좁은 폭에서 footer 출력이 주어진 폭을 넘지 않는다", () => {
	for (let width = 1; width <= 120; width += 1) {
		const rendered = renderAlignedLine(theme, width, "partner-notification-activation", crashRight);
		assert.ok(visibleWidth(rendered) <= width, `width ${width}: ${visibleWidth(rendered)} > ${width}`);
	}
});
