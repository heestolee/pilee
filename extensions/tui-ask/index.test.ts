import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
import { TuiAskOverlay } from "./index.ts";

const PRODUCT_PRIMARY_FG = "\x1b[38;2;0;189;173m";
const GRAPHITE_CARD_BG = "\x1b[48;2;238;240;242m";
const GRAPHITE_SELECTED_BG = "\x1b[48;2;217;240;238m";

test("tui_ask renders product-primary graphite card styling without exceeding width", () => {
	const overlay = new TuiAskOverlay({} as Theme, {
		title: "ASK 스타일 확인",
		question: "밝은 배경과 product primary accent가 적용되어야 한다.",
		options: ["첫 번째 선택지", "두 번째 선택지"],
		multiSelect: false,
		allowText: true,
		placeholder: "직접 입력",
		defaultSelectedIndices: [],
		done: () => undefined,
	});

	const lines = overlay.render(72);

	assert.ok(lines.some((line) => line.includes(GRAPHITE_CARD_BG)), "card background should be applied");
	assert.ok(lines.some((line) => line.includes(GRAPHITE_SELECTED_BG)), "selected row background should be applied");
	assert.ok(lines.some((line) => line.includes(PRODUCT_PRIMARY_FG)), "product primary accent should be applied");
	for (const line of lines) {
		assert.equal(visibleWidth(line), 72);
	}
});
