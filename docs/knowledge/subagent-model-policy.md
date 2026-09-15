---
title: Hybrid subagent 모델 운용 정책
tags:
  - subagent
  - codex
  - claude
  - model-policy
  - worker
  - finder
  - searcher
  - stress-interview
  - self-healing
  - agent
  - 모델
category: agent
status: active
confidence: high
applies_to:
  - agents
  - extensions/subagent
  - skills/stress-interview
  - skills/self-healing
source:
  - pilee-history:2026-05-04#33
  - pilee-history:2026-05-04#34
  - pilee-history:2026-05-05#42
reviewed_at: 2026-09-15
reviewed_commit: a326514967ca6cda46471d3c833e1bff9e834013
related:
  - pilee-knowledge-system
  - worktree-session-continuity
---

## Overview

pilee subagent는 GPT-6 Astra를 기본 실행 모델로 사용하고 Claude Opus 5를 독립 검증 경계에 남기는 hybrid 모델 정책으로 운영합니다. 11개 agent 중 9개는 Astra를 primary로 사용하며, 역할 난도에 따라 `low`·`high`·`max` effort를 구분합니다. false PASS와 동일 모델 계열의 상관된 맹점을 줄이기 위해 verifier와 challenger만 Opus 5 `max`를 primary로 유지하고 Astra를 첫 fallback으로 둡니다.

## Model Split

Astra 사용률을 높이는 것과 모든 역할에 같은 effort를 강제하는 것은 다릅니다. 현재 정책은 모델은 Astra 중심으로 통일하되 역할의 판단 난도와 실패 비용에 맞춰 thinking을 나눕니다.

- worker/planner/reviewer는 구현·구조·diff 판단의 핵심 역할이므로 `gpt-6-astra`를 `max` effort로 사용하고 Sol로 fallback합니다.
- Meta Review question worker와 Study Hard worker는 pinned source·구조화 artifact·충돌 보존 계약을 다루므로 Astra `max`를 사용하며 `Sol → Terra → Spark` fallback을 유지합니다.
- browser와 searcher는 상태 해석·다중 도구·교차근거가 필요하지만 실행 지연도 중요하므로 Astra `high`를 사용합니다. 각각 기존 Sol, `Terra → Sol`을 fallback으로 둡니다.
- finder와 bootstrapper는 좁은 탐색 또는 지정 executor·status·log 판정이 중심이므로 Astra `low`를 사용하고 Luna를 fallback으로 둡니다. Astra의 `minimal`도 실제로 `low`에 매핑되므로 명시적으로 `low`를 사용합니다.
- verifier는 “증거 없는 PASS”의 비용이 크므로 Claude Opus 5를 `max` effort로 사용합니다. 구현보다 claim inventory, 재현, evidence 판정, skipped check/remaining risk 기록이 핵심 역할입니다.
- challenger는 제품·구조 맥락의 숨은 가정과 실패 시나리오를 압박하므로 Claude Opus 5를 `max` effort로 사용합니다. 두 Opus 역할 모두 `Astra → Sol` 순서로 fallback해 독립 검증을 우선하되 provider 장애로 workflow 전체가 막히지 않게 합니다.
- abort는 사용자가 실행을 중단한 의사이므로 fallback을 시작하지 않습니다. fallback이 실행돼도 verifier의 PASS 기준과 challenger의 가설/사실 분리 기준은 바뀌지 않습니다.
- agent는 기존 단일 `modelFallback`과 순서형 `modelFallbacks` chain을 모두 지원합니다. 같은 Pi runtime 안의 fallback은 persisted session을 이어 쓰되 새 offset부터 terminal event를 읽고, Claude→Pi cross-runtime fallback은 서로 다른 session JSONL을 사용합니다.
- Astra의 도구 호출·구조화 출력·컨텍스트 한계는 역할별 fixture로 검증합니다. 반복 실패 시 전체 정책을 되돌리지 않고 해당 agent만 직전 primary로 복구합니다.
- 모델 선택은 세대만이 아니라 역할 난도, 실패 시 되돌리기 비용, 독립 검증 필요성을 함께 기준으로 조정합니다.

## Prompt Specificity Rule

stress-interview와 self-healing은 subagent fan-out을 쓰지만, worker에게 빈 요청을 보내면 안 됩니다. actionable item, 대상 파일/영역, 기대 수정, 검증 명령이 포함된 구체 프롬프트를 전달해야 합니다. 그렇지 않으면 worker는 실행 가능한 문제를 받지 못하고 형식적인 응답만 남기기 쉽습니다.

## Runtime Direction

사용자-facing 실행 표면은 계속 Pi의 `subagent` 도구와 run/session UI로 통일합니다. 내부 runtime은 역할에 따라 나뉩니다. Codex agent는 Pi runtime을 사용하고, Claude-primary agent는 `runtime: claude`와 `subagent.claudeRuntime: "cli"`를 통해 Claude Code first-party 구독 경로를 사용합니다. CLI의 stream event는 Pi-compatible sidecar session으로 기록해 replay·continue·완료 알림을 기존 subagent UX에 합류시킵니다. `cc-system-prompt`는 prompt bridge일 뿐 provider/auth transport를 바꾸지 않으므로 이 runtime 선택을 대신하지 않습니다.

## Review Trigger

새 agent를 추가하거나 모델 버전·thinking·fallback 순서를 바꾸거나 self-healing/stress-interview 흐름을 수정하면 이 문서를 다시 봅니다. 특히 finder/bootstrapper의 `low` 또는 browser/searcher의 `high`에서 품질 저하가 반복되면, effort를 올리기 전에 task prompt와 evidence 요구가 충분한지 먼저 확인합니다.
