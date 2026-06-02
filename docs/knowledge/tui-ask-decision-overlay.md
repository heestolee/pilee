---
title: TUI 질문은 작은 의사결정 게이트다
tags:
  - tui
  - ask-user-question
  - decision-gate
  - tool
  - overlay
category: workflow
status: active
confidence: high
applies_to:
  - extensions/tui-ask
  - skills/ask-user-question-rules
  - skills/tft-guidelines
source: public
reviewed_at: 2026-06-02
reviewed_commit: d8f8c4c56f23dcfda08b089b6d8ff5be4885e37c
related:
  - ask-user-question-decision-gates
  - ask-user-question-option-design
  - tui-rendering-sanitization
title_en: TUI Ask is a lightweight decision gate
---

# TUI 질문은 작은 의사결정 게이트다

## 판단

작은 선택을 받기 위해 별도 WebView/Studio artifact를 만들 필요는 없다. 브랜치명 선택, PR Intent 선택, yes/no 승인, 2~5개 옵션 비교처럼 **결정 자체가 짧고 결과만 다음 행동을 바꾸는 게이트**는 터미널 TUI overlay로 묻는다.

## 규칙

- `tui_ask`는 Pi terminal 안에서 single choice, multi choice, direct text를 받는다.
- 옵션/직접입력 라벨은 terminal 폭 안에서 줄바꿈해야 하며, 긴 문구를 primary evidence처럼 사용자가 읽는 상태에서 오른쪽으로 잘라내지 않는다.
- UI가 없는 실행 컨텍스트에서는 실패로 간주하지 않고 `unavailable`과 numbered text fallback을 반환한다.
- 옵션은 행동 분기 중심으로 작성한다. “충분하다” 같은 의례적 옵션보다 “branch rename”, “현재 branch 유지”, “직접 입력”처럼 다음 작업이 달라지는 표현을 쓴다.
- Ask overlay는 주변 Pi transcript와 시각적으로 구분되어야 한다. 밝은 카드 배경, 선택 row 배경, product primary 계열 accent처럼 질문/선택 상태가 즉시 보이는 대비를 사용하고, 각 렌더 라인은 terminal width를 넘지 않게 padding/truncation한다.
- Frame/Decide/Verify처럼 긴 사고 전문과 artifact가 필요한 작업은 TFT Studio를 쓸 수 있지만, 단발성 PR/create-pr 게이트는 TUI 질문을 우선한다.

## Review trigger

- 새 질문 surface가 WebView/Studio를 열기만 하고 결과가 단순 선택이면 `tui_ask`로 대체 가능한지 검토한다.
- TUI overlay가 raw ANSI/newline 때문에 깨지면 [TUI 렌더링 경계에서는 문자열을 신뢰하지 않는다](./tui-rendering-sanitization.md)를 같이 확인한다.
