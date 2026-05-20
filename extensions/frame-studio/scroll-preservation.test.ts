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

function makeState(markdown: string, time = Date.now()) {
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
	};
}

function createFakeBrowser(options: { top: number; viewport: number; height: number; onTimelineRender?: () => void }) {
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
				elements.set(id, {
					id,
					textContent: "",
					className: "",
					set innerHTML(value: string) {
						html = String(value);
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
	const immediate = (fn: () => void) => { fn(); return 0; };
	const factory = new Function("window", "document", "EventSource", "fetch", "setTimeout", "requestAnimationFrame", `${script}\nreturn { render: render, selectTab: selectTab };`);
	return factory(fakeWindow, fakeDocument, EventSource, fetch, immediate, immediate) as { render(state: any, options?: any): void; selectTab(key: string): void };
}

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
	browser.window.pageYOffset = 420;
	browser.document.documentElement.scrollTop = 420;
	browser.document.body.scrollTop = 420;
	resetOnTimelineRender = true;
	studio.render(makeState("# 업데이트된 상태", Date.now() + 1));

	assert.equal(browser.window.pageYOffset, 420);
	assert.equal(browser.window.scrollCalls.at(-1), 420);
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
	browser.window.pageYOffset = 570;
	browser.document.documentElement.scrollTop = 570;
	browser.document.body.scrollTop = 570;
	resetOnTimelineRender = true;
	studio.render(makeState("# 새 하단 상태", Date.now() + 1));

	assert.equal(browser.window.pageYOffset, 1200);
	assert.equal(browser.window.scrollCalls.at(-1), 1200);
});
