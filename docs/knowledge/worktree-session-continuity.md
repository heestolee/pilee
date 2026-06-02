---
title: Worktree 세션 연속성과 식별성 원칙
tags:
  - worktree
  - session
  - revive
  - fork-panel
  - panel-inbox
  - handoff
  - conductor
  - switch
  - resume
  - title
  - continuity
  - context
  - 워크트리
  - 세션
category: workflow
status: active
confidence: high
applies_to:
  - extensions/worktree
  - /wt switch
  - /wt resume
  - /wt sessions
  - extensions/fork-panel
  - session_info.name
  - revive workflow
  - panels inbox
  - handoff done workflow
source:
  - pilee-history:2026-05-04#38
  - pilee-history:2026-05-05#39
  - pilee-history:2026-05-05#40
  - pilee-history:2026-05-05#41
  - pilee-history:2026-05-05#42
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-05-12-wt-switch-session-unification
  - user-direction:2026-05-12-minimal-worktree-handoff
  - user-direction:2026-05-17-full-worktree-fork-default
reviewed_at: 2026-06-02
reviewed_commit: 63f2a622f7539ebd582b9af2b392c6de9ee47d47
related:
  - subagent-model-policy
  - pilee-knowledge-system
  - frame-plan-synthesis-continuity
---

## Overview

pilee의 worktree/fork UX는 “세션을 많이 만들 수 있다”보다 “나중에 어떤 세션이 무엇이었는지 회수할 수 있다”가 중요합니다. 따라서 세션 목록은 파일명이나 방향 label보다 사람이 기억하는 제목, 마지막 의미 있는 요청, workspace 정보를 우선 표시합니다.

## Identification Rule

세션 식별자는 내부 파일명보다 `session_info.name`을 우선합니다. footer에 보이는 세션명은 사용자가 실제로 본 제목이므로, revive나 worktree switch 목록에서 가장 강한 식별 정보입니다. 세션명이 없거나 의미 없는 경우에만 마지막 user/assistant 메시지 요약으로 fallback합니다.

## Continuity Rule

fork-panel에서 종료된 대화는 transcript를 주입하는 것보다 세션 자체를 다시 살리는 편이 자연스럽습니다. 그래서 회수 흐름은 `/recall`식 복사보다 `/revive`식 재개를 중심으로 둡니다. 목록은 현재 workspace를 기본 scope로 보여주되, 필요할 때 전체 workspace를 확장해 탐색할 수 있어야 합니다.

홈/planning 세션에서 만든 ticket-bound `frame.json`은 worktree 생성·전환 시 같은 ticket의 worktree `.pi/frame.json`으로 자동 승격되어야 합니다. 이것은 세션 transcript carry와 별개로 canonical 계약을 옮기는 단계입니다. `/wt fork`처럼 사용자가 “현재 대화에서 worktree로 분기한다”고 기대하는 흐름은 전체 transcript를 기본으로 복사해야 “같은 작업이 실행 공간을 얻었다”는 연속성이 생깁니다. 이때 planning work-unit의 task board도 새 worktree `.pi/work-tasks.json`으로 함께 승격되어야 합니다. frame만 승격되고 slice/verify task가 비면 overlay가 빈 작업처럼 보이므로 세션 연속성이 깨집니다. 토큰/오염 위험 때문에 가볍게 넘기고 싶을 때만 `--minimal-context` / `minimalContext: true`를 명시합니다.

## Worktree Entry Rule

기본 진입점은 `/wt switch`입니다. 사용자가 작업공간으로 돌아간다는 것은 “워크트리만 이동”이 아니라 “그 워크트리 안에서 이어갈 세션을 고른다”는 뜻이므로, `/wt switch`는 워크트리 선택 다음에 해당 worktree session picker까지 이어져야 합니다. `/wt sessions`는 독립 UX가 아니라 호환 alias로 남겨 같은 session picker 흐름을 호출합니다.

`/wt resume <workspace>`는 Conductor workspace 하나를 선택한 세션만 복구하지 않습니다. 해당 workspace의 Conductor 세션 전체를 Pi session으로 hydrate하고, 각 변환 세션에 source metadata를 남겨 재실행 시 중복 변환을 피합니다. hydrate가 끝나면 `/wt switch <workspace>`와 같은 세션 선택 흐름으로 이어져야 합니다. 복구된 Pi session 자체가 원본 transcript를 갖고 있으므로, workspace-level `conductor-context.md`가 특정 active Conductor session 요약을 다음 turn에 잘못 주입하지 않도록 `.loaded.md`로 보존 처리합니다.

`/revive`는 전역 회수 도구입니다. P0/P1/P2 패널, 전체 Pi 세션, split/tab 복구처럼 “어디 있던 세션인지 모르지만 되살린다”가 목적입니다. 반면 `/wt switch`는 “이 worktree로 돌아가 이어 한다”는 작업공간 중심 진입점입니다. 세션 목록 기능이 겹치더라도 사용자가 기억해야 할 기본 명령은 `/wt switch`와 `/revive` 두 개로 줄입니다.

## Context Sharing Rule

worktree 생성의 context sharing은 command 의미에 맞춰 나뉩니다. `/wt fork`와 `worktree_fork`는 현재 패널 대화의 조사·판단·파일 포인터를 그대로 이어받는 것이 사용자 기대이므로 full transcript를 기본으로 복사합니다. P0/P1/P2는 위치 표시일 뿐 기본 source를 바꾸지 않습니다. 반대로 `/wt new`는 깨끗한 세션이고, `--minimal-context` / `minimalContext: true`를 명시한 경우에만 최근 user prompt, source session `/archive <path>` reference, 선택적 summary를 담은 최소 전달 pack을 붙입니다.

최소 전달 정보도 “보조 힌트”가 아니라 복구 가능한 artifact입니다. 새 session JSONL에 실제 `worktree-context` custom message로 persist되어야 하며, `.pi/worktree-meta.json`에는 `context.mode`, source session file/title/cwd, target session file, full transcript copy 여부가 남아야 합니다. UI의 cwd binding도 `전문 계승`, `최소 전달 메모 저장`, `대체 전달 메모 저장`처럼 실제 전달 상태를 말해야 합니다. handoff를 숨긴다는 뜻은 전달 사실을 감추는 것이 아니라, 사용자가 별도 handoff 절차를 수행해야만 worktree를 만들 수 있는 UX를 없앤다는 뜻입니다.

fork-panel의 handoff는 패널 생명주기와 분리합니다. 자식 패널이 닫혀야만 맥락이 전달되는 구조는 사용자가 불필요하게 패널을 종료하게 만들고, 즉시 follow-up 주입은 부모 대화 흐름을 끊을 수 있습니다. 기본 handoff는 parent inbox에 unread 항목으로 저장하고, 부모가 `/panels`에서 선택해 입력창에 삽입하거나 명시적으로 follow-up 전송할 때만 대화 컨텍스트에 들어옵니다.

자식 패널은 부모 기준 `P1`, `P2` 같은 주소를 갖고, 그 label을 입력창 메타 영역에 표시합니다. 부모 패널은 명시적으로 `P0`로 표시해 현재 세션이 handoff의 기준점임을 드러냅니다. `/handoff --inject`와 `/done --inject`는 부모를 즉시 interrupt해도 되는 상황에서만 쓰는 강한 옵션이고, 예기치 않은 종료 fallback은 inbox 저장으로 처리합니다.

## Display Guardrail

TUI 목록 row는 반드시 단일 행이어야 합니다. preview나 label에 newline, code block, ANSI/control 문자가 남아 있으면 화면 전체가 깨질 수 있습니다. 과거 저장 데이터가 multi-line이어도 렌더링 단계에서 정규화하고 폭을 제한해야 합니다.

## Migration Lesson

외부 세션 기록을 pilee JSONL로 변환할 때는 message만 옮기지 말고 원본 시스템의 session title도 `session_info.name`으로 보존합니다. 의미 없는 `Untitled`는 제외하고, 메시지가 없는 세션은 title만으로 파일을 만들지 않습니다. 이 원칙은 [subagent-model-policy](./subagent-model-policy.md)처럼 agent fan-out이 늘어날수록 더 중요해집니다.
