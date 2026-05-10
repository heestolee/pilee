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
confidence: high
applies_to:
  - extensions/fork-panel
  - extensions/worktree
  - revive workflow
source:
  - pilee-history:2026-05-05#39
  - pilee-history:2026-05-05#40
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-10
reviewed_commit: 50cfaca9c91ff34d0765227845530269cbb3b505
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

회수의 기본 동작은 `/revive`입니다. 사용자는 닫힌 세션 목록에서 제목과 preview를 보고 선택한 뒤, 같은 세션 파일로 새 패널/탭/현재 패널에서 이어갑니다. 이때 세션 파일만 바꾸면 안 되고, 해당 세션이 대화하던 cwd/worktree도 함께 복원합니다. fork-panel이 과거 세션 파일을 복사해 만들면 session header의 cwd가 record cwd와 다를 수 있으므로, revive 직전에 실제 존재하는 record/session cwd로 header cwd를 보정합니다. 현재 패널에서 여는 경우에는 Pi runtime뿐 아니라 살아 있는 Node process cwd도 `process.chdir()`로 맞춥니다. worktree-bound session을 현재 패널에서 열 때도 tool 실행 기준이 원 세션의 worktree가 되게 합니다. 전문 복사는 보조 수단이며 기본 UX가 아닙니다.

## Placement Rule

revive는 현재 패널로 복구할지, Ghostty split/tab으로 열지 선택할 수 있어야 합니다. 위치 선택은 단순 편의가 아니라 사용자가 보던 공간 기억의 일부입니다. 세션을 되살리는 작업은 transcript 주입보다 기존 대화 객체와 화면 위치를 함께 복원하는 쪽을 우선합니다.

## P0 Inclusion Rule

`/revive`는 fork-panel 자식 기록만 보여주는 도구가 되어서는 안 됩니다. 사용자가 “과거 세션”을 찾을 때는 부모 패널(P0)에서 진행한 일반 Pi 세션도 같은 회수 후보입니다. 따라서 revive 목록은 fork-panel recent metadata의 P1/P2… 세션과 `~/.pi/agent/sessions` 아래의 일반 Pi session JSONL을 함께 스캔하고, 일반 세션에는 `P0` label을 표시합니다.

P0 세션을 split/tab으로 열 때는 `PI_FORK_ID`/`PI_FORK_PANEL_LABEL` 같은 child-panel env를 주입하지 않습니다. P0를 다시 여는 것은 새 fork handoff 대상을 만드는 것이 아니라 기존 부모 대화 객체를 재개하는 동작이기 때문입니다.

## Failure Mode

`/recall` 같은 이름은 memory recall과도 충돌하고, “대화 객체를 되살린다”는 사용자 기대와 다릅니다. pilee에서는 종료된 세션도 주소 있는 작업 단위로 다룹니다.
