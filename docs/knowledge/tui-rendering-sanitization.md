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
confidence: high
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
  - user-feedback:2026-09-01-diff-commit-file-arrow-selection
reviewed_at: 2026-09-01
reviewed_commit: 8c1ef4c295f74256f6078ef40597c2a5e9acf161
related:
  - mcp-stderr-isolation
  - theme-information-hierarchy
  - terminal-host-integration
---

## Judgment

TUI row에 들어가는 문자열은 저장된 preview, 외부 출력, 사용자 입력을 그대로 믿으면 안 됩니다. newline, code fence, ANSI/control char가 남아 있으면 pi-tui의 단일 행 계약을 깨고 화면 전체가 무너집니다.

## Render Rule

목록 row는 단일 행입니다. 렌더링 직전에 newline과 control char를 제거하고, 폭을 계산해 잘라야 합니다. 과거 저장 데이터가 multi-line이어도 migration에 기대지 말고 render boundary에서 정규화합니다.

Panel label이나 model metadata처럼 짧아 보이는 값도 렌더링 경계에서는 문자열입니다. `P0 · model` 같은 affordance는 한 줄로 제한하고, 외부 값이 길어지거나 control char를 포함해도 editor layout을 깨지 않게 정규화합니다.

## Detail Rule

긴 노트나 전문은 row에 억지로 넣지 않습니다. detail view에 scroll state를 두고 PgUp/PgDn, j/k 같은 이동을 제공합니다. 한 줄 목록과 긴 본문 화면은 다른 UI 계약입니다.

commit history처럼 탐색 목록과 전문이 함께 필요한 화면은 왼쪽 목록을 한 줄로 유지하고, 선택한 commit의 전체 메시지를 오른쪽 detail 상단에 둡니다. 메시지와 changed files/diff는 nested scroll로 분리하지 않고 하나의 vertical surface로 이어 붙여 문맥을 잃지 않게 합니다. 전문은 기본 펼침으로 두되 명시적 toggle로 파일 공간을 회수할 수 있어야 하며, uncommitted row에는 존재하지 않는 commit message 영역을 만들지 않습니다.

하나의 vertical surface로 합치는 것은 changed files의 선택 계약을 없앤다는 뜻이 아닙니다. 파일이 있으면 `↑/↓`와 `j/k`는 선택 파일을 이동하고, 긴 surface 이동은 `PgUp/PgDn`, `u/i`, `g/G`가 담당합니다. 커밋 메시지 같은 상세 본문을 추가하면서 기존 화살표 목록 탐색을 전체 surface 스크롤로 재할당하면 안 됩니다. 선택할 파일이 없는 커밋에서만 `↑/↓`를 긴 메시지 스크롤 fallback으로 사용할 수 있습니다.

Git의 `%B`처럼 외부에서 읽은 multiline text도 newline·문단·bullet만 보존하고 ANSI/control sequence는 render boundary에서 제거합니다. scroll indicator는 content row를 덮지 않도록 별도 줄을 예약해 마지막 본문·파일까지 접근 가능해야 합니다.
