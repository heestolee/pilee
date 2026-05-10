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
reviewed_at: 2026-05-10
reviewed_commit: 9052c3c
related:
  - change-integration-discipline
  - diff-review-draft-handoff
  - request-traceability-surgical-changes
  - evidence-first-verification-gate
---

## Judgment

`ship`과 `pr-ship`은 같은 “올리기”가 아닙니다. `ship`은 PR 전 변경을 commit/verify/push 가능한 상태로 정리하는 단계이고, `pr-ship`은 열린 PR의 리뷰 코멘트를 실제 근본 원인까지 대응한 뒤 commit/push/thread reply/re-request review까지 수행하는 단계입니다. 다만 `pr-ship --push-only`는 사용자와 답글 문구를 세션에서 다듬기 위해 외부 write를 commit/push까지만 제한하는 변형입니다.

## Stage Boundary

`ship`은 PR 생성 전 또는 일반 push 전 gate입니다. 관심사는 diff 정리, 의도 단위 커밋, 로컬 검증, 안전한 push입니다. PR comment state나 reviewer workflow를 바꾸지 않습니다.

`pr-ship`은 PR이 열린 뒤의 review-response gate입니다. 관심사는 특정 review conversation이 지적한 문제가 코드/문서/검증 근거로 닫혔는지입니다. 사용자가 “이거 대응작업-커밋-푸시-코멘트까지”라고 하면 코드 수정부터 해당 thread 답글, 승인되지 않은 리뷰어/팀의 review re-request까지를 하나의 완료 단위로 봅니다. 사용자가 `--push-only`를 선택하면 완료 단위는 코드 수정, 검증, commit, push, 수동 게시용 comment draft까지입니다.

## Review State Boundary

PR 리뷰 대응에서 AI가 기본으로 바꾸는 외부 상태는 commit, push, thread reply, review re-request까지입니다. `--push-only`에서는 commit/push만 외부 write로 수행하고, thread reply/re-request는 draft/report로 멈춥니다. Review thread `resolve`/`unresolve`, merge/auto-merge/merge queue는 사용자 또는 리뷰어 판단 영역입니다. 명시 승인 없이 실행하면 리뷰 사이클의 ownership을 침범하고, 이미 리뷰어가 바꾼 상태를 되돌리는 사고가 생깁니다.

## Root-Cause Rule

`pr-ship`은 표면 답변을 만들지 않습니다. 리뷰 문구에 맞춰 한 줄만 바꾸기 전에, 부모/현재 대화의 작업 맥락, PR diff, commit history, 관련 파일, 기존 답글을 확인합니다. 실제 수정할 게 없으면 fake commit을 만들지 않고, 근거를 해당 review conversation에 남깁니다.

## Extension/Skill Split

Skill은 판단과 행동 계약을 담습니다. 근본 원인 분석, 수정 여부 판단, 검증 선택, reply format, 금지 동작은 skill이 책임집니다.

Extension은 결정적 수집과 routing을 맡습니다. `/pr-ship` command shim은 current PR/comment URL, unresolved review comment snapshot, current/parent session path, invocation mode를 모아 skill을 인라인 실행합니다. `--push-only`/`--no-comment`/`--draft-only`/`--manual-comment`는 manual-comment mode로 전달됩니다. `github:get-pr-comments`는 editor에 unresolved thread를 붙이고, `github:pr-review-re-request`는 승인되지 않은 reviewer/team만 재요청하는 별도 finishing command입니다. Extension은 thread resolve/unresolve를 하지 않습니다.

## Failure Mode

`respond-review`류 workflow가 “답글 + resolve”를 하나로 묶으면 AI가 reviewer/author의 thread-state ownership을 침범합니다. 반대로 comment 수집과 review re-request를 전부 수동으로 맡기면 agent가 부모 대화와 PR state를 놓쳐 표면적 대응을 하기 쉽습니다. 그래서 pr-ship은 skill의 judgment contract, read-only comment collection, 마지막 re-request action을 함께 사용하되, 사용자가 문구를 직접 다듬어 게시하려는 때에는 `--push-only`로 외부 write boundary를 commit/push에 고정합니다.
