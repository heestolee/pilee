---
title: Skill은 재사용 가능한 절차다
tags:
  - skill
  - skill-creator
  - procedure
  - porting
  - workflow
  - 스킬
category: workflow
status: active
confidence: high
applies_to:
  - skills/skill-creator
  - extensions/dynamic-agents-md
  - skills/systematic-debugging
source:
  - pilee-history:2026-05-03#32
reviewed_at: 2026-05-07
reviewed_commit: ce6c2b04f7774e2da5e7aa4df9114959429b22d7
related:
  - context-loading-minimal-surface
  - judgment-doc-unit
---

## Judgment

Skill은 긴 프롬프트 모음이 아니라 특정 상황에서 반복 실행되는 절차입니다. 그래서 skill을 만들거나 이식할 때는 “무엇을 설명하는가”보다 “언제 로드되고 어떤 행동을 강제하는가”가 중요합니다.

## Porting Rule

다른 repo나 my-pi에서 skill/extension을 가져올 때는 파일만 복사하지 않습니다. trigger description, prerequisite, output format, red flag, 검증 명령을 pilee 환경에 맞게 조정합니다. 세션 자동 로드 비용이 큰 내용은 skill로 분리해 필요할 때만 로드합니다.

## Failure Mode

모든 일반론을 skill로 만들면 skill이 지식 저장소가 되어 토큰을 낭비합니다. 좋은 skill은 좁은 트리거와 명확한 절차를 가집니다.
