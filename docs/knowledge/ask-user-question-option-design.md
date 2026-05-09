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
reviewed_at: 2026-05-09
reviewed_commit: b10752d9e7268f12cbd6e41ec1d9567c27073d52
related:
  - ask-user-question-decision-gates
  - evidence-first-verification-gate
supersedes:
  - ritual-confirmation-options
  - processed-sufficient-options
---

## Judgment

AskUserQuestion의 옵션은 사실 진술이나 검수 결과가 아니라 이후 행동의 분기를 표현해야 합니다. 옵션 안에 “처리됨”, “무관”, “충분하다”처럼 결론이 들어가면 질문이 아니라 의례가 됩니다.

## Writing Rule

질문은 짧고 구체적으로 쓰고, 옵션은 선택 후 무엇이 달라지는지 드러냅니다. 사용자가 “무슨 말이야?”라고 되물을 가능성이 있으면 질문이 너무 추상적인 것입니다. 모든 옵션이 같은 행동으로 귀결되면 질문하지 말고 결과를 표로 보고합니다.

## Useful Replacement

검수받고 싶은 단일 판단은 옵션화하지 않습니다. 본문에 `(명백: 저장소 컨벤션)`, `(명백: 직전 지시)`처럼 근거를 적고 진행합니다. 사용자는 침묵으로 동의하고, 틀렸으면 정정할 수 있습니다.

예외적으로 `/frame`의 목표·범위·성공 기준·검증 축 정렬은 단순 실행 판단이 아니라 후속 계약을 바꾸는 선택입니다. 이 경우 추천안이 명백해 보여도 질문하고, `(명백: ...)`은 질문 생략이 아니라 AI 판단 근거를 보여주는 주석으로 사용합니다.

## Text-mode Rule

AskUserQuestion은 반드시 modal UI여야 하는 것은 아닙니다. Pi처럼 선택 UI가 약한 환경에서는 `1`, `2`, `1,3`처럼 답할 수 있는 번호형 메뉴가 같은 의사결정 게이트 역할을 합니다. 중요한 것은 선택 후 행동이 달라지는지이며, 번호는 전달 방식일 뿐입니다.

## Productive Resistance Rule

`/frame`의 Productive Resistance 질문은 “정말 괜찮나요?”가 아니라 계약을 바꾸는 행동 옵션이어야 합니다. 예를 들어 성공 기준에 추가, 범위 밖으로 명시, 먼저 탐색, ask_first로 올리기처럼 선택 후 `frame.json`이 달라져야 합니다.

`/decide`는 모든 결정에 tradeoff challenge를 수행합니다. 다만 강도는 low/medium/high/ask_first로 조절합니다. low risk라도 skip하지 않고 한 줄 반론을 던지며, 옵션은 `선택 유지`, `보완 후 유지`, `재고`, `frame으로 돌아가기`처럼 선택 후 `decisions[].challenge`, `tradeoffs_accepted`, `mitigations`가 달라져야 합니다.

## Completion Feedback Rule

TFT Studio 같은 UI가 선택 완료 카드나 transcript를 보여줄 때도 옵션의 책임은 변하지 않습니다. 완료 카드는 사용자가 어떤 분기를 골랐는지 보존하는 feedback이고, 다음 단계 markdown은 그 선택을 반영해야 합니다. “선택됨”을 보여주는 UI가 있어도 옵션 자체가 행동 분기를 표현하지 못하면 의례화 문제는 해결되지 않습니다.
