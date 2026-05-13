---
title: TFT Preference Regression Gate는 사용자 선호 역전을 막는다
tags:
  - tft
  - frame
  - decide
  - verify
  - ask-user-question
  - regression
  - preference
  - final-check
  - 질문
  - 신뢰
category: workflow
status: active
confidence: high
applies_to:
  - AGENTS.md
  - scripts/tft-regression-audit.mjs
  - skills/ask-user-question-rules
  - skills/frame
  - skills/decide
  - skills/verify
  - skills/tft-guidelines
  - skills/pilee-final-check
source:
  - user-direction:2026-05-14-tft-preference-regression-gate
reviewed_at: 2026-05-13
reviewed_commit: 9152c3541fcb65b16a73b411af145bda742a59be
related:
  - ask-user-question-option-design
  - decide-tradeoff-challenge
  - atomic-evidence-workflow
  - frame-verify-contract
  - evidence-first-verification-gate
---

## Judgment

파이리의 신뢰를 깎는 실패는 새 기능 부족보다, 사용자가 이미 명확히 말한 선호가 다음 개선에서 다시 뒤집히는 순간에 발생합니다. 따라서 TFT 계열 변경은 새 기능처럼 확장하기보다, 기존 선호를 배신하지 않는지 확인하는 **regression gate**를 통과해야 합니다.

이 gate의 목적은 agent가 더 많은 절차를 만들게 하는 것이 아닙니다. 목적은 `frame`, `decide`, `verify`, `ask-user-question-rules`, `tft-guidelines`, `pilee-final-check`가 서로 다른 방향을 말하지 못하게 하는 것입니다.

## Preference Inversion Rule

다음은 preference inversion입니다.

- 질문을 “짧은 제목 + 판단 맥락 카드”가 아니라 짧은 제목 단독 흐름으로 되돌립니다.
- 사용자가 이미 준 목적·절차·제약을 generic best practice로 덮습니다.
- 선택지가 선택 후 행동, 검증, canonical 기록을 바꾸지 않습니다.
- Studio transcript나 tool success가 canonical record나 사용자-facing evidence를 대체합니다.
- context 보존이 현재 claim/evidence보다 우선됩니다.
- 완료 선언이 claim/evidence 매핑보다 먼저 나옵니다.

## Core Contract

TFT 계열 문서는 다음 계약을 공유해야 합니다.

| Contract | Meaning |
|---|---|
| 짧은 질문 제목 + 판단 맥락 카드 | 사용자가 무엇을 판단해야 하는지 `현재 이해 / 막힌 결정 / 왜 중요한가 / 선택 후 달라지는 것`으로 보여줍니다. |
| 하나의 결정만 묻기 | 여러 불확실성을 한 질문에 섞지 않습니다. |
| 선택 후 달라지는 것 명시 | 선택지가 구현, 검증, 기록, 범위 중 무엇을 바꾸는지 드러냅니다. |
| 증거 없는 완료 금지 | claim/evidence가 없으면 PASS가 아니라 GAP입니다. |
| source-of-truth 우선 | Studio/transcript/요약은 provenance이고, frame.json/decision/knowledge/final-check 계약을 대체하지 않습니다. |

## Automation Rule

`npm run tft:regression-audit`는 문서 전체를 이해하는 AI reviewer가 아니라, 반복되면 안 되는 역전 문구와 필수 계약 누락을 잡는 작은 deterministic gate입니다.

- `한 줄 질문` 계열 directive가 돌아오면 실패합니다.
- `한 줄 반론` 계열 directive가 돌아오면 실패합니다.
- 통과용 옵션이 돌아오면 실패합니다.
- 핵심 파일에서 판단 맥락 카드 계약이 빠지면 실패합니다.

스크립트가 PASS해도 모든 품질 검토가 끝난 것은 아닙니다. 다만 이 스크립트가 FAIL이면, 사용자가 이미 말한 선호를 다시 뒤집는 위험이 있으므로 pilee 변경을 완료하면 안 됩니다.

## Final-check Rule

`pilee-final-check`는 TFT/질문/검증 계열 파일이 변경됐을 때 이 gate를 실행해야 합니다.

1. friction을 적습니다.
2. 이전 대응 evidence를 확인합니다.
3. 현재 파일 상태를 확인합니다.
4. 남은 gap이 있는지 판단합니다.
5. `npm run tft:regression-audit`로 deterministic regression을 확인합니다.

이 흐름은 새 command를 사용자가 의식적으로 실행하게 하려는 것이 아니라, agent가 완료 선언 전에 자동으로 확인해야 하는 safety rail입니다.
