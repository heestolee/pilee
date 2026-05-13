---
title: 반복 검증 실패는 baseline cache로 분리한다
tags:
  - preflight
  - validation
  - baseline
  - failure
  - cache
  - verification
  - workflow
category: verification
status: active
confidence: high
applies_to:
  - extensions/preflight
  - skills/git-workflow-and-versioning
  - skills/verify
source:
  - user-direction:2026-05-12-worktree-speed-analysis
reviewed_at: 2026-05-12
reviewed_commit: fc6ffa9aaa2a87275a50c2888d6ca4bbe0255cf6
related:
  - root-cause-before-fix
  - evidence-first-verification-gate
  - worktree-session-continuity
  - deterministic-fallbacks-preserve-workflow
title_en: Repeated validation failures are separated by a baseline cache
---

## Overview

검증 실패는 반드시 읽어야 하지만, 이미 여러 worktree에서 같은 원인으로 확인된 unrelated baseline 실패를 매번 새 결함처럼 재조사하면 작은 hotfix도 느려집니다. Baseline cache는 “이 실패는 존재하지만 이번 diff의 actionable failure가 아니다”를 짧은 기간 동안 기억하는 장치입니다.

## Rule

검증 명령이 실패하면 preflight extension이 bash tool result를 관찰해 실패 signature를 남깁니다. 같은 repo/check/signature가 known baseline으로 등록되어 있으면 결과에 `[preflight] Known baseline failure` 주석을 붙이고, agent는 이를 `Known baseline / unrelated`로 분리합니다.

새 실패를 처음 본 경우에는 agent가 전체 로그를 읽고 current diff와의 관련성을 판단합니다. unrelated baseline이라고 판단했을 때는 사용자에게 slash command를 요구하지 않고 `preflight_baseline` tool의 `action="add_last"`로 기록합니다. 별도 사용자-facing `/preflight` command는 제공하지 않습니다. 사람이 점검하거나 정리하고 싶으면 자연어로 요청하고, agent가 `preflight_baseline` tool의 `list`/`clear`/`prune`을 호출합니다.

Baseline entry는 state sidecar(`~/.pi/agent/state/preflight-baseline-cache.json`)이며 repository source나 public docs에 raw 로그를 복사하지 않습니다.

## Guardrails

- Baseline은 required check를 통과로 만들지 않습니다.
- 현재 diff가 실패 signature나 원인을 바꿨으면 새 failure로 분석합니다.
- 만료 기간을 둡니다. 기본 30일이며, hotfix 반복 노이즈는 보통 `--expires 14d`처럼 더 짧게 둡니다.
- 실패를 처음 본 경우에는 root cause를 읽고 unrelated라는 근거를 확보한 뒤 agent가 tool로 baseline을 등록합니다.
- Baseline으로 분리한 실패는 최종 보고의 `Known baseline / unrelated` 섹션에 남깁니다.

## Why It Matters

작은 작업이 느려지는 흔한 이유는 구현 난이도보다 반복되는 환경·baseline 실패 조사입니다. Cache는 검증을 약화하지 않고, 이미 판단한 노이즈를 액션 대상에서 분리해 새 실패에 집중하게 합니다.
