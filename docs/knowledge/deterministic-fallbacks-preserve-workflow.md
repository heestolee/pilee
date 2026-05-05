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
applies_to:
  - extensions/web-access
  - extensions/archive-to-html
  - extensions/mcp-bridge
  - skills/verify-report
source:
  - pilee-history:2026-05-05#44
  - pilee-history:2026-05-05#45
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - curator-approved-source-selection
  - live-artifact-preview-pattern
---

## Judgment

모델 요약, Glimpse native host, rewrite, 추가 검색 중 하나가 실패해도 전체 workflow가 실패해서는 안 됩니다. AI가 부가가치를 만들지 못한 경우에도 사용자는 원본 결과와 최소 요약을 바탕으로 다음 결정을 할 수 있어야 합니다.

## Fallback Rule

모델 요약이 실패하면 deterministic summary를 만들고, Glimpse가 실패하면 브라우저로 열며, 긴 raw snippet 대신 출처 title/URL과 짧은 요약을 남깁니다. fallback은 조용히 숨기지 않고 사용자가 품질 차이를 알 수 있게 표시합니다.

## Boundary

fallback은 정확성을 보장하지 않습니다. 역할은 workflow continuity입니다. 최종 신뢰는 승인된 출처, 검증 증거, 사용자의 확인에서 나옵니다.
