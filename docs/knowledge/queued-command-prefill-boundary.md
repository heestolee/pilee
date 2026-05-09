---
title: Queued command는 실행 보장이 아니다
tags:
  - queued-messages
  - slash-command
  - prefill
  - worktree
  - session
  - boundary
category: workflow
status: active
confidence: high
applies_to:
  - extensions/queued-messages
  - extensions/worktree
  - worktree_create
  - worktree_switch
  - worktree_fork
source:
  - pilee-history:2026-05-05#41
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-09
reviewed_commit: d54d56d58ec9f5216cc5f5858e675a0addd5233e
related:
  - worktree-execution-boundary
  - session-identity-over-filenames
  - subagent-prompt-specificity
---

## Judgment

Pi 대화에 slash command 문자열을 queue했다고 해서 그 command가 실제로 실행된다고 가정하면 안 됩니다. 세션 전환이나 worktree 생성처럼 실행 경계가 중요한 작업은 “메시지 주입”이 아니라 명시적 세션 준비와 사용자-visible prefill을 사용합니다.

## Boundary Rule

도구는 필요한 세션을 만들거나 fork하고, 사용자가 확인할 수 있는 editor prefill을 제공합니다. 자동 실행이 필요한 일은 command queue에 기대지 말고 확실한 API/함수 경로로 수행합니다.

## Worktree Tool Rule

`worktree_create`, `worktree_switch`, `worktree_fork` 같은 도구는 slash command를 몰래 실행하지 않습니다. 대신 세션을 준비하고 사용자가 볼 수 있는 `/wt switch ...` prefill을 남깁니다. 실행 경계가 바뀌는 작업일수록 사용자가 실제 전환을 눈으로 확인해야 합니다.

## Failure Mode

queued slash command를 실행으로 착각하면 worktree가 만들어진 줄 알았지만 현재 세션은 그대로인 상태가 됩니다. 사용자가 보는 전환과 실제 실행 상태를 일치시켜야 합니다.
