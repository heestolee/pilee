---
title: AskUserQuestion은 의사결정 게이트다
tags:
  - ask-user-question
  - tft
  - decision-gate
  - question
  - non-delegable
  - 질문
  - 의사결정
category: workflow
status: active
confidence: high
applies_to:
  - skills/tft-guidelines
  - skills/ask-user-question-rules
  - skills/frame
  - skills/decide
  - skills/verify
  - extensions/frame-studio
source:
  - pilee-history:2026-05-01#3
  - pilee-history:2026-05-01#5
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-10-07
reviewed_commit: 1dc578d7810bf790806ce7d0b23adff50894d416
related:
  - ask-user-question-option-design
  - frame-verify-contract
  - evidence-first-verification-gate
---

## Judgment

AskUserQuestion은 사용자의 클릭을 얻기 위한 확인창이 아니라, AI가 단독으로 결정하면 안 되는 실제 분기점에서 쓰는 의사결정 게이트입니다. 질문을 던지는 기준은 “사용자가 보길 원하는가”가 아니라 “선택에 따라 이후 작업 결과가 달라지는가”입니다.

## Operating Rule

질문 승격의 단일 원천은 `skills/tft-guidelines/SKILL.md` 철칙 1입니다. 확인할 수 있는 사실은 먼저 조사하고, 공개 계약·보안 보장·운영/되돌리기/유지보수 비용을 실질적으로 바꾸는 미해결 선택을 근거·대안·추천과 함께 묻습니다. 이미 승인된 요구나 실행 세부를 후보가 여럿이라는 이유로 재질문하지 않습니다. 명확한 작업은 질문 0개도 정상입니다.

선택 전 비용을 비교하고 선택 후에는 수용한 tradeoff를 기록합니다. 기본 Frame/Decide에 의무 반론이나 검증축 선택을 두지 않습니다. 새 중요한 근거가 생기거나 사용자가 명시적으로 grill 검토를 요청할 때만 추가 검토합니다. 검증은 요구사항과 변경 위험에서 도출하며, 설계 선택과 외부 실행 권한은 분리합니다.

## Transport Rule

AskUserQuestion의 본질은 UI가 아니라 decision gate입니다. TFT Studio처럼 버튼/체크박스/전문 저장 UI가 있어도, 그것은 선택을 더 잘 보존하는 transport일 뿐입니다. modal, 번호형 text fallback, TFT Studio 모두 “선택에 따라 이후 행동이 달라지는가”를 만족할 때만 AskUserQuestion으로 취급합니다.

## Failure Mode

결과가 정해진 질문은 신호를 잃게 만듭니다. 사용자는 “충분하다”를 누르게 되고, 에이전트는 질문을 했다는 사실만 남긴 채 실제 판단을 회피합니다. 질문은 적을수록 좋은 것이 아니라, 진짜 분기에서만 강해야 합니다.
