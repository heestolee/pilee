---
title: Decide는 선택을 한 번 공격한다
tags:
  - decide
  - tradeoff
  - challenge
  - productive-resistance
  - frame-json
  - decision
  - tft
  - 판단
  - 트레이드오프
category: workflow
status: active
confidence: high
applies_to:
  - skills/decide
  - skills/verify
  - skills/frame
  - .pi/frame.json
  - extensions/frame-studio
source:
  - user-direction:2026-05-09-decide-tradeoff-challenge
  - pilee-history:2026-05-09#102
reviewed_at: 2026-05-30
reviewed_commit: de40e548359d357b1f7444ab484fa322e9b8a707
related:
  - ask-user-question-decision-gates
  - ask-user-question-option-design
  - frame-verify-contract
  - frame-studio-interactive-decision-ui
  - evidence-first-verification-gate
  - architecture-friction-tft-lens
  - atomic-evidence-workflow
  - tft-preference-regression-gate
supersedes:
  - conditional-productive-resistance-in-decide
---

## Judgment

`/decide`는 선택지를 기록하는 명령이 아니라, 사용자의 선택을 한 번 공격해서 수용한 비용을 명확히 하는 판단 도구입니다. 대안 비교표와 사용자 선택만으로 끝나면 “왜 이 선택이 더 낫다고 봤는가”는 남지만, “무엇을 포기하기로 했는가”와 “어떤 실패를 감수했는가”가 흐려집니다.

따라서 `/decide`는 모든 결정에서 Productive Resistance를 수행합니다. 위험도는 challenge를 생략할지 말지를 정하지 않고, challenge의 강도만 정합니다. 코드 구조를 건드리는 결정에서는 비교표에 구조 비용/AI 탐색성 행을 넣어 빠른 구현이 shallow module이나 복잡한 interface를 늘리는지 드러냅니다. source-grounded frame에서 이어진 결정은 여기에 더해 requirement ID, Domain Work Map lane, Architecture/Data Flow edge/source-of-truth 영향 행을 포함해 Frame의 requirement source가 선택 과정에서 사라지지 않게 합니다.

## Challenge Intensity Rule

Challenge intensity는 다음처럼 해석합니다.

| intensity | 의미 | 질문 방식 |
|---|---|---|
| `low` | 되돌리기 쉽고 영향이 작다 | 짧은 반론 카드로 선택 유지/보완/재고를 묻습니다. |
| `medium` | 여러 모듈이나 테스트 비용이 생긴다 | 비교표의 약점을 짚고 완화책 여부를 묻습니다. |
| `high` | 데이터 의미, 상태 모델, 외부 계약, 운영 위험이 크다 | 가장 비싼 실패 시나리오와 rollback 비용을 중심으로 묻습니다. |
| `ask_first` | 사용자가 위임하면 안 되는 영역이다 | 사용자 선택을 필수로 받고, 근거와 완화책을 명시합니다. |

이 규칙은 [AskUserQuestion은 의사결정 게이트다](./ask-user-question-decision-gates.md)의 특수한 적용입니다. `/decide`의 challenge는 “정말 괜찮나요?”라는 확인창이 아니라, 선택 후 실제 행동이 달라지는 두 번째 decision gate입니다. challenge 질문도 짧은 제목만 던지지 않고 `현재 이해 / 막힌 결정 / 왜 중요한가 / 선택 후 달라지는 것`을 포함한 판단 맥락 카드로 제시합니다.

## Canonical Record

Challenge 결과는 prose 메모가 아니라 `frame.json.decisions[]`에 구조화해 남깁니다.

- `selected`: 선택한 대안
- `tradeoffs_accepted`: 수용하기로 한 비용
- `mitigations[]`: 보완 후 유지 선택 시 추가된 완화책
- `challenge.intensity`: low/medium/high/ask_first
- `challenge.objection`: AI가 제기한 가장 중요한 반론
- `challenge.response`: accepted / accepted_with_mitigation / reconsidered / returned_to_frame
- `challenge.userSelection`: 사용자가 고른 challenge 응답
- `challenged: true`: `/decide`는 항상 challenge를 수행했다는 불변식
- `requirementIds`: 영향을 받는 Frame requirement ID
- `domainLanesImpacted`: FE/BE/DB/Ops/Verification 같은 Domain Work Map lane 영향
- `architectureFlowImpacts`: lane/node/edge/source-of-truth 변화
- `verifyHandoffHints`: `/verify`와 `/verify-report`가 reuse/revise/add/drop/blocked로 판정할 후보와 이유

이 구조는 [Frame과 Verify는 구조화 계약이다](./frame-verify-contract.md)의 일부입니다. `frame.md`나 transcript는 사람이 읽는 view이고, Verify가 읽는 원천은 최신 `frame.json`입니다. TFT Studio에서 `/decide`를 진행했다면 tool result의 `contextDigest`와 `tabSnapshot`은 현재 turn의 요약 맥락으로 쓰고, `transcriptRef.openCommand`는 전문 provenance 링크로만 남깁니다. 최종 판단은 반드시 `decisions[]` 또는 즉석 결정 파일에 구조화합니다.

## Verify Implication

`/verify`는 결정이 코드에 반영됐는지만 보면 부족합니다. 결정 시 수용한 tradeoff와 challenge에서 약속한 완화책도 실제 코드, 테스트, 문서, 검증 증거에 반영됐는지 대조해야 합니다. source-grounded 결정이라면 requirement ID coverage, Domain Work Map lane, Architecture/Data Flow edge/source-of-truth가 선택 후에도 Frame 계약과 일치하는지 확인하고, PM-facing 캡처가 필요한 항목은 `/verify-report` handoff 후보로 넘겨야 합니다.

예를 들어 “선택은 유지하되 rollback test를 추가한다”를 고른 결정이라면, Verify는 선택한 구현이 존재하는지와 별개로 rollback test 또는 그에 준하는 검증 근거가 있는지 확인해야 합니다. “빠른 복구를 위해 wrapper 증가를 수용하되 follow-up을 남긴다”를 고른 결정이라면, Verify는 diff가 수용 범위를 넘지 않았는지와 follow-up/backlog가 남았는지도 확인합니다. 완화책이 빠졌다면 결정 자체는 존재해도 검증은 부분 또는 미달성입니다.

## Writing Rule

Productive Resistance 옵션은 [AskUserQuestion 옵션은 행동 분기를 표현한다](./ask-user-question-option-design.md)를 따릅니다. 옵션은 결론이나 감정 확인이 아니라 canonical 기록을 바꾸는 행동이어야 합니다.

좋은 옵션:

- 선택 유지 — 이 비용을 수용하고 결정에 기록
- 보완 후 유지 — 선택은 유지하되 완화책을 추가
- 재고 — 다른 대안을 다시 비교
- frame으로 돌아가기 — 목표/범위/ask_first를 재정렬

나쁜 옵션:

- 문제없음
- 충분하다
- 확인함
- AI 추천대로 진행

## Review Trigger

다음 변화가 생기면 이 doctrine을 다시 봅니다.

- `/decide`의 TFT Studio tab, challenge UI, 질문 transport 우선순위가 다시 달라질 때
- `frame.json.decisions[]` schema가 바뀔 때
- `/verify`가 decision challenge를 자동 판정하는 방식이 바뀔 때
- 사용자가 “challenge가 너무 과하다”거나 “생각을 충분히 흔들지 못한다”고 피드백할 때
