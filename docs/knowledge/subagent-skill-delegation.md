---
title: Subagent는 slash command가 아니라 skill prompt를 위임받는다
tags:
  - subagent
  - skill
  - slash-command
  - delegation
  - ship
  - ci-ship
category: agent
status: active
confidence: high
applies_to:
  - extensions/subagent
  - extensions/ship-commands
  - skills/ship
  - skills/pr-ship
  - skills/ci-ship
source:
  - user-direction:2026-05-11-subagent-skill-delegation
reviewed_at: 2026-05-13
reviewed_commit: 10e08748c48459b4044ec1abe3f88d39566de60c
related:
  - queued-command-prefill-boundary
  - ship-pr-ship-review-boundary
  - ci-ship-failure-response-boundary
  - subagent-prompt-specificity
---

## Judgment

Subagent에게 `/ci-ship` 같은 slash command 문자열을 그대로 보내도 Pi command handler가 실행되는 것은 아닙니다. Subagent task는 별도 Pi prompt로 들어가며, leading slash는 command hijack을 막기 위해 escape될 수 있습니다.

하지만 command shim이 하는 일을 분해하면 위임할 수 있습니다. 핵심은 slash command 실행이 아니라, 해당 command가 읽는 `SKILL.md`와 read-only collected context를 하나의 subagent task prompt로 만들어 넘기는 것입니다.

## Delegation Rule

`>> /ci-ship` 같은 입력은 slash command 실행이 아니라 **skill prompt delegation**으로 해석합니다.

- 부모 세션에서 command shim이 필요한 PR/CI/review context를 먼저 수집합니다.
- 대상 `SKILL.md`를 인라인합니다.
- subagent task에는 “이 slash command를 실행하라”가 아니라 “이 skill prompt를 따라 실행하라”고 전달합니다.
- subagent는 main context를 상속받은 곁가지로 실행되고, 완료 결과를 follow-up으로 부모 세션에 돌려줍니다.

초기 allowlist는 branch-safe 성격이 강한 `ship`, `pr-ship`, `ci-ship`입니다. 사용자 결정 질문이 많은 `frame`이나 UI 검증 capture처럼 부모와 상호작용이 필요한 workflow는 별도 설계가 필요합니다.

## Safety Boundary

Delegated subagent도 target skill의 write boundary를 그대로 따릅니다. 예를 들어 `ci-ship`이 허용하는 commit/push는 수행할 수 있지만, merge, force-push, review thread resolve/unresolve 같은 금지 동작은 여전히 금지입니다.

## Failure Mode

Subagent에게 `/ci-ship` 문자를 그대로 던지면 command가 실행되지 않고 “/ci-ship을 어떻게 할까요?” 같은 일반 작업이 됩니다. 반대로 모든 slash command를 자동 delegation하면 사용자 질문/승인 게이트가 필요한 workflow를 백그라운드에서 잘못 진행할 수 있습니다. 그래서 command별 prompt builder와 allowlist가 필요합니다.
