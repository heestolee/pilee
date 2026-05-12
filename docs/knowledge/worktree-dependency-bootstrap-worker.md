---
title: Worktree 의존성 준비는 조건부 worker가 맡는다
tags:
  - worktree
  - dependencies
  - bootstrap
  - profile-driven
  - worker
  - subagent
  - orchestrator
category: workflow
status: active
confidence: high
applies_to:
  - extensions/worktree
  - agents/bootstrapper
  - /wt bootstrap
  - worktree_create
  - worktree_fork
source:
  - user-direction:2026-05-07-worker-dependency-bootstrap
reviewed_at: 2026-05-12
reviewed_commit: 593f46779556089e3ecded3e579afb8a9c97f165
related:
  - worktree-execution-boundary
  - worktree-session-continuity
  - worktree-creation-parent-gate
  - subagent-prompt-specificity
  - subagent-model-policy
---

## Judgment

Profile이 bootstrap 대상으로 지정한 worktree의 dependency/runtime 준비는 구현 agent가 lint·migration·local-dev 실패를 맞고 뒤늦게 처리하는 일이 아니라, 구현 시작 시점에 조건부 readiness workflow가 맡아야 합니다.

기본 구조는 **AI subagent orchestrator + deterministic executor**입니다. subagent는 현재 작업 의도와 repo profile로 필요한 domain을 확인하고, extension이 생성한 executor script를 실행한 뒤 status/log를 읽어 READY/BLOCKED를 판정합니다. executor는 이미 준비된 marker를 다시 설치하거나 생성하지 않고 누락된 domain만 실행합니다. Domain은 dependency install뿐 아니라 local env 생성처럼 repo/profile마다 다른 runtime readiness도 표현할 수 있습니다. 한 domain이 여러 파일을 함께 준비해야 하면 profile은 `marker` + `markers[]`로 전체 marker 묶음을 선언하고, public executor는 하나라도 빠지면 해당 domain을 missing으로 봅니다.

## Conditional Rule

orchestrator/worker는 다음 조건을 만족할 때만 자동 시작합니다.

1. 현재 cwd가 runtime profile의 `worktree.repos[].bootstrap.enabled` repo와 매칭됩니다.
2. user prompt가 조사 전용이 아니라 구현/수정/검증/마무리 흐름입니다.
3. profile이 지정한 domain marker가 없습니다.

구체적인 marker, command, domain 추론 regex는 public extension 코드가 아니라 overlay/profile JSON에 둡니다. public pilee는 orchestration lifecycle, status/log, idempotent marker check, executor script 생성만 담당합니다. Profile이 없으면 자동 bootstrap은 조용히 비활성화되고, 사용자는 일반 worktree workflow만 사용합니다.

## Main Agent Contract

subagent orchestrator가 시작되면 extension은 해당 turn의 system prompt와 상태바에 bootstrap 상태를 주입합니다. 시작/이미 실행 중 안내는 채팅에 visible block으로 반복 노출하지 않고, READY/BLOCKED 같은 최종 판정이나 failed-to-start처럼 사용자가 개입해야 하는 상태만 visible하게 보고합니다. main agent는 코드를 읽고 수정할 수 있지만, lint/type-check/test를 실행하기 전에는 orchestrator의 READY 보고, `/wt bootstrap status`, 또는 status/log/report를 확인해야 합니다.

수동으로는 `/wt bootstrap`, `/wt bootstrap --backend`, `/wt bootstrap --frontend`, `/wt bootstrap --<profile-domain>`, `/wt bootstrap --domain <name>`, `/wt bootstrap --env`, `/wt bootstrap --all`, `/wt bootstrap status`를 사용할 수 있습니다. AI orchestrator를 우회해야 하면 `/wt bootstrap --executor`로 deterministic executor만 실행합니다. `/wt bootstrap status`는 profile domain marker별 ready/missing 상태를 함께 보여줘서 dependency READY와 runtime env READY를 구분할 수 있어야 합니다. 다중 marker domain은 누락된 marker 목록을 직접 보여줘 partial env copy 같은 false-ready를 막습니다.

## Boundary

이 workflow는 bootstrap과 readiness diagnosis만 담당합니다. 실제 schema/codegen, DB migration 적용, local dev server 실행, verification capture는 각 작업의 명시적 validation 단계에서 별도로 실행해야 합니다.

AI subagent는 source code를 수정하지 않습니다. 설치/준비 동작은 profile이 지정한 deterministic executor script 안에 제한하고, 실패 시에는 원인과 다음 조치를 보고합니다.

## Recursion Guard

Bootstrap orchestrator 자체도 product/lambda worktree 안에서 실행되므로, 일반 `before_agent_start` bootstrap trigger가 subagent 세션 안에서 다시 동작하면 bootstrapper가 bootstrapper를 계속 띄우는 재귀 launch가 발생합니다.

따라서 자동 bootstrap은 subagent session(`~/.pi/agent/sessions/subagents/...`)과 bootstrap orchestrator prompt 안에서는 비활성화합니다. Dependency readiness의 ownership은 main session이 orchestration하고, subagent는 전달받은 executor만 실행합니다.
