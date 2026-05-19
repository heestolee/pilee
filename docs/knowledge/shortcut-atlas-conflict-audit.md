---
title: Shortcut Atlas는 단축키 표면을 한 번에 검토한다
tags:
  - shortcuts
  - keybindings
  - overlay
  - collision
  - audit
  - ui
category: ui
status: active
confidence: high
applies_to:
  - extensions/shortcut-atlas
  - scripts/knowledge.mjs
  - README.md
source:
  - user-direction:2026-05-20-shortcut-atlas
reviewed_at: 2026-05-20
reviewed_commit: 7ea10e491f6879877d71fa09f3671ed4c8c0d7bb
related:
  - task-work-map-overlay
  - terminal-host-integration
  - theme-information-hierarchy
  - readme-coverage-map
---

## Judgment

단축키가 늘어나면 “기억해야 할 목록”보다 먼저 필요한 것은 충돌을 볼 수 있는 지도입니다. 사용자는 터미널 host 단축키, Pi 기본 keybinding, pilee custom shortcut을 별도 문서에서 찾아 맞춰보지 않고 한 화면에서 확인할 수 있어야 합니다.

## Rule

`/shortcuts`는 단축키 atlas입니다.

- `terminal` — Ghostty/macOS/Glimpse host처럼 Pi TUI 밖에서 먼저 처리될 수 있는 host 단축키
- `pi` — Pi 기본 keybinding 문서의 editor/app/session/model/tree/message queue 단축키
- `pilee` — pilee extension이 `pi.registerShortcut()`로 등록하는 custom 단축키

Atlas는 단축키를 단순 나열하지 않고 collision 상태를 함께 보여줍니다.

- `custom-collision`은 error입니다. 같은 key가 여러 pilee custom action에 등록되면 사용자가 어느 기능이 실행될지 예측할 수 없습니다.
- `reserved-overlap`은 warning입니다. pilee custom이 Pi/terminal 기본 shortcut과 같은 key를 쓸 수는 있지만, 실제 우선순위와 사용 맥락을 의식해야 합니다.
- Pi 내부 scoped duplicate는 info입니다. editor/tree/session selector처럼 서로 다른 화면에서 같은 key를 쓰는 것은 보통 정상입니다.

## Source Coverage Rule

pilee custom shortcut 목록은 사람이 읽는 curated atlas이지만, source scan으로 literal `registerShortcut("...")` 호출도 검사합니다. literal shortcut이 registry에 없으면 `/shortcuts` overlay와 `npm run test:shortcut-atlas`가 빠진 key를 드러내야 합니다.

동적 등록처럼 정적 scan이 잡기 어려운 shortcut은 curated registry에 명시합니다. 예: fork-panel 방향키 배열.

Terminal/host shortcut은 추측으로 적지 말고 가능한 경우 host가 제공하는 목록을 기준으로 갱신합니다. Ghostty 기본 동작은 `ghostty +list-keybinds`를 기준으로 Cmd+T 탭, Cmd+D split, Cmd+Shift+]/[ 탭 이동, Cmd+Alt+Arrow split focus, 검색/폰트/스크롤 동작을 atlas의 `terminal` layer에 둡니다.

## Test Contract

`npm run test:shortcut-atlas`는 다음 계약을 고정합니다.

- Pi custom renderer가 `render(width)`처럼 height 없이 호출돼도 atlas body rows를 렌더한다. height는 terminal rows 또는 안전한 기본값으로 fallback한다.
- modifier normalize가 `Ctrl+Shift+O`, `Cmd+-`, `Ctrl+-`, `Super+T` 같은 host key 표기를 잃지 않는다.
- Ghostty host shortcut의 탭/split/search 대표 키가 terminal layer에 포함된다.
- 현재 pilee custom shortcut 사이에는 blocking collision이 없다.
- 의도적으로 중복 custom key를 넣으면 `custom-collision` error가 발생한다.
- custom이 `Ctrl+C` 같은 Pi reserved key와 겹치면 warning으로 드러난다.
- `/shortcuts` command가 실제 overlay render에서 `Ctrl+Shift+O`와 conflict/source scan summary를 보여준다.

## Boundary

Atlas는 keybinding source of truth를 대체하지 않습니다. Pi 기본 keybinding의 canonical source는 Pi keybindings 문서와 사용자 `~/.pi/agent/keybindings.json`이고, terminal shortcut의 실제 처리 우선순위는 host app이 가집니다. Atlas는 사용자가 충돌 가능성을 빠르게 보고, pilee custom shortcut을 추가할 때 안전하게 고르는 검토 표면입니다.
