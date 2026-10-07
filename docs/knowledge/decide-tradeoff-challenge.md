---
title: Decide는 근거와 수용한 비용을 남긴다
tags:
  - decide
  - tradeoff
  - challenge
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
  - user-direction:2026-10-07-evidence-first-decisions
reviewed_at: 2026-10-07
reviewed_commit: 1dc578d7810bf790806ce7d0b23adff50894d416
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
  - mandatory-productive-resistance-in-decide
---

## 판단

`/decide`의 목적은 선택을 공격하는 의식을 수행하는 것이 아니라, 개발자가 중요한 기술적 손익을 이해하고 선택한 근거와 비용을 남기는 것입니다. 확인할 수 있는 사실은 먼저 조사하고, 공개 계약·보안 보장·운영/되돌리기/유지보수 비용을 실질적으로 바꾸는 미해결 판단을 대안·추천과 함께 비교합니다.

## 현재 규칙

- 질문 승격은 `skills/tft-guidelines/SKILL.md` 철칙 1을 따릅니다. 후보 수만으로 질문을 만들지 않습니다.
- 비용·실패 가능성·완화책은 선택 전 비교에 포함합니다. 선택 후 같은 비용을 다시 유지/보완/재고 메뉴로 묻지 않습니다.
- 기본 Frame/Decide의 의무 반론과 고정 질문 횟수는 제거합니다. 새 중요한 근거가 생기거나 사용자가 명시적으로 grill/반론 검토를 요청할 때만 추가 검토합니다.
- 이미 승인된 선택은 기록하고 다음 행동으로 이어갑니다. 설계 승인과 외부 실행 권한은 구분합니다.

## Canonical 기록

`frame.json.decisions[]`에는 `selected`, `rationale`, `alternatives_considered`, `tradeoffs_accepted`, 필요한 `mitigations`를 남깁니다. source-grounded 작업은 `requirementIds`, `domainLanesImpacted`, `architectureFlowImpacts`, `verifyHandoffHints`로 요구사항과 검증까지 연결합니다.

`challenge`는 실제 추가 검토의 선택적 이력입니다. 기존 `challenged: true` 기록은 보존하고, 미수행은 false 또는 필드 생략으로 표현합니다. 기록 형식을 채우려고 하지 않은 반론·사용자 응답을 만들어내지 않습니다.

결정 저장 후 해당 큐/task/slice 의존성을 해소하고 다른 미결정은 남깁니다. 미확인 사실은 조사, 근거가 모인 중요한 선택은 다음 `/decide`, 승인된 독립 slice는 구현으로 연결합니다. 전체 plan에 미결정이 남아도 독립 slice를 자동 차단하지 않습니다.

## Verify의 책임

`/verify`는 challenge 누락만으로 실패시키지 않습니다. 선택한 계약·수용한 비용·약속한 완화책이 실제 구현과 증거에 반영됐는지 확인합니다. 완화책이 빠졌으면 해당 기준은 미달성입니다. 의무 질문을 덜어낸 것이 검증·승인 경계를 덜어내는 뜻은 아닙니다.

## 재검토 trigger

- 선택 후 같은 비용을 다시 승인받거나 반론 횟수를 채울 때
- 조사할 사실을 사용자 선택 문제로 바꿀 때
- 중요한 기술적 손익을 AI가 실행 세부로 숨길 때
- 결정은 저장됐지만 큐/task/slice 의존성이 해소되지 않을 때
- legacy challenge 기록과 새 선택적 기록의 호환성이 바뀔 때
