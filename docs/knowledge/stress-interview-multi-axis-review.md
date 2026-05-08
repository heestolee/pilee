---
title: Stress Interview는 다축 검토다
tags:
  - stress-interview
  - review
  - verifier
  - reviewer
  - challenger
  - subagent
  - 검토
category: agent
status: active
confidence: high
applies_to:
  - skills/stress-interview
  - extensions/subagent
  - agents
source:
  - pilee-history:2026-05-01#7
  - pilee-history:2026-05-05#42
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-08
reviewed_commit: 9b7ea36d62a7eb3ada47dff7915bf30e9ec6ac16
related:
  - subagent-model-policy
  - self-healing-actionable-loop
  - evidence-first-verification-gate
---

## Judgment

Stress Interview는 같은 변경을 여러 에이전트에게 반복 확인시키는 절차가 아니라, 서로 다른 실패 모드를 찾는 다축 검토입니다. verifier, reviewer, challenger는 같은 질문을 하는 세 명이 아니라 증거, 품질, 가정 공격을 나눠 맡는 역할입니다.

## Axis Rule

Verifier는 성공 기준과 검증 증거를 봅니다. Reviewer는 코드 품질, 유지보수성, 보안/성능 위험을 봅니다. Challenger는 숨은 가정과 범위 착각을 공격합니다. 세 결과는 찬반 투표가 아니라 actionable item 추출의 입력입니다.

## Delegation Rule

Subagent fan-out은 같은 지시를 세 번 보내는 것이 아닙니다. 각 agent prompt에는 검토 축, 대상 diff, 기대 출력 형식, fix_class 기준이 들어가야 합니다. 결과를 합칠 때도 `AUTO_FIX`, `ASK`, `INFO`처럼 후속 행동으로 분류해야 self-healing이나 PR review에 연결됩니다.

## Failure Mode

결과를 그대로 나열하거나 “대체로 문제없음”으로 합치면 fan-out의 의미가 사라집니다. 충돌하는 지적은 어느 축의 관점인지 표시하고, 실제 수정/질문/정보로 분류해야 합니다.
