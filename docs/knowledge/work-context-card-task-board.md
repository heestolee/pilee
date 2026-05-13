---
title: Working Context Card는 큰 맥락을 현재 slice로 압축한다
tags:
  - work-context
  - tasks
  - workflow
  - context
  - guard
category: workflow
status: active
confidence: high
applies_to:
  - extensions/work-context
  - extensions/utils/work-context.ts
  - extensions/tasks
  - extensions/workflow-guard
  - extensions/frame-studio
  - skills/frame
source:
  - user-direction:2026-05-13-working-context-card
reviewed_at: 2026-05-13
reviewed_commit: e0dc999e580d0ff1f1940470f7a8f2a20d2920f5
related:
  - frame-studio-interactive-decision-ui
  - frame-plan-synthesis-continuity
  - workflow-guard-enforced-flow
  - worktree-session-continuity
  - ambient-status-surfaces
title_en: Working Context Card compresses large context into the current slice
---

## Judgment

풀스택 기능 구현에는 큰 맥락이 필요하지만, 전체 transcript를 매 턴 LLM context에 싣는 것은 좋은 절충점이 아닙니다. 오래된 시행착오, 폐기된 결정, 로그 노이즈가 현재 판단과 같은 무게로 섞이면 오히려 base branch, hotfix 여부, 현재 slice, 열린 결정 같은 실행 조건을 놓칩니다.

pilee의 절충점은 **큰 맥락은 artifact로 보존하고, 실행 순간에는 Working Context Card만 들고 가는 것**입니다.

## Card Contract

Working Context Card는 work-unit scoped JSON입니다.

- worktree가 있으면 `<worktree>/.pi/work-context.json`
- task board는 같은 단위의 `<worktree>/.pi/work-tasks.json`
- planning/session 상태는 identity별 local state dir을 사용합니다.

카드는 다음만 담습니다.

1. goal — 지금 달성하려는 결과
2. currentSlice — 지금 구현/검증 중인 slice와 허용 scope
3. mustKeep — 깨지면 안 되는 계약
4. mustNot — 지금 건드리지 않을 범위와 금지 조건
5. openQuestions — 사용자/외부 결정이 필요한 항목
6. verifyFocus — 이 slice/작업을 닫을 증거 축
7. refs — frame, transcript, tasks, archive 링크

전체 대화 전문, 긴 로그, 폐기된 안은 카드에 넣지 않습니다. 그런 raw context는 TFT Studio transcript, `/archive`, frame provenance로 다시 열 수 있게만 연결합니다.

## Task Board Rule

`tasks`는 agent 내부 todo가 아니라 work-unit의 외부 기억장치입니다. 기본 표시 우선순위는 다음과 같습니다.

1. `owner=user` 또는 `kind=decision` — 사용자가 봐야 하는 결정
2. `in_progress` slice — 지금 agent가 작업 중인 단위
3. blocked task — 진행을 막는 대기 상태
4. next slice / verify task
5. completed task는 접어서 보조 정보로 둡니다.

Frame이 저장되면 `implementation_plan.slices[]`는 `kind=slice`, `risk_register.needs_decision`은 `kind=decision owner=user`, `verify_plan.manual_checks`는 `kind=verify` task로 내려갑니다. 이렇게 해야 사용자가 todo를 “agent가 알아서 처리하는 목록”이 아니라 “내가 개입해야 하는 판단과 현재 실행 단위”로 읽을 수 있습니다.

## Guard Rule

`workflow-guard`는 Working Context Card를 hard gate의 입력으로 사용합니다.

- standard/full 구현에서 currentSlice가 없으면 먼저 slice를 고정해야 합니다.
- currentSlice가 열린 decision에 막혀 있으면 관련 mutation/commit을 막습니다.
- currentSlice scope 밖 파일이 포함되면 card를 갱신하거나 slice를 바꾸기 전까지 mutation/commit을 막습니다.
- 예외가 필요하면 카드 자체를 업데이트해 scope 변경을 명시하거나, 명시적 bypass 주석으로 의도를 남깁니다.

이 gate는 사용자를 더 자주 방해하기 위한 것이 아니라, 큰 context가 필요한 작업에서 가장 중요한 실행 조건을 작은 card로 고정하기 위한 장치입니다.

## TFT Studio Rule

TFT Studio는 같은 work-unit의 카드 요약을 상단에 보여줍니다. Frame/Decide/Verify/Verify Report tab은 전문을 모두 현재 LLM context에 밀어 넣지 않고, `contextDigest`, `transcriptRef`, `workContext` snapshot을 반환합니다.

사용자는 Studio에서 현재 목표, current slice, 사용자 결정 대기, verify focus를 바로 볼 수 있어야 합니다. 자세한 과거 전문은 `/archive <transcriptPath>`로 열고, 현재 실행은 카드와 task board를 기준으로 진행합니다.

## Boundary

Working Context Card는 `frame.json`을 대체하지 않습니다. `frame.json`은 목표·성공 기준·검증 계약의 canonical source이고, Working Context Card는 그 계약에서 파생된 mutable execution state입니다. 둘이 충돌하면 frame/decision/verify canonical을 먼저 고치고, card를 다시 refresh합니다.
