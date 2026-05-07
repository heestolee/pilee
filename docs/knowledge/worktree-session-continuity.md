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
reviewed_at: 2026-05-07
reviewed_commit: d601ac0041243e78871b352c51f38b50f22be4bb
related:
  - subagent-model-policy
  - pilee-knowledge-system
---

## Overview

pilee의 worktree/fork UX는 “세션을 많이 만들 수 있다”보다 “나중에 어떤 세션이 무엇이었는지 회수할 수 있다”가 중요합니다. 따라서 세션 목록은 파일명이나 방향 label보다 사람이 기억하는 제목, 마지막 의미 있는 요청, workspace 정보를 우선 표시합니다.

## Identification Rule

세션 식별자는 내부 파일명보다 `session_info.name`을 우선합니다. footer에 보이는 세션명은 사용자가 실제로 본 제목이므로, revive나 worktree switch 목록에서 가장 강한 식별 정보입니다. 세션명이 없거나 의미 없는 경우에만 마지막 user/assistant 메시지 요약으로 fallback합니다.

## Continuity Rule

fork-panel에서 종료된 대화는 transcript를 주입하는 것보다 세션 자체를 다시 살리는 편이 자연스럽습니다. 그래서 회수 흐름은 `/recall`식 복사보다 `/revive`식 재개를 중심으로 둡니다. 목록은 현재 workspace를 기본 scope로 보여주되, 필요할 때 전체 workspace를 확장해 탐색할 수 있어야 합니다.

## Context Sharing Rule

fork-panel의 handoff는 패널 생명주기와 분리합니다. 자식 패널이 닫혀야만 맥락이 전달되는 구조는 사용자가 불필요하게 패널을 종료하게 만들고, 즉시 follow-up 주입은 부모 대화 흐름을 끊을 수 있습니다. 기본 handoff는 parent inbox에 unread 항목으로 저장하고, 부모가 `/panels`에서 선택해 입력창에 삽입하거나 명시적으로 follow-up 전송할 때만 대화 컨텍스트에 들어옵니다.

자식 패널은 부모 기준 `P1`, `P2` 같은 주소를 갖고, 그 label을 입력창 메타 영역에 표시합니다. 부모 패널은 명시적으로 `P0`로 표시해 현재 세션이 handoff의 기준점임을 드러냅니다. `/handoff --inject`와 `/done --inject`는 부모를 즉시 interrupt해도 되는 상황에서만 쓰는 강한 옵션이고, 예기치 않은 종료 fallback은 inbox 저장으로 처리합니다.

## Display Guardrail

TUI 목록 row는 반드시 단일 행이어야 합니다. preview나 label에 newline, code block, ANSI/control 문자가 남아 있으면 화면 전체가 깨질 수 있습니다. 과거 저장 데이터가 multi-line이어도 렌더링 단계에서 정규화하고 폭을 제한해야 합니다.

## Migration Lesson

외부 세션 기록을 pilee JSONL로 변환할 때는 message만 옮기지 말고 원본 시스템의 session title도 `session_info.name`으로 보존합니다. 의미 없는 `Untitled`는 제외하고, 메시지가 없는 세션은 title만으로 파일을 만들지 않습니다. 이 원칙은 [subagent-model-policy](./subagent-model-policy.md)처럼 agent fan-out이 늘어날수록 더 중요해집니다.
