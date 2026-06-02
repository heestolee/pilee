---
title: Worktree 생성은 현재 패널 대화가 source다
tags:
  - worktree
  - fork-panel
  - current-panel
  - hotfix
  - context
  - profile-driven
  - 워크트리
category: workflow
status: active
confidence: high
applies_to:
  - extensions/worktree
  - extensions/fork-panel
  - worktree_create
  - worktree_fork
  - /wt new
  - /wt fork
source:
  - pilee-history:2026-05-06#67
  - user-direction:2026-05-17-full-worktree-fork-default
reviewed_at: 2026-06-02
reviewed_commit: 61ccbc9d3fb4d6eb5cb7f0558dd056eb385b0410
related:
  - worktree-execution-boundary
  - worktree-session-continuity
---

## Judgment

Worktree 생성은 단순한 파일 시스템 작업이 아니라 실행 경계와 세션 계보를 동시에 만드는 결정입니다. runtime profile이 protected repo로 지정한 업무 레포에서도 사용자가 현재 보고 있는 패널의 대화가 기본 source session입니다. 어느 base branch에서 시작하는지, 이미 쌓인 조사 맥락을 어떻게 넘기는지가 결과의 일부이지만, P0/P1/P2 위치 자체가 생성을 막는 조건은 아닙니다.

## Gate Rule

생성 전에 반드시 세 가지를 판정합니다.

1. **Stage** — “확인해볼래?”처럼 조사 요청이면 worktree를 만들지 않습니다. 원인과 수정 후보를 먼저 좁힙니다.
2. **Context carry** — 조사·계획·파일 경로·의사결정이 이미 대화에 있으면 fresh worktree가 아니라 `/wt fork` / `worktree_fork`를 사용합니다. 이 흐름의 기본 계승 단위는 전체 transcript입니다. 최소 handoff pack은 사용자가 `--minimal-context` / `minimalContext: true`처럼 의식적으로 가벼운 전달을 선택했을 때만 사용합니다.
3. **Base branch** — hotfix/production 단서가 있으면 `--hotfix` / `hotfix: true`를 명시해 production 기반에서 시작합니다.

## Current Panel Source Rule

Fork child panel(`P1`, `P2`, …)도 protected/profiled worktree를 생성할 수 있습니다. 이때 source session은 부모가 아니라 현재 패널 대화입니다. 사용자가 P1에서 조사하고 바로 `/wt fork`를 실행했다면 “P1의 조사 맥락 그대로 새 실행공간으로 이동한다”가 직관적인 모델입니다.

부모 `P0` 대화를 기준으로 만들고 싶을 때만 사용자가 부모 패널에서 명시적으로 실행합니다. `/handoff`는 부모에게 결과를 알리는 협업 기능이지, worktree 생성을 위한 필수 의식 절차가 아닙니다. 어떤 repo가 protected인지는 public code가 아니라 profile/overlay config가 결정하지만, profile의 gate flag는 현재 패널 source provenance를 표시하는 데 쓰고 hard block으로 쓰지 않습니다.

## Failure Mode

잘못 생성된 worktree는 이름과 브랜치가 남아 이후 대시보드와 세션 선택을 오염시킵니다. development 기반 hotfix, context 없는 구현 세션, source session을 추적할 수 없는 minimal handoff는 작업 자체보다 복구 비용이 커질 수 있으므로, 잘못 만들었음을 알면 즉시 삭제하고 현재 패널 source 기준으로 다시 만듭니다. full transcript가 과도하게 큰 예외 상황에서는 `--minimal-context`를 쓰되, meta/source reference와 persisted context message가 반드시 남아야 합니다.
