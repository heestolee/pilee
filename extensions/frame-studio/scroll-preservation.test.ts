import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildPageHtml } from "./index.ts";

const independentFlowMaster = JSON.parse(readFileSync(new URL("./fixtures/independent-flow-panels.master.json", import.meta.url), "utf-8"));
const dataModelLearningMaster = JSON.parse(readFileSync(new URL("./fixtures/data-model-learning.master.json", import.meta.url), "utf-8"));
const boundedResponsibilityMaster = JSON.parse(readFileSync(new URL("./fixtures/bounded-responsibility-map.master.json", import.meta.url), "utf-8"));

interface FakeWindow {
	pageYOffset: number;
	innerHeight: number;
	scrollCalls: number[];
	scrollTo(x: number, y: number): void;
	addEventListener(type: string, listener: (...args: any[]) => void): void;
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
		addEventListener() {},
	};
	const fakeDocument: FakeDocument = {
		documentElement: { scrollTop: options.top, scrollHeight: options.height, offsetHeight: options.height, clientHeight: options.viewport },
		body: { scrollTop: options.top, scrollHeight: options.height, offsetHeight: options.height, classList: { contains() { return false; } } },
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
	const factory = new Function("window", "document", "EventSource", "fetch", "setTimeout", "requestAnimationFrame", `${script}\nreturn { render: render, selectTab: selectTab, renderTftVisualElement: renderTftVisualElement, renderArchitectureFlowElement: renderArchitectureFlowElement, renderBackendLayerVisualElement: renderBackendLayerVisualElement, renderPhasePanelVisualElement: renderPhasePanelVisualElement, renderIndependentFlowPanelsElement: renderIndependentFlowPanelsElement, renderBoundedResponsibilityMapElement: renderBoundedResponsibilityMapElement, renderDataModelMigrationMapElement: renderDataModelMigrationMapElement };`);
	return { ...(factory(fakeWindow, fakeDocument, EventSource, fetch, queueTimer, queueTimer) as { render(state: any, options?: any): void; selectTab(key: string): void; renderTftVisualElement(el: any): Promise<void>; renderArchitectureFlowElement(el: any, spec: any): void; renderBackendLayerVisualElement(el: any, spec: any): void; renderPhasePanelVisualElement(el: any, spec: any): void; renderIndependentFlowPanelsElement(el: any, spec: any): void; renderBoundedResponsibilityMapElement(el: any, spec: any): void; renderDataModelMigrationMapElement(el: any, spec: any): void }), flushTimers };
}

function makeVisualElement(source: unknown) {
	let rendered = "0";
	return {
		id: "visual-healing-test",
		className: "tft-visual",
		innerHTML: "",
		getAttribute(name: string) {
			if (name === "data-rendered") return rendered;
			if (name === "data-source") return encodeURIComponent(typeof source === "string" ? source : JSON.stringify(source));
			return "";
		},
		setAttribute(name: string, value: string) {
			if (name === "data-rendered") rendered = value;
		},
	};
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

function assertTextOrder(html: string, first: string, second: string, message: string) {
	const firstIndex = html.indexOf(first);
	const secondIndex = html.indexOf(second);
	assert.ok(firstIndex >= 0, `${message}: ${first} should render`);
	assert.ok(secondIndex >= 0, `${message}: ${second} should render`);
	assert.ok(firstIndex < secondIndex, `${message}: ${first} should render before ${second}`);
}

test("TFT visual self-heals nodes/edges shape without requiring a fixed kind", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = makeVisualElement({
		title: "Generic action flow",
		nodes: [
			{ id: "admin", lane: "Admin", type: "screen", title: "Admin action" },
			{ id: "mutation", lane: "Backend", type: "resolver", title: "singleUpdateToUsed" },
		],
		edges: [{ from: "admin", to: "mutation", label: "reuse" }],
	});

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "arch-visual");
	assert.match(element.innerHTML, /Generic action flow/);
	assert.match(element.innerHTML, /자동 보정됨/);
	assert.match(element.innerHTML, /nodes\/edges shape를 architecture-flow로 해석/);
	assert.doesNotMatch(element.innerHTML, /tft-visual-error/);
});

test("TFT visual self-heals nodes/edges shape even when kind points at another renderer", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = makeVisualElement({
		kind: "backend-layer-map",
		title: "Mismatched flow",
		nodes: [
			{ id: "ui", lane: "UI", type: "screen", title: "Admin table" },
			{ id: "be", lane: "BE", type: "service", title: "Existing mutation" },
		],
		edges: [{ from: "ui", to: "be", label: "call" }],
	});

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "arch-visual");
	assert.match(element.innerHTML, /Mismatched flow/);
	assert.match(element.innerHTML, /kind=backend-layer-map이지만 nodes\/edges shape를 architecture-flow로 해석/);
	assert.doesNotMatch(element.innerHTML, /layers 배열이 필요/);
	assert.doesNotMatch(element.innerHTML, /tft-visual-error/);
});

test("bounded-responsibility-map master fixture는 책임 경계·handoff·component·예외를 분리한다", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 700, height: 2400 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = makeVisualElement(boundedResponsibilityMaster);

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "brm-visual");
	assert.equal((element.innerHTML.match(/class="brm-spine-node/g) || []).length, 4);
	assert.equal((element.innerHTML.match(/class="brm-group role-/g) || []).length, 4);
	assert.match(element.innerHTML, /role-source/);
	assert.match(element.innerHTML, /role-delivery/);
	assert.match(element.innerHTML, /role-core/);
	assert.match(element.innerHTML, /role-channel/);
	assert.match(element.innerHTML, /durable event/);
	assert.match(element.innerHTML, /claimed context/);
	assert.match(element.innerHTML, /member-scoped inbox/);
	assert.match(element.innerHTML, /PartnerNotificationService/);
	assert.match(element.innerHTML, /PartnerRecipientResolver/);
	assert.match(element.innerHTML, /PartnerNotificationRepo/);
	assert.match(element.innerHTML, /Future Mobile Adapter/);
	assert.match(element.innerHTML, /brm-component future/);
	assert.match(element.innerHTML, /반드시 지킬 경계/);
	assert.match(element.innerHTML, /세부 책임·검증·Requirement/);
	assert.match(element.innerHTML, /BLOCKED_RECIPIENT/);
	assert.match(element.innerHTML, /예외·운영 branch · 정상 handoff와 분리/);
	assert.doesNotMatch(element.innerHTML, /layer-rail|phase-stage-label|1\. Source Event Boundary/);
});

test("bounded-responsibility-map은 legacy layers와 잘못된 handoff를 숨기지 않고 진단한다", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 700, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = makeVisualElement({
		kind: "bounded-responsibility-map",
		groups: [
			{ id: "source", title: "Source", role: "source", components: [{ title: "Publisher" }] },
			{ id: "core", title: "Core", role: "core", components: [{ title: "Service" }] },
		],
		handoffs: [{ from: "source", to: "missing", label: "invalid" }],
		layers: [{ id: "legacy" }],
	});

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "tft-visual");
	assert.match(element.innerHTML, /bounded-responsibility-map 검증 실패/);
	assert.match(element.innerHTML, /layers는 이 kind에서 사용하지 않습니다/);
	assert.match(element.innerHTML, /handoff가 존재하지 않는 group을 참조/);
});

test("independent-flow-panels master fixture는 실행 패널·annotation·command를 명시적 영역으로 분리한다", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 700, height: 2200 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = makeVisualElement(independentFlowMaster);

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "ifp-visual");
	assert.equal((element.innerHTML.match(/class="ifp-panel"/g) || []).length, 2);
	assert.match(element.innerHTML, /A\. 알림 적재/);
	assert.match(element.innerHTML, /B\. 사용자 조회/);
	assert.match(element.innerHTML, /Purpose/);
	assert.match(element.innerHTML, /Trigger/);
	assert.match(element.innerHTML, /Source transaction/);
	assert.match(element.innerHTML, /비동기 전달/);
	assert.match(element.innerHTML, /class="ifp-stage parallel"/);
	assert.match(element.innerHTML, /병렬 결과/);
	assert.match(element.innerHTML, /class="ifp-stage alternatives"/);
	assert.match(element.innerHTML, /대안 분기/);
	assert.match(element.innerHTML, /목록 page SELECT/);
	assert.match(element.innerHTML, /최근 100건 badge SELECT/);
	assert.match(element.innerHTML, /예외 · 복구 경로/);
	assert.match(element.innerHTML, /↻ 재진입 · PENDING event claim/);
	assert.match(element.innerHTML, /Contract · 반드시 지킬 조건/);
	assert.match(element.innerHTML, /Learning · 이 구조를 읽는 핵심/);
	assert.match(element.innerHTML, /데이터 조건 · 실행 호출 아님/);
	assert.match(element.innerHTML, /Partner commit은 B에서 보이기 위한 데이터 조건/);
	assert.match(element.innerHTML, /별도 상태 변경 명령 · 위 조회선의 후속 단계가 아님/);
	assert.match(element.innerHTML, />readAll</);
	assert.doesNotMatch(element.innerHTML, /phase-stage-label|placeholder|렌더링 포맷 자동 치유/);
});

test("independent-flow-panels는 세 패널과 선택 annotation 부재를 placeholder 없이 처리한다", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 700, height: 2200 });
	const studio = loadStudioScript(browser.window, browser.document);
	const panels = ["수집", "처리", "조회"].map((title, index) => ({
		id: `panel-${index + 1}`,
		title,
		stages: [{ id: `stage-${index + 1}`, title: `${title} 단계`, steps: [{ id: `step-${index + 1}`, title: `${title} 실행` }] }],
	}));
	const element = makeVisualElement({ kind: "independent-flow-panels", title: "세 독립 경로", panels });

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "ifp-visual");
	assert.equal((element.innerHTML.match(/class="ifp-panel"/g) || []).length, 3);
	assert.match(element.innerHTML, /수집 실행/);
	assert.match(element.innerHTML, /처리 실행/);
	assert.match(element.innerHTML, /조회 실행/);
	assert.doesNotMatch(element.innerHTML, /Contract ·|Learning ·|별도 상태 변경 명령|placeholder/);
});

test("independent-flow-panels는 legacy shape와 잘못된 relation을 숨기지 않고 진단한다", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 700, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = makeVisualElement({
		kind: "independent-flow-panels",
		title: "Invalid explicit flow",
		panels: [{ id: "a", title: "A", stages: [{ id: "s", title: "단계", steps: [{ id: "x", title: "실행" }] }] }],
		relations: [{ from: "a", to: "missing", type: "data-condition", label: "invalid" }],
		layers: [{ id: "legacy" }],
	});

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "tft-visual");
	assert.match(element.innerHTML, /independent-flow-panels 검증 실패/);
	assert.match(element.innerHTML, /layers는 이 kind에서 사용하지 않습니다/);
	assert.match(element.innerHTML, /존재하지 않는 panel을 참조/);
	assert.match(element.innerHTML, /원본 visual JSON/);
});

test("layers와 nodes가 함께 있는 두 구간 flow는 독립 phase panel로 렌더링한다", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = makeVisualElement({
		kind: "backend-layer-map",
		title: "A. 알림 적재 / B. 사용자 조회",
		subtitle: "A→B 실행 연결 없음",
		body: "처리 순서와 실행 계층을 패널별로 읽습니다.",
		layers: [
			{ id: "panel-a", title: "A. 알림 적재" },
			{ id: "panel-b", title: "B. 사용자 조회" },
		],
		nodes: [
			{ id: "source", lane: "panel-a", step: "A · ①-a", title: "[Source DB] 업무 row 변경", technicalLabel: "Source transaction", description: "업무 변경을 준비합니다." },
			{ id: "worker", lane: "panel-a", step: "A · ②-a", title: "[Backend] PENDING 이벤트 claim", description: "commit 뒤 비동기로 처리합니다." },
			{ id: "blocked", lane: "panel-a", step: "A · ② 업무 예외", title: "[예외] 활성 수신자 없음", description: "데이터 수정 뒤 replay합니다.", reentryTarget: "worker", status: "blocked" },
			{ id: "request", lane: "panel-b", step: "B · ④-a", title: "[Frontend] 조회 요청", description: "사용자 요청으로 B를 시작합니다." },
			{ id: "select", lane: "panel-b", step: "B · ④-c", title: "[Partner DB] 알림 SELECT", description: "A가 commit한 데이터를 읽습니다." },
		],
		edges: [{ source: "source", target: "worker" }, { source: "request", target: "select" }],
		notes: [
			{ title: "CONTRACT", body: ["하단 중복 계약"] },
			{ title: "LEARNING", body: ["하단 중복 학습 문구"] },
			{ title: "① Source local transaction", body: ["A 상세"] },
			{ title: "④ 사용자 조회", body: ["B 상세"] },
		],
	});

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "phase-visual");
	assert.match(element.innerHTML, /A\. 알림 적재/);
	assert.match(element.innerHTML, /B\. 사용자 조회/);
	assert.match(element.innerHTML, /phase-stage-summary/);
	assert.match(element.innerHTML, /Source DB · 업무 row 변경/);
	assert.match(element.innerHTML, /Backend · PENDING 이벤트 claim/);
	assert.match(element.innerHTML, /Frontend → Partner DB · 조회 요청 → 알림 SELECT/);
	assert.match(element.innerHTML, /업무 row 변경/);
	assert.match(element.innerHTML, /PENDING 이벤트 claim/);
	assert.match(element.innerHTML, /활성 수신자 없음/);
	assert.match(element.innerHTML, /예외·복구 · 정상 흐름과 분리/);
	assert.match(element.innerHTML, /↻ 재진입 · worker/);
	assert.match(element.innerHTML, /A→B 실행 연결 없음/);
	assert.match(element.innerHTML, /① Source local transaction/);
	assert.match(element.innerHTML, /④ 사용자 조회/);
	assert.doesNotMatch(element.innerHTML, /Contract · 책임|Learning ·|이 레이어가 닫는 책임|PASS 증거|하단 중복 계약|하단 중복 학습 문구/);
});

test("TFT visual fallback preserves unsupported shapes instead of showing a red error", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = makeVisualElement({ title: "Unknown visual", widgets: [{ id: "w1" }] });

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "tft-visual");
	assert.match(element.innerHTML, /렌더링 포맷 자동 치유/);
	assert.match(element.innerHTML, /원본 visual JSON/);
	assert.match(element.innerHTML, /Unknown visual/);
	assert.doesNotMatch(element.innerHTML, /tft-visual-error/);
});

test("Data Model / Migration Map visual renders entities, relationships, operations, and verification", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = makeVisualElement({
		kind: "data-model-migration-map",
		title: "Spot Event / Special Price 데이터 구조",
		runtimeFlow: ["spot_translation 기준 조회", "Special Price fallback source 선택"],
		entities: [
			{
				name: "spot_translation",
				description: "언어별 상세 정보 source-of-truth",
				sourceOfTruth: true,
				columns: [
					{ name: "code", type: "string", primaryKey: true },
					{ name: "spot_code", foreignKey: true, references: "spot.code" },
				],
			},
			{
				name: "spot_trans_fee_schedule_display_setting",
				status: "new",
				columns: [
					{ name: "spot_trans_code", foreignKey: true, unique: true, nullable: false, references: "spot_translation.code" },
					{ name: "is_collapsed", type: "boolean", defaultValue: false },
				],
			},
		],
		relationships: [{ from: "spot_translation.code", to: "spot_trans_fee_schedule_display_setting.spot_trans_code", cardinality: "1 : 0..1", description: "언어별 Special Price 섹션 설정" }],
		migrationOperations: [{ type: "DDL", target: "spot_trans_fee_schedule_display_setting", description: "섹션 접힘 설정 테이블 생성", rollback: "drop table" }],
		verificationQueries: [{ title: "UNIQUE 검증", sql: "select spot_trans_code, count(*) from spot_trans_fee_schedule_display_setting group by 1 having count(*) > 1;" }],
	});

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "data-visual");
	assert.match(element.innerHTML, /Data Model \/ Migration Map/);
	assert.match(element.innerHTML, /spot_translation/);
	assert.match(element.innerHTML, /spot_trans_fee_schedule_display_setting/);
	assert.match(element.innerHTML, /source-of-truth/);
	assert.match(element.innerHTML, /UNIQUE/);
	assert.match(element.innerHTML, /Relationships \/ Cardinality/);
	assert.match(element.innerHTML, /Migration Plan · DDL \/ DML \/ Backfill/);
	assert.match(element.innerHTML, /Verification Queries \/ Evidence/);
	assert.doesNotMatch(element.innerHTML, /tft-visual-error/);
});

test("Data Model learning fixture는 역할 색·저장 spine·학습 위계·접힌 보조 정보를 렌더링한다", async () => {
	const browser = createFakeBrowser({ top: 0, viewport: 700, height: 2200 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = makeVisualElement(dataModelLearningMaster);

	await studio.renderTftVisualElement(element);

	assert.equal(element.className, "data-visual");
	assert.equal((element.innerHTML.match(/class="data-spine-node/g) || []).length, 4);
	assert.match(element.innerHTML, /same transaction/);
	assert.match(element.innerHTML, /worker materialize/);
	assert.match(element.innerHTML, /role-unchanged/);
	assert.match(element.innerHTML, /role-transport/);
	assert.match(element.innerHTML, /role-core/);
	assert.match(element.innerHTML, /role-recipient/);
	assert.match(element.innerHTML, /왜 존재하는가/);
	assert.match(element.innerHTML, /핵심 key · 불변식/);
	assert.match(element.innerHTML, /변경되는 상태/);
	assert.match(element.innerHTML, /Schema fields · 4개/);
	assert.match(element.innerHTML, /<section class="data-schema-visible">/);
	assert.doesNotMatch(element.innerHTML, /<details class="data-schema-details"/);
	assert.ok(element.innerHTML.indexOf("Schema fields") < element.innerHTML.indexOf("왜 존재하는가"), "schema fields should be visible above the learning explanation");
	assert.match(element.innerHTML, /<details class="data-secondary"><summary>Relationships \/ Cardinality · 2개/);
	assert.match(element.innerHTML, /<details class="data-secondary"><summary>Migration Plan · DDL \/ DML \/ Backfill · 3개/);
	assert.match(element.innerHTML, /<details class="data-secondary"><summary>Verification Queries \/ Evidence · 3개/);
	assert.doesNotMatch(element.innerHTML, /columns\?|data-flow-chip/);
});

test("모든 TFT visual renderer는 presentation으로 root 영역 순서·노출·접힘을 바꾼다", () => {
	const browser = createFakeBrowser({ top: 0, viewport: 700, height: 2400 });
	const studio = loadStudioScript(browser.window, browser.document);

	const layerElement = { id: "presentation-layer-root", className: "", innerHTML: "" };
	studio.renderBackendLayerVisualElement(layerElement, {
		kind: "backend-layer-map",
		flow: ["FLOW MARKER"],
		layers: [{ title: "LAYER MARKER", responsibilities: ["layer responsibility"] }],
		glossary: [{ term: "HIDDEN GLOSSARY", description: "must not render" }],
		notes: [{ title: "NOTES MARKER", body: ["notes body"] }],
		__tftHealing: ["HEALING MARKER"],
		presentation: {
			order: ["notes", "flow", "diagram", "glossary", "healing"],
			display: { flow: "details", glossary: "hidden" },
		},
	});
	assertTextOrder(layerElement.innerHTML, "NOTES MARKER", "FLOW MARKER", "backend layer root order");
	assert.match(layerElement.innerHTML, /<details class="tft-presentation-details"><summary>처리 흐름<\/summary>/);
	assert.doesNotMatch(layerElement.innerHTML, /HIDDEN GLOSSARY/);

	const boundedElement = { id: "presentation-bounded-root", className: "", innerHTML: "" };
	studio.renderBoundedResponsibilityMapElement(boundedElement, {
		...boundedResponsibilityMaster,
		overview: "HIDDEN BOUNDED OVERVIEW",
		presentation: {
			order: ["exceptions", "spine", "groups", "overview"],
			display: { overview: "hidden", spine: "details" },
		},
	});
	assertTextOrder(boundedElement.innerHTML, 'class="brm-exceptions"', 'class="brm-group role-', "bounded map root order");
	assert.match(boundedElement.innerHTML, /<summary>책임 연결선<\/summary>/);
	assert.doesNotMatch(boundedElement.innerHTML, /HIDDEN BOUNDED OVERVIEW/);

	const independentElement = { id: "presentation-independent-root", className: "", innerHTML: "" };
	studio.renderIndependentFlowPanelsElement(independentElement, {
		kind: "independent-flow-panels",
		overview: "HIDDEN INDEPENDENT OVERVIEW",
		panels: [
			{ id: "panel-a", title: "PANEL A", stages: [{ title: "STAGE A", steps: [{ title: "STEP A" }] }] },
			{ id: "panel-b", title: "PANEL B", stages: [{ title: "STAGE B", steps: [{ title: "STEP B" }] }] },
		],
		relations: [{ from: "panel-a", to: "panel-b", label: "RELATION MARKER" }],
		commands: [{ title: "COMMAND MARKER" }],
		presentation: {
			order: ["commands", "relations", "panels", "overview"],
			display: { overview: "hidden", relations: "details" },
		},
	});
	assertTextOrder(independentElement.innerHTML, "COMMAND MARKER", "RELATION MARKER", "independent flow root order");
	assertTextOrder(independentElement.innerHTML, "RELATION MARKER", 'class="ifp-panel"', "independent flow panel placement");
	assert.match(independentElement.innerHTML, /<summary>패널 관계<\/summary>/);
	assert.doesNotMatch(independentElement.innerHTML, /HIDDEN INDEPENDENT OVERVIEW/);

	const phaseElement = { id: "presentation-phase-root", className: "", innerHTML: "" };
	studio.renderPhasePanelVisualElement(phaseElement, {
		body: "HIDDEN PHASE OVERVIEW",
		layers: [{ id: "phase-a", title: "PHASE A" }, { id: "phase-b", title: "PHASE B" }],
		nodes: [{ lane: "phase-a", title: "PHASE STEP A" }, { lane: "phase-b", title: "PHASE STEP B" }],
		__tftHealing: ["PHASE HEALING MARKER"],
		presentation: {
			order: ["healing", "panels", "overview"],
			display: { overview: "hidden", panels: "details" },
		},
	});
	assertTextOrder(phaseElement.innerHTML, "PHASE HEALING MARKER", "PHASE STEP A", "phase panel root order");
	assert.match(phaseElement.innerHTML, /<summary>독립 phase 패널<\/summary>/);
	assert.doesNotMatch(phaseElement.innerHTML, /HIDDEN PHASE OVERVIEW/);

	const architectureElement = { id: "presentation-architecture-root", className: "", innerHTML: "" };
	studio.renderArchitectureFlowElement(architectureElement, {
		kind: "architecture-flow",
		lanes: ["UI"],
		nodes: [{ id: "arch-node", lane: "UI", type: "screen", title: "ARCH DIAGRAM MARKER" }],
		edges: [],
		legend: [{ title: "HIDDEN ARCH LEGEND", description: "must not render" }],
		notes: [{ title: "ARCH NOTES MARKER", body: ["notes body"] }],
		presentation: {
			order: ["notes", "diagram", "legend", "healing"],
			display: { diagram: "details", legend: "hidden" },
		},
	});
	assertTextOrder(architectureElement.innerHTML, "ARCH NOTES MARKER", "ARCH DIAGRAM MARKER", "architecture root order");
	assert.match(architectureElement.innerHTML, /<summary>Architecture diagram<\/summary>/);
	assert.doesNotMatch(architectureElement.innerHTML, /HIDDEN ARCH LEGEND/);

	const dataElement = { id: "presentation-data-root", className: "", innerHTML: "" };
	studio.renderDataModelMigrationMapElement(dataElement, {
		kind: "data-model-migration-map",
		entities: [{ name: "DATA ENTITY MARKER", columns: [{ name: "id" }] }],
		relationships: [{ from: "DATA ENTITY MARKER.id", to: "other.id", description: "HIDDEN RELATION MARKER" }],
		migrationOperations: [{ title: "MIGRATION MARKER" }],
		presentation: {
			order: ["migration", "entities", "relationships"],
			display: { entities: "details", relationships: "hidden" },
		},
	});
	assertTextOrder(dataElement.innerHTML, "MIGRATION MARKER", "DATA ENTITY MARKER", "data model root order");
	assert.match(dataElement.innerHTML, /<summary>Data entities<\/summary>/);
	assert.doesNotMatch(dataElement.innerHTML, /HIDDEN RELATION MARKER/);
});

test("TFT visual card scope는 같은 presentation 계약으로 내부 영역을 재배치한다", () => {
	const browser = createFakeBrowser({ top: 0, viewport: 700, height: 2400 });
	const studio = loadStudioScript(browser.window, browser.document);

	const layerElement = { id: "presentation-layer-card", className: "", innerHTML: "" };
	studio.renderBackendLayerVisualElement(layerElement, {
		kind: "backend-layer-map",
		layers: [{
			title: "Layer",
			responsibilities: ["CONTRACT MARKER"],
			frontendAnalogy: "LEARNING MARKER",
			files: ["HIDDEN FILE MARKER"],
		}],
		presentation: {
			layer: { order: ["learning", "contract", "files", "risks"], display: { files: "hidden" } },
		},
	});
	assertTextOrder(layerElement.innerHTML, "LEARNING MARKER", "CONTRACT MARKER", "layer card scope");
	assert.doesNotMatch(layerElement.innerHTML, /<div class="layer-card-section"><b>구현 후보 파일<\/b>/);

	const boundedElement = { id: "presentation-bounded-group", className: "", innerHTML: "" };
	studio.renderBoundedResponsibilityMapElement(boundedElement, {
		kind: "bounded-responsibility-map",
		groups: [
			{ id: "a", title: "Group A", role: "source", purpose: "PURPOSE MARKER", components: [{ title: "COMPONENT MARKER" }] },
			{ id: "b", title: "Group B", role: "core", components: [{ title: "Component B" }] },
		],
		presentation: {
			group: { order: ["components", "purpose", "io", "boundary", "details"], display: { purpose: "details" } },
		},
	});
	const componentIndex = boundedElement.innerHTML.indexOf("COMPONENT MARKER");
	const groupPurposeIndex = boundedElement.innerHTML.lastIndexOf("PURPOSE MARKER");
	assert.ok(componentIndex >= 0 && componentIndex < groupPurposeIndex, "bounded group scope should place components before its purpose region");
	assert.match(boundedElement.innerHTML, /<summary>목적<\/summary>/);

	const independentElement = { id: "presentation-independent-panel", className: "", innerHTML: "" };
	studio.renderIndependentFlowPanelsElement(independentElement, {
		kind: "independent-flow-panels",
		panels: [{
			id: "panel-a",
			title: "Panel A",
			purpose: "META MARKER",
			stages: [{ title: "STAGE MARKER", steps: [{ title: "Step" }] }],
			contract: [{ value: "ANNOTATION MARKER" }],
		}],
		presentation: {
			panel: { order: ["annotations", "stages", "meta", "exceptions"], display: { stages: "details" } },
		},
	});
	assertTextOrder(independentElement.innerHTML, "ANNOTATION MARKER", "STAGE MARKER", "independent panel scope");
	assert.match(independentElement.innerHTML, /<summary>실행 단계<\/summary>/);

	const architectureElement = { id: "presentation-architecture-node", className: "", innerHTML: "" };
	studio.renderArchitectureFlowElement(architectureElement, {
		kind: "architecture-flow",
		lanes: ["DB"],
		nodes: [{
			id: "table",
			lane: "DB",
			type: "table",
			title: "Table",
			description: "NODE DESCRIPTION MARKER",
			frontendAnalogy: "HIDDEN NODE LEARNING",
			columns: [{ name: "NODE COLUMN MARKER" }],
		}],
		edges: [],
		presentation: {
			node: { order: ["columns", "description", "contract", "learning", "badges"], display: { learning: "hidden" } },
		},
	});
	assertTextOrder(architectureElement.innerHTML, "NODE COLUMN MARKER", "NODE DESCRIPTION MARKER", "architecture node scope");
	assert.doesNotMatch(architectureElement.innerHTML, /HIDDEN NODE LEARNING/);

	const dataElement = { id: "presentation-data-entity", className: "", innerHTML: "" };
	studio.renderDataModelMigrationMapElement(dataElement, {
		kind: "data-model-migration-map",
		entities: [{
			name: "Entity",
			description: "HIDDEN ENTITY DESCRIPTION",
			purpose: "ENTITY LEARNING MARKER",
			columns: [{ name: "ENTITY SCHEMA MARKER" }],
		}],
		presentation: {
			entity: { order: ["schema", "learning", "description"], display: { schema: "visible", description: "hidden" } },
		},
	});
	assertTextOrder(dataElement.innerHTML, "ENTITY SCHEMA MARKER", "ENTITY LEARNING MARKER", "data entity scope");
	assert.match(dataElement.innerHTML, /<section class="data-schema-visible">/);
	assert.doesNotMatch(dataElement.innerHTML, /HIDDEN ENTITY DESCRIPTION/);
});

test("Known visual kind with missing required shape falls back without blocking the reader", () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = { id: "missing-layer-fallback", className: "", innerHTML: "" };

	studio.renderBackendLayerVisualElement(element, { kind: "backend-layer-map", title: "Missing layers" });

	assert.equal(element.className, "tft-visual");
	assert.match(element.innerHTML, /fallback/);
	assert.match(element.innerHTML, /layers 배열이 필요/);
	assert.doesNotMatch(element.innerHTML, /tft-visual-error/);
});

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

test("Architecture schema diff theme renders semantic column lifecycle colors and labels", () => {
	const browser = createFakeBrowser({ top: 0, viewport: 600, height: 1600 });
	const studio = loadStudioScript(browser.window, browser.document);
	const element = { id: "arch-schema-diff-test", className: "", innerHTML: "" };

	studio.renderArchitectureFlowElement(element, {
		kind: "architecture-flow",
		theme: "schema-diff-dark",
		lanes: ["Before", "After"],
		nodes: [
			{
				id: "before",
				lane: "Before",
				type: "table",
				title: "legacy_table",
				status: "before",
				columns: [
					{ name: "id", status: "same", statusLabel: "유지", description: "기존 식별자를 그대로 유지" },
					{ name: "legacy_image", status: "removed", statusLabel: "삭제", description: "정규화 이후 사용하지 않는 이미지 컬럼" },
				],
			},
			{
				id: "after",
				lane: "After",
				type: "table",
				title: "normalized_table",
				status: "after",
				columns: [
					{ name: "section_title", status: "new", statusLabel: "신규", description: "섹션 제목을 별도 저장" },
					{ name: "writer_type", status: "changed", statusLabel: "확장", description: "SYSTEM 작성자 유형 추가" },
					{ name: "content", status: "reused", statusLabel: "재사용", description: "기존 본문 컬럼에 최종 HTML 저장" },
				],
			},
		],
		edges: [],
	});

	assert.equal(element.className, "arch-visual schema-diff-dark");
	assert.match(element.innerHTML, /class="arch-column same"/);
	assert.match(element.innerHTML, /class="arch-column removed"/);
	assert.match(element.innerHTML, /class="arch-column new"/);
	assert.match(element.innerHTML, /class="arch-column changed"/);
	assert.match(element.innerHTML, /class="arch-column reused"/);
	assert.match(element.innerHTML, /class="arch-badge removed">삭제/);
	assert.match(element.innerHTML, /class="arch-badge new">신규/);
	assert.match(element.innerHTML, /class="arch-badge changed">확장/);
	assert.match(element.innerHTML, /class="arch-badge reused">재사용/);
	assert.match(element.innerHTML, /class="arch-column-desc">섹션 제목을 별도 저장/);
	assert.match(element.innerHTML, /class="arch-column-desc">SYSTEM 작성자 유형 추가/);
	assert.match(element.innerHTML, /class="arch-column-desc">기존 본문 컬럼에 최종 HTML 저장/);

	const lightElement = { id: "arch-schema-diff-light-test", className: "", innerHTML: "" };
	studio.renderArchitectureFlowElement(lightElement, {
		kind: "architecture-flow",
		theme: "schema-diff-light",
		lanes: ["Before", "After"],
		nodes: [
			{ id: "light-before", lane: "Before", type: "table", title: "before_table", status: "before", columns: [{ name: "id", status: "same" }] },
			{ id: "light-after", lane: "After", type: "table", title: "after_table", status: "after", columns: [{ name: "new_field", status: "new" }] },
		],
		edges: [],
	});
	assert.equal(lightElement.className, "arch-visual schema-diff-light");
	assert.match(lightElement.innerHTML, /class="arch-column new"/);

	const pageHtml = buildPageHtml();
	assert.match(pageHtml, /\.arch-column\.removed \.arch-column-name \{ text-decoration:line-through/);
	assert.match(pageHtml, /\.arch-column-desc \{ color:#64748b/);
	assert.match(pageHtml, /columnDescriptionLines \* 13/);
	assert.match(pageHtml, /\.arch-visual\.schema-diff-light \.arch-canvas \{ min-width:0/);
	assert.match(pageHtml, /\.arch-node\.before \{ border-top-color:#38bdf8/);
	assert.match(pageHtml, /\.arch-node\.after \{ border-top-color:#22c55e/);
	assert.match(pageHtml, /\.arch-visual\.schema-diff-dark \.arch-column\.new/);
	assert.match(pageHtml, /\.arch-visual\.schema-diff-dark \.arch-node\.after/);
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
