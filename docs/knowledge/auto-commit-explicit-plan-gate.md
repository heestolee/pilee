---
title: Auto-commit은 명시 계획만 실행한다
tags:
  - auto-commit
  - git
  - commit
  - plan
  - safety
category: workflow
status: active
confidence: high
applies_to:
  - extensions/auto-commit
source: public
reviewed_at: 2026-05-13
reviewed_commit: e0dc999e580d0ff1f1940470f7a8f2a20d2920f5
related:
  - change-integration-discipline
  - request-traceability-surgical-changes
  - deterministic-vs-ai-actions
title_en: Auto-commit executes only explicit plans
---

# Auto-commit은 명시 계획만 실행한다

## 판단

자동 커밋 도구는 agent가 임의로 변경 파일을 추론해 커밋하는 도구가 아니다. 사용자가 검토할 수 있는 JSON plan에 commit message와 path 묶음이 명시되어 있을 때만 실행한다.

## 규칙

- `auto_commit`은 `status`, `apply`, `split-head`처럼 좁은 action만 제공한다.
- `apply`는 plan file의 `commits[].paths`만 stage/commit한다.
- `split-head`는 clean worktree에서만 동작하고, reset 전에 backup branch를 둘 수 있어야 한다.
- commit message는 reviewable해야 하며, scope parentheses 같은 프로젝트별 convention 강제는 기본적으로 거부할 수 있다.
- push는 plan에 명시된 경우에만 수행한다.

## Review trigger

- auto-commit 도구가 dirty tree 전체를 자동 stage하려 하면 중단한다.
- plan 없이 “알아서 커밋”하는 흐름이 생기면 [변경 통합은 작은 단위와 검증을 요구한다](./change-integration-discipline.md)를 다시 적용한다.
