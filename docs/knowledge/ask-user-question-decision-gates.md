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
reviewed_at: 2026-05-09
reviewed_commit: 3701ea453a8ad46d93d9cce0b5f53ca917b0bce1
related:
  - ask-user-question-option-design
  - frame-verify-contract
  - evidence-first-verification-gate
---

## Judgment

AskUserQuestion은 사용자의 클릭을 얻기 위한 확인창이 아니라, AI가 단독으로 결정하면 안 되는 실제 분기점에서 쓰는 의사결정 게이트입니다. 질문을 던지는 기준은 “사용자가 보길 원하는가”가 아니라 “선택에 따라 이후 작업 결과가 달라지는가”입니다.

## Operating Rule

구현 방식이 둘 이상이고 각각 다른 결과를 만들면 묻습니다. 결제, 보안, PII, 스키마, 외부 연동, 동시성, 운영 설정처럼 위임 금지 영역이면 사소해 보여도 묻습니다. 반대로 사용자가 이미 명확히 지시했거나 저장소 컨벤션상 단일 답이 명백하면 묻지 않고 `(명백: ...)`으로 판단 근거를 본문에 남깁니다.

`/decide`에서는 선택 질문 뒤에 항상 Productive Resistance를 둡니다. 이 challenge는 “정말 괜찮나요?” 확인이 아니라 선택한 대안의 가장 중요한 비용을 드러내고, 사용자가 유지/보완/재고/frame 복귀 중 하나를 고르게 하는 두 번째 decision gate입니다. 위험도는 challenge 생략 여부가 아니라 low/medium/high/ask_first 강도를 결정합니다.

## Transport Rule

AskUserQuestion의 본질은 UI가 아니라 decision gate입니다. TFT Studio처럼 버튼/체크박스/전문 저장 UI가 있어도, 그것은 선택을 더 잘 보존하는 transport일 뿐입니다. modal, 번호형 text fallback, TFT Studio 모두 “선택에 따라 이후 행동이 달라지는가”를 만족할 때만 AskUserQuestion으로 취급합니다.

## Failure Mode

결과가 정해진 질문은 신호를 잃게 만듭니다. 사용자는 “충분하다”를 누르게 되고, 에이전트는 질문을 했다는 사실만 남긴 채 실제 판단을 회피합니다. 질문은 적을수록 좋은 것이 아니라, 진짜 분기에서만 강해야 합니다.
