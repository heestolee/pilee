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
reviewed_at: 2026-05-20
reviewed_commit: 32d1aedb2d3bbe552d84e03c7db7435884af2c0e
related:
  - worktree-execution-boundary
  - session-identity-over-filenames
  - subagent-prompt-specificity
  - subagent-skill-delegation
---

## Judgment

Pi 대화에 slash command 문자열을 queue했다고 해서 그 command가 실제로 실행된다고 가정하면 안 됩니다. 세션 전환이나 worktree 생성처럼 실행 경계가 중요한 작업은 “메시지 주입”·입력창 prefill·터미널 keyboard injection이 아니라, command context의 `switchSession` 또는 tool context의 deferred `requestSessionSwitch` 같은 실제 session switch API로만 수행합니다. deferred API는 즉시 터미널에 입력하지 않고 현재 agent turn이 idle이 된 뒤 runtime의 `switchSession`을 요청합니다.

## Boundary Rule

도구는 자동 실행이 필요한 일을 command queue에 기대지 말고 확실한 API/함수 경로로 수행합니다. 해당 API가 없는 tool context라면 실행 경계 변경을 시도하지 않고 `BLOCKED`로 멈춥니다. “절대경로로 계속 작업”은 사용자가 기대한 forked context가 아니므로 fallback이 아닙니다.

사용자가 단축키를 누른 경우에는 가능한 한 실제 handler를 즉시 실행해야 합니다. `Ctrl+W`처럼 `/wt switch` dashboard를 열 수 있거나 `Ctrl+Shift+T`처럼 `/tasks` overlay를 바로 열 수 있는 shortcut이 입력창에 slash command만 채워 넣으면 사용자는 “단축키가 동작했다”가 아니라 “명령어가 입력됐다”고 느낍니다. prefill은 즉시 실행 API가 없거나 runtime 경계 때문에 수동 확인이 필요한 fallback일 때만 씁니다.

Subagent에 slash command 문자열을 그대로 넘기는 것도 command 실행이 아닙니다. 필요한 경우 command shim이 만드는 context와 `SKILL.md` prompt를 명시적으로 구성해 subagent task로 위임합니다.

## Worktree Tool Rule

`worktree_create`, `worktree_switch`, `worktree_fork` 같은 일반 도구는 slash command를 몰래 실행하지 않습니다. 현재 패널을 실제 worktree session으로 전환할 수 있는 `switchSession` 또는 `requestSessionSwitch` API가 있을 때만 진행합니다. pilee worktree extension은 `ExtensionRunner.createContext()`에 비열거 `requestSessionSwitch`를 추가하고, 이 함수는 `waitForIdle()` 이후 runtime `switchSession` handler를 호출합니다. API가 없는 tool context에서는 worktree 생성·전환을 시작하지 않고 `BLOCKED`를 반환하며, 전환 명령을 에디터에 채우거나 “이 경로에서 계속 작업” 같은 우회를 제안하지 않습니다. 특히 Ghostty에 `cd ... && pi --session ...`을 `input text`로 주입하는 current-panel relaunch fallback은 포커스된 다른 Pi 패널을 user message로 오염시킬 수 있으므로 사용하지 않습니다. 이미 생성 후 전환이 실패한 드문 경우에도 현재 세션에서 작업을 이어가지 않고 실패를 명시합니다.

`/frame`처럼 command shim에서 시작해 agent가 Step 9 결정을 처리하는 흐름은 예외적으로 command context bridge를 둡니다. `/frame` command handler가 자신의 `ExtensionCommandContext`를 frame identity에 묶어 저장하고, Step 9의 `fork해서 시작`은 `frame_worktree_fork` tool을 통해 그 저장된 command context의 실제 `/wt fork` 경로를 호출합니다. 이렇게 해야 LLM tool context가 직접 session switch를 못 하더라도 사용자는 `/wt switch` fallback 없이 forked worktree session으로 바로 이동합니다. bridge context가 없거나 session이 맞지 않으면 worktree를 만들지 않고 `BLOCKED`로 멈춥니다.

## Failure Mode

queued slash command를 실행으로 착각하면 worktree가 만들어진 줄 알았지만 현재 세션은 그대로인 상태가 됩니다. 사용자가 보는 전환과 실제 실행 상태를 일치시켜야 합니다.
