---
title: reviewed_commit은 날짜 freshness의 빈틈을 막는다
tags:
  - knowledge
  - reviewed-commit
  - reviewed-at
  - freshness
  - commit
  - 정합성
category: knowledge
status: active
confidence: high
applies_to:
  - docs/knowledge
  - scripts/knowledge.mjs
  - skills/pilee-knowledge
source:
  - pilee-history:2026-05-05#50
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-09
reviewed_commit: ce7e63b0fb6ed42383fd23760d10e4b9f72851dd
related:
  - freshness-diagnosis-report
  - deterministic-vs-ai-actions
---

## Judgment

`reviewed_at` 날짜만으로 freshness를 판단하면 같은 날짜에 추가된 커밋을 놓칠 수 있습니다. 문서 검토는 시간보다 git commit 기준이 더 정확한 경계입니다.

## Commit Rule

Knowledge doc은 `reviewed_at`과 함께 `reviewed_commit`을 기록합니다. `--confirm`은 문서를 실제로 검토한 뒤 두 값을 함께 갱신합니다. freshness report는 `reviewed_commit..HEAD` 범위의 actionable commit을 보고 review 후보를 찾습니다.

## Boundary

Knowledge 문서 자체를 고친 commit은 freshness stale의 직접 원인이 아닙니다. 판단을 바꾸는 코드/스킬/확장 변경이 문서 검토를 요구합니다.

## Actionable Range Rule

`reviewed_commit..HEAD`를 볼 때 모든 파일 변경을 같은 무게로 보지 않습니다. `docs/knowledge/*.md`, `docs/knowledge/README.md`, `docs/knowledge-review.md`, root `README.md`/`README.en.md`의 generated block 같은 knowledge 산출물은 다른 doctrine을 stale하게 만드는 입력에서 제외합니다. 그렇지 않으면 검토 큐 PR이나 confirm-only commit이 다음 검토 큐를 계속 만들어냅니다.
