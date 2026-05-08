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
confidence: high
applies_to:
  - extensions/frame-studio
  - skills/frame
  - extensions/tft-commands
source:
  - pilee-history:2026-05-06#67
  - pilee-history:2026-05-07#73
reviewed_at: 2026-05-08
reviewed_commit: fdf91a44f626b47846fb59501575357657fd8ef3
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

Frame Studio는 markdown live view와 single/multi option, 직접 입력을 지원합니다. markdown live view는 frame draft의 success criteria처럼 표가 핵심인 문서를 그대로 읽을 수 있어야 하므로 GitHub-style pipe table(`| header |`, `|---|`)을 table로 렌더링합니다. 표가 raw pipe paragraph로 깨지면 검증 기준을 함께 좁히는 UI 목적을 잃습니다.

사용자가 선택하거나 취소하면 tool 응답으로 돌아오고, headless/no-UI 환경에서는 blocking하지 않고 numbered text fallback으로 내려갑니다. 질문 대기는 agent turn을 붙잡는 blocking 상태라서 무한 대기하지는 않지만, 실제 frame 검토는 긴 회의/휴식 후에도 이어질 수 있으므로 기본 timeout은 짧은 30분이 아니라 작업 세션 단위의 긴 window로 둡니다.

사용자가 선택한 뒤에는 완료 카드가 선택값·직접 입력값·원 질문을 남겨 “Pi가 다음 단계를 준비 중”임을 보여줍니다. 즉 선택 직후 질문 UI가 사라져도 사용자가 방금 무엇을 제출했는지 화면에서 확인할 수 있어야 합니다.

즉 Frame Studio는 AskUserQuestion 원칙을 대체하지 않습니다. 같은 decision gate를 더 읽기 쉬운 UI로 표현하는 surface입니다.

## Transcript Rule

Frame Studio는 UI에 렌더된 markdown/update/question/answer 흐름을 identity별 transcript JSON으로 저장합니다. tool result의 `transcriptPath`는 이 전체 전문 저장 위치이며, agent에게 돌아오는 즉시 응답은 여전히 선택값과 직접 입력값 중심입니다.

이 구분이 중요합니다. LLM context에는 제출된 답이 우선 들어오고, 전체 co-thinking 전문은 필요할 때 파일 또는 다시 열린 WebView로 확인하는 artifact입니다.

## Reopen Rule

사용자가 이전 frame 흐름을 다시 보고 싶어 하면 같은 worktree/ticket/session identity로 `frame_studio action=open`을 호출합니다. 활성 run이 없더라도 저장된 transcript를 복원해 Glimpse/WebView에서 `Frame 전문` 섹션으로 다시 보여줘야 합니다.

## Boundary

Frame Studio는 `/frame` co-thinking을 위한 UI 계층입니다. 구현 계획을 자동 생성하거나 검증 완료를 선언하는 도구가 아닙니다. frame 결과의 검증 가능성은 여전히 [frame-verify-contract](./frame-verify-contract.md)와 [evidence-first-verification-gate](./evidence-first-verification-gate.md)의 기준을 따릅니다.
