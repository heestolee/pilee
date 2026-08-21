---
title: Ship과 PR-Ship은 서로 다른 통합 단계다
tags:
  - ship
  - pr-ship
  - pr-review
  - github
  - commit
  - push
category: workflow
status: active
confidence: high
applies_to:
  - skills/ship
  - skills/pr-ship
  - extensions/ship-commands
  - extensions/pr-comments
  - extensions/pr-review-re-request
source:
  - user-direction:2026-05-10-pr-ship-boundary
  - external-reference:my-pi-skills-ship
  - backlog:22
  - user-direction:2026-08-21-pr-ship-automated-reviewer-only
  - user-direction:2026-08-21-pr-ship-decision-preservation
reviewed_at: 2026-08-21
reviewed_commit: 44f9c17
related:
  - change-integration-discipline
  - diff-review-draft-handoff
  - request-traceability-surgical-changes
  - evidence-first-verification-gate
  - subagent-skill-delegation
---

## Judgment

`ship`과 `pr-ship`은 같은 “올리기”가 아닙니다. `ship`은 PR 전 변경을 commit/verify/push 가능한 상태로 정리하는 단계입니다. `pr-ship`은 trusted private profile이 exact GitHub login으로 허용한 자동 리뷰어만 근본 대응해 commit/push/thread reply/same-login re-request까지 수행합니다. allowlist 밖 인간·미확인 리뷰는 읽기와 로컬 분석·보고에서 멈추며 코드와 GitHub 상태를 바꾸지 않습니다. `pr-ship --push-only`는 allowlisted 자동 리뷰 대응의 comment/re-request만 생략하는 변형입니다.

## Stage Boundary

`ship`은 PR 생성 전 또는 일반 push 전 gate입니다. 관심사는 diff 정리, 의도 단위 커밋, 로컬 검증, 안전한 push입니다. PR comment state나 reviewer workflow를 바꾸지 않습니다.

`pr-ship`은 PR이 열린 뒤의 actor-gated review-response 단계입니다. 특정 review/comment URL이면 그 target의 실제 author가, PR-wide 실행이면 각 thread의 root author가 action eligibility를 결정합니다. allowlisted 자동 리뷰는 코드 수정부터 해당 thread 답글과 같은 exact login re-request까지가 완료 단위입니다. 인간 review URL은 본문이 AI 결과를 전달하더라도 인간 review이며 local-only입니다. `--push-only`도 인간 review를 write workflow로 승격하지 않습니다.

## Review State Boundary

PR 리뷰 대응의 외부 상태 변경은 allowlisted 자동 리뷰에만 허용됩니다. 답글과 re-request는 `pr_ship_review_write`가 게시 직전 대상 author/login을 trusted profile과 다시 대조해 허용하며, 인간·unknown·team reviewer는 차단합니다. raw `gh`/REST/GraphQL review write는 command turn에서 막고 skill도 우회를 금지합니다. 인간 리뷰는 제품 파일 수정, test 수정, commit, push, draft, comment, re-request를 모두 하지 않습니다. Review thread `resolve`/`unresolve`, timeline comment, merge/auto-merge/merge queue는 actor와 무관하게 `pr-ship` 범위 밖입니다.

## Root-Cause Rule

`pr-ship`은 표면 답변을 만들지 않습니다. 리뷰 문구에 맞춰 한 줄만 바꾸기 전에, 부모/현재 대화의 작업 맥락, PR diff, commit history, 관련 파일, 기존 답글을 확인합니다. 실제 수정할 게 없으면 fake commit을 만들지 않고, 근거를 해당 review conversation에 남깁니다.

## Decision Preservation Boundary

review comment는 새 입력이지만, 기존 사용자 선택·frame decision·의도적 revert/refactor/code-refine·이미 수용한 review response를 자동으로 덮어쓰는 권한은 아닙니다. `pr-ship`은 대응 시작 전 `pre-response HEAD`와 근거가 있는 protected decision ledger를 만들고, 각 리뷰를 기존 결정과 호환되는 수정, stale/reintroduction, conflict, superseding evidence로 분류합니다.

보존 가능한 해법이 있으면 가장 작은 호환 수정을 선택합니다. 리뷰 severity가 높아도 모든 유효한 해법이 보호 결정을 바꿔야 한다면 사용자 재결정 전에는 write workflow를 진행하지 않습니다. 반대로 더 최신의 명시적 사용자 선택이나 검증된 새 사실이 기존 전제를 깨뜨리면 결정을 영구 고정하지 않고 supersession 근거를 갱신합니다. commit 전에는 review-response 범위의 `pre-response HEAD` 대비 diff로 제거·원복·다이어트한 코드나 이전 review response가 되살아나지 않았는지 확인하고, 최종 보고에 보존한 결정과 의도적 변경을 분리해 남깁니다.

## Extension/Skill Split

Skill은 actor gate와 행동 계약을 담습니다. allowlisted action queue와 인간 local-analysis queue를 분리하고, 근본 원인 분석, 수정 여부, 검증, reply format, 금지 동작을 규정합니다.

Extension은 결정적 수집·routing·write guard를 맡습니다. `/pr-ship` command shim은 review URL과 comment URL의 author, unresolved thread root author, trusted private profile allowlist를 모아 각 actor route를 명시합니다. profile이 없거나 author/repository 조회가 실패하면 fail closed local-only입니다. `pr_ship_review_write`는 allowlisted thread reply와 same-login re-request만 제공하고, generic reviewer/team re-request 경로는 사용하지 않습니다. 회사별 actor login은 public skill/extension이 아니라 private profile에 둡니다.

Subagent delegation에서도 같은 split을 유지합니다. `>> /ship`, `>> /pr-ship`, `>> /ci-ship`은 slash command를 subagent 안에서 실행하는 것이 아니라, 부모 extension이 동일한 read-only context와 inlined skill prompt를 만들어 subagent task로 넘기는 방식입니다.

## Failure Mode

review body의 문체나 `user.type`만 보고 자동 actor를 추정하면 인간이 전달한 AI 결과에 agent가 답글/re-request하는 사고가 생깁니다. 또한 “승인되지 않은 reviewer 전부”를 re-request하면 인간 review ownership을 침범합니다. 그래서 actor identity는 trusted profile의 exact login으로만 결정하고, project-local profile이 스스로 external-write 권한을 선언하지 못하게 합니다. 특정 인간 review URL을 받았을 때 PR의 다른 자동 thread를 대신 처리하는 것도 금지합니다. 자동화 대상을 좁힌 결과 인간 리뷰 구현이 필요하면 `/pr-ship`이 아니라 별도 일반 구현/`ship` 흐름으로 전환해야 합니다.
