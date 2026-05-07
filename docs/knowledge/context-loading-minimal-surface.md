---
title: 자동 로드 컨텍스트는 최소 surface만 가진다
tags:
  - context
  - agents-md
  - memory
  - system-prompt
  - token
  - autoload
category: workflow
status: active
applies_to:
  - AGENTS.md
  - extensions/context-loader
  - extensions/dynamic-agents-md
  - extensions/memory-layer
  - extensions/cc-system-prompt
  - extensions/claude-hooks-bridge
source:
  - pilee-history:2026-05-01#10
  - pilee-history:2026-05-01#19
  - pilee-history:2026-05-01#24
reviewed_at: 2026-05-07
reviewed_commit: f1480c7b2a651eb5eba20709293b9839f4f91587
related:
  - private-journal-public-doctrine
  - tool-output-noise-management
---

## Judgment

세션 시작 시 자동으로 들어오는 컨텍스트는 최소 surface만 가져야 합니다. 모든 과거 기록과 일반론 스킬을 항상 넣으면 토큰을 소모하고, 현재 작업과 무관한 지시가 판단을 흐립니다.

## Loading Rule

AGENTS.md에는 핵심 원칙만 짧게 두고, 긴 history/knowledge는 필요할 때 검색하거나 read합니다. 동적으로 AGENTS.md를 주입하더라도 파일 탐색 결과와 관련된 범위로 제한합니다. cc-system-prompt처럼 매 턴 큰 비용을 만드는 일반 프롬프트는 제거하거나 skill로 분리합니다.

## Failure Mode

컨텍스트를 많이 넣는 것이 기억력이 아닙니다. 적은 자동 로드와 명시적 회수가 결합될 때 세션은 가볍고 판단은 더 선명해집니다.
