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
reviewed_at: 2026-06-02
reviewed_commit: 83617e9544615d818e6a7a17fa807f029a7db835
related:
  - pilee-knowledge-system
  - worktree-session-continuity
---

## Overview

pilee subagent는 Codex-first 실행 흐름을 기본으로 하되, 검증 판정처럼 false PASS 비용이 큰 역할에는 Claude Opus를 쓰는 hybrid 모델 정책으로 운영합니다. 기본 방향은 worker/planner/reviewer/challenger/browser처럼 구현·리뷰·도전·실행 책임이 큰 agent에는 강한 Codex 모델을 쓰고, verifier처럼 증거 판정 책임이 큰 agent에는 Claude Opus를 쓰며, finder/searcher처럼 탐색·수집 중심 agent에는 더 가벼운 모델을 써 비용과 부하를 낮추는 것입니다.

## Model Split

모든 agent를 같은 최고 모델로 통일하면 기준선은 단순해지지만, 탐색형 agent까지 같은 비용 구조를 갖게 됩니다. 현재 정책은 역할별 위험도와 출력 품질 요구를 나눕니다.

- 구현·리뷰·도전·브라우저 실행 역할은 강한 Codex 모델을 유지합니다.
- verifier는 “증거 없는 PASS”의 비용이 크므로 Claude Opus를 사용합니다. 구현보다 claim inventory, 재현, evidence 판정, skipped check/remaining risk 기록이 핵심 역할입니다.
- verifier의 primary Opus 호출이 실패하면 `openai-codex/gpt-5.5`로 한 번 fallback합니다. fallback은 검증 workflow를 끊지 않기 위한 안전장치이며, 실제 PASS 기준은 동일하게 evidence-first입니다.
- 단순 탐색·검색 역할은 가벼운 모델을 우선 사용합니다.
- 모델 선택은 “얼마나 똑똑한가”보다 “이 agent가 실패했을 때 되돌리기 비용이 큰가”를 기준으로 조정합니다.

## Prompt Specificity Rule

stress-interview와 self-healing은 subagent fan-out을 쓰지만, worker에게 빈 요청을 보내면 안 됩니다. actionable item, 대상 파일/영역, 기대 수정, 검증 명령이 포함된 구체 프롬프트를 전달해야 합니다. 그렇지 않으면 worker는 실행 가능한 문제를 받지 못하고 형식적인 응답만 남기기 쉽습니다.

## Runtime Direction

pilee의 agent 정의와 스킬 문서는 Claude Code CLI 관성 표현을 줄이고 Pi subagent runtime 기준으로 정렬합니다. 모델 provider는 역할별로 Codex/Claude를 섞을 수 있지만, 실행 표면은 `claude -p` 같은 외부 CLI 전제가 아니라 Pi subagent 도구 흐름을 우선합니다. 이 정책은 [worktree-session-continuity](./worktree-session-continuity.md)의 세션 이어가기 UX와 함께, 여러 agent가 동시에 움직여도 사람이 맥락을 회수할 수 있게 만드는 기반입니다.

## Review Trigger

새 agent를 추가하거나 모델 버전을 바꾸거나 self-healing/stress-interview 흐름을 수정하면 이 문서를 다시 봅니다. 특히 finder/searcher처럼 가벼운 모델을 쓰는 역할에서 품질 저하가 반복되면, 모델 자체보다 task prompt와 evidence 요구가 충분한지 먼저 확인합니다.
