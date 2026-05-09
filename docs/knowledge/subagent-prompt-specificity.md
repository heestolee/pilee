---
title: Subagent 위임은 구체 프롬프트를 요구한다
tags:
  - subagent
  - prompt
  - delegation
  - worker
  - context
  - 위임
category: agent
status: active
confidence: high
applies_to:
  - extensions/subagent
  - agents
  - skills/self-healing
  - skills/stress-interview
source:
  - pilee-history:2026-05-05#42
reviewed_at: 2026-05-09
reviewed_commit: 5f1411ca08dc2cf31f11a75588dd372adb6f3c1a
related:
  - subagent-model-policy
  - self-healing-actionable-loop
  - worktree-session-continuity
---

## Judgment

Subagent는 “똑똑한 백그라운드 모델”이 아니라 제한된 맥락을 받은 실행자입니다. main agent가 불명확한 요청을 던지면 subagent는 부족한 맥락을 추측하거나 형식적인 결과를 냅니다.

## Prompt Contract

위임 프롬프트에는 목표, 제외 범위, 대상 파일/검색 범위, 기대 산출물, 검증 명령, 보고 형식이 있어야 합니다. 비동기 실행 후에는 바로 polling하지 않고 완료 알림을 기다리며, 이어서 작업할 때는 최신 main context를 명시적으로 제공합니다.

## Async Boundary

Subagent launch 자체는 작업 완료가 아닙니다. 비동기 실행을 시작한 뒤 같은 턴에서 상태를 반복 조회하면 main agent가 orchestration noise를 만들고, subagent 완료 알림 흐름과 충돌합니다. launch 후에는 사용자에게 시작 사실을 짧게 알리고, 완료 메시지가 돌아온 뒤 필요한 후속 작업을 이어갑니다.

## Failure Mode

모델을 강하게 바꾸는 것만으로 위임 품질이 안정되지 않습니다. 실패 비용이 큰 worker/reviewer/verifier에는 강한 모델을 쓰되, 우선 확인할 것은 프롬프트의 구체성과 evidence 요구입니다.
