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
  - .pi/frame.json
source:
  - pilee-history:2026-05-01#6
  - pilee-history:2026-05-06#65
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: 1b5b68d8fc7197824e8cd1e57dba3a36c113bc9a
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

Frame Studio transcript는 계약 자체가 아니라 계약을 만든 대화 전문입니다. transcript는 사용자가 어떤 질문과 선택을 거쳤는지 다시 열어보는 provenance이고, Verify가 기계적으로 판정할 기준은 여전히 최신 `frame.json`입니다.

## Co-thinking Boundary

Frame은 구현 plan을 대신 만들지 않습니다. 먼저 사용자가 볼 사고 렌즈와 실제 목표/범위 분기를 드러내고, 그 선택을 바탕으로 검증 계약을 작성합니다. 사용자가 검수해야 할 초점이 보이지 않으면 frame은 정교한 문서여도 TFT로는 실패입니다.

## Review Trigger

작업 중 목표나 범위가 바뀌면 frame은 갱신되어야 합니다. 검증은 “처음 들은 요구사항”이 아니라 “최신 계약”에 대해 수행됩니다.
