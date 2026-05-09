---
title: 색상은 정보 위계다
tags:
  - theme
  - color
  - dim
  - muted
  - border
  - accent
  - ui
  - 색상
category: ui
status: active
confidence: high
applies_to:
  - extensions/custom-style
  - extensions/diff-overlay
  - extensions/backlog
  - extensions/fork-panel
  - extensions/timestamp
  - extensions/idle-screensaver
  - skills/ask-user-question-rules
source:
  - pilee-history:2026-05-03#27
  - pilee-history:2026-05-03#28
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-09
reviewed_commit: 8050064c8c98da577174208778fc7d9f8d6025f5
related:
  - tui-rendering-sanitization
  - terminal-host-integration
---

## Judgment

`dim`과 `muted`는 “덜 중요한 텍스트”의 자동 정답이 아닙니다. 테마에 따라 배경과 섞이면 안내문, help text, AskUserQuestion 입력이 거의 보이지 않을 수 있습니다.

## Hierarchy Rule

주요 내용은 기본 foreground로 읽히게 둡니다. 보조 메타데이터와 separator는 `border` 계열로 낮추고, 현재 선택/입력/강조 상태만 `accent`나 warning/success 색을 씁니다. 색은 장식이 아니라 정보 위계입니다.

## Review Trigger

새 TUI 컴포넌트나 help overlay를 추가할 때는 “흐리게 보이면 예쁘다”보다 실제 테마에서 읽히는지 확인합니다. 색 토큰을 바꾸는 작업은 accessibility 수정으로 취급합니다.

## Panel Metadata Rule

P0/P1/P2 같은 panel label, model name, session metadata는 본문보다 낮은 위계로 보이되 사라질 만큼 흐리면 안 됩니다. metadata는 장식이 아니라 현재 작업 위치를 알려주는 navigation cue이므로, border/muted 계열을 쓰더라도 대비와 길이 제한을 함께 확인합니다.

패널이 많이 만들어지는 revive/panels 목록에서는 `P0`, `P1`, `P2`처럼 자주 회수하는 초기 패널 label에 안정적인 색을 부여할 수 있습니다. 단, `P3+`는 기존 muted/border 계열에 남겨 색상 수를 제한하고, 색은 상태(success/warning)가 아니라 “빠르게 찾기 위한 식별자”로만 사용합니다.
