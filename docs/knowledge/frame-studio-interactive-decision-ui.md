---
title: Frame Studio는 frame 질문을 작업 단위 UI로 묶는다
tags:
  - frame-studio
  - frame
  - glimpse
  - ask-user-question
  - decision-ui
  - co-thinking
  - planning
category: workflow
status: active
applies_to:
  - extensions/frame-studio
  - skills/frame
  - extensions/tft-commands
source:
  - pilee-history:2026-05-06#67
reviewed_at: 2026-05-06
reviewed_commit: ce6b0aae6fdbe21a53d2766d9e4f21988806c94e
related:
  - frame-planning-identity
  - frame-verify-contract
  - ask-user-question-option-design
  - live-artifact-preview-pattern
---

## Judgment

`/frame`은 사용자가 계획을 감사하게 만드는 문서 생성 명령이 아니라, 목표·범위·검증 렌즈를 함께 좁히는 decision gate입니다. Pi text-mode fallback만으로는 이 체감이 약할 수 있으므로, UI가 가능한 환경에서는 Frame Studio가 질문 흐름을 별도 Glimpse 창에 묶어 보여줍니다.

## Identity Rule

Frame Studio의 소유자는 현재 패널이 아니라 작업 단위입니다. worktree가 있으면 worktree identity를 쓰고, home/planning 상태라면 ticket 또는 session planning identity를 씁니다. 이렇게 해야 P0/P1 패널 이동이나 재개가 있어도 같은 frame 대화가 같은 Studio run으로 이어집니다.

## Interaction Rule

Frame Studio는 markdown live view와 single/multi option, 직접 입력을 지원합니다. 사용자가 선택하거나 취소하면 tool 응답으로 돌아오고, headless/no-UI 환경에서는 blocking하지 않고 numbered text fallback으로 내려갑니다.

즉 Frame Studio는 AskUserQuestion 원칙을 대체하지 않습니다. 같은 decision gate를 더 읽기 쉬운 UI로 표현하는 surface입니다.

## Boundary

Frame Studio는 `/frame` co-thinking을 위한 UI 계층입니다. 구현 계획을 자동 생성하거나 검증 완료를 선언하는 도구가 아닙니다. frame 결과의 검증 가능성은 여전히 [frame-verify-contract](./frame-verify-contract.md)와 [evidence-first-verification-gate](./evidence-first-verification-gate.md)의 기준을 따릅니다.
