import assert from "node:assert/strict";
import test from "node:test";
import { buildPageHtml } from "./index.ts";

interface FakeWindow {
	pageYOffset: number;
	innerHeight: number;
	scrollCalls: number[];
	scrollTo(x: number, y: number): void;
}

interface FakeDocument {
	documentElement: any;
	body: any;
	getElementById(id: string): any;
	querySelectorAll(selector: string): any[];
	addEventListener(): void;
}

function extractInlineScript(html: string): string {
	const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
	assert.ok(scripts.length > 0, "inline script should exist");
	return scripts.join("\n");
}

function makeState(markdown: string, time = Date.now(), overrides: Record<string, unknown> = {}) {
	return {
		title: "TFT Studio scroll test",
		identity: { mode: "session", displayTitle: "Scroll test" },
		status: "running",
		step: "step",
		activeTab: "frame",
		tabs: { frame: { markdown, step: "step", updatedAt: time } },
		workContext: undefined,
		timeline: [{ id: String(time), time, kind: "update", tab: "frame", step: "step", markdown }],
		logs: [],
		...overrides,
	};
}

function makeQuestion(id: string, time = Date.now()) {
	return {
		id,
		tab: "frame",
		question: "다음 단계는 무엇인가요?",
		markdown: "## 선택대기 섹션\n\n- 현재 맥락\n- 선택 후 달라지는 것",
		options: ["계속 진행", "잠시 멈춤"],
		multiSelect: false,
		allowText: true,
		placeholder: "직접 입력",
		createdAt: time,
	};
}

function createFakeBrowser(options: { top: number; viewport: number; height: number; onElementRender?: (id: string, value: string) => void; onTimelineRender?: () => void }) {
	const elements = new Map<string, any>();
	const fakeWindow: FakeWindow = {
		pageYOffset: options.top,
		innerHeight: options.viewport,
		scrollCalls: [],
		scrollTo(_x: number, y: number) {
			this.pageYOffset = y;
			fakeDocument.documentElement.scrollTop = y;
			fakeDocument.body.scrollTop = y;
			this.scrollCalls.push(y);
		},
	};
	const fakeDocument: FakeDocument = {
		documentElement: { scrollTop: options.top, scrollHeight: options.height, offsetHeight: options.height, clientHeight: options.viewport },
		body: { scrollTop: options.top, scrollHeight: options.height, offsetHeight: options.height },
		getElementById(id: string) {
			if (!elements.has(id)) {
				let html = "";
				let text = "";
				elements.set(id, {
					id,
					className: "",
					set textContent(value: string) {
						text = String(value);
						options.onElementRender?.(id, text);
					},
					get textContent() { return text; },
					set innerHTML(value: string) {
						html = String(value);
						options.onElementRender?.(id, html);
						if (id === "timeline" && options.onTimelineRender) options.onTimelineRender();
					},
					get innerHTML() { return html; },
				});
			}
			return elements.get(id);
		},
		querySelectorAll() { return []; },
		addEventListener() {},
	};
	return { window: fakeWindow, document: fakeDocument };
}

function loadStudioScript(fakeWindow: FakeWindow, fakeDocument: FakeDocument) {
	const script = extractInlineScript(buildPageHtml());
	const EventSource = function EventSource(this: any) { this.close = () => {}; };
	const fetch = () => Promise.reject(new Error("initial state disabled in test"));
	const timerQueue: Array<() => void> = [];
	const queueTimer = (fn: () => void) => { timerQueue.push(fn); return timerQueue.length; };
	function flushTimers(limit = 100) {
		let count = 0;
		while (timerQueue.length) {
			const next = timerQueue.shift();
			if (next) next();
			count += 1;
			if (count > limit) throw new Error("Timer queue did not settle");
		}
	}
	const factory = new Function("window", "document", "EventSource", "fetch", "setTimeout", "requestAnimationFrame", `${script}\nreturn { render: render, selectTab: selectTab, renderArchitectureFlowElement: renderArchitectureFlowElement, renderBackendLayerVisualElement: renderBackendLayerVisualElement };`);
	return { ...(factory(fakeWindow, fakeDocument, EventSource, fetch, queueTimer, queueTimer) as { render(state: any, options?: any): void; selectTab(key: string): void; renderArchitectureFlowElement(el: any, spec: any): void; renderBackendLayerVisualElement(el: any, spec: any): void }), flushTimers };
}

function extractArchNodeBoxes(html: string) {
	return [...html.matchAll(/<article class="arch-node[^"]*" style="[^"]*top:(\d+)px;[^"]*min-height:(\d+)px"/g)]
		.map((match) => ({ top: Number(match[1]), height: Number(match[2]), bottom: Number(match[1]) + Number(match[2]) }))
		.sort((a, b) => a.top - b.top);
}

function extractArchLabelRects(html: string) {
	return [...html.matchAll(/<rect class="arch-edge-label-bg" x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)"/g)]
		.map((match) => ({ x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) }));
}

test("Backend layer visual keeps contract before the short learning helper", () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = { id: "layer-contract-learning-test", className: "", innerHTML: "" };

	studio.renderBackendLayerVisualElement(element, {
		kind: "backend-layer-map",
		layers: [
			{
				layer: "application_flow",
				title: "Existing approval usecase",
				requirements: ["R2", "R3"],
				responsibilities: ["전체 승인/승인 버튼이 기존 승인 흐름을 재사용하는지 확인"],
				evidence: ["기존 approve action 호출 diff", "신규 bulk endpoint 없음"],
				frontendAnalogy: "프론트의 submit handler + 여러 hook/API call 조합",
				whyHere: "승인은 사용자 행동 단위의 업무 흐름이기 때문",
				ifWrong: "화면마다 승인 조건이 흩어져 회귀가 생김",
			},
		],
	});

	const contractIndex = element.innerHTML.indexOf("Contract · 책임");
	const learningIndex = element.innerHTML.indexOf("Learning · 짧은 보조 설명");
	assert.ok(contractIndex >= 0, "contract layer should render");
	assert.ok(learningIndex > contractIndex, "learning helper should be after contract layer");
	assert.match(element.innerHTML, /프론트 비유/);
	assert.match(element.innerHTML, /신규 bulk endpoint 없음/);
});

test("Architecture flow keeps variable-height nodes in the same lane from overlapping", () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = {
		id: "arch-overlap-test",
		className: "",
		innerHTML: "",
	};

	studio.renderArchitectureFlowElement(element, {
		kind: "architecture-flow",
		lanes: ["DB"],
		nodes: [
			{
				id: "large-table",
				lane: "DB",
				row: 0,
				type: "table",
				title: "Large canonical table",
				description: "source-of-truth table with enough columns to be taller than the next card",
				badges: ["source-of-truth"],
				columns: [
					{ name: "id", badges: ["PK"] },
					{ name: "parent_id", badges: ["FK"], references: "parent.id" },
					{ name: "media_id", badges: ["FK"], references: "media.id" },
					{ name: "payload", badges: ["JSON"] },
					{ name: "sort_order" },
					{ name: "is_main" },
				],
			},
			{ id: "small-table", lane: "DB", row: 1, type: "table", title: "Small lookup table", columns: [{ name: "id", badges: ["PK"] }] },
			{
				id: "another-large-table",
				lane: "DB",
				row: 2,
				type: "table",
				title: "Another tall table",
				columns: [
					{ name: "id", badges: ["PK"] },
					{ name: "request_id", badges: ["FK"] },
					{ name: "payload", badges: ["JSON"] },
					{ name: "status" },
				],
			},
		],
		edges: [],
	});

	const boxes = extractArchNodeBoxes(element.innerHTML);
	assert.equal(boxes.length, 3);
	for (let index = 0; index < boxes.length - 1; index++) {
		assert.ok(boxes[index].bottom < boxes[index + 1].top, `node ${index} should end before node ${index + 1} starts`);
	}
});

test("Architecture flow auto layout switches wide lane maps to vertical with label pills", () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = { id: "arch-auto-layout-test", className: "", innerHTML: "" };
	const lanes = ["Jira", "FE Mobile", "Shared UI", "Existing Backend", "FE Desktop", "Widget", "Verification"];

	studio.renderArchitectureFlowElement(element, {
		kind: "architecture-flow",
		lanes,
		nodes: lanes.map((lane, index) => ({
			id: `node-${index}`,
			lane,
			type: index === 3 ? "resolver" : "screen",
			title: `${lane} node with a title long enough to need safe wrapping`,
			description: "긴 설명이 있어도 카드가 canvas 경계에 잘리지 않고 edge label은 pill로 보입니다.",
			badges: [`R${index + 1}`],
		})),
		edges: [
			{ from: "node-1", to: "node-2", label: "재사용" },
			{ from: "node-2", to: "node-3", label: "기존 boundary" },
			{ from: "node-5", to: "node-6", label: "캡처" },
		],
	});

	assert.match(element.innerHTML, /세로 자동 배치/);
	assert.match(element.innerHTML, /class="arch-lane down"/);
	assert.match(element.innerHTML, /arch-edge-label-bg/);
	assert.doesNotMatch(element.innerHTML, / C[\d. -]+ C/);
});

test("Architecture flow horizontal routing keeps edge labels below cards", () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = { id: "arch-horizontal-routing-test", className: "", innerHTML: "" };

	studio.renderArchitectureFlowElement(element, {
		kind: "architecture-flow",
		direction: "RIGHT",
		lanes: ["UI", "Action", "Verification"],
		nodes: [
			{ id: "ui", lane: "UI", type: "screen", title: "Mobile cards", description: "사용자가 보는 카드", requirements: ["R1"], responsibility: "카드와 버튼 노출", evidence: ["375px 캡처"], frontendAnalogy: "프론트 컴포넌트" },
			{ id: "action", lane: "Action", type: "service", title: "Existing approval action", description: "기존 action boundary", requirements: ["R2"], responsibility: "기존 action 재사용", evidence: ["action wiring diff"], frontendAnalogy: "submit handler" },
			{ id: "verify", lane: "Verification", type: "review", title: "Capture evidence", description: "캡처 증거", requirements: ["R3"], responsibility: "PASS 증거 수집", evidence: ["캡처 리포트"], frontendAnalogy: "QA 체크리스트" },
		],
		edges: [
			{ from: "ui", to: "action", label: "기존 action" },
			{ from: "action", to: "verify", label: "캡처" },
		],
	});

	const nodeBottom = Math.max(...extractArchNodeBoxes(element.innerHTML).map((box) => box.bottom));
	const labelRects = extractArchLabelRects(element.innerHTML);
	assert.equal(labelRects.length, 2);
	assert.ok(labelRects.every((rect) => rect.y > nodeBottom), "edge labels should be placed in the bottom bus, below node cards");
	assert.match(element.innerHTML, /stroke-linejoin="round"/);
	assert.ok(element.innerHTML.indexOf("Contract · 책임") < element.innerHTML.indexOf("프론트 비유"), "architecture node contract should appear before learning text");
});

test("TFT Studio state update preserves the reader's current scroll offset", () => {
	let resetOnTimelineRender = false;
	const browser = createFakeBrowser({
		top: 420,
		viewport: 600,
		height: 3000,
		onTimelineRender: () => {
			if (!resetOnTimelineRender) return;
			browser.window.pageYOffset = 0;
			browser.document.documentElement.scrollTop = 0;
			browser.document.body.scrollTop = 0;
		},
	});
	const studio = loadStudioScript(browser.window, browser.document);

	studio.render(makeState("# 처음 상태"));
	studio.flushTimers();
	browser.window.pageYOffset = 420;
	browser.document.documentElement.scrollTop = 420;
	browser.document.body.scrollTop = 420;
	resetOnTimelineRender = true;
	studio.render(makeState("# 업데이트된 상태", Date.now() + 1));
	studio.flushTimers();

	assert.equal(browser.window.pageYOffset, 420);
	assert.equal(browser.window.scrollCalls.at(-1), 420);
});

test("TFT Studio preserves scroll when non-question sections are appended", () => {
	const sectionCases = [
		{
			name: "answer card",
			state: makeState("# 답변 이후 상태", Date.now() + 1, {
				timeline: [
					{ id: "u1", time: Date.now(), kind: "update", tab: "frame", step: "step", markdown: "# 처음 상태" },
					{ id: "a1", time: Date.now() + 1, kind: "answer", tab: "frame", step: "step", answer: { status: "answered", questionId: "q1", question: "다음 단계는 무엇인가요?", selectedIndices: [0], selectedOptions: ["계속 진행"], submittedAt: Date.now() + 1 } },
				],
			}),
		},
		{
			name: "work context and logs",
			state: makeState("# 작업 맥락 갱신", Date.now() + 2, {
				workContext: { mode: "worktree", goal: "스크롤 보존", currentSlice: { id: "S1", title: "렌더 안정화", scope: ["extensions/frame-studio"] }, openQuestions: [], verifyFocus: ["scroll"] },
				logs: [{ time: Date.now() + 2, message: "Work context refreshed." }],
			}),
		},
		{
			name: "additional update block",
			state: makeState("# 두 번째 업데이트\n\n새 섹션이 추가됩니다.", Date.now() + 3, {
				timeline: [
					{ id: "u1", time: Date.now(), kind: "update", tab: "frame", step: "step", markdown: "# 처음 상태" },
					{ id: "u2", time: Date.now() + 3, kind: "update", tab: "frame", step: "step", markdown: "# 두 번째 업데이트\n\n새 섹션이 추가됩니다." },
				],
			}),
		},
	];

	for (const item of sectionCases) {
		let resetOnTimelineRender = false;
		const browser = createFakeBrowser({
			top: 640,
			viewport: 600,
			height: 3200,
			onTimelineRender: () => {
				if (!resetOnTimelineRender) return;
				browser.window.pageYOffset = 0;
				browser.document.documentElement.scrollTop = 0;
				browser.document.body.scrollTop = 0;
			},
		});
		const studio = loadStudioScript(browser.window, browser.document);

		studio.render(makeState(`# initial ${item.name}`));
		studio.flushTimers();
		browser.window.pageYOffset = 640;
		browser.document.documentElement.scrollTop = 640;
		browser.document.body.scrollTop = 640;
		resetOnTimelineRender = true;
		studio.render(item.state);
		studio.flushTimers();

		assert.equal(browser.window.pageYOffset, 640, item.name);
		assert.equal(browser.window.scrollCalls.at(-1), 640, item.name);
	}
});

test("TFT Studio preserves scroll when header/status/log/workContext sections mutate independently", () => {
	let resetOnElementRender = false;
	const resetIds = new Set(["title", "meta", "tabs", "workContext", "flowTitle", "flowSubtitle", "flowStatus", "logs"]);
	const browser = createFakeBrowser({
		top: 510,
		viewport: 600,
		height: 3300,
		onElementRender: (id) => {
			if (!resetOnElementRender || !resetIds.has(id)) return;
			browser.window.pageYOffset = 0;
			browser.document.documentElement.scrollTop = 0;
			browser.document.body.scrollTop = 0;
		},
	});
	const studio = loadStudioScript(browser.window, browser.document);

	studio.render(makeState("# 헤더 갱신 전"));
	studio.flushTimers();
	browser.window.pageYOffset = 510;
	browser.document.documentElement.scrollTop = 510;
	browser.document.body.scrollTop = 510;
	resetOnElementRender = true;
	studio.render(makeState("# 헤더와 보조 섹션 갱신", Date.now() + 4, {
		title: "TFT Studio scroll test updated",
		status: "awaiting",
		question: makeQuestion("q-header", Date.now() + 4),
		workContext: { mode: "worktree", goal: "보조 섹션 스크롤 보존", currentSlice: { id: "S2", title: "header/status/log/workContext sections", scope: ["extensions/frame-studio"] }, openQuestions: [{ id: "Q1", text: "질문", owner: "user" }], verifyFocus: ["header", "status", "logs"] },
		logs: [{ time: Date.now() + 4, message: "Header/status/log/workContext sections refreshed." }],
	}));
	studio.flushTimers();

	assert.equal(browser.window.pageYOffset, 510);
	assert.equal(browser.window.scrollCalls.at(-1), 510);
});

test("TFT Studio preserves scroll when a pending question section is appended", () => {
	let resetOnTimelineRender = false;
	const question = makeQuestion("q1", Date.now() + 1);
	const browser = createFakeBrowser({
		top: 720,
		viewport: 600,
		height: 3400,
		onTimelineRender: () => {
			if (!resetOnTimelineRender) return;
			browser.window.pageYOffset = 0;
			browser.document.documentElement.scrollTop = 0;
			browser.document.body.scrollTop = 0;
		},
	});
	const studio = loadStudioScript(browser.window, browser.document);

	studio.render(makeState("# 질문 전 상태"));
	studio.flushTimers();
	browser.window.pageYOffset = 720;
	browser.document.documentElement.scrollTop = 720;
	browser.document.body.scrollTop = 720;
	resetOnTimelineRender = true;
	studio.render(makeState(question.markdown, Date.now() + 1, {
		status: "awaiting",
		question,
		timeline: [
			{ id: "u1", time: Date.now(), kind: "update", tab: "frame", step: "step", markdown: "# 질문 전 상태" },
			{ id: "q1", time: Date.now() + 1, kind: "question", tab: "frame", step: "step", markdown: question.markdown, question },
		],
	}));
	studio.flushTimers();

	assert.equal(browser.window.pageYOffset, 720);
	assert.equal(browser.window.scrollCalls.at(-1), 720);
});

test("TFT Studio keeps following the bottom only when the reader was already near the bottom", () => {
	let resetOnTimelineRender = false;
	const browser = createFakeBrowser({
		top: 570,
		viewport: 600,
		height: 1200,
		onTimelineRender: () => {
			if (!resetOnTimelineRender) return;
			browser.document.documentElement.scrollHeight = 1800;
			browser.document.body.scrollHeight = 1800;
			browser.document.documentElement.offsetHeight = 1800;
			browser.document.body.offsetHeight = 1800;
			browser.window.pageYOffset = 0;
			browser.document.documentElement.scrollTop = 0;
			browser.document.body.scrollTop = 0;
		},
	});
	const studio = loadStudioScript(browser.window, browser.document);

	studio.render(makeState("# 처음 상태"));
	studio.flushTimers();
	browser.window.pageYOffset = 570;
	browser.document.documentElement.scrollTop = 570;
	browser.document.body.scrollTop = 570;
	resetOnTimelineRender = true;
	studio.render(makeState("# 새 하단 상태", Date.now() + 1));
	studio.flushTimers();

	assert.equal(browser.window.pageYOffset, 1200);
	assert.equal(browser.window.scrollCalls.at(-1), 1200);
});
