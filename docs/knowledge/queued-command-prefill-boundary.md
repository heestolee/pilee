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
  - extensions/tasks
  - extensions/frame-studio
  - extensions/tft-commands
  - frame_worktree_fork
  - worktree_create
  - worktree_switch
  - worktree_fork
  - extensions/subagent
source:
  - pilee-history:2026-05-05#41
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-05-11-subagent-skill-delegation
reviewed_at: 2026-08-26
reviewed_commit: 871ec54
related:
  - worktree-execution-boundary
  - session-identity-over-filenames
  - subagent-prompt-specificity
  - subagent-skill-delegation
  - workspace-action-panel-activation-contract
---

## Judgment

Pi 대화에 slash command 문자열을 queue했다고 해서 그 command가 실제로 실행된다고 가정하면 안 됩니다. 실행 경계가 중요한 작업은 목적에 맞는 실제 activation API로 수행합니다. current-panel 이동인 `/wt switch`는 `switchSession` 또는 deferred `requestSessionSwitch`를 사용하고, new/fork/create 흐름은 fork-panel host adapter로 exact cwd/session을 새 panel에서 연 뒤 target READY ack를 기다립니다. 둘을 서로의 fallback으로 사용하지 않습니다.

## Boundary Rule

도구는 자동 실행이 필요한 일을 command queue에 기대지 말고 확실한 API/함수 경로로 수행합니다. 해당 API가 없는 tool context라면 실행 경계 변경을 시도하지 않고 `BLOCKED`로 멈춥니다. “절대경로로 계속 작업”은 사용자가 기대한 forked context가 아니므로 fallback이 아닙니다.

사용자가 단축키를 누른 경우에는 가능한 한 실제 handler를 즉시 실행해야 합니다. `Ctrl+W`처럼 `/wt switch` dashboard를 열 수 있거나 `Ctrl+Shift+T`처럼 `/tasks` overlay를 바로 열 수 있는 shortcut이 입력창에 slash command만 채워 넣으면 사용자는 “단축키가 동작했다”가 아니라 “명령어가 입력됐다”고 느낍니다. prefill은 즉시 실행 API가 없거나 runtime 경계 때문에 수동 확인이 필요한 fallback일 때만 씁니다.

Subagent에 slash command 문자열을 그대로 넘기는 것도 command 실행이 아닙니다. 필요한 경우 command shim이 만드는 context와 `SKILL.md` prompt를 명시적으로 구성해 subagent task로 위임합니다.

## Worktree Tool Rule

`worktree_create`, `worktree_switch`, `worktree_fork` 같은 일반 도구는 slash command를 몰래 실행하지 않습니다. `worktree_create`와 `worktree_fork`는 매 실행 placement를 묻고 source panel을 유지한 채 exact target session을 새 Ghostty panel/tab에서 엽니다. target process는 session file과 cwd를 확인해 READY를 먼저 기록하고, 그 뒤에만 continuation을 follow-up으로 시작합니다. `worktree_switch`만 `switchSession` 또는 deferred `requestSessionSwitch`로 current panel을 이동합니다. 새 panel open/READY가 실패하면 이번 실행의 terminal/fork record/session/worktree/branch를 정리하고 BLOCKED로 끝내며, current-panel relaunch·slash prefill·절대경로 작업으로 우회하지 않습니다.

`/frame`처럼 command shim에서 시작해 agent가 Step 9 결정을 처리하는 흐름은 command context bridge를 둡니다. `/frame` command handler가 자신의 `ExtensionCommandContext`를 frame identity에 묶어 저장하고, Step 9의 `fork해서 시작`은 `frame_worktree_fork` tool을 통해 그 context의 실제 `/wt fork` 경로를 호출합니다. placement 선택과 READY handshake는 이 command path에서 실행되고, 새 panel continuation이 승격된 frame/task의 첫 ready slice를 시작합니다. bridge context가 없거나 session이 맞지 않으면 worktree를 만들지 않고 BLOCKED로 멈춥니다.

## Failure Mode

queued slash command를 실행으로 착각하면 worktree가 만들어진 줄 알았지만 현재 세션은 그대로인 상태가 됩니다. 사용자가 보는 전환과 실제 실행 상태를 일치시켜야 합니다.
