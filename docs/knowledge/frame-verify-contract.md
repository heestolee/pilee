---
title: Frame과 Verify는 구조화 계약이다
tags:
  - frame
  - verify
  - frame-json
  - success-criteria
  - contract
  - verification
  - 계약
  - 검증
category: verification
status: active
applies_to:
  - skills/frame
  - skills/decide
  - skills/verify
  - .context/frame.json
source:
  - pilee-history:2026-05-01#6
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - ask-user-question-decision-gates
  - evidence-first-verification-gate
  - verification-invalidation-on-change
supersedes:
  - freeform-context-md-verification
---

## Judgment

Frame은 구현 전 자연어 메모가 아니라, Verify가 기계적으로 읽을 수 있는 계약을 만드는 단계입니다. 자유서술 context만 남기면 검증 단계에서 목표를 다시 해석하게 되고, 그 해석 오차가 완료 판단을 흐립니다.

## Contract Shape

`frame.json`에는 성공 기준, 검증 계획, 범위 밖 항목, 엣지 케이스 seed, 위험 register가 구조화되어야 합니다. Verify는 이 계약의 `success_criteria`를 행 단위로 PASS/FAIL 판정합니다. 새 의사결정이 필요하면 `/decide`로 분리하고, 결정 결과를 다시 계약에 반영합니다.

## Review Trigger

작업 중 목표나 범위가 바뀌면 frame은 갱신되어야 합니다. 검증은 “처음 들은 요구사항”이 아니라 “최신 계약”에 대해 수행됩니다.
