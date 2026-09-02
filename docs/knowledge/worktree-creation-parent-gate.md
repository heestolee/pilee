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
  - user-direction:2026-08-25-workspace-activation-redesign
  - user-direction:2026-09-02-pr-review-current-panel-or-tab
reviewed_at: 2026-09-02
reviewed_commit: 93ddc04
related:
  - worktree-execution-boundary
  - worktree-session-continuity
  - workspace-action-panel-activation-contract
---

## Judgment

Worktree 생성은 단순한 파일 시스템 작업이 아니라 실행 경계와 세션 계보를 동시에 만드는 결정입니다. runtime profile이 protected repo로 지정한 업무 레포에서도 사용자가 현재 보고 있는 패널의 대화가 기본 source session입니다. 다만 source가 어디인지와 target을 어느 panel에서 활성화할지는 workflow별로 다릅니다. 사용자가 직접 실행한 slash `/wt new`는 기존 생성 방식대로 현재 panel을 target session으로 전환합니다. Slash `/wt fork`는 공통 생성을 마친 뒤 현재 panel·새 탭·오른쪽 panel 중 사용자가 고른 위치에서 활성화합니다. Agent tool·Frame/TFT처럼 source panel 보존 자체가 목적에 포함된 composed workflow는 별도 placement/READY 계약을 유지합니다. PR review는 read-only head-pinned worktree를 만들지만 source panel 보존을 강제하지 않으며, 사용자가 현재 panel 또는 새 탭을 고릅니다.

## Gate Rule

생성 전에 반드시 세 가지를 판정합니다.

1. **Stage** — “확인해볼래?”처럼 조사 요청이면 worktree를 만들지 않습니다. 원인과 수정 후보를 먼저 좁힙니다.
2. **Context carry** — 조사·계획·파일 경로·의사결정이 이미 대화에 있으면 fresh worktree가 아니라 `/wt fork` / `worktree_fork`를 사용합니다. 이 흐름의 기본 계승 단위는 전체 transcript입니다. 최소 handoff pack은 사용자가 `--minimal-context` / `minimalContext: true`처럼 의식적으로 가벼운 전달을 선택했을 때만 사용합니다.
3. **Base branch** — hotfix/production 단서가 있으면 `--hotfix` / `hotfix: true`를 명시해 production 기반에서 시작합니다.

## Current Panel Source Rule

Fork child panel(`P1`, `P2`, …)도 profile gate가 허용하면 protected/profiled worktree의 source가 될 수 있습니다. 이때 source session은 부모가 아니라 현재 패널 대화입니다. 사용자가 P1에서 조사하고 바로 `/wt fork`를 실행했다면 P1은 그대로 남고, “P1의 조사 맥락을 계승한 새 실행공간이 선택한 sibling panel에서 시작된다”가 직관적인 모델입니다.

부모 `P0` 대화를 기준으로 만들고 싶을 때만 사용자가 부모 패널에서 명시적으로 실행합니다. `/handoff`는 부모에게 결과를 알리는 협업 기능이지, worktree 생성을 위한 필수 의식 절차가 아닙니다. 어떤 repo가 protected인지는 public code가 아니라 profile/overlay config가 결정하지만, profile의 gate flag는 현재 패널 source provenance를 표시하는 데 쓰고 hard block으로 쓰지 않습니다.

## Failure Mode

잘못 생성된 worktree는 이름과 브랜치가 남아 이후 대시보드와 세션 선택을 오염시킵니다. development 기반 hotfix, context 없는 full fork, source session을 추적할 수 없는 handoff, READY가 오지 않은 target session은 작업 자체보다 복구 비용이 큽니다. 실패를 알면 source panel은 그대로 두고, cancellation claim과 target terminal close가 모두 확인된 경우에만 이번 실행이 만든 session/worktree/branch를 정리합니다. Child가 continuation을 소유했거나 close가 확인되지 않으면 recovery artifact를 보존합니다. full transcript가 과도하게 큰 예외 상황에서는 사용자가 명시적으로 `--minimal-context`를 선택해야 하며, meta/source reference와 persisted context message가 반드시 남아야 합니다.
