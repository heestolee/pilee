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
applies_to:
  - extensions/custom-style
  - extensions/diff-overlay
  - extensions/backlog
  - extensions/timestamp
  - extensions/idle-screensaver
  - skills/ask-user-question-rules
source:
  - pilee-history:2026-05-03#27
  - pilee-history:2026-05-03#28
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
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
