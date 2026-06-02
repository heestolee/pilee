---
title: 장시간 세션은 phase와 stop-line으로 제어한다
tags:
  - workflow
  - guard
  - checkpoint
  - validation
  - commit
  - heartbeat
category: workflow
status: active
confidence: high
applies_to:
  - skills/incremental-implementation
  - skills/git-workflow-and-versioning
  - extensions/workflow-guard
source:
  - user-direction:2026-05-27-long-running-session-friction
reviewed_at: 2026-06-02
reviewed_commit: fad9c363005bba6afcb9fecd6a1d5475b32c4ea9
related:
  - workflow-guard-enforced-flow
  - workflow-weight-proportionality
  - work-context-card-task-board
  - change-integration-discipline
title_en: Long-running sessions are controlled by phases and stop-lines
---

## Overview

긴 구현 세션의 실패는 보통 “작업이 컸다”가 아니라, 구현·검증·커밋·UI 확인·PR 준비가 하나의 흐름으로 이어지며 사용자가 완료 지점을 보지 못할 때 발생합니다. pilee의 기본값은 긴 작업을 계속 밀어붙이는 것이 아니라, phase를 라벨링하고 stop-line마다 보고하는 것입니다.

## Phase Model

긴 작업은 다음 phase로 나눕니다.

1. 구조 파악
2. 구현
3. 기계 검증
4. 커밋
5. UI/수동 검증
6. PR/push

phase가 바뀌면 최소 한 줄로 현재 상태와 다음 stop-line을 보고합니다. 특히 커밋이 만들어졌다면 구현/기계 검증 phase는 닫힌 것이므로, UI 검증이나 PR 작업을 계속하기 전에 먼저 보고합니다.

## Checkpoint Rules

- **30분 checkpoint**: 현재 phase, 완료한 것, 남은 것, 차단 가능성을 보고합니다.
- **60분 checkpoint**: 계속 진행할지, 부분 커밋/부분 handoff로 끊을지 확인합니다.
- **2-failure validation gate**: 같은 lint/test/type-check/codegen 계열이 두 번 실패하면 원인, 수정한 것, 남은 선택지를 보고합니다.
- **commit-complete stop-line**: 커밋 완료 후에는 무조건 보고합니다. UI 검증, PR, push는 사용자가 이미 요청했거나 별도 phase로 동의된 경우에만 이어갑니다.
- **environment gate**: 로컬 서버, 로그인, 권한, 데이터 세팅 문제는 5~10분 이상 main flow를 붙잡지 않습니다. BLOCKED 또는 선택지로 보고합니다.

## Continue Rule

`continue`/compaction/세션 전환 직후에는 오래된 transcript를 다시 훑어 불확실성을 해소하지 않습니다. current context card, current slice/task, git status, 현재 변경 파일만 확인하고, 이미 있는 discovery/frame은 우선 신뢰합니다.

## Why It Matters

agent는 “조금만 더 확인하면 완전히 닫힌다”는 판단을 반복하기 쉽습니다. 하지만 사용자는 완료 지점과 차단 지점을 먼저 알아야 작업을 운영할 수 있습니다. stop-line은 검증을 생략하는 규칙이 아니라, 검증을 phase로 분리해 사용자가 진행을 통제하게 하는 규칙입니다.
