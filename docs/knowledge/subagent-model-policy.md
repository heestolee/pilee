---
title: Codex-first subagent 모델 운용 정책
tags:
  - subagent
  - codex
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
applies_to:
  - agents
  - extensions/subagent
  - skills/stress-interview
  - skills/self-healing
source:
  - pilee-history:2026-05-04#33
  - pilee-history:2026-05-04#34
  - pilee-history:2026-05-05#42
reviewed_at: 2026-05-07
reviewed_commit: 8b79c81704f67905fa6cecca9c6bb24e50c433c1
related:
  - pilee-knowledge-system
  - worktree-session-continuity
---

## Overview

pilee subagent는 Codex-first로 운영합니다. 기본 방향은 worker/planner/reviewer/verifier/challenger/browser처럼 판단·구현·검증 책임이 큰 agent에는 강한 모델을 쓰고, finder/searcher처럼 탐색·수집 중심 agent에는 더 가벼운 모델을 써 비용과 부하를 낮추는 것입니다.

## Model Split

모든 agent를 같은 최고 모델로 통일하면 기준선은 단순해지지만, 탐색형 agent까지 같은 비용 구조를 갖게 됩니다. 현재 정책은 역할별 위험도와 출력 품질 요구를 나눕니다.

- 구현·검증·리뷰·도전 역할은 더 강한 모델을 유지합니다.
- 단순 탐색·검색 역할은 가벼운 모델을 우선 사용합니다.
- 모델 선택은 “얼마나 똑똑한가”보다 “이 agent가 실패했을 때 되돌리기 비용이 큰가”를 기준으로 조정합니다.

## Prompt Specificity Rule

stress-interview와 self-healing은 subagent fan-out을 쓰지만, worker에게 빈 요청을 보내면 안 됩니다. actionable item, 대상 파일/영역, 기대 수정, 검증 명령이 포함된 구체 프롬프트를 전달해야 합니다. 그렇지 않으면 worker는 실행 가능한 문제를 받지 못하고 형식적인 응답만 남기기 쉽습니다.

## Runtime Direction

pilee의 agent 정의와 스킬 문서는 Claude Code 관성 표현을 줄이고 Pi/Codex runtime 기준으로 정렬합니다. 예시 명령도 `claude -p` 같은 외부 CLI 전제보다 Pi subagent 도구 흐름을 우선합니다. 이 정책은 [worktree-session-continuity](./worktree-session-continuity.md)의 세션 이어가기 UX와 함께, 여러 agent가 동시에 움직여도 사람이 맥락을 회수할 수 있게 만드는 기반입니다.

## Review Trigger

새 agent를 추가하거나 모델 버전을 바꾸거나 self-healing/stress-interview 흐름을 수정하면 이 문서를 다시 봅니다. 특히 finder/searcher처럼 가벼운 모델을 쓰는 역할에서 품질 저하가 반복되면, 모델 자체보다 task prompt와 evidence 요구가 충분한지 먼저 확인합니다.
