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
reviewed_at: 2026-07-10
reviewed_commit: 6ad26cd
related:
  - subagent-model-policy
  - workflow-guard-enforced-flow
  - ai-worker-readiness-orchestrator
---

## Judgment

Ultra는 provider API에 보내는 독립 reasoning effort가 아닙니다. Codex의 Ultra는 두 책임을 결합한 클라이언트 mode입니다.

1. provider 요청은 지원되는 최고 reasoning effort인 `max`로 정규화합니다.
2. 로컬 agent 정책은 proactive multi-agent delegation을 활성화합니다.

따라서 Pi core는 `ultra`를 selector, 설정, session, RPC/SDK에서 보존하는 일급 상태로 다루되 provider 요청에서는 `max`로 변환해야 합니다. pilee는 그 상태를 읽어 기존 subagent 도구의 사용 정책을 바꿉니다.

## Delegation Rule

Ultra가 선택된 turn에서는 “subagent 실행에는 사용자의 명시 요청이 필요하다”는 일반 opt-in 규칙을 해제합니다. Main agent는 병렬 작업이 속도나 품질을 실질적으로 높일 때 subagent를 자율적으로 사용할 수 있습니다.

이 모드는 무조건 fan-out하라는 뜻이 아닙니다.

- 순차로 바로 끝나는 작은 작업은 main이 직접 처리합니다.
- read-only, mutation, side effect, light-path hard gate는 그대로 유지합니다.
- subagent prompt에는 목표, 범위, 기대 산출물, 검증 기준을 구체적으로 전달합니다.
- main agent가 최종 판정과 write side effect를 소유합니다.

## State Boundary

Ultra 상태는 provider payload에 그대로 노출하지 않습니다. 모델 metadata가 Ultra를 지원할 때만 selector에 보이고, 지원하지 않는 모델로 전환하면 해당 모델의 최상위 지원 level로 clamp합니다.

pilee의 `workflow-guard`는 매 `before_agent_start`에서 현재 thinking level을 읽습니다.

- `ultra`: proactive delegation 지침을 주입하고 기존 worker opt-in 문구를 제거합니다.
- 그 외 level: 기존 worker opt-in 규칙을 유지합니다.
- status-only turn: Ultra여도 이전 작업이나 worker를 자동 재개하지 않습니다.

## Review Trigger

다음 변화가 생기면 이 문서를 다시 검토합니다.

- Pi core의 `ThinkingLevel` 또는 model capability 표현이 바뀔 때
- Codex가 Ultra를 실제 API effort로 지원하기 시작할 때
- proactive delegation이 trivial task에서 과도한 fan-out을 만들 때
- subagent recursion, side-effect ownership, light-path 안전 규칙이 바뀔 때
