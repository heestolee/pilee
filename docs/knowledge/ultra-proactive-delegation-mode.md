---
title: Ultra는 Max reasoning과 proactive delegation을 결합한 로컬 mode다
tags:
  - ultra
  - reasoning
  - codex
  - subagent
  - delegation
  - workflow-guard
category: agent
status: active
confidence: high
applies_to:
  - extensions/ultra-mode
  - extensions/workflow-guard
  - extensions/subagent
source:
  - external:openai-codex-rust-v0.144.1
  - user-direction:2026-07-10-ultra-mode
reviewed_at: 2026-07-11
reviewed_commit: de70f71
related:
  - subagent-model-policy
  - workflow-guard-enforced-flow
  - ai-worker-readiness-orchestrator
---

## Judgment

Ultra는 provider API에 보내는 독립 reasoning effort가 아닙니다. Codex의 Ultra는 두 책임을 결합한 클라이언트 mode입니다.

1. provider 요청은 지원되는 최고 reasoning effort인 `max`로 정규화합니다.
2. 로컬 agent 정책은 proactive multi-agent delegation을 활성화합니다.

개인용 Pi 환경에서는 upstream core에 새 reasoning level을 요구하지 않습니다. 공식 Pi의 `max`를 provider reasoning으로 사용하고, pilee가 별도 전역 상태와 proactive delegation 정책을 소유합니다. 이 경계는 core fork 유지 비용 없이 Codex Ultra의 실질 동작을 재현합니다.

## Delegation Rule

Ultra가 선택된 turn에서는 “subagent 실행에는 사용자의 명시 요청이 필요하다”는 일반 opt-in 규칙을 해제합니다. Main agent는 병렬 작업이 속도나 품질을 실질적으로 높일 때 subagent를 자율적으로 사용할 수 있습니다.

이 모드는 무조건 fan-out하라는 뜻이 아닙니다.

- 순차로 바로 끝나는 작은 작업은 main이 직접 처리합니다.
- read-only, mutation, side effect, light-path hard gate는 그대로 유지합니다.
- subagent prompt에는 목표, 범위, 기대 산출물, 검증 기준을 구체적으로 전달합니다.
- main agent가 최종 판정과 write side effect를 소유합니다.

## State Boundary

Ultra 상태는 `~/.pi/agent/state/ultra-mode.json`에 pilee 전역 preference로 저장하며 `/ultra on|off|status`로 제어합니다. 기본값은 OFF입니다.

pilee의 `workflow-guard`는 매 `before_agent_start`에서 저장 상태와 현재 모델을 함께 판정합니다.

- `openai-codex/gpt-5.6-sol`, `openai-codex/gpt-5.6-terra`: Ultra가 켜져 있으면 공식 core thinking level을 `max`로 맞추고 proactive delegation 지침을 주입합니다.
- `gpt-5.6-luna`와 그 외 provider/model: preference를 보존하지만 Ultra는 적용하지 않고 기존 worker opt-in 규칙을 유지합니다.
- status-only turn: Ultra가 활성 상태여도 이전 작업이나 worker를 자동 재개하지 않습니다.

Ultra preference와 provider reasoning을 분리하므로 `getThinkingLevel() === "ultra"` 같은 미출시 core 상태에 의존하지 않습니다.

## Review Trigger

다음 변화가 생기면 이 문서를 다시 검토합니다.

- Pi core가 공식 Ultra 상태를 제공하거나 extension thinking-level API를 바꿀 때
- Codex가 Ultra를 실제 API effort로 지원하기 시작할 때
- proactive delegation이 trivial task에서 과도한 fan-out을 만들 때
- subagent recursion, side-effect ownership, light-path 안전 규칙이 바뀔 때
