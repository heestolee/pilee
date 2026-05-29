import assert from "node:assert/strict";
import test from "node:test";
import { buildPageHtml, splitQuestionDisplayParts } from "./index.ts";

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
	assert.match(html, /SVG layer map/);
	assert.match(html, /요청 접수창/);
	assert.match(html, /업무 총괄자/);
	assert.match(html, /DB·외부 저장소 창구/);
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
