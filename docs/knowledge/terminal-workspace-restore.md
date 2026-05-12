---
title: 터미널 workspace 복원은 snapshot과 host adapter를 분리한다
tags:
  - workspace
  - terminal
  - ghostty
  - snapshot
  - restore
  - session
category: runtime
status: active
confidence: high
applies_to:
  - extensions/workspace
  - extensions/fork-panel
source:
  - user-direction:2026-05-12-workspace-save-restore
reviewed_at: 2026-05-12
reviewed_commit: e6ef5c6fe908828c5731428051c4886fa3559372
related:
  - terminal-host-integration
  - fork-panel-spatial-continuity
  - session-identity-over-filenames
---

## Judgment

터미널 탭과 split 패널 묶음은 사용자가 기억하는 작업공간입니다. 이를 복원하려면 “어떤 세션을 어떤 탭/패널에 열었는가”라는 workspace snapshot과 “그 탭/패널을 실제 host에서 어떻게 여는가”라는 terminal host adapter를 분리합니다.

## Snapshot Rule

snapshot에는 Ghostty window/tab/terminal id, tab 순서, terminal title, cwd, 연결된 Pi session file, panel label, fork metadata를 저장합니다. session 매핑은 terminal title/cwd만 믿지 말고 현재 떠 있는 Pi session registry를 우선합니다. registry가 없는 오래된 패널은 수동 save에서 최근 session fallback으로 보조하되, 매칭 실패를 숨기지 않고 restore plan에 `SKIP`으로 표시합니다.

## Restore Rule

기본 restore mode는 append입니다. workspace 복원은 사용자의 현재 창을 닫거나 대체하지 않고, 새 tab을 추가한 뒤 저장된 session을 `pi --session`으로 다시 엽니다. 새 shell의 PATH는 현재 Pi 프로세스와 다를 수 있으므로 bare `pi`에 의존하지 않고 현재 실행 중인 Pi command 또는 명시 wrapper를 사용합니다.

## Layout Fidelity Rule

Ghostty AppleScript가 split tree, pane 비율, tty를 안정적으로 노출하지 않으면 exact layout 복원을 약속하지 않습니다. 탭 순서와 패널 수, session/cwd/panel label을 우선 복원하고, split 방향·비율은 순차 split 같은 근사 복원으로 표시합니다. `--dry-run`은 이 근사성과 skip 이유를 사용자에게 먼저 보여주는 안전장치입니다.

## Failure Mode

workspace 복원을 “세션 몇 개를 다시 열기”로만 보면 P0/P1/P2 위치 기억과 cwd/session provenance가 사라집니다. 반대로 host layout fidelity를 과장하면 사용자는 종료 전 화면이 그대로 복원될 것으로 오해합니다. pilee는 복원 가능한 session continuity와 복원 불가능한 host geometry를 명확히 분리해야 합니다.
