---
title: AskUserQuestion 옵션은 행동 분기를 표현한다
tags:
  - ask-user-question
  - option
  - wording
  - ceremony
  - tft
  - 질문
  - 옵션
  - text-mode
  - 번호형
category: workflow
status: active
confidence: high
applies_to:
  - skills/ask-user-question-rules
  - skills/tft-guidelines
  - skills/frame
  - skills/decide
  - skills/verify
  - extensions/frame-studio
source:
  - pilee-history:2026-05-01#4
  - pilee-history:2026-05-01#5
  - pilee-history:2026-05-06#65
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-05-10-deep-interview-frame
reviewed_at: 2026-10-07
reviewed_commit: 1dc578d7810bf790806ce7d0b23adff50894d416
related:
  - ask-user-question-decision-gates
  - evidence-first-verification-gate
  - atomic-evidence-workflow
  - tft-preference-regression-gate
supersedes:
  - ritual-confirmation-options
  - processed-sufficient-options
---

## Judgment

AskUserQuestion의 옵션은 사실 진술이나 검수 결과가 아니라 이후 행동의 분기를 표현해야 합니다. 옵션 안에 “처리됨”, “무관”, “충분하다”처럼 결론이 들어가면 질문이 아니라 의례가 됩니다.

## Writing Rule

질문은 “짧은 제목 + 충분한 판단 맥락 카드”로 작성합니다. 제목만 짧게 던지고 맥락을 생략하면 사용자는 무엇을 검수해야 하는지 알 수 없습니다. 사용자가 “무슨 말이야?”라고 되물을 가능성이 있으면 질문이 너무 추상적인 것입니다. 모든 옵션이 같은 행동으로 귀결되면 질문하지 말고 결과를 표로 보고합니다.

`/frame`처럼 요구사항을 좁히는 질문은 deep-interview식 카드가 기본입니다: `현재 이해`, `막힌 결정`, `왜 중요한가`, `추천 답안`, `선택 후 달라지는 것`, `질문`. 이 카드는 장황한 계획 설명이 아니라 사용자가 지금 판단해야 하는 빈칸 하나를 드러내는 장치입니다.

## Useful Replacement

기존 지시·결정·컨벤션으로 충분한 실행 세부는 근거를 적고 승인된 범위에서 진행합니다. `(명백)` 태그나 `ok` 응답은 필수가 아니며, 침묵을 새로운 실행 권한의 동의로 해석하지 않습니다.

코드베이스, 문서, 티켓, 이전 frame, 세션 transcript로 확인 가능한 사실은 사용자에게 묻지 않습니다. 먼저 직접 확인하고, 확인 결과를 가정/근거로 보여준 뒤 남은 판단만 묻습니다.

Frame에서도 중요한 미해결 판단이 있을 때만 질문합니다. 검증은 AI가 요구사항·성공 기준·변경 위험에서 도출합니다. 검증 범위 조정에 실제 비용·부작용·권한의 선택이 필요할 때만 그 차이를 묻습니다.

## Text-mode Rule

AskUserQuestion은 반드시 modal UI여야 하는 것은 아닙니다. Pi처럼 선택 UI가 약한 환경에서는 `1`, `2`, `1,3`처럼 답할 수 있는 번호형 메뉴가 같은 의사결정 게이트 역할을 합니다. 중요한 것은 선택 후 행동이 달라지는지이며, 번호는 전달 방식일 뿐입니다.

## Reconsideration Rule

기본 Frame/Decide의 의무 반론과 선택 후 유지/보완/재고 반복 메뉴는 제거합니다. 비용을 선택 전 비교에 포함하고, 선택 뒤에는 기록합니다. 새로운 중요한 근거가 결정을 바꾸거나 사용자가 명시적으로 grill/반론 검토를 요청한 경우에만 추가 검토하며, 수행한 기록만 선택적 `challenge`에 남깁니다. 저장·patch 반영을 이유로 같은 선택을 다시 승인받지 않습니다.

## Completion Feedback Rule

TFT Studio 같은 UI가 선택 완료 카드나 transcript를 보여줄 때도 옵션의 책임은 변하지 않습니다. 완료 카드는 사용자가 어떤 분기를 골랐는지 보존하는 feedback이고, 다음 단계 markdown은 그 선택을 반영해야 합니다. “선택됨”을 보여주는 UI가 있어도 옵션 자체가 행동 분기를 표현하지 못하면 의례화 문제는 해결되지 않습니다.
