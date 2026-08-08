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
reviewed_at: 2026-08-08
reviewed_commit: adacb00
related:
  - subagent-model-policy
  - parallel-workflow-analysis-single-writer
  - mcp-digest-first-artifacts
  - final-verification-parallelization
  - self-healing-actionable-loop
  - worktree-session-continuity
---

## Judgment

Subagent는 “똑똑한 백그라운드 모델”이 아니라 제한된 맥락과 capability를 받은 owner입니다. 큰 작업인지 판단하는 일과 어떤 agent를 고르는 일은 분리합니다. 작업 크기는 입력 fan-out뿐 아니라 복잡도·불확실성, 실행시간, 검증 축으로 판단하고, 역할은 기대 산출물과 필요한 tool로 선택합니다. 고정 숫자 threshold나 자동 spawn은 두지 않습니다.

## Role Routing

- local lookup → finder
- external research/cross-reference → searcher
- plan/dependency map → planner
- transformation/artifact/implementation → worker
- patch review/assumption challenge → reviewer/challenger
- executable proof → verifier
- UI interaction/capture → browser
- environment readiness → bootstrapper
- dedicated workflow → 해당 전용 worker

작은 작업이나 handoff·merge 비용이 더 큰 작업은 main이 직접 처리합니다. 반대로 순차 작업이라는 이유만으로 main이 독박 쓰지 않습니다.

## Topology And Writer Boundary

- 강결합 작업 → 단일 owner
- 독립 shard → batch
- 선행 결과가 필요한 단계 → chain

병렬 분석은 read-only proposal이 기본입니다. mutation은 단일 writer가 소유하며, 병렬 mutation은 scope/worktree가 분리되고 integration owner가 있을 때만 사용합니다. 큰 입력이나 많은 slice가 보인다는 사실만으로 같은 cwd의 병렬 writer를 허용하지 않습니다.

## Source-aware Handoff

child가 source-native locator를 실제로 열 capability가 있을 때만 locator를 넘깁니다. 부모의 tool result는 자동 상속된다고 가정하지 않습니다. locator를 사용할 수 없으면 stable ID와 provenance가 있는 제한·redaction된 임시 shard만 전달하고, Slack/Notion/Jira 같은 외부 시스템의 raw/full 전문을 기본 artifact로 복제하지 않습니다.

## Prompt And Closure Contract

위임 프롬프트에는 목표, 제외 범위, 대상 파일·source scope, 기대 산출물, 검증/evidence, 보고 schema가 있어야 합니다. shard 작업이면 공통 rubric과 각 shard의 basis·범위도 포함합니다.

main은 모든 shard의 basis·status·coverage를 확인하고 specialist의 evidence contract가 닫힌 뒤 결과를 통합합니다. terminal/partial failure는 재할당·main fallback·명시적 GAP 중 하나로 처리하며, 일부 결과만으로 전체 PASS를 선언하지 않습니다.

## Runtime Re-evaluation

최초 prompt가 작은 작업처럼 보여도 tool result나 phase 전환에서 digest, full-content locator, truncation, pagination 같은 typed metadata가 드러나면 owner와 topology를 다시 평가합니다. 본문 문자열에 우연히 `truncated`, `hasMore`, `offset`이 등장했다는 이유만으로 routing을 바꾸지 않습니다.

## Async Boundary

Subagent launch 자체는 작업 완료가 아닙니다. 비동기 실행을 시작한 뒤 같은 턴에서 상태를 반복 조회하면 main agent가 orchestration noise를 만들고, subagent 완료 알림 흐름과 충돌합니다. launch 후에는 사용자에게 시작 사실을 짧게 알리고, 완료 메시지가 돌아온 뒤 필요한 후속 작업을 이어갑니다.

## Failure Mode

크기만 보고 finder/searcher로 고정하면 구현·계획·검증·UI 작업이 main에 남거나 잘못된 권한으로 위임됩니다. 반대로 모든 큰 작업을 worker batch로 보내면 writer 충돌과 stale basis가 생깁니다. 모델을 강하게 바꾸는 것보다 role, topology, handoff, writer, closure 계약을 먼저 확인해야 합니다.
