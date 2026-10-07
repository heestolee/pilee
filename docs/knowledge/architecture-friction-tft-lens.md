---
title: Architecture friction은 TFT의 검증 축이다
tags:
  - architecture
  - frame
  - decide
  - verify
  - deep-module
  - shallow-module
  - ai-navigation
  - 구조
  - 검증
category: architecture
status: active
confidence: high
applies_to:
  - skills/frame
  - skills/decide
  - skills/verify
  - .pi/frame.json
source:
  - user-direction:2026-05-09-architecture-lens
reviewed_at: 2026-10-07
reviewed_commit: 1dc578d7810bf790806ce7d0b23adff50894d416
related:
  - frame-verify-contract
  - decide-tradeoff-challenge
  - evidence-first-verification-gate
---

## Judgment

AI 코딩에서 구조 비용은 미학 문제가 아니라 다음 변경 가능성의 비용입니다. 빠르게 붙인 작은 wrapper, 분산 조건, 얕은 module이 늘어나면 다음 사람이나 AI가 변경 지점을 찾지 못하고 같은 문제를 다른 위치에서 다시 고칠 수 있습니다.

따라서 TFT는 기능 결과뿐 아니라 “다음 변경자가 길을 잃는 구조인가?”를 AI의 검토 렌즈로 사용합니다. 모든 작업에서 사용자 질문을 만들지는 않습니다. 단, 이 질문은 모든 작업을 리팩터링으로 키우라는 뜻이 아닙니다. 지금 고치지 않을 구조 비용도 `out_of_scope`, `risk_register`, decision tradeoff, verify finding, follow-up/backlog로 명시하면 충분합니다.

## Frame Rule

`/frame`은 실제 구조 변경이 있으면 architecture friction을 검토합니다. 중요한 미해결 기술적 손익이 있을 때만 tft-guidelines 기준으로 질문을 승격합니다.

좋은 질문:

- 이번 변경이 작은 module/wrapper를 더 늘리는가?
- 조건이 한곳에 모이는가, 여러 호출부로 흩어지는가?
- public interface가 단순해지는가, 의미가 넓어지는가?
- 이번에는 빠른 복구를 택하고 구조 정리는 follow-up으로 뺄 것인가?

선택 결과는 기존 canonical shape 안에 남깁니다. 별도 schema가 없어도 `review_lenses`, `risk_register`, `edge_case_seeds`, `verify_plan.manual_checks`, `out_of_scope`로 충분히 표현할 수 있습니다.

## Decide Rule

`/decide`의 비교표에는 코드 구조를 건드리는 결정일 때 `구조 비용/AI 탐색성` 행이 들어가야 합니다. 빠른 구현 옵션이 항상 나쁜 것은 아니지만, 빠른 구현이 shallow module을 늘리거나 기존 개념을 새 이름으로 복제한다면 그 비용을 수용한 tradeoff로 기록해야 합니다.

구조 비용은 선택 전 비교에 포함하고 `tradeoffs_accepted` 또는 `mitigations[]`로 남깁니다. 이미 선택한 비용을 별도 challenge 메뉴로 재승인받지 않습니다. 새로운 중요한 근거가 생기거나 명시적인 반론 검토 요청이 있을 때만 다시 비교합니다.

## Verify Rule

`/verify`는 테스트 통과와 별개로 architecture side-effect를 보고합니다. 구조 비용이 frame/decision에 기록되어 있거나 diff가 module boundary를 바꾸면 다음을 확인합니다.

- 다음 사람/AI가 변경 지점을 한두 단계 안에 찾을 수 있는가?
- 단순한 interface 뒤로 복잡도가 숨겨졌는가?
- 새 wrapper나 작은 module이 실제 의미 없이 늘었는가?
- 같은 도메인 개념이 새 용어로 중복되지 않았는가?
- decision에서 약속한 mitigation이 코드·테스트·문서에 반영됐는가?

이 결과는 자동 리팩터링 명령이 아닙니다. frame 계약 위반이나 mitigation 누락이면 `부분`/`Blocked`로 연결하고, 범위 밖이면 follow-up/backlog로 남깁니다.

## Backlog Boundary

코드베이스 전체에서 shallow/deep module 후보를 찾는 흐름은 Ember/knowledge 명령이 아니라 별도의 architecture diagnostic 기능 후보입니다. Ember는 knowledge domain의 friendly entrypoint로 유지하고, architecture diagnostic은 대상 repo/worktree를 분석해 follow-up, decision, knowledge 후보를 downstream으로 만들 수 있는 별도 pilee 기능으로 다룹니다.

현재 TFT에 넣는 것은 전체 진단 도구가 아니라, 개별 작업마다 구조 비용을 놓치지 않게 하는 얇은 렌즈입니다.

## Review Trigger

다음 변화가 생기면 다시 검토합니다.

- `/frame`, `/decide`, `/verify`가 architecture lens를 과하게 질문한다고 느껴질 때
- 독립 architecture 진단 command/worker가 실제로 구현될 때
- `frame.json`에 architecture-specific field를 추가할지 결정할 때
