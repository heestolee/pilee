---
title: 작업 절차의 무게는 변경 리스크에 비례해야 한다
tags:
  - workflow
  - frame
  - tft
  - hotfix
  - scope
  - incremental
  - overwork
category: workflow
status: active
confidence: high
applies_to:
  - skills/frame
  - skills/incremental-implementation
  - skills/verify-report-preflight
source:
  - user-direction:2026-05-12-worktree-speed-analysis
reviewed_at: 2026-05-24
reviewed_commit: fbc67710c611e264e907f16cf867c2c7a6e36c76
related:
  - request-traceability-surgical-changes
  - frame-verify-contract
  - worktree-session-continuity
  - verify-report-preflight-readiness
title_en: Workflow weight must match change risk
---

## Overview

TFT, verify-report, worker fan-out, exhaustive validation은 모두 강한 도구입니다. 하지만 단일 hotfix나 copy 변경에도 같은 무게를 적용하면 구현보다 절차가 더 커집니다. pilee의 기본값은 “가볍게 시작하고, 증거가 필요해질 때 승격한다”입니다.

## Weight Classes

| 무게 | 신호 | 적절한 절차 |
|---|---|---|
| light | 파일 1~2개, route/role/data 1개, side effect 없음 | 짧은 scope lock, focused 수정, 가장 가까운 검증 1개, 커밋. PR도 diff/commit/user intent 중심으로 작성 |
| standard | UI/BE/event 중 여러 축, 작은 회귀 위험 | frame/verify 또는 verify-report를 필요한 축만 사용. worker는 병렬 소유권이 있을 때만 |
| full | 정책/DB/다중 role/viewport/before-after/release risk | TFT, decide, worker fan-out, full report를 명시 계획 뒤 사용 |

절차를 키우는 이유를 한 문장으로 설명할 수 없으면 절차를 줄입니다. 반대로 light로 시작했더라도 새로운 위험 축이 발견되면 standard/full로 승격하고 이유를 기록합니다.

## Guardrails

- 사용자가 “간단한 hotfix”, “문구만”, “이거 하나만”처럼 말하면 light path를 우선합니다.
- `/frame`은 full plan을 자동 생성하기보다 작업 무게를 먼저 보정합니다.
- `/verify-report-preflight`는 full report가 필요한지 판단하는 전 단계입니다.
- Worker fan-out은 병렬 소유권이 필요할 때 쓰고, 단일 축 확인에는 기본값으로 쓰지 않습니다.
- light PR/ship에서 PR 템플릿을 채우기 위해 raw session/context를 깊게 훑지 않습니다. 현재 diff, 최근 커밋, 사용자 intent가 우선 evidence입니다.
- 사용자가 특정 환경이나 dev 검증 절차를 지정하면 그 범위를 유지합니다. production/외부 확인이나 더 무거운 절차로 확장하려면 먼저 묻습니다.
- DB write/runbook 안전장치는 변경 위험에 비례해야 합니다. 작은 reversible row 변경에 backup table, DELETE rollback, 장황한 rollback ceremony를 자동으로 붙이지 않습니다.
- 절차를 줄여도 evidence-first 원칙은 유지합니다. UI 변화는 가능한 실제 화면/TUI evidence로 닫습니다.

## Why It Matters

최근 worktree 지연 사례의 공통점은 코드 변경 자체보다 과한 맥락 상속, 늦은 scope lock, 반복 baseline 조사, full 검증 절차 진입, 사용자가 지정한 dev/preview 범위에서 production/정석 설계로 확장한 판단이었습니다. Workflow weight rule은 안전을 포기하지 않고 작업 크기와 사용자가 말한 목적에 맞는 절차를 선택하게 합니다.
