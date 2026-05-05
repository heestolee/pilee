---
title: Supervisor는 outcome guardrail이다
tags:
  - supervisor
  - outcome
  - guardrail
  - steering
  - agent
category: agent
status: active
confidence: medium
applies_to:
  - extensions/supervisor
  - start_supervision
source:
  - pilee-history:2026-05-01#workflow-analysis
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - ask-user-question-decision-gates
  - subagent-prompt-specificity
---

## Judgment

Supervisor는 작업을 대신 수행하는 또 하나의 agent가 아니라, 대화가 합의한 outcome에서 벗어날 때 steering하는 guardrail입니다. 감시 목적이 흐려지면 supervisor는 잡음 많은 reviewer가 됩니다.

## Guardrail Rule

Supervision은 구체적이고 측정 가능한 outcome에 대해 켭니다. 민감도는 drift를 얼마나 적극적으로 잡을지 결정할 뿐, 사용자 판단을 대체하지 않습니다. outcome이 바뀌면 기존 supervision을 계속 늘려 쓰지 말고 새 기준을 명시해야 합니다.

## Failure Mode

목표가 추상적인 supervision은 모든 발화를 참견하게 됩니다. 좋은 supervisor는 작업 방향을 좁히고, 실제 구현과 의사결정은 main workflow에 남깁니다.
