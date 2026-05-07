---
title: Worktree 의존성 준비는 조건부 worker가 맡는다
tags:
  - worktree
  - dependencies
  - bootstrap
  - product
  - lambda
  - worker
category: workflow
status: active
confidence: high
applies_to:
  - extensions/worktree
  - /wt bootstrap
  - worktree_create
  - worktree_fork
source:
  - user-direction:2026-05-07-worker-dependency-bootstrap
reviewed_at: 2026-05-07
reviewed_commit: d601ac0041243e78871b352c51f38b50f22be4bb
related:
  - worktree-execution-boundary
  - worktree-session-continuity
  - worktree-creation-parent-gate
---

## Judgment

Product/lambda worktree의 dependency 준비는 구현 agent가 lint 실패를 맞고 뒤늦게 처리하는 일이 아니라, 구현 시작 시점에 조건부 background worker가 맡아야 합니다.

worker는 이미 준비된 `node_modules`를 다시 설치하지 않고, 현재 작업 의도와 worktree 종류로 필요한 domain만 추정해 누락된 dependency만 설치합니다. 이렇게 하면 main agent는 구현 맥락을 유지하면서도 validation 전에 필요한 toolchain 상태를 인지할 수 있습니다.

## Conditional Rule

worker는 다음 조건을 만족할 때만 자동 시작합니다.

1. 현재 cwd가 product/lambda worktree입니다.
2. user prompt가 조사 전용이 아니라 구현/수정/검증/마무리 흐름입니다.
3. 필요한 marker가 없습니다.
   - product root: `node_modules/.bin/lefthook`
   - product backend: `backend/node_modules/.bin/eslint`
   - product frontend: `frontend/node_modules/.bin/eslint`
   - lambda root: `node_modules/`

product backend install은 Homebrew Python native build 문제를 피하기 위해 `PYTHON=/usr/bin/python3 pnpm install --frozen-lockfile`을 사용합니다.

## Main Agent Contract

worker가 시작되면 extension은 해당 turn의 system prompt와 visible message에 bootstrap 상태를 주입합니다. main agent는 코드를 읽고 수정할 수 있지만, lint/type-check/test를 실행하기 전에는 `/wt bootstrap status` 또는 footer/status/log로 worker 완료 여부를 확인해야 합니다.

수동으로는 `/wt bootstrap`, `/wt bootstrap --backend`, `/wt bootstrap --frontend`, `/wt bootstrap --all`, `/wt bootstrap status`를 사용할 수 있습니다.

## Boundary

이 worker는 dependency bootstrap만 담당합니다. schema/codegen, DB migration, local dev server, verification capture는 각 작업의 명시적 validation 단계에서 별도로 실행해야 합니다.
