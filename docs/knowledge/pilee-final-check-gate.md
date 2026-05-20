---
title: pilee 변경은 final-check gate로 닫는다
tags:
  - pilee
  - final-check
  - verification
  - skill
  - workflow
  - 마무리
category: workflow
status: active
confidence: high
applies_to:
  - skills/pilee-final-check
  - AGENTS.md
  - scripts/knowledge.mjs
  - scripts/check-pilee-final-check.mjs
  - pilee change workflow
source:
  - user-direction:2026-05-12-pilee-final-check
  - user-direction:2026-05-19-final-check-test-code-gate
  - user-direction:2026-05-20-webview-scroll-reload-test-gate
reviewed_at: 2026-05-20
reviewed_commit: 0a58e59c9c35506e0568bb2bfc3cadc283f337a6
related:
  - request-traceability-surgical-changes
  - evidence-first-verification-gate
  - change-integration-discipline
  - pilee-knowledge-system
---

## Overview

pilee 변경은 기능 구현, knowledge 갱신, 기록/동기화, push가 함께 얽힙니다. 그래서 “코드가 컴파일된다”만으로는 작업이 닫히지 않습니다. 최종 보고 전에는 사용자가 요청한 의도와 실제 diff를 다시 맞추고, pilee 특유의 session/worktree/archive/knowledge/Notion 구멍을 한 번 더 찾아야 합니다.

## Rule

pilee repo에 변경이 생기면 final response 전에 `pilee-final-check` 절차를 적용합니다. 이 절차는 새 기능을 추가하는 단계가 아니라, 이미 만든 변경이 실제 의도대로 동작하는지 마지막으로 닫는 gate입니다.

필수 확인:

1. 요청 의도와 diff의 직접 매핑
2. unrelated dirty/generated drift 분리
3. 변경 유형별 실제 failure mode 검토
4. 테스트 코드 추가·보강 여부 판단
5. 가능한 smoke/validation 실행
6. 구멍 발견 시 수정 후 재검증
7. local pilee-history/Notion sync와 push 상태 확인

## Why a separate skill

일반 `verify`는 frame success criteria를 mechanical하게 검증하고, `code-review-and-quality`는 일반 코드 품질을 봅니다. 하지만 pilee 개선은 public/private boundary, generated knowledge graph, package version lockstep, local history/Notion sync, Pi session/worktree state 같은 운영 축이 함께 닫혀야 합니다.

따라서 final-check는 기존 검증 스킬을 대체하지 않고, pilee 변경의 마지막 조립 게이트 역할을 합니다.

## Test Code Gate

final-check는 “어떤 명령을 돌렸는가”만 확인하지 않고, 이번 변경에 남겨야 할 자동화 테스트가 있는지도 확인합니다. 동작/계약/회귀를 고정할 수 있는 변경이면 테스트 추가가 기본값이고, 테스트를 생략할 때는 순수 문서/generated 변경인지, 이미 같은 계약을 덮는 테스트가 있는지, 자동화 비용 때문에 캡처·수동 evidence로 대체해야 하는지를 명시합니다.

의미 있는 테스트는 변경 계약을 직접 assert해야 합니다. 예를 들어 tool/command 변경은 mock context로 state transition과 user-facing render text를 확인하고, parser/generator 변경은 fixture output의 핵심 구조·escape·round-trip을 확인하며, skill/prompt 계약 변경은 deterministic script로 필수 heading/문구와 금지 패턴을 검사합니다. Glimpse/WebView/render UX 변경은 사용자가 보고 조작하던 상태를 깨뜨리기 쉽기 때문에 scroll preservation fixture, mock companion no-reload/window reuse assert, generated WebView script parse처럼 사용자 조작 상태를 직접 고정하는 테스트가 필요합니다. 반대로 assert 없는 smoke, 변경과 무관한 snapshot 대량 갱신, 구현을 그대로 복제하는 테스트, 실패 원인과 무관한 기대값 완화는 final-check에서 테스트 보강으로 인정하지 않습니다.

`pilee-final-check` 자체는 `scripts/check-pilee-final-check.mjs`가 계약을 고정합니다. 이 테스트는 Test Code Gate 섹션, 의미 없는 테스트 금지 문구, final output의 테스트 결정 항목, WebView scroll/reload 회귀 테스트 존재, `npm run test:pilee-final-check` package script가 빠지면 실패합니다.

## Behavior

구멍이 없으면 개선 내용과 검증 근거를 짧게 정리합니다. 구멍이 있으면 바로 고치고 같은 검증 세트를 다시 실행합니다. 미검증 gap이 남으면 “문제없음”이라고 말하지 않고 gap으로 분리합니다.

## Review triggers

이 문서는 다음 경우 다시 검토합니다.

- pilee 변경 배포 규칙이 바뀔 때
- knowledge graph/freshness 운영 방식이 바뀔 때
- Notion/local history sync 방식이 바뀔 때
- final-check가 너무 넓게 trigger되어 일반 repo 작업을 방해할 때
- 테스트 게이트가 의례적 체크리스트가 되어 실제 변경 계약을 고정하지 못할 때
