---
title: 웹 검색은 승인된 출처 선택을 거친다
tags:
  - web-search
  - curator
  - source-selection
  - approval
  - tavily
  - 검색
category: web-access
status: active
confidence: high
applies_to:
  - extensions/web-access
  - web_search workflow=summary-review
source:
  - pilee-history:2026-05-05#44
  - pilee-history:2026-05-05#45
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-13
reviewed_commit: 49eb5f7591aa355f1022ea1e7fe2659a181cfb63
related:
  - web-search-curator
  - live-artifact-preview-pattern
  - deterministic-fallbacks-preserve-workflow
---

## Judgment

웹 검색 결과를 모델 답변에 바로 섞으면 사용자는 어떤 자료가 근거로 쓰였는지 통제하기 어렵습니다. curator는 검색을 “자료 선택 → 요약 초안 → 승인” 흐름으로 바꿔 출처 선택권을 사용자에게 돌려줍니다.

## Interaction Rule

검색 창은 초기 Tavily 결과가 끝난 뒤가 아니라 검색 중에 먼저 열립니다. 결과는 placeholder와 SSE로 채워지고, 사용자는 선택/추가 검색/rewrite/요약 재생성을 거쳐 승인합니다. 승인 전 초안은 최종 답변이 아닙니다.

## Evidence Rule

승인형 검색에서 중요한 증거는 모델이 만든 요약문 자체가 아니라 사용자가 선택한 출처 집합입니다. archive나 PR 요약에는 승인된 출처와 선택 시점의 요약을 남기되, raw snippet을 길게 복사하거나 사용자가 보지 않은 결과를 근거로 섞지 않습니다.

## Reopen Rule

승인된 출처 집합은 나중에 다시 열 수 있어야 합니다. web-search review archive를 `/archive`에서 열 때도 목록으로 돌아가거나 원본 HTML을 브라우저로 여는 조작이 가능해야 하며, static file link가 WebView에서 동작하지 않는 경우 host-side opener로 경계를 보강합니다.

## Failure Mode

자동 요약이 빨라도 출처 선택이 불투명하면 신뢰가 떨어집니다. curator는 속도를 조금 늦추더라도 사용자가 본 자료만 답변 근거로 삼게 합니다.
