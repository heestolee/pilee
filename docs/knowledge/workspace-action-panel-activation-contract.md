---
title: 작업공간 동작과 panel activation은 별도 계약이다
tags:
  - workspace
  - worktree
  - branch
  - activation
  - panel
  - authorization
  - continuation
category: workflow
status: active
confidence: high
applies_to:
  - extensions/worktree
  - extensions/fork-panel
  - extensions/workflow-guard
  - extensions/pr-review
  - extensions/tft-commands
  - skills/frame
  - skills/git-workflow-and-versioning
  - /wt new
  - /wt fork
  - /wt switch
source:
  - user-direction:2026-08-25-workspace-activation-redesign
reviewed_at: 2026-08-31
reviewed_commit: e38c1637107f90a8e398dbfc9cb4779cb70e1ab9
related:
  - worktree-execution-boundary
  - worktree-session-continuity
  - queued-command-prefill-boundary
  - frame-plan-synthesis-continuity
  - human-pr-review-precedent-harness
  - worktree-creation-parent-gate
  - worktree-dependency-bootstrap-worker
---

## Judgment

파일 작업공간을 어떻게 준비할지와 대화를 어느 panel에서 활성화할지는 서로 다른 결정입니다. “worktree가 필요하다”는 사실이 현재 panel 교체를 허용하지 않고, “새 branch를 만든다”는 요청도 worktree 생성 권한이 아닙니다. 에이전트의 일반적인 안전성 추론은 사용자가 고른 topology를 확대할 수 없습니다.

## Execution Contract

실행 전 계약은 최소한 다음 축을 분리해 기록합니다.

- `workspaceAction`: 아무 변경 없음, 현재 workspace의 branch in-place 전환, 새 worktree 생성, 기존 worktree 사용
- `activationTarget`: current panel 또는 new panel
- `placement`: new panel일 때 right/left/up/down/tab
- `contextMode`: full 또는 clean
- `continuation`: target session READY 뒤 시작할 workflow
- `authorization`: command/tool/TUI/user turn 중 무엇이 해당 동작을 허용하거나 거부했는지

Authorization은 단순 keyword 존재 여부가 아닙니다. `worktree 만들지 말고 branch만 만들어`처럼 같은 문장에 worktree와 branch가 함께 있어도 부정 대상과 허용 대상을 따로 보존합니다. User turn과 TUI 선택은 ID·source/sourceId·action·decision·target·placement·timestamp·TTL을 가진 session custom entry로 저장합니다. 중립 `계속해` turn과 compaction/session restore는 이 event를 복원하고, matching tool call만 한 번 소비합니다. 이미 소비된 allow는 두 번째 생성을 허용하지 않으며 이후 사용자의 명시적 deny가 최신 결정으로 우선합니다. Activation contract는 별도 allow를 만들지 않고 그 consumer proof의 동일 event ID/source/sourceId를 보존합니다. 단, `/wt new`·`/wt fork`·`/wt switch` 같은 slash command 자체는 명시적 사용자 action이므로 exact command provenance로 self-authorize할 수 있습니다.

## Activation Rule

Slash `/wt new`는 worktree/session 생성 후 기존 `switchSession` 경로로 현재 panel을 exact target session/cwd로 직접 전환하고 최신 non-transition 요청 1개만 compact continuation으로 전달합니다. Slash `/wt fork`는 공통 worktree/full-lineage session 생성 후 현재 panel·새 탭·오른쪽 panel 중 활성화 위치를 선택하며 어느 경로든 최신 작업을 자동 계속합니다. 현재 panel은 직접 switch하고, 새 탭·오른쪽은 durable READY descriptor를 사용합니다. Full-lineage target이 초기 READY 대기 시간을 넘기면 crash로 오판해 panel을 닫지 않고 `pending`으로 반환하며 descriptor를 열어 둡니다. Target receiver가 나중에 exact cwd/session READY를 기록하면 continuation을 한 번만 claim해 자동 실행합니다. 실제 activation 준비/open 실패가 확인돼도 성공적으로 만든 worktree/session은 recovery artifact로 보존합니다. `worktree_create`, `worktree_fork`, PR review checkout, Frame/TFT fork도 source panel 보존용 new-panel READY 계약을 유지합니다.

Descriptor 전이는 `prepared → panel-opened → ready → continuing → continued`와 `prepared|panel-opened|ready|failed → cancelling → cancelled`를 구분합니다. Parent와 child process는 bounded retry·stale recovery가 있는 exclusive lock directory 안에서 전이를 claim합니다. Receiver가 `ready→continuing`을 먼저 소유하면 parent는 timeout cleanup을 수행하지 않고, parent가 cancellation을 먼저 소유하면 receiver는 continuation을 보내지 않습니다. 같은 descriptor를 연 duplicate receiver도 continuation을 두 번 dispatch할 수 없습니다.

`/wt switch`와 `worktree_switch`는 사용자가 기존 worktree로 현재 panel을 옮기는 명시적 경로입니다. current-panel activation은 이 switch/here 계열에만 남기며, new-panel open 실패를 current-panel switch로 대체하지 않습니다.

명시적 worktree authorization은 P0/P1/P2 어느 panel에서든 현재 보이는 conversation을 source로 사용할 수 있습니다. Source panel은 그대로 남고 target은 선택한 placement에 열립니다. 부모 P0를 source로 쓰고 싶을 때만 사용자가 P0에서 실행하며, `/handoff`는 필수 생성 절차가 아닙니다. Panel 번호는 stage·context-carry·hotfix/base·authorization gate를 우회하지 않습니다.

## Host Adapter Boundary

Ghostty에서 새 tab/split을 연 직후 별도 `input text`나 key event를 보내면 surface model 준비와 경쟁할 수 있습니다. 새 surface는 `surface configuration`의 initial working directory와 `command`를 생성 시점에 설정하고, 생성 이후 입력 자동화에 의존하지 않습니다. `initial input`에 한글 raw command를 넣으면 Unicode가 깨지고 긴 inline base64 payload를 넣으면 host 길이 제한으로 닫는 quote가 잘릴 수 있습니다. 따라서 command에는 짧은 ASCII 임시 script path만 넣고, 실제 UTF-8 cwd/session/env와 Pi 실행 명령은 self-deleting script 내부에 보존합니다.

Host adapter runtime E2E는 사용자가 작업 중인 terminal·tab·window를 fixture로 사용하지 않습니다. 명시적으로 승인된 disposable host 공간을 격리할 수 있을 때만 실제 panel 생성·focus·입력 테스트를 수행합니다. 격리할 수 없으면 mock state machine, 생성 script assertion, AppleScript compile까지만 자동 검증하고 실제 host success path는 coverage gap으로 남깁니다. Cleanup은 run이 생성한 exact terminal/session/worktree ID만 대상으로 하며 baseline 이후 생긴 모든 surface를 일괄 삭제하지 않습니다.

## Context and Continuation

Slash `/wt fork`는 full transcript와 `parentSession` lineage를 기본으로 시도하되 fork copy 실패가 이미 성공한 worktree 생성을 취소하지 않으며, 기존 fallback context/session과 경고를 남긴 뒤 현재 panel 전환을 계속합니다. Slash `/wt new`는 clean session을 만들고 full transcript 대신 source의 최신 non-transition 요청 1개를 최대 2,000자로 전달합니다. Source session이 아직 없으면 provenance를 꾸며내거나 생성을 차단하지 않습니다. 반대로 별도 panel에서 자동 실행되는 tool·PR review·Frame/TFT workflow는 요구한 full lineage/READY가 없으면 생성 전 또는 안전한 cleanup 뒤 BLOCKED 처리할 수 있습니다.

Worktree directory나 session file을 만들었다고 workflow가 완료된 것은 아닙니다. PR review는 Review Studio와 `/diff`를 사용할 수 있는 target session까지, Frame fork는 승격된 frame/task를 읽고 첫 ready implementation slice를 시작하는 continuation까지 닫혀야 합니다.

## Failure Rule

새 panel open, exact-session READY, context fork, continuation dispatch 중 하나라도 실패하면 source panel은 그대로 둡니다. Parent가 cancellation을 claim하고 target terminal close가 확인된 경우에만 이번 실행이 만든 session/worktree/branch 삭제를 허용합니다. Terminal close가 실패하거나 child가 이미 `continuing|continued`를 소유했다면 descriptor·panel record·target session·worktree를 recovery artifact로 보존하고 `safeToDeleteTarget: false`를 반환합니다. Cleanup이 완전하지 않으면 남은 artifact와 원인을 BLOCKED 결과에 명시하며 current-panel fallback이나 절대경로 작업으로 성공을 꾸미지 않습니다.

## In-place Branch Boundary

사용자가 새 branch만 요청하면 현재 workspace에서 branch를 생성·전환합니다. production 기반 branch 전환은 `/to-production`의 current-workspace in-place 계약을 따릅니다. 새 worktree는 사용자가 worktree/fork/new topology를 명시적으로 허용했을 때만 생성합니다. Bash guard는 command-start regex가 아니라 shell token과 git verb를 해석해 assignment prefix, `env`/`command` wrapper, absolute git path, global option, nested shell 안의 `git worktree add`도 같은 authorization으로 판정합니다.

## Re-review Triggers

다음 변경이 생기면 이 계약을 다시 검토합니다.

- Pi가 exact session을 여는 native new-panel API를 제공한다.
- Ghostty 외 host adapter가 추가된다.
- continuation을 process 간 durable queue로 옮긴다.
- compact context mode를 일반 기능으로 추가하려 한다.
- branch/worktree intent classifier가 새로운 자연어/TUI source를 받는다.
