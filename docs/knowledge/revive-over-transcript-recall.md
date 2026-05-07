---
title: 종료된 포크는 transcript 주입보다 revive가 우선이다
tags:
  - revive
  - recall
  - fork-panel
  - session
  - continuity
  - 세션
category: workflow
status: active
applies_to:
  - extensions/fork-panel
  - extensions/worktree
  - revive workflow
source:
  - pilee-history:2026-05-05#39
  - pilee-history:2026-05-05#40
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: 74e15fcd9f1709efc1b06a1dbb0a1976216ad8c3
related:
  - session-identity-over-filenames
  - fork-panel-parent-inbox
  - worktree-session-continuity
supersedes:
  - fork-panel-recall-command
---

## Judgment

종료된 포크 패널의 전문을 부모 대화에 붙여넣는 것보다, 그 세션 자체를 다시 살리는 편이 더 자연스럽습니다. transcript injection은 부모 컨텍스트를 급격히 더럽히고, 긴 대화일수록 핵심 흐름을 잃게 만듭니다.

## Continuity Rule

회수의 기본 동작은 `/revive`입니다. 사용자는 닫힌 세션 목록에서 제목과 preview를 보고 선택한 뒤, 같은 세션 파일로 새 패널/탭/현재 패널에서 이어갑니다. 전문 복사는 보조 수단이며 기본 UX가 아닙니다.

## Placement Rule

revive는 현재 패널로 복구할지, Ghostty split/tab으로 열지 선택할 수 있어야 합니다. 위치 선택은 단순 편의가 아니라 사용자가 보던 공간 기억의 일부입니다. 세션을 되살리는 작업은 transcript 주입보다 기존 대화 객체와 화면 위치를 함께 복원하는 쪽을 우선합니다.

## Failure Mode

`/recall` 같은 이름은 memory recall과도 충돌하고, “대화 객체를 되살린다”는 사용자 기대와 다릅니다. pilee에서는 종료된 세션도 주소 있는 작업 단위로 다룹니다.
