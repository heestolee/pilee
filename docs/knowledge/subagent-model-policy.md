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
reviewed_at: 2026-08-31
reviewed_commit: 21312736719de638c1640cbf79629017abc93598
related:
  - pilee-knowledge-system
  - worktree-session-continuity
---

## Overview

pilee subagent는 Codex와 Claude Code CLI를 역할별로 결합하는 hybrid 모델 정책으로 운영합니다. 구현·코드 리뷰·브라우저 실행은 강한 Codex 모델을 유지하고, false PASS 비용이 큰 verifier와 긴 맥락의 숨은 가정·실패 시나리오를 공격하는 challenger는 Claude Opus 5를 max effort로 사용합니다. finder/searcher처럼 탐색·수집 중심 agent에는 더 가벼운 모델을 써 비용과 부하를 낮춥니다.

## Model Split

모든 agent를 같은 최고 모델로 통일하면 기준선은 단순해지지만, 탐색형 agent까지 같은 비용 구조를 갖게 됩니다. 현재 정책은 역할별 위험도와 출력 품질 요구를 나눕니다.

- worker/planner/reviewer/browser는 강한 Codex 모델을 유지합니다.
- verifier는 “증거 없는 PASS”의 비용이 크므로 Claude Opus 5를 `max` effort로 사용합니다. 구현보다 claim inventory, 재현, evidence 판정, skipped check/remaining risk 기록이 핵심 역할입니다.
- challenger는 제품·구조 맥락의 숨은 가정과 실패 시나리오를 압박하는 판단 역할이므로 Claude Opus 5를 `max` effort로 사용합니다. reviewer는 Codex에 남겨 stress-interview의 provider 다양성을 보존합니다.
- verifier와 challenger의 primary Opus는 Claude Code CLI first-party 구독 경로로 실행합니다. primary가 실패하면 `openai-codex/gpt-5.6-sol`을 Pi runtime으로 실행해 workflow를 이어갑니다. cross-runtime attempt는 terminal marker와 replay가 섞이지 않도록 별도 session JSONL에 기록합니다.
- abort는 사용자가 실행을 중단한 의사이므로 fallback을 시작하지 않습니다. fallback이 실행돼도 verifier의 PASS 기준과 challenger의 가설/사실 분리 기준은 바뀌지 않습니다.
- agent는 기존 단일 `modelFallback`과 순서형 `modelFallbacks` chain을 모두 지원합니다. Study Hard worker처럼 사용자 상호작용을 비동기로 닫아야 하는 역할은 `Sol → Terra → Spark` 순서로 provider 장애를 흡수합니다.
- 같은 Pi runtime 안의 fallback은 persisted session을 이어 쓰되 새 offset부터 terminal event를 읽습니다. Claude→Pi cross-runtime fallback은 서로 다른 session JSONL을 사용해 이전 runtime의 completion marker가 다음 실행을 즉시 종료시키지 않게 합니다.
- 단순 탐색·검색 역할은 가벼운 모델을 우선 사용합니다.
- 모델 선택은 “얼마나 똑똑한가”보다 “이 agent가 실패했을 때 되돌리기 비용이 큰가”를 기준으로 조정합니다.

## Prompt Specificity Rule

stress-interview와 self-healing은 subagent fan-out을 쓰지만, worker에게 빈 요청을 보내면 안 됩니다. actionable item, 대상 파일/영역, 기대 수정, 검증 명령이 포함된 구체 프롬프트를 전달해야 합니다. 그렇지 않으면 worker는 실행 가능한 문제를 받지 못하고 형식적인 응답만 남기기 쉽습니다.

## Runtime Direction

사용자-facing 실행 표면은 계속 Pi의 `subagent` 도구와 run/session UI로 통일합니다. 내부 runtime은 역할에 따라 나뉩니다. Codex agent는 Pi runtime을 사용하고, Claude-primary agent는 `runtime: claude`와 `subagent.claudeRuntime: "cli"`를 통해 Claude Code first-party 구독 경로를 사용합니다. CLI의 stream event는 Pi-compatible sidecar session으로 기록해 replay·continue·완료 알림을 기존 subagent UX에 합류시킵니다. `cc-system-prompt`는 prompt bridge일 뿐 provider/auth transport를 바꾸지 않으므로 이 runtime 선택을 대신하지 않습니다.

## Review Trigger

새 agent를 추가하거나 모델 버전을 바꾸거나 self-healing/stress-interview 흐름을 수정하면 이 문서를 다시 봅니다. 특히 finder/searcher처럼 가벼운 모델을 쓰는 역할에서 품질 저하가 반복되면, 모델 자체보다 task prompt와 evidence 요구가 충분한지 먼저 확인합니다.
