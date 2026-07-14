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
  - extensions/workflow-guard
  - extensions/subagent
source:
  - external:openai-codex-rust-v0.144.1
  - user-direction:2026-07-10-ultra-mode
reviewed_at: 2026-07-13
reviewed_commit: 2c1f13d
related:
  - subagent-model-policy
  - workflow-guard-enforced-flow
  - ai-worker-readiness-orchestrator
---

## Judgment

Ultra는 provider API에 보내는 독립 reasoning effort가 아닙니다. Codex의 Ultra는 두 책임을 결합한 클라이언트 mode입니다.

1. provider 요청은 지원되는 최고 reasoning effort인 `max`로 정규화합니다.
2. 로컬 agent 정책은 proactive multi-agent delegation을 활성화합니다.

개인용 Pi 환경은 로컬 core build에서 `max`와 `ultra`를 native reasoning selector 상태로 제공합니다. Provider 요청에서 Ultra는 Max로 정규화하고, pilee는 선택된 `ultra` 상태를 읽어 proactive delegation 정책만 추가합니다.

## Delegation Rule

Ultra가 선택된 turn에서는 “subagent 실행에는 사용자의 명시 요청이 필요하다”는 일반 opt-in 규칙을 해제합니다. Main agent는 병렬 작업이 속도나 품질을 실질적으로 높일 때 subagent를 자율적으로 사용할 수 있습니다.

이 모드는 무조건 fan-out하라는 뜻이 아닙니다.

- 순차로 바로 끝나는 작은 작업은 main이 직접 처리합니다.
- read-only, mutation, side effect, light-path hard gate는 그대로 유지합니다.
- subagent prompt에는 목표, 범위, 기대 산출물, 검증 기준을 구체적으로 전달합니다.
- main agent가 최종 판정과 write side effect를 소유합니다.

## State Boundary

Reasoning selector가 상태의 단일 source of truth입니다. 별도 `/ultra` 명령이나 전역 preference 파일을 두지 않습니다.

pilee의 `workflow-guard`는 매 `before_agent_start`에서 `getThinkingLevel()`을 읽습니다.

- `max`: provider에 Max reasoning을 요청하고 기존 worker opt-in 규칙을 유지합니다.
- `ultra`: provider 요청은 Max로 정규화하고 proactive delegation 지침을 주입합니다.
- status-only turn: Ultra여도 이전 작업이나 worker를 자동 재개하지 않습니다.
- 모델이 Ultra를 지원하지 않으면 core selector가 해당 모델의 최고 지원 level로 clamp합니다.

## Review Trigger

다음 변화가 생기면 이 문서를 다시 검토합니다.

- 로컬 Pi core build를 upstream 새 버전으로 갱신할 때
- Codex가 Ultra를 실제 API effort로 지원하기 시작할 때
- proactive delegation이 trivial task에서 과도한 fan-out을 만들 때
- subagent recursion, side-effect ownership, light-path 안전 규칙이 바뀔 때
