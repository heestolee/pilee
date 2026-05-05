---
title: reviewed_commit은 날짜 freshness의 빈틈을 막는다
tags:
  - knowledge
  - reviewed-commit
  - reviewed-at
  - freshness
  - commit
  - 정합성
category: knowledge
status: active
applies_to:
  - docs/knowledge
  - scripts/knowledge.mjs
  - skills/pilee-knowledge
source:
  - pilee-history:2026-05-05#50
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - freshness-diagnosis-report
  - deterministic-vs-ai-actions
---

## Judgment

`reviewed_at` 날짜만으로 freshness를 판단하면 같은 날짜에 추가된 커밋을 놓칠 수 있습니다. 문서 검토는 시간보다 git commit 기준이 더 정확한 경계입니다.

## Commit Rule

Knowledge doc은 `reviewed_at`과 함께 `reviewed_commit`을 기록합니다. `--confirm`은 문서를 실제로 검토한 뒤 두 값을 함께 갱신합니다. freshness report는 `reviewed_commit..HEAD` 범위의 actionable commit을 보고 review 후보를 찾습니다.

## Boundary

Knowledge 문서 자체를 고친 commit은 freshness stale의 직접 원인이 아닙니다. 판단을 바꾸는 코드/스킬/확장 변경이 문서 검토를 요구합니다.
