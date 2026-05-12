---
title: pilee 변경은 final-check gate로 닫는다
tags:
  - pilee
  - final-check
  - verification
  - skill
  - workflow
  - 마무리
category: workflow
status: active
confidence: high
applies_to:
  - skills/pilee-final-check
  - AGENTS.md
  - scripts/knowledge.mjs
  - pilee change workflow
source:
  - user-direction:2026-05-12-pilee-final-check
reviewed_at: 2026-05-12
reviewed_commit: fd5aaa5192e7bb7ddb0fe9197983780a83f3b16f
related:
  - request-traceability-surgical-changes
  - evidence-first-verification-gate
  - change-integration-discipline
  - pilee-knowledge-system
---

## Overview

pilee 변경은 기능 구현, knowledge 갱신, 기록/동기화, push가 함께 얽힙니다. 그래서 “코드가 컴파일된다”만으로는 작업이 닫히지 않습니다. 최종 보고 전에는 사용자가 요청한 의도와 실제 diff를 다시 맞추고, pilee 특유의 session/worktree/archive/knowledge/Notion 구멍을 한 번 더 찾아야 합니다.

## Rule

pilee repo에 변경이 생기면 final response 전에 `pilee-final-check` 절차를 적용합니다. 이 절차는 새 기능을 추가하는 단계가 아니라, 이미 만든 변경이 실제 의도대로 동작하는지 마지막으로 닫는 gate입니다.

필수 확인:

1. 요청 의도와 diff의 직접 매핑
2. unrelated dirty/generated drift 분리
3. 변경 유형별 실제 failure mode 검토
4. 가능한 smoke/validation 실행
5. 구멍 발견 시 수정 후 재검증
6. local pilee-history/Notion sync와 push 상태 확인

## Why a separate skill

일반 `verify`는 frame success criteria를 mechanical하게 검증하고, `code-review-and-quality`는 일반 코드 품질을 봅니다. 하지만 pilee 개선은 public/private boundary, generated knowledge graph, package version lockstep, local history/Notion sync, Pi session/worktree state 같은 운영 축이 함께 닫혀야 합니다.

따라서 final-check는 기존 검증 스킬을 대체하지 않고, pilee 변경의 마지막 조립 게이트 역할을 합니다.

## Behavior

구멍이 없으면 개선 내용과 검증 근거를 짧게 정리합니다. 구멍이 있으면 바로 고치고 같은 검증 세트를 다시 실행합니다. 미검증 gap이 남으면 “문제없음”이라고 말하지 않고 gap으로 분리합니다.

## Review triggers

이 문서는 다음 경우 다시 검토합니다.

- pilee 변경 배포 규칙이 바뀔 때
- knowledge graph/freshness 운영 방식이 바뀔 때
- Notion/local history sync 방식이 바뀔 때
- final-check가 너무 넓게 trigger되어 일반 repo 작업을 방해할 때
