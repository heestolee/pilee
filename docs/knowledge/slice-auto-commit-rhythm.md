---
title: Slice 완료는 commit 후보를 만든다
tags:
  - frame
  - slice
  - auto-commit
  - work-context
  - git
category: workflow
status: active
confidence: high
applies_to:
  - skills/frame
  - skills/incremental-implementation
  - skills/git-workflow-and-versioning
  - extensions/work-context
  - extensions/workflow-guard
  - extensions/auto-commit
source:
  - user-direction:2026-05-20-slice-commit-rhythm
  - reference:https://github.com/Jonghakseo/my-pi
  - reference:https://github.com/Jonghakseo/pi-extension
reviewed_at: 2026-05-26
reviewed_commit: 668415d6b821f26cfd3eb95dc0a8a38ef23144dd
related:
  - auto-commit-explicit-plan-gate
  - change-integration-discipline
  - work-context-card-task-board
  - frame-plan-synthesis-continuity
---

## Judgment

Frame으로 구현 계획을 세웠다면 `implementation_plan.slices[]`는 단순한 TODO가 아니라 commit 후보 단위입니다. 구현이 모두 끝난 뒤에 “커밋이 안 되어 있다”고 발견하는 흐름은 정상 경로가 아닙니다.

다만 이것은 hard gate가 아니어야 합니다. slice가 아직 불완전하거나 검증이 끝나지 않았거나 파일을 분리하면 빌드가 깨지는 경우에는 커밋을 미룰 수 있습니다. 중요한 것은 미룸을 조용히 누적하지 않고, slice closure 시점마다 commit 후보를 검토하고 이유를 남기는 것입니다.

## Soft Rhythm

1. currentSlice의 claim/scope/evidence를 확인합니다.
2. 가장 가까운 검증이 통과하면 `work_context action=commit_plan`을 호출합니다.
3. 생성된 JSON plan의 `message`와 `paths`를 읽어 reviewable한지 확인합니다.
4. 적절하면 `auto_commit action=apply planPath=<planPath>`로 커밋합니다. 단일 copy/hotfix처럼 slice plan 파일을 만드는 비용이 작업보다 커질 때는 `auto_commit action=quick message=<...> paths=[...]`로 같은 explicit-path 원칙을 지키며 바로 닫을 수 있습니다.
5. auto-commit 결과가 `committed_not_pushed`이면 사용자가 push 보류를 말하지 않은 한 push 실패/스킵을 먼저 해결합니다.
6. 커밋을 보류하면 `work_context action=checkpoint`에 이유를 남깁니다.

`workflow_guard`는 standard/full 구현 턴에서 이 rhythm을 system prompt에 soft reminder로 주입합니다. reminder는 block이 아니라 기본 리듬입니다.

## Why not hard guard

하드 가드는 작업을 자주 막고, 작은 탐색·검증 전 diff까지 억지 커밋으로 만들 위험이 있습니다. 사용자가 원한 것은 “중간중간 쪼개서 커밋하는 습관/흐름”이지 “다음 행동마다 커밋 여부로 막히는 UX”가 아닙니다.

그래서 pilee는 다음 방식으로 균형을 잡습니다.

- `work_context commit_plan`은 currentSlice scope 기반으로 plan을 만들지만 곧바로 commit하지 않습니다.
- `auto_commit apply`는 여전히 explicit JSON plan만 실행합니다.
- `auto_commit quick`은 JSON 파일을 만들지 않는 light path지만, message와 paths가 명시된 경우에만 실행합니다.
- outside-scope 파일은 기본적으로 leftovers로 남겨 unrelated change를 섞지 않습니다.
- agent가 커밋을 미루면 checkpoint reason을 남기게 합니다.

## Reference fit

`my-pi`의 `/ship`은 “commit + verify + push가 기본”이라는 강한 release rhythm을 둡니다. pilee의 slice rhythm은 이를 ship 직전이 아니라 implementation 중 slice closure 시점으로 앞당긴 것입니다.

`pi-extension`의 diff-review는 working tree와 commit scope를 분리해 리뷰 단위를 명확히 합니다. pilee는 같은 관점을 구현 중에도 적용해, working tree 전체가 아니라 currentSlice scope를 먼저 commit 후보로 삼습니다.
