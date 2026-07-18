import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildPageHtml, buildStaticTftStudioHtmlFromTranscript, splitQuestionDisplayParts } from "./index.ts";

test("짧은 질문은 제목/본문으로 분리하지 않는다", () => {
	const parts = splitQuestionDisplayParts("배너 버튼 스크롤 target을 어떻게 반영할까요?");
	assert.equal(parts.title, "배너 버튼 스크롤 target을 어떻게 반영할까요?");
	assert.equal(parts.body, "");
	assert.equal(parts.wasSplit, false);
});

test("판단 맥락 카드가 question으로 들어오면 질문 제목과 본문으로 분리한다", () => {
	const raw = `질문 제목: 배너 버튼 스크롤 target 정리

현재 이해:
- 전체 티켓을 frame contract로 잡기로 했습니다.
- Jira 유저 플로우와 와이어프레임은 배너별 target 분리에 가깝습니다.

막힌 결정:
상단 배너 버튼의 스크롤 target을 success criteria에 어떻게 박제할지 정해야 합니다.

왜 중요한가:
이 선택에 따라 UI 동작 검증 캡처, scroll selector, QA 시나리오가 달라집니다.

질문:
배너 버튼 스크롤 target을 어떻게 frame에 반영할까요?`;

	const parts = splitQuestionDisplayParts(raw);
	assert.equal(parts.title, "배너 버튼 스크롤 target 정리");
	assert.equal(parts.wasSplit, true);
	assert.match(parts.body, /현재 이해:/);
	assert.match(parts.body, /막힌 결정:/);
	assert.doesNotMatch(parts.body, /^질문 제목:/);
});

test("질문 제목이 없으면 마지막 질문 라인을 짧은 제목으로 쓴다", () => {
	const raw = `현재 이해:
- 긴 설명입니다.

선택 후 달라지는 것:
- 1번: A
- 2번: B

질문:
어떤 검증 축을 우선할까요?`;

	const parts = splitQuestionDisplayParts(raw);
	assert.equal(parts.title, "어떤 검증 축을 우선할까요?");
	assert.equal(parts.wasSplit, true);
	assert.match(parts.body, /현재 이해:/);
});

test("생성된 WebView 스크립트가 파싱된다", () => {
	const html = buildPageHtml();
	const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
	assert.ok(scripts.length > 0, "inline script should exist");
	for (const script of scripts) new Function(script);
	assert.match(html, /question-context/);
});

test("Backend Layer Visual Map 렌더러가 WebView bundle에 포함된다", () => {
	const html = buildPageHtml();
	assert.match(html, /backend-layer-map/);
	assert.match(html, /renderBackendLayerVisualElement/);
	assert.match(html, /renderPhasePanelVisualElement/);
	assert.match(html, /독립 phase panel/);
	assert.match(html, /phase-stage-summary/);
	assert.match(html, /phaseStageSummary/);
	assert.match(html, /phase-step:not\(:last-child\)::after/);
	assert.match(html, /content:'→'/);
	assert.match(html, /SVG layer map/);
	assert.match(html, /요청 접수창/);
	assert.match(html, /업무 총괄자/);
	assert.match(html, /DB·외부 저장소 창구/);
});

test("Bounded Responsibility Map 렌더러가 WebView bundle에 포함된다", () => {
	const html = buildPageHtml();
	assert.match(html, /bounded-responsibility-map/);
	assert.match(html, /renderBoundedResponsibilityMapElement/);
	assert.match(html, /책임 경계 지도/);
	assert.match(html, /반드시 지킬 경계/);
	assert.match(html, /예외·운영 branch · 정상 handoff와 분리/);
	assert.match(html, /세부 책임·검증·Requirement/);
	assert.match(html, /role-delivery/);
	assert.match(html, /role-core/);
	assert.match(html, /role-channel/);
});

test("Independent Flow Panels 렌더러가 WebView bundle에 포함된다", () => {
	const html = buildPageHtml();
	assert.match(html, /independent-flow-panels/);
	assert.match(html, /renderIndependentFlowPanelsElement/);
	assert.match(html, /독립 실행 흐름/);
	assert.match(html, /독립 실행 패널/);
	assert.match(html, /데이터 조건 · 실행 호출 아님/);
	assert.match(html, /별도 상태 변경 명령 · 위 조회선의 후속 단계가 아님/);
	assert.match(html, /Contract · 반드시 지킬 조건/);
	assert.match(html, /Learning · 이 구조를 읽는 핵심/);
	assert.match(html, /대안 분기/);
	assert.match(html, /병렬 결과/);
});

test("Architecture/Data Flow Map 렌더러가 WebView bundle에 포함된다", () => {
	const html = buildPageHtml();
	assert.match(html, /architecture-flow/);
	assert.match(html, /renderArchitectureFlowElement/);
	assert.match(html, /Architecture flow/);
	assert.match(html, /arch-edge-label/);
	assert.match(html, /source-of-truth/);
	assert.match(html, /PK/);
	assert.match(html, /FK/);
});

test("Data Model / Migration Map 렌더러가 WebView bundle에 포함된다", () => {
	const html = buildPageHtml();
	assert.match(html, /data-model-migration-map/);
	assert.match(html, /renderDataModelMigrationMapElement/);
	assert.match(html, /Data Model \/ Migration Map/);
	assert.match(html, /Migration Plan · DDL \/ DML \/ Backfill/);
	assert.match(html, /Verification Queries \/ Evidence/);
	assert.match(html, /renderDataModelSpine/);
	assert.match(html, /왜 존재하는가/);
	assert.match(html, /핵심 key · 불변식/);
	assert.match(html, /변경되는 상태/);
	assert.match(html, /top-open/);
	assert.match(html, /top-visible/);
	assert.match(html, /data-schema-visible/);
	assert.match(html, /schemaFirst/);
	assert.match(html, /role-transport/);
	assert.match(html, /role-core/);
	assert.match(html, /role-recipient/);
});


test("정적 TFT transcript HTML도 live visual renderer bundle을 사용한다", () => {
	const dir = mkdtempSync(join(tmpdir(), "pilee-tft-static-"));
	const file = join(dir, "planning-ticket-COM-2491.json");
	const architectureFlow = {
		kind: "architecture-flow",
		title: "COM-2491 flow",
		lanes: ["UI", "Backend"],
		nodes: [
			{ id: "ui", lane: "UI", type: "screen", title: "Mobile cards" },
			{ id: "api", lane: "Backend", type: "resolver", title: "Existing approval API" },
		],
		edges: [{ from: "ui", to: "api", label: "reuse existing action" }],
	};
	const backendLayerMap = {
		kind: "backend-layer-map",
		title: "Backend boundary",
		layers: [{ layer: "Entry/API boundary", title: "Existing approval API", role: "기존 backend 입구" }],
	};
	const dataModelMap = {
		kind: "data-model-migration-map",
		title: "Migration structure",
		entities: [{ name: "fee_setting", status: "new", columns: [{ name: "spot_trans_code", foreignKey: true, unique: true }] }],
		migrationOperations: [{ type: "DDL", target: "fee_setting", description: "설정 테이블 생성" }],
	};
	const markdown = [
		"# Visual smoke",
		"",
		"```tft-visual",
		JSON.stringify(architectureFlow, null, 2),
		"```",
		"",
		"```tft-visual",
		JSON.stringify(backendLayerMap, null, 2),
		"```",
		"",
		"```tft-visual",
		JSON.stringify(dataModelMap, null, 2),
		"```",
	].join("\n");
	try {
		writeFileSync(file, JSON.stringify({
			title: "Verify · 윤겔라 · COM-2491",
			activeTab: "frame",
			status: "running",
			markdown,
			tabs: { frame: { markdown, step: "Visual smoke", updatedAt: Date.now() } },
			timeline: [{ id: "u1", time: Date.now(), kind: "update", tab: "frame", step: "Visual smoke", markdown }],
			logs: [],
		}, null, 2));
		const html = buildStaticTftStudioHtmlFromTranscript(file);
		assert.match(html, /Verify · 윤겔라 · COM-2491/);
		assert.match(html, /var STATIC_STATE = /);
		assert.match(html, /renderArchitectureFlowElement/);
		assert.match(html, /renderBackendLayerVisualElement/);
		assert.match(html, /renderDataModelMigrationMapElement/);
		assert.match(html, /architecture-flow/);
		assert.match(html, /backend-layer-map/);
		assert.match(html, /data-model-migration-map/);
		const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
		assert.ok(scripts.length > 0);
		for (const script of scripts) new Function(script);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
