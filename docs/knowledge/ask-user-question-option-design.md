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
applies_to:
  - skills/ask-user-question-rules
  - skills/tft-guidelines
  - skills/frame
  - skills/decide
  - skills/verify
source:
  - pilee-history:2026-05-01#4
  - pilee-history:2026-05-01#5
  - pilee-history:2026-05-06#65
reviewed_at: 2026-05-06
reviewed_commit: 8f5edeef3baff0455a7178acf07297e221029467
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

## Text-mode Rule

AskUserQuestion은 반드시 modal UI여야 하는 것은 아닙니다. Pi처럼 선택 UI가 약한 환경에서는 `1`, `2`, `1,3`처럼 답할 수 있는 번호형 메뉴가 같은 의사결정 게이트 역할을 합니다. 중요한 것은 선택 후 행동이 달라지는지이며, 번호는 전달 방식일 뿐입니다.
