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
reviewed_at: 2026-08-26
reviewed_commit: dd55c1095e8d8624945c947a28ab5032f231a5a7
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
- `auto_commit`은 실행 직전 diff-aware logical atom gate를 적용한다. 한 commit entry가 3개 이상 primary path를 가지면 파일 수만으로 막지 않고 diff 양, layer mix, cluster/surface fan-out을 함께 평가한다.
- `quick`은 plan file을 생략하지만 message와 paths를 tool input에 반드시 명시해야 하며, dirty tree 전체를 자동 stage하지 않는다.
- `split-head`는 clean worktree에서만 동작하고, reset 전에 backup branch를 둘 수 있어야 한다.
- commit message는 reviewable해야 하며, scope parentheses 같은 프로젝트별 convention 강제는 기본적으로 거부할 수 있다.
- `apply`와 `split-head`의 비자명한 entry는 `situationImpact`, `cause`, `solution`, `rationale`, `tradeoffs`, `invariants`, `changeTrigger`, `evidence`, `references`를 optional lens로 사용한다. 모든 field를 채우지 않고 해당 commit에서 diff로 사라지는 complete-sentence 사실만 고른다. 같은 내용을 이미 담은 multiline `message`도 허용한다.
- `solution`, `evidence`, `references`는 보조 정보라 이것만으로 durable record가 되지 않는다. 상황·원인·선택 이유·트레이드오프·불변조건·변경 계기 중 최소 하나가 있어야 한다.
- renderer는 고정된 `배경/판단/검증` checklist를 강제하지 않고, 값이 있는 field에만 선택형 semantic section을 붙인다. `situationImpact`·`cause`·`changeTrigger`는 각각 `문제`·`원인`·`변경 계기`의 짧은 문단으로, `solution`+`rationale`·`tradeoffs`·`invariants`·`evidence`는 `선택`·`트레이드오프`·`보존한 경계`·`비자명한 근거`의 bullet로 렌더한다. references는 마지막에 둔다.
- `evidence`는 선택한 판단을 이해시키는 비자명한 근거에만 쓴다. 수정 전 실패→수정 후 통과, schema/invariant 무변경, 설계를 뒷받침하는 수치는 남길 수 있지만 일반 test/lint/typecheck/build 통과, 테스트 개수, 브라우저 치수와 캡처 확인은 CI·PR test plan·verify report에 둔다.
- `record`는 raw chain-of-thought나 실행 로그가 아니라 diff에서 사라지는 인과관계, 선택 이유·불변조건·트레이드오프와 stable provenance만 보존한다. 확인하지 않은 근거나 존재하지 않는 링크를 만들지 않는다.
- 단순 generated/mechanical entry는 `recordOmissionReason`을 명시해 제목-only를 유지할 수 있다. `quick`은 이 예외를 자주 쓰는 tiny hotfix/copy 전용 경로이며 비자명한 변경을 우회하는 수단이 아니다.
- `test`, `spec`, `__tests__`, `tests`, `__generated__`, `generated`, `gen`, `schema.gql`, `schema.graphql`, package metadata는 companion path로 분류한다. companion은 source/test/generated/schema/package metadata 보조 관계가 닫히는 logical atom에만 붙일 수 있다.
- push는 plan의 `push`, `pushPolicy`, 또는 quick path 기본값(`push-if-tracking`)으로만 수행한다. 결과는 `committed_and_pushed` / `committed_not_pushed`로 분리해 보고한다.
- `status`는 현재 branch/head와 안전한 push target/ahead/behind뿐 아니라 dirty diff의 commit readiness, ship readiness caveat, split recommendation을 진단한다.
- `status`의 `READY_WITH_CAVEATS`는 “nearest validation 후 커밋 가능한 diff”라는 뜻이지 ship 완료가 아니다. migration 실행, UI capture, 최종 verify-report는 ship caveat로 남길 수 있다.
- `work_context action=commit_plan`은 currentSlice scope 기반 plan 파일을 만드는 helper일 뿐이며, 실제 commit은 여전히 plan 검토 후 `auto_commit apply`가 수행한다.
- commit plan에는 `metadata.commitReadiness`, `metadata.shipReadiness`, `metadata.caveats`, `metadata.notBlockers`를 포함해 agent가 migration/UI 검증 대기를 commit blocker로 오인하지 않게 한다.

## Review trigger

- auto-commit 도구가 dirty tree 전체를 자동 stage하려 하면 중단한다.
- `quick`이 explicit paths 없이 동작하거나, unplanned dirty file을 조용히 함께 커밋하려 하면 중단한다.
- plan 없이 “알아서 커밋”하는 흐름이 생기면 [변경 통합은 작은 단위와 검증을 요구한다](./change-integration-discipline.md)를 다시 적용한다.
- 비자명한 `apply`/`split-head` entry가 제목 한 줄뿐인데 실행되거나, 모든 optional lens를 형식적으로 채우거나, solution과 routine validation만으로 record를 통과시키면 중단한다.
- renderer가 선택된 lens를 모두 같은 무제목 문단으로 이어 가독성을 잃거나, 반대로 빈 section을 만들기 위해 내용을 억지로 채우면 중단한다.
- 관련 issue/PR/review가 있는데 이동 가능한 line number나 설명 없는 숫자만 남기고 stable permalink를 생략하면 provenance 품질을 다시 확인한다.
- 한 commit entry가 큰 diff, layer-mixed 변경, 과도한 cluster/surface fan-out인데 `auto_commit`이 그대로 실행되면 중단한다. primary path 3~5개라도 작은 동일 cluster 변경이면 warning을 출력하고 허용할 수 있다.
- currentSlice scope 밖 파일을 기본 commit plan에 섞으면 중단하고 [Slice 완료는 commit 후보를 만든다](./slice-auto-commit-rhythm.md)의 leftover 원칙을 적용한다.
- auto-commit 결과가 `committed_not_pushed`인데 사용자가 push 보류를 말하지 않았다면 완료 보고 전에 push 실패/스킵을 해결한다.
- verified slice가 있고 dirty diff가 남아 있는데 “migration 실행 전”, “UI 캡처 전”, “최종 verify 전”만을 이유로 commit을 미루면 중단하고 commit plan을 만들거나 명시적 checkpoint reason을 남긴다.
