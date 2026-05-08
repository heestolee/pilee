---
title: Utils surface는 사용자 계약을 만들지 않는다
tags:
  - utils
  - internal
  - surface
  - abstraction
  - extension
category: architecture
status: active
confidence: high
applies_to:
  - extensions/utils
source:
  - pilee-history:2026-05-03#32
reviewed_at: 2026-05-08
reviewed_commit: fdf91a44f626b47846fb59501575357657fd8ef3
related:
  - deterministic-fallbacks-preserve-workflow
  - terminal-host-integration
---

## Judgment

`extensions/utils` 같은 공용 유틸리티 surface는 사용자-facing 기능 계약을 직접 만들지 않습니다. 재사용 코드는 여러 extension의 구현을 돕지만, 사용자가 기억해야 하는 판단은 그 유틸을 쓰는 기능 문서에 남아야 합니다.

## Boundary Rule

유틸 문서는 public API, fallback, sanitization helper처럼 여러 곳에서 공유되는 구현 규칙만 설명합니다. 특정 UX 결정이나 workflow 정책은 해당 extension/skill doctrine으로 연결합니다.

## Failure Mode

모든 공통 코드를 별도 doctrine으로 만들면 문서는 구현 구조를 따라가고 판단을 잃습니다. utils는 보조 surface이며, 사용자 계약은 상위 기능에 둡니다.
