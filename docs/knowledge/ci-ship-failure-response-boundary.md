---
title: CI-Ship은 PR 후 검증 실패 대응 단계다
tags:
  - ci-ship
  - ci
  - github-actions
  - pull-request
  - failure-analysis
  - ship
category: workflow
status: active
confidence: high
applies_to:
  - skills/ci-ship
  - extensions/ship-commands
source:
  - user-direction:2026-05-10-ci-ship
  - user-direction:2026-05-11-ci-ship-update-branch
  - pr-context:github-actions-failure
reviewed_at: 2026-05-11
reviewed_commit: 7142974
related:
  - ship-pr-ship-review-boundary
  - root-cause-before-fix
  - evidence-first-verification-gate
  - change-integration-discipline
---

## Judgment

`ci-ship`은 `ship`이나 `pr-ship`의 하위 옵션이 아니라 PR 후 검증 실패를 다루는 별도 단계입니다. PR이 이미 열린 뒤 CI가 실패하면 핵심 질문은 “무엇을 push할까?”나 “리뷰 코멘트에 뭐라고 답할까?”가 아니라 **어떤 check/job/step이 왜 실패했고, PR 변경과 어떤 인과가 있는가**입니다.

## Stage Boundary

`ship`은 PR 전 commit/verify/push gate입니다. `pr-ship`은 review conversation 대응 gate입니다. `ci-ship`은 PR 후 status check failure 대응 gate입니다. 세 단계는 모두 commit/push를 할 수 있지만, 입력 표면과 완료 조건이 다릅니다.

- `ship`: local diff → commit/verify/push
- `pr-ship`: review comment → root-cause fix or evidence reply
- `ci-ship`: failed check/log → failure classification → fix/regenerate/verify/push + final report

## Failure Classification Rule

CI 실패는 먼저 분류합니다. Code failure, generated artifact stale, stale base / branch behind, stale test expectation, flaky/timeout, infra/external, unrelated baseline, unknown은 서로 다른 대응을 요구합니다. 마지막 `exit code 1`이나 실패 check 이름만으로 수정하면 표면 대응이 됩니다.

## Evidence Rule

CI 대응은 failed check URL, workflow/job/step, 실제 에러 로그, 로컬 재현 명령, 수정 commit을 연결해야 합니다. `--log-failed`가 부족하면 전체 log나 더 좁은 local reproduction을 확인합니다. Generated artifact 문제는 정식 generator로 만들고 diff를 읽어야 하며, 손편집하지 않습니다.

## Branch Freshness Rule

`ci-ship`은 실패 check만 보지 않고 PR head가 base branch보다 뒤처졌는지도 함께 봅니다. base-only commit이 있고 실패 로그·mergeState·로컬 재현이 stale base를 가리키면, 코드 수정 대신 branch update가 근본 대응일 수 있습니다. 이때 자동 update는 clean worktree, local HEAD와 PR `headRefOid` 일치, merge conflict 없음, rebase/force-push 없음 조건에서만 허용합니다.

기본 방식은 `git fetch origin <base> <head>` 후 `git merge --no-edit origin/<base>`와 `git push origin HEAD:<headRefName>`입니다. GitHub `Update branch` 버튼과 같은 목적이더라도 로컬 상태를 추적하기 위해 merge commit 기반으로 수행하고, conflict나 remote divergence가 있으면 abort/report합니다.

## State Boundary

새 commit push나 안전한 base merge update push로 CI가 자동 재실행되는 것은 정상 대응입니다. 하지만 수동 workflow rerun, PR comment 작성, review re-request, PR merge/auto-merge/merge queue, rebase/force-push는 별도 외부 상태 변경이므로 사용자 명시 승인 없이 실행하지 않습니다. Flaky/infra 판단도 근거 없이 rerun으로 덮지 않습니다.

## Extension/Skill Split

Skill은 실패 분류와 대응 계약을 담습니다. Extension은 PR statusCheckRollup과 failed job log를 read-only로 수집해 skill을 시작시키는 역할만 합니다. Extension이 CI를 고치거나 rerun하지 않습니다.

## Failure Mode

CI 실패를 `pr-ship`으로 처리하면 review comment가 없는데도 thread 답글 중심 사고가 끼어듭니다. 반대로 `ship`으로 처리하면 이미 열린 PR의 check rollup/log evidence가 빠집니다. `ci-ship`은 CI failure를 일급 입력으로 두고 기본 완료 조건을 commit/push로 제한해, 원인 분석과 PR 후속 상태 변경을 분리합니다.
