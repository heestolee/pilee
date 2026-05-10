---
title: 변경된 줄은 요청으로 추적 가능해야 한다
tags:
  - request-traceability
  - surgical-change
  - karpathy
  - diff
  - scope
  - review
  - traceability
  - 변경
category: workflow
status: active
confidence: high
applies_to:
  - AGENTS.md
  - skills/incremental-implementation
  - skills/code-review-and-quality
  - skills/verify
  - skills/git-workflow-and-versioning
source:
  - user-direction:2026-05-09-karpathy-guardrails
reviewed_at: 2026-05-10
reviewed_commit: ba9a88b2e604e9e12cbc7580b8b7dbe040594904
related:
  - change-integration-discipline
  - evidence-first-verification-gate
  - frame-verify-contract
---

## Judgment

AI가 만든 diff에서 모든 변경된 줄은 사용자 요청, frame success criteria, decision mitigation, 또는 verification failure 중 하나로 추적 가능해야 합니다. 추적되지 않는 줄은 “좋아 보이는 정리”일 수 있어도 현재 작업의 일부가 아닙니다.

이 원칙은 AI가 인접 코드 정리, 취향 리팩터링, 포맷 변경을 좋은 의도로 섞어 review 범위와 회귀 위험을 키우는 것을 막습니다.

## Traceability Rule

코드를 수정할 때 각 변경은 다음 중 하나에 답해야 합니다.

- 사용자 요청을 직접 구현한다.
- `frame.json.success_criteria[]`의 특정 행을 만족한다.
- `/decide`에서 기록한 mitigation이나 tradeoff 수용 조건을 반영한다.
- `/verify` 또는 테스트 실패가 확인한 문제를 고친다.
- 내가 만든 변경 때문에 생긴 orphan import/variable/test fixture를 정리한다.

어느 항목에도 연결되지 않으면 수정하지 않습니다. 이미 수정했다면 별도 follow-up 후보로 보고하거나, 현재 diff에서 분리합니다.

## Surgical Change Rule

기존 코드 편집은 외과수술처럼 작아야 합니다.

- 인접 코드, 주석, 포맷을 “겸사겸사” 개선하지 않습니다.
- 동작 중인 코드를 요청 없이 리팩터링하지 않습니다.
- 기존 style이 마음에 들지 않아도 현재 파일의 style을 따릅니다.
- 관련 없는 dead code는 발견해도 보고만 하고 삭제하지 않습니다.
- 단, 내 변경 때문에 unused가 된 import/변수/함수는 내 mess이므로 정리합니다.

## Verification Implication

`/verify`와 code review는 diff를 볼 때 “이 줄이 왜 필요한가?”를 묻습니다. 답이 frame/decision/verification evidence로 연결되지 않으면 의도하지 않은 변경 또는 scope creep으로 보고합니다. 자동으로 되돌리지는 말고, 사용자에게 분리/유지/후속 작업 여부를 명확히 보여줍니다.

## Review Trigger

다음 일이 반복되면 이 doctrine을 다시 봅니다.

- agent가 요청 밖 formatting/refactor를 자주 섞는다.
- PR review에서 “왜 이 파일도 바뀌었나?”가 반복된다.
- verify가 의도하지 않은 변경을 발견했지만 처리 기준이 애매하다.
- project style상 generated formatting이나 codemod가 필요한 작업을 별도 예외로 문서화해야 한다.
