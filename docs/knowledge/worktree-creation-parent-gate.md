---
title: Worktree 생성은 부모 패널의 게이트다
tags:
  - worktree
  - fork-panel
  - parent-panel
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
reviewed_at: 2026-05-17
reviewed_commit: d674c80ef978cfb1c29327122ebb66b48b47f269
related:
  - worktree-execution-boundary
  - worktree-session-continuity
---

## Judgment

Worktree 생성은 단순한 파일 시스템 작업이 아니라 실행 경계와 세션 계보를 동시에 만드는 결정입니다. 특히 runtime profile이 protected repo로 지정한 업무 레포에서는 어느 패널의 대화가 source session인지, 어떤 base branch에서 시작하는지, 이미 쌓인 조사 맥락을 어떻게 넘기는지가 결과의 일부입니다.

## Gate Rule

생성 전에 반드시 세 가지를 판정합니다.

1. **Stage** — “확인해볼래?”처럼 조사 요청이면 worktree를 만들지 않습니다. 원인과 수정 후보를 먼저 좁힙니다.
2. **Context carry** — 조사·계획·파일 경로·의사결정이 이미 대화에 있으면 fresh worktree가 아니라 `/wt fork` / `worktree_fork`를 사용합니다. 이 흐름의 기본 계승 단위는 전체 transcript입니다. 최소 handoff pack은 사용자가 `--minimal-context` / `minimalContext: true`처럼 의식적으로 가벼운 전달을 선택했을 때만 사용합니다.
3. **Base branch** — hotfix/production 단서가 있으면 `--hotfix` / `hotfix: true`를 명시해 production 기반에서 시작합니다.

## Parent Panel Rule

Fork child panel(`P1`, `P2`, …)은 protected/profiled worktree를 생성하지 않습니다. 자식 패널이 worktree를 만들면 부모 대화가 source session이 아니게 되고, 사용자가 기대한 `/wt fork` 계보와 어긋납니다. 자식은 `/handoff`로 조사 결과를 부모 `P0`에 넘기고, 부모가 `/wt fork`를 실행합니다. 어떤 repo가 protected인지는 public code가 아니라 profile/overlay config가 결정합니다. Public worktree engine은 repo 이름이나 조직 URL을 내장하지 않고, profile의 match rule과 gate flag를 읽어 같은 부모 패널/hotfix 정책을 적용합니다. 이 gate는 `PI_FORK_PANEL_LABEL` env만 보지 않고 현재 session file의 fork-panel recent record도 fallback으로 확인해 revive로 env가 유실된 child session을 P0로 오판하지 않습니다.

## Failure Mode

잘못 생성된 worktree는 이름과 브랜치가 남아 이후 대시보드와 세션 선택을 오염시킵니다. development 기반 hotfix, context 없는 구현 세션, source session을 추적할 수 없는 minimal handoff는 작업 자체보다 복구 비용이 커질 수 있으므로, 잘못 만들었음을 알면 즉시 삭제하고 올바른 부모-owned fork를 다시 만듭니다. full transcript가 과도하게 큰 예외 상황에서는 `--minimal-context`를 쓰되, meta/source reference와 persisted context message가 반드시 남아야 합니다.
