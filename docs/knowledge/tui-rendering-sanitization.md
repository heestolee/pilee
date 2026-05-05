---
title: TUI 렌더링 경계에서는 문자열을 신뢰하지 않는다
tags:
  - tui
  - rendering
  - newline
  - ansi
  - sanitize
  - terminal
  - ui
category: ui
status: active
applies_to:
  - extensions/fork-panel
  - extensions/backlog
  - extensions/timestamp
  - extensions/diff-overlay
  - extensions/claude-code-ui
source:
  - pilee-history:2026-05-05#39
  - pilee-history:2026-05-05#51
  - pilee-history:2026-05-05#53
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - mcp-stderr-isolation
  - theme-information-hierarchy
  - terminal-host-integration
---

## Judgment

TUI row에 들어가는 문자열은 저장된 preview, 외부 출력, 사용자 입력을 그대로 믿으면 안 됩니다. newline, code fence, ANSI/control char가 남아 있으면 pi-tui의 단일 행 계약을 깨고 화면 전체가 무너집니다.

## Render Rule

목록 row는 단일 행입니다. 렌더링 직전에 newline과 control char를 제거하고, 폭을 계산해 잘라야 합니다. 과거 저장 데이터가 multi-line이어도 migration에 기대지 말고 render boundary에서 정규화합니다.

## Detail Rule

긴 노트나 전문은 row에 억지로 넣지 않습니다. detail view에 scroll state를 두고 PgUp/PgDn, j/k 같은 이동을 제공합니다. 한 줄 목록과 긴 본문 화면은 다른 UI 계약입니다.
