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
reviewed_at: 2026-06-02
reviewed_commit: 83617e9544615d818e6a7a17fa807f029a7db835
related:
  - terminal-host-integration
  - fork-panel-spatial-continuity
  - session-identity-over-filenames
---

## Judgment

터미널 탭과 split 패널 묶음은 사용자가 기억하는 작업공간입니다. 이를 복원하려면 “어떤 세션을 어떤 탭/패널에 열었는가”라는 workspace snapshot과 “그 탭/패널을 실제 host에서 어떻게 여는가”라는 terminal host adapter를 분리합니다.

## Snapshot Rule

snapshot에는 Ghostty window/tab/terminal id, tab 순서, terminal title, cwd, 연결된 Pi session file, panel label, fork metadata를 저장합니다. session 매핑은 terminal title/cwd만 믿지 말고 현재 떠 있는 Pi session registry를 우선합니다. registry가 없는 오래된 패널은 수동 save에서 최근 session fallback으로 보조하되, 매칭 실패를 숨기지 않고 restore plan에 `SKIP`으로 표시합니다.

## Autosave Rule

autosave는 명시 save를 대체하는 주 복원 경로가 아니라 안전망입니다. Ghostty/macOS 세션에서 시작 30~60초 뒤 첫 확인을 하고 이후 약 1시간마다 `autosave` snapshot을 확인합니다. 다만 실제 snapshot 저장은 각 Pi 패널이 아니라 전역 leader process 하나만 수행합니다. 다른 패널은 active session registry만 갱신하고, leader lease가 살아 있으면 autosave write를 건너뜁니다.

autosave는 시간만 됐다고 파일을 새로 쓰지 않습니다. tab/panel 순서, cwd, terminal title, 연결된 session file, panel label 같은 복원 핵심 필드로 stable hash를 계산하고, 직전 hash와 같으면 `autosave` alias와 archive를 그대로 둡니다. 사용자가 의도한 복원 지점은 여전히 `/workspace save "이름"`으로 남긴 수동 snapshot이 기준이어야 합니다.

전역 `autosave`는 새 Pi 세션이나 단일 패널 창에서도 실행될 수 있으므로, 단일 alias 파일만 덮어쓰면 사용자가 부활시키려던 작업공간을 잃습니다. alias 갱신 전 기존 autosave는 `autosave-YYYYMMDDTHHMMSS` 형태의 versioned archive로 보존하되, archive는 snapshot hash가 바뀌고 tab/panel/session 수·복원 점수 변화 또는 최소 보관 간격이 있을 때만 남깁니다. 또한 기존 autosave에 연결된 session이 있는데 새 snapshot은 session 0개이거나, 기존 다중 panel autosave를 단일 panel snapshot이 크게 낮은 복원 점수로 대체하려는 경우에는 alias 갱신을 건너뛰고 상태 파일에 skip reason을 남깁니다.

autosave archive cleanup은 매 저장마다 무작정 돌리는 사용자가 보는 기능이 아니라 저장소 위생 안전장치입니다. leader autosave가 하루에 한 번 또는 archive pressure가 높을 때 prune하며, 최근 대표 archive와 일/주 단위 대표본만 남겨 전체 autosave archive를 작게 유지합니다. `/workspace list` 기본 목록은 현재 autosave, 수동 snapshot, 대표 archive만 보여주고 오래된 archive는 `/workspace list --all`에서 봅니다. 기본 목록 번호는 `/workspace restore <번호>`와 대응하고, 전체 목록 번호는 `/workspace restore --all <번호>`와 대응합니다.

## Restore Rule

기본 restore mode는 append입니다. workspace 복원은 사용자의 현재 창을 닫거나 대체하지 않고, 새 tab을 추가한 뒤 저장된 session을 `pi --session`으로 다시 엽니다. 새 shell의 PATH는 현재 Pi 프로세스와 다를 수 있으므로 bare `pi`에 의존하지 않고 현재 실행 중인 Pi command 또는 명시 wrapper를 사용합니다. `/workspace list`가 보여주는 번호는 복원 대상 선택 UI의 일부이므로 `/workspace restore 2`처럼 그대로 사용할 수 있어야 합니다.

번호 선택은 “저장 시각”만이 아니라 “복원 가능한 session이 실제로 연결됐는가”와 “얼마나 많은 session/panel을 되살릴 수 있는가”를 우선합니다. 단일 패널 최신 autosave가 목록 1번이나 기본 restore를 차지하면 사용자가 되살리려던 다중 패널 작업공간 대신 현재 디버깅 세션만 열릴 수 있습니다. 따라서 복원 가능한 snapshot을 먼저 정렬하고, 그 안에서는 session/panel 수 기반 복원성 점수가 높은 snapshot을 먼저 둡니다. restore report에는 requested target, resolved snapshot id/path를 함께 표시해 번호 매핑 오류를 즉시 볼 수 있어야 합니다.

## Layout Fidelity Rule

Ghostty AppleScript가 split tree, pane 비율, tty를 안정적으로 노출하지 않으면 exact layout 복원을 약속하지 않습니다. 탭 순서와 패널 수, session/cwd/panel label을 우선 복원하고, split 방향·비율은 순차 split 같은 근사 복원으로 표시합니다. `--dry-run`은 이 근사성과 skip 이유를 사용자에게 먼저 보여주는 안전장치입니다.

## Failure Mode

workspace 복원을 “세션 몇 개를 다시 열기”로만 보면 P0/P1/P2 위치 기억과 cwd/session provenance가 사라집니다. 반대로 host layout fidelity를 과장하면 사용자는 종료 전 화면이 그대로 복원될 것으로 오해합니다. pilee는 복원 가능한 session continuity와 복원 불가능한 host geometry를 명확히 분리해야 합니다.
