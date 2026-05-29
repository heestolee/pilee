---
title: 정확한 기획 근거가 있으면 Frame은 추적 매트릭스를 만든다
tags:
  - frame
  - tft-studio
  - planning
  - requirements
  - traceability
  - work-map
  - backend-layer-map
  - verification
category: workflow
status: active
confidence: high
applies_to:
  - skills/frame
  - skills/frame/references/source-grounded-planning.md
  - skills/frame/references/backend-layer-map.md
  - extensions/tasks
  - extensions/frame-studio
source:
  - user-direction:2026-05-30-source-grounded-frame-matrix
reviewed_at: 2026-05-30
reviewed_commit: bfa4a448ed135506decf63ffb13836ddca918e70
related:
  - frame-verify-contract
  - frame-plan-synthesis-continuity
  - backend-layer-map-frame-gate
  - task-work-map-overlay
  - work-context-card-task-board
  - tft-preference-regression-gate
---

## Judgment

Jira, Notion, Slack thread, wireframe, PRD처럼 정확한 기획 근거가 있으면 `/frame`은 큰틀 목표를 요약하는 도구로 끝나면 안 됩니다. Frame은 기획 원문을 구현 계약과 검증 증거로 연결하는 traceability surface가 되어야 합니다.

문제가 되는 흐름은 “기획은 자세했지만 frame이 큰 방향만 잡고, 구현 중 agent가 요구를 source/model parity처럼 더 작은 목표로 축소하는 것”입니다. 이 경우 lint/typecheck가 통과해도 기획 충족은 실패할 수 있습니다.

## Requirement Matrix Rule

source-grounded frame은 기획 원문을 `R1`, `R2` 같은 requirement ID로 쪼개고, 각 ID를 다음 항목에 연결합니다.

- 출처: Jira section, Notion heading, Slack permalink, wireframe frame name 등
- 원문 또는 sanitized excerpt
- 구현 계약: 무엇이 실제로 구현되어야 하는가
- 검증 증거: UI capture, GIF, network payload, BE test, DB dry-run, code diff, log 등
- 상태: pending, confirmed, decision-needed, gap, blocked, out-of-scope

“컴포넌트 재사용”을 “같은 데이터 source 사용”으로 바꾸는 식의 축소는 matrix에서 즉시 드러나야 합니다. 그대로 구현하기 위험한 요구는 조용히 축소하지 않고, `원문 요구 → 위험 → 대안 → 승인 필요 여부`를 decision gate로 올립니다.

## Domain Work Map Rule

Requirement Matrix는 다시 도메인별 work map으로 펼쳐집니다. 기본 레인은 필요한 만큼만 사용합니다.

- FE Web
- FE Admin
- FE Mobile/App
- BE Entry/API
- BE Application
- BE Domain/Data
- DB / Migration
- Ops / Runbook
- Verification / Evidence
- Docs / PR / Release

각 task는 닫는 requirement ID와 acceptance/evidence를 가져야 합니다. Frame 저장 시 이 leaf task들은 가능하면 `TaskCreate`로 내려가고, `area`는 사용자가 읽을 수 있는 레인 이름으로 표시합니다. 이렇게 해야 “BE는 됐는데 Admin 검수 UI가 빠짐”, “FE는 됐는데 DB/Ops runbook이 빠짐” 같은 누락이 보입니다.

## Backend Layer Map Rule

backend가 얽힌 작업에서 layer map은 아키텍처 설명이 아니라 기획 책임 분배표입니다. Entry/API, Application flow, Domain rule, Data access, Cache/batching, Persistence, Consumer, Ops 같은 레이어에 requirement ID를 붙입니다.

이 맵은 “어느 파일을 먼저 고칠지”가 아니라 “어느 레이어가 어떤 책임을 소유하는지”를 보여줍니다. 책임 위치가 불분명하면 파일 plan으로 넘어가기 전에 한 가지 질문으로 승격합니다. 예를 들어 목표 상태 validation이 usecase 흐름인지, domain/helper invariant인지, repository DB 조건인지 결정합니다.

## Verification Rule

source-grounded frame의 `/verify`와 `/verify-report`는 요구사항 ID별로 닫혀야 합니다.

- UI 요구는 캡처/GIF 없이 PASS가 아닙니다.
- “영향 없음” 요구도 실제 consumer path 확인 없이 PASS가 아닙니다.
- “자동 반려/로그” 요구는 dry-run, execute gate, log evidence 없이 PASS가 아닙니다.
- 기획과 다른 대안을 선택했다면 decision record 또는 사용자 승인 없이는 PASS가 아닙니다.

## TFT Studio Surface

TFT Studio Frame tab은 source-grounded mode에서 다음 섹션을 눈에 띄게 보여줘야 합니다.

1. Source Evidence
2. Requirement Matrix
3. Domain Work Map
4. Backend Layer Map
5. Implementation Plan Synthesis
6. Verification Evidence Plan

이 UI는 pipeline을 강제하는 것이 아니라 사용자가 기획 원문과 실행 계획의 연결을 함께 검수하게 하는 surface입니다. canonical source는 여전히 `frame.json`입니다.
