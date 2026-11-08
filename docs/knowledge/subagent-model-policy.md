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
reviewed_at: 2026-11-08
reviewed_commit: b6a9d606f4ac40e90be73ad99e67c2a4593cc15a
related:
  - pilee-knowledge-system
  - worktree-session-continuity
  - astra-adaptive-thinking-effort
---

## Overview

pilee subagent는 Claude Opus 5.5를 기본 실행 모델로 사용하고 GPT-6 Astra를 독립 검증 경계에 두는 hybrid 모델 정책으로 운영합니다. 11개 agent 중 9개는 Opus 5.5를 primary로 사용하며, 역할 난도에 따라 `low`·`high`·`max` effort를 구분합니다. false PASS와 동일 모델 계열의 상관된 맹점을 줄이기 위해 메인·실행 역할과 다른 계열인 Astra `max`를 verifier와 challenger의 primary로 둡니다. 실행 역할은 Astra를 첫 fallback으로, 검증 역할은 Opus 5.5를 마지막 fallback으로 두어 한 provider 장애가 전체 workflow를 막지 않게 합니다.

## Model Split

Opus 5.5를 primary로 통일하는 것과 모든 역할에 같은 effort를 강제하는 것은 다릅니다. 현재 정책은 실행 역할의 모델은 Opus 5.5로 맞추되 역할의 판단 난도와 실패 비용에 따라 thinking을 나눕니다.

- worker/planner/reviewer는 구현·구조·diff 판단의 핵심 역할이므로 `claude-opus-5-5`를 `max` effort로 사용하고 `Astra → 5.6 Sol`로 fallback합니다.
- Meta Review question worker와 Study Hard worker는 pinned source·구조화 artifact·충돌 보존 계약을 다루므로 Opus 5.5 `max`를 사용하며 `Astra → 5.6 Sol → 5.6 Terra → 5.3 Spark` fallback을 유지합니다.
- browser와 searcher는 상태 해석·다중 도구·교차근거가 필요하지만 실행 지연도 중요하므로 Opus 5.5 `high`를 사용합니다. browser는 `Astra → 5.6 Sol`, searcher는 `Astra → 5.6 Terra → 5.6 Sol`로 fallback합니다.
- finder와 bootstrapper는 좁은 탐색 또는 지정 executor·status·log 판정이 중심이므로 Opus 5.5 `low`를 사용하고 `Astra → 5.6 Luna`로 fallback합니다. 호출 빈도가 높아 Anthropic 사용량이 집중되면 이 두 역할부터 가벼운 모델로 내리는 것을 검토합니다.
- verifier는 “증거 없는 PASS”의 비용이 크므로 GPT-6 Astra를 `max` effort로 사용합니다. 구현보다 claim inventory, 재현, evidence 판정, skipped check/remaining risk 기록이 핵심 역할입니다.
- challenger는 제품·구조 맥락의 숨은 가정과 실패 시나리오를 압박하므로 GPT-6 Astra를 `max` effort로 사용합니다. 두 Astra 역할 모두 `6.1 Sol → Opus 5.5` 순서로 fallback해 다른 계열 검증을 우선하되 provider 장애로 workflow 전체가 막히지 않게 합니다. Codex 경로 Astra의 context window(272K)는 Opus 5.5보다 작으므로 큰 diff 검증은 범위를 나눠 전달합니다.
- abort는 사용자가 실행을 중단한 의사이므로 fallback을 시작하지 않습니다. fallback이 실행돼도 verifier의 PASS 기준과 challenger의 가설/사실 분리 기준은 바뀌지 않습니다.
- agent는 기존 단일 `modelFallback`과 순서형 `modelFallbacks` chain을 모두 지원합니다. 같은 Pi runtime 안의 fallback은 persisted session을 이어 쓰되 새 offset부터 terminal event를 읽고, Claude→Pi cross-runtime fallback은 서로 다른 session JSONL을 사용합니다.
- primary 모델의 도구 호출·구조화 출력·컨텍스트 한계는 역할별 fixture로 검증합니다. 반복 실패 시 전체 정책을 되돌리지 않고 해당 agent만 이전 primary로 복구합니다.
- 모델 선택은 세대만이 아니라 역할 난도, 실패 시 되돌리기 비용, 독립 검증 필요성을 함께 기준으로 조정합니다.

## Main Session Boundary

메인 Pi 세션의 기본 모델·effort와 subagent role mapping은 별도 계약입니다. 메인 기본 모델은 사용자의 로컬 설정(현재 Claude Opus 5.5 `xhigh`)을 따르며, Codex Astra·6.1 Sol 세션에서는 [고위험 turn만 max로 승격](./astra-adaptive-thinking-effort.md)합니다. `agents/*.md`에 고정된 Opus 5.5 역할은 `low`·`high`·`max`, verifier/challenger는 Astra `max`를 사용하며 메인의 turn-level 승격을 자동 전파하지 않습니다. Subagent는 좁게 선택된 전문 역할과 failure cost를 기준으로 고정 effort를 유지합니다.

## Prompt Specificity Rule

stress-interview와 self-healing은 subagent fan-out을 쓰지만, worker에게 빈 요청을 보내면 안 됩니다. actionable item, 대상 파일/영역, 기대 수정, 검증 명령이 포함된 구체 프롬프트를 전달해야 합니다. 그렇지 않으면 worker는 실행 가능한 문제를 받지 못하고 형식적인 응답만 남기기 쉽습니다.

## Runtime Direction

사용자-facing 실행 표면은 계속 Pi의 `subagent` 도구와 run/session UI로 통일합니다. 현재 11개 agent는 모두 `runtime: pi`를 사용합니다. Claude-primary agent도 Pi runtime에 두는 이유는 `runtime: claude`(Claude Code CLI)가 Pi 도구 중 read·find·grep·bash·edit·write·ls만 매핑하므로 searcher의 `web_search`·`fetch_content`를 쓸 수 없고, `ask_master` escalation과 Pi session 경로도 잃기 때문입니다. Pi runtime의 Anthropic 호출은 Pi provider OAuth와 `cc-system-prompt` bridge를 사용하며, subagent가 extension을 끄지 않으므로 메인 세션과 같은 transport로 동작합니다.

`runtime: claude`와 `subagent.claudeRuntime: "cli"` 경로는 Claude Code first-party 구독 transport가 필요할 때 선택할 수 있는 대안으로 남깁니다. 이 경로는 Anthropic 모델만 허용하고 CLI stream event를 Pi-compatible sidecar session으로 기록합니다. Pi의 Anthropic provider OAuth와 Claude Code CLI 인증은 별도 transport이므로, Claude 모델 버전을 바꾸거나 runtime을 옮길 때는 실제 primary transport의 smoke로 readiness를 판정합니다.

## Review Trigger

새 agent를 추가하거나 모델 버전·thinking·fallback 순서를 바꾸거나 self-healing/stress-interview 흐름을 수정하면 이 문서를 다시 봅니다. 특히 finder/bootstrapper의 `low` 또는 browser/searcher의 `high`에서 품질 저하가 반복되면, effort를 올리기 전에 task prompt와 evidence 요구가 충분한지 먼저 확인합니다.
