---
title: Editor affordance는 숨은 컨텍스트가 아니다
tags:
  - editor
  - footer
  - prompt-suggest
  - working-text
  - affordance
  - ui
category: ui
status: active
applies_to:
  - extensions/footer
  - extensions/prompt-suggest-lite
  - extensions/working-text
  - extensions/custom-style
source:
  - pilee-history:2026-05-03#31
  - pilee-history:2026-05-03#32
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: f1480c7b2a651eb5eba20709293b9839f4f91587
related:
  - theme-information-hierarchy
  - context-loading-minimal-surface
  - tool-output-noise-management
---

## Judgment

Footer, prompt suggestion, working text 같은 editor affordance는 사용자가 입력을 더 잘 다루게 하는 UI이지 모델에게 몰래 주입되는 컨텍스트가 아닙니다. 보이는 편의 기능과 숨은 지시가 섞이면 사용자는 어떤 정보가 모델 입력으로 들어갔는지 알 수 없습니다.

## Boundary Rule

Editor surface는 현재 모델, 패널 label, 입력 상태, suggestion처럼 사용자가 보는 정보를 표시합니다. 실제 시스템 지시나 장기 메모는 AGENTS/skill/knowledge처럼 추적 가능한 경로로 들어가야 합니다.

## Panel Label Rule

`P0 · model`, `P1 · model` 같은 표시는 사용자가 현재 패널의 역할을 기억하도록 돕는 visible affordance입니다. 이 label은 숨은 prompt나 권한 모델이 아니며, 중요한 실행 판단은 worktree gate·handoff·tool guard처럼 별도 경로에서 검증되어야 합니다.

## Failure Mode

편의를 위해 editor affordance에 암묵적 지시를 넣으면 재현성과 신뢰가 떨어집니다. 입력 보조는 입력 보조로, 컨텍스트 로딩은 컨텍스트 로딩으로 분리합니다.
