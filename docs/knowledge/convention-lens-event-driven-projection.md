---
title: Convention Lens는 작업 종료 시 관련 판단만 투영한다
tags:
  - convention-lens
  - agent-settled
  - stop-hook
  - graph
  - evidence
  - reviewer
  - auto-fix
category: architecture
status: experimental
confidence: high
applies_to:
  - extensions/convention-lens
  - extensions/pr-review
  - extensions/subagent
  - extensions/utils
  - skills/test-boundary-refactor
source:
  - user-direction:2026-08-25-convention-lens-trigger-first
reviewed_at: 2026-08-25
reviewed_commit: c077eab9b6155c98888816be3aac69754fe3df7a
related:
  - human-pr-review-precedent-harness
  - atomic-evidence-workflow
  - self-healing-actionable-loop
  - stress-interview-multi-axis-review
  - private-overlay-package-boundary
---

## Judgment

Convention Lens의 주 진입점은 slash command가 아니라 작업 종료 event입니다. Pi에서는 `agent_settled`, 다른 runtime에서는 Stop에 해당하는 adapter가 이번 run의 변경을 고정하고, 전체 규칙 문서를 넣는 대신 현재 diff에 관련된 작은 판단 subgraph만 reviewer에게 투영합니다.

수동 query나 고정 root critique는 graph 진단과 회귀 재생에 유용하지만 정상 실행 계약이 아닙니다. 사용자가 명령을 기억해야만 convention이 적용된다면 규칙이 존재해도 routing 부재 문제를 해결하지 못합니다.

## Source, Lens, Consumer

세 역할을 분리합니다.

- **Curated source pack**은 재사용 가능한 판단, trigger, outcome, evidence, counterexample, authority를 소유합니다.
- **Lens projector**는 diff fact와 consumer seed를 근거로 source pack의 작은 subgraph를 선택합니다.
- **Consumer**는 실제 코드 조사, 수정, 검증, subagent orchestration 같은 workflow를 소유합니다.

Skill의 실행 절차 전체를 graph node로 옮기지 않습니다. 예를 들어 test command 선택과 수정 순서는 기존 Skill에 남고, behavior/logic/boundary/contract 판단만 graph source가 됩니다.

## Trigger Boundary

`agent_start`에서 HEAD와 기존 dirty file hash를 baseline으로 저장하고 `agent_settled`에서 이번 run에 실제로 바뀐 file만 review target으로 만듭니다.

- working diff가 있으면 그것을 사용합니다.
- 같은 run에서 이미 commit했다면 시작 HEAD와 현재 working tree를 비교합니다.
- 기존 dirty file이 그대로라면 제외하고, 이번 run에서 다시 바뀐 경우에만 포함합니다.
- untracked text file도 unified diff로 변환합니다.
- no-change, no-match, generated-only는 사용자-visible output 없이 끝냅니다.

동일 worktree·diff fingerprint·graph version은 한 번만 검토하고, 자동 repair로 fingerprint가 바뀌어도 cycle 상한을 둡니다.

## Evidence and Follow-up Boundary

Finding은 기존 PR review의 unified diff parser와 stable `D...` evidence id를 재사용합니다. Core Stop 경로는 background reviewer를 기다리지 않고 selected lens artifact를 main agent의 즉시 follow-up으로 주입합니다. 이는 원래 work unit의 도구·검증·commit/push 계약을 그대로 이어가면서 print/RPC/session shutdown 경쟁을 피합니다.

Follow-up은 `KEEP`, `AUTO_FIX`, `ASK`, `INFO`, `NO_MATCH` 분류와 lens id, evidence id, confidence, recommendation, validation을 요구합니다. Review mode는 수정하지 않고, repair mode는 reviewed lens와 high confidence가 있는 safe AUTO_FIX만 처리합니다.

독립 reviewer 관점이 필요한 broad review는 기존 self-review·stress-interview orchestrator가 선택적으로 담당합니다. Core trigger 자체는 subagent lifecycle을 필수 dependency로 두지 않습니다.

## Structured Repair Gate

Main follow-up은 판정 전에 파일을 수정할 수 없습니다. `edit`, `write`, `auto_commit`, mutating bash는 pending review 동안 차단되고, agent는 먼저 `convention_lens action=submit`으로 verdict, lens ids, evidence ids, confidence, recommendation을 제출해야 합니다.

Extension은 artifact에 존재하는 lens/evidence인지 검증하고, repair mode에서도 reviewed lens와 high confidence를 모두 만족한 AUTO_FIX만 승인합니다. Candidate·draft·private-case만 근거인 AUTO_FIX는 ASK로 강등됩니다. Review mode는 제출 전후 모두 수정 권한을 열지 않습니다.

이 gate는 prompt 준수에만 의존하지 않고 “무엇을 근거로 어떤 수정 권한을 얻었는가”를 runtime state로 보존합니다. Agent가 submit하지 않고 끝나면 review-done이 아니라 review-error입니다.

## Authority and Repair

Authority 순서는 다음과 같습니다.

1. explicit user/frame decision
2. nearest `AGENTS.md`, lint, schema, runtime contract
3. reviewed team convention
4. reviewed generic guideline
5. candidate personal precedent or private case

Draft node는 shadow에서만 사용할 수 있습니다. Candidate precedent는 review 질문을 제공할 수 있지만 repair mode의 AUTO_FIX 근거가 될 수 없습니다. Repair는 reviewed lens, high confidence, current scope, no conflict, no external side effect, nearest validation이 모두 닫힐 때만 허용합니다.

Commit과 push는 Convention Lens가 독립적으로 확장하지 않고 원래 work unit의 요청을 상속합니다.

## Public / Private Boundary

Public pilee는 trigger state, diff evidence, graph loader/validator/projector, reviewer lifecycle, profile schema를 소유합니다. Repository 이름, source path, private card, mode, reviewer agent, generated graph artifact는 private profile/package가 공급합니다.

자동 repair profile은 project-local self declaration으로 활성화하지 않습니다. Global 또는 active trusted package profile만 읽어 repository가 자기 자신에게 높은 authority나 repair 권한을 부여하지 못하게 합니다.

## Rollout

- `shadow`: candidate와 latency만 기록합니다.
- `review`: dedicated reviewer가 자동 판단하지만 code는 수정하지 않습니다.
- `repair`: safe AUTO_FIX만 main agent가 수정하고 가장 가까운 검증을 실행합니다.

처음부터 event path를 타되 side effect만 단계적으로 엽니다. Hook을 마지막에 덧붙이면 automatic routing, silence, reentrancy라는 가장 위험한 가설을 너무 늦게 발견합니다.

## Failure Modes

- 전체 convention 문서를 매 turn 주입하면 context와 오탐이 폭증합니다.
- 기존 dirty diff 전체를 매번 보면 unrelated work를 수정합니다.
- broad architecture review까지 main follow-up 하나로 닫으려 하면 자신의 설계를 합리화할 수 있으므로 self-review·stress-interview를 별도 consumer로 둡니다.
- candidate precedent를 team rule로 말하면 authority가 왜곡됩니다.
- review mode의 fixability와 repair mode의 수정 권한을 혼동하면 분류 정보가 사라집니다.
- reviewer timeout이나 model failure를 PASS로 처리하면 검증 공백이 숨겨집니다. 실패는 fail-open하되 `unverified`로 남깁니다.
