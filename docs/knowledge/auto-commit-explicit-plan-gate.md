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
  - extensions/work-context
source: public
reviewed_at: 2026-05-20
reviewed_commit: 14cb3a94b0e5ad8f6c5eef7afa606a392cf18487
related:
  - change-integration-discipline
  - request-traceability-surgical-changes
  - deterministic-vs-ai-actions
  - slice-auto-commit-rhythm
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
- `work_context action=commit_plan`은 currentSlice scope 기반 plan 파일을 만드는 helper일 뿐이며, 실제 commit은 여전히 plan 검토 후 `auto_commit apply`가 수행한다.

## Review trigger

- auto-commit 도구가 dirty tree 전체를 자동 stage하려 하면 중단한다.
- plan 없이 “알아서 커밋”하는 흐름이 생기면 [변경 통합은 작은 단위와 검증을 요구한다](./change-integration-discipline.md)를 다시 적용한다.
- currentSlice scope 밖 파일을 기본 commit plan에 섞으면 중단하고 [Slice 완료는 commit 후보를 만든다](./slice-auto-commit-rhythm.md)의 leftover 원칙을 적용한다.
