---
title: Worker는 readiness ownership을 가진다
tags:
  - worker
  - subagent
  - orchestrator
  - readiness
  - bootstrap
  - diagnosis
  - background-job
  - agent
  - 위임
  - 준비상태
category: agent
status: active
confidence: high
applies_to:
  - agents/bootstrapper
  - extensions/worktree
  - extensions/subagent
  - skills/stress-interview
  - skills/self-healing
source:
  - pilee-history:2026-05-07#83
  - pilee-history:2026-05-07#86
  - pilee-history:2026-05-07#87
  - user-direction:2026-05-07-ai-native-worker
reviewed_at: 2026-06-02
reviewed_commit: ce5e875d9e49a3a0b93215894e525b1933c6a145
related:
  - worktree-dependency-bootstrap-worker
  - subagent-prompt-specificity
  - subagent-model-policy
  - self-healing-actionable-loop
  - stress-interview-multi-axis-review
---

## Judgment

“worker”는 단순 background process의 다른 이름이 아닙니다. 사용자가 readiness, monitoring, diagnosis, parallel ownership, main-agent unblocking을 기대하는 상황에서는 먼저 AI subagent나 orchestrator가 적합한지 판단해야 합니다.

Deterministic executor는 명령 실행에 강하지만, 실패 원인 해석과 READY/BLOCKED 판정, 다음 조치 요약은 별도 ownership이 필요합니다. pilee의 기본 판단은 **AI orchestrator + deterministic executor**입니다.

## Ownership Rule

Worker가 맡는 것은 “무언가를 백그라운드로 실행”하는 일이 아니라 다음 책임입니다.

- readiness 기준을 알고 있습니다.
- 실행 가능한 deterministic command 또는 executor boundary를 갖습니다.
- log/status artifact를 읽고 READY/BLOCKED/UNKNOWN을 판정합니다.
- main agent가 언제 기다리고, 언제 계속 구현해도 되는지 알려줍니다.
- 실패 시 추측으로 코드를 수정하지 않고 원인과 next action을 보고합니다.

이 판단은 [Worktree 의존성 준비는 조건부 worker가 맡는다](./worktree-dependency-bootstrap-worker.md)의 bootstrapper 사례에서 시작했지만, self-healing, stress-interview, verify-report case worker처럼 “분리된 책임자가 증거를 모으고 판정한다”는 흐름에도 적용됩니다.

## Executor Boundary

AI worker가 모든 것을 자유롭게 해서는 안 됩니다. 반복 가능하고 side effect가 있는 실행은 deterministic executor나 명시된 명령 목록 안에 둡니다. Worker는 그 executor를 언제 실행할지, 결과를 어떻게 해석할지, main agent에게 무엇을 보고할지를 맡습니다.

좋은 구조:

1. Main이 목표, 제외 범위, 허용 action, expected artifact를 정합니다.
2. Worker가 전달받은 executor/check만 실행합니다.
3. Worker가 status/log/report를 읽고 READY/BLOCKED를 판정합니다.
4. Main이 최종 사용자-facing 판단과 다음 실행을 소유합니다.

나쁜 구조:

- Worker가 source code를 임의로 고칩니다.
- Worker가 실패를 숨기고 “완료”라고 보고합니다.
- Main이 worker report를 확인하지 않고 validation을 시작합니다.
- Subagent 세션 안에서 같은 worker trigger가 재귀 실행됩니다.

## Recursion Guard

Worker orchestration은 main session이 소유합니다. Subagent 내부에서 일반 trigger가 다시 발동하면 worker가 worker를 띄우는 재귀가 생길 수 있습니다. 자동 worker trigger는 subagent session, orchestrator prompt, 이미 실행 중인 worker scope에서는 비활성화해야 합니다.

## Review Trigger

다음 변화가 생기면 이 doctrine을 다시 검토합니다.

- 새 worker/orchestrator agent가 추가될 때
- background job을 AI subagent로 바꿀지 논의할 때
- readiness report 형식이 바뀔 때
- main agent가 worker READY/BLOCKED를 확인하지 않고 validation하는 사고가 생길 때
