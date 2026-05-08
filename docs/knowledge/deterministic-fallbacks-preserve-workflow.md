---
title: Deterministic fallback은 workflow를 보존한다
tags:
  - fallback
  - deterministic
  - model-failure
  - resilience
  - web-search
  - report
category: runtime
status: active
confidence: high
applies_to:
  - extensions/web-access
  - extensions/archive-to-html
  - extensions/mcp-bridge
  - skills/verify-report
source:
  - pilee-history:2026-05-05#44
  - pilee-history:2026-05-05#45
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-08
reviewed_commit: be32cb7b2dbf4ad10d2343b0f453f261a5fb6270
related:
  - curator-approved-source-selection
  - live-artifact-preview-pattern
---

## Judgment

모델 요약, Glimpse native host, rewrite, 추가 검색 중 하나가 실패해도 전체 workflow가 실패해서는 안 됩니다. AI가 부가가치를 만들지 못한 경우에도 사용자는 원본 결과와 최소 요약을 바탕으로 다음 결정을 할 수 있어야 합니다.

## Fallback Rule

모델 요약이 실패하면 deterministic summary를 만들고, Glimpse가 실패하면 브라우저로 열며, 긴 raw snippet 대신 출처 title/URL과 짧은 요약을 남깁니다. fallback은 조용히 숨기지 않고 사용자가 품질 차이를 알 수 있게 표시합니다.

## Artifact Rule

fallback 산출물도 workflow의 일부이므로 다시 열 수 있어야 합니다. web search, verify report, local resolver처럼 중간 모델 호출이 실패해도 사용자는 최소한 입력, deterministic 결과, 다음 행동을 확인할 수 있어야 합니다. fallback은 품질을 낮추는 대신 state loss를 막는 안전장치입니다.

## Preview Fallback Rule

Glimpse/native preview가 완전하지 않아도 사용자가 workflow를 계속 이어갈 수 있어야 합니다. preview 안의 top-bar 버튼이 WebView에서 동작하지 않으면 static anchor를 반복하기보다 local server route와 host-side opener로 deterministic하게 대체합니다. fallback의 목표는 “어떻게든 열림”이 아니라 같은 artifact browser 흐름 안에서 다음 행동이 보존되는 것입니다.

## Grouping Fallback Rule

Capture grouping도 deterministic fallback을 가져야 합니다. ideal label은 ticket + title이지만, 없으면 session title, Frame identity, workspace name, 마지막으로 `미분류` 순서로 낮춥니다. metadata가 부족하다고 캡처 탐색 workflow가 실패하면 안 됩니다.

## Boundary

fallback은 정확성을 보장하지 않습니다. 역할은 workflow continuity입니다. 최종 신뢰는 승인된 출처, 검증 증거, 사용자의 확인에서 나옵니다.
