import assert from "node:assert/strict";
import test from "node:test";
import type { Theme } from "@mariozechner/pi-coding-agent";
import { visibleWidth } from "@mariozechner/pi-tui";
import tuiAsk, { TuiAskOverlay } from "./index.ts";
import { EventEmitter } from "node:events";

test("canonical 승인 화면과 host action은 같은 선택을 나타낸다", async () => {
	const events = new EventEmitter(), receipts: any[] = [];
	let tool: any;
	tuiAsk({ events, registerTool: (value: any) => { tool = value; } } as any);
	events.on("pilee:tui-commit-decision", (value) => receipts.push(value));
	for (const [key, expected] of [["1", "approve-single-commit"], ["2", "split"], ["3", "deny"], ["q", undefined]]) {
		const result = await tool.execute("choice", { question: "에이전트 자유 질문", title: "에이전트 제목", approval: { kind: "single-commit", command: "git commit -m target" } }, undefined, undefined, {
			cwd: "/synthetic", hasUI: true, ui: { custom: (factory: any) => new Promise((done) => {
				const overlay = factory({}, {}, {}, done);
				const rendered = overlay.render(100).join("\n");
				assert.match(rendered, /단일 커밋 승인/); assert.match(rendered, /git commit -m target/);
				assert.match(rendered, /push 제외/); assert.match(rendered, /대신 파일별로 분리/);
				assert.doesNotMatch(rendered, /에이전트 자유 질문|에이전트 제목/);
				overlay.handleInput(key);
			}) },
		});
		assert.equal(receipts.at(-1).action, expected);
		assert.deepEqual(receipts.at(-1).details, result.details);
	}
});

test("generic 질문의 단일 커밋 라벨/복수선택/자유텍스트와 no-UI fallback은 호환되며 승인하지 않는다", async () => {
	const events = new EventEmitter(); let receipts = 0; let tool: any;
	tuiAsk({ events, registerTool: (value: any) => { tool = value; } } as any);
	events.on("pilee:tui-commit-decision", () => receipts++);
	for (const mode of ["single", "multi", "text", "unavailable"]) {
		const params = { question: "일반 질문", options: ["단일 커밋 대신 분리", "다음"], multiSelect: mode === "multi", allowText: mode === "text" };
		const result = await tool.execute("generic", params, undefined, undefined, { cwd: "/synthetic", hasUI: mode !== "unavailable", ui: { custom: (factory: any) => new Promise((done) => {
			const overlay = factory({}, {}, {}, done);
			assert.match(overlay.render(100).join("\n"), /일반 질문/);
			if (mode === "text") { overlay.handleInput("i"); overlay.handleInput("hello"); overlay.handleInput("\r"); }
			else { overlay.handleInput("1"); if (mode === "multi") overlay.handleInput("\r"); }
		}) } });
		assert.equal(result.details.status, mode === "unavailable" ? "unavailable" : "submitted");
		if (mode === "text") assert.equal(result.details.text, "hello");
		else if (mode !== "unavailable") assert.deepEqual(result.details.selectedIndices, [1]);
	}
	assert.equal(receipts, 0);
});

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
