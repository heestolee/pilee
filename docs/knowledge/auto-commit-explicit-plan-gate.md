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
reviewed_at: 2026-06-03
reviewed_commit: 238ee8dc514157fdec14db36a41125a2fd24f664
related:
  - change-integration-discipline
  - request-traceability-surgical-changes
  - deterministic-vs-ai-actions
  - slice-auto-commit-rhythm
title_en: Auto-commit executes only explicit plans
---

# Auto-commit은 명시 계획만 실행한다

## 판단

자동 커밋 도구는 agent가 임의로 변경 파일을 추론해 커밋하는 도구가 아니다. 기본은 사용자가 검토할 수 있는 JSON plan에 commit message와 path 묶음이 명시되어 있을 때만 실행한다. 단, 단일 문구·라벨 같은 light hotfix는 JSON 파일을 만들지 않더라도 `action=quick`에 message와 paths를 명시해 같은 안전 경계 안에서 commit+push까지 닫을 수 있다.

## 규칙

- `auto_commit`은 `status`, `apply`, `split-head`, `quick`처럼 좁은 action만 제공한다.
- `apply`는 plan file의 `commits[].paths`만 stage/commit한다.
- `auto_commit`은 실행 직전 logical atom gate를 적용한다. 한 commit entry는 기본적으로 1~2개의 primary path만 가져야 하며, 3개 이상이면 plan을 거부하고 split 후보를 출력한다.
- `quick`은 plan file을 생략하지만 message와 paths를 tool input에 반드시 명시해야 하며, dirty tree 전체를 자동 stage하지 않는다.
- `split-head`는 clean worktree에서만 동작하고, reset 전에 backup branch를 둘 수 있어야 한다.
- commit message는 reviewable해야 하며, scope parentheses 같은 프로젝트별 convention 강제는 기본적으로 거부할 수 있다.
- `test`, `spec`, `__tests__`, `tests`, `__generated__`, `generated`, `gen`, `schema.gql`, `schema.graphql`, package metadata은 companion path로 분류한다. companion은 source/test/generated/schema 보조 관계가 닫히는 logical atom에만 붙일 수 있다.
- push는 plan의 `push`, `pushPolicy`, 또는 quick path 기본값(`push-if-tracking`)으로만 수행한다. 결과는 `committed_and_pushed` / `committed_not_pushed`로 분리해 보고한다.
- `status`는 현재 branch/head와 안전한 push target/ahead/behind뿐 아니라 dirty diff의 commit readiness, ship readiness caveat, split recommendation을 진단한다.
- `status`의 `READY_WITH_CAVEATS`는 “nearest validation 후 커밋 가능한 diff”라는 뜻이지 ship 완료가 아니다. migration 실행, UI capture, 최종 verify-report는 ship caveat로 남길 수 있다.
- `work_context action=commit_plan`은 currentSlice scope 기반 plan 파일을 만드는 helper일 뿐이며, 실제 commit은 여전히 plan 검토 후 `auto_commit apply`가 수행한다.
- commit plan에는 `metadata.commitReadiness`, `metadata.shipReadiness`, `metadata.caveats`, `metadata.notBlockers`를 포함해 agent가 migration/UI 검증 대기를 commit blocker로 오인하지 않게 한다.

## Review trigger

- auto-commit 도구가 dirty tree 전체를 자동 stage하려 하면 중단한다.
- `quick`이 explicit paths 없이 동작하거나, unplanned dirty file을 조용히 함께 커밋하려 하면 중단한다.
- plan 없이 “알아서 커밋”하는 흐름이 생기면 [변경 통합은 작은 단위와 검증을 요구한다](./change-integration-discipline.md)를 다시 적용한다.
- 한 commit entry에 primary path가 3개 이상인데 `auto_commit`이 그대로 실행되면 중단한다. slice 하나가 크더라도 commit은 더 작은 logical atom 단위여야 한다.
- currentSlice scope 밖 파일을 기본 commit plan에 섞으면 중단하고 [Slice 완료는 commit 후보를 만든다](./slice-auto-commit-rhythm.md)의 leftover 원칙을 적용한다.
- auto-commit 결과가 `committed_not_pushed`인데 사용자가 push 보류를 말하지 않았다면 완료 보고 전에 push 실패/스킵을 해결한다.
- verified slice가 있고 dirty diff가 남아 있는데 “migration 실행 전”, “UI 캡처 전”, “최종 verify 전”만을 이유로 commit을 미루면 중단하고 commit plan을 만들거나 명시적 checkpoint reason을 남긴다.
