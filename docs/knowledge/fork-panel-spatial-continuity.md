---
title: Fork-panel 위치는 작업 맥락의 일부다
tags:
  - fork-panel
  - revive
  - repanel
  - ghostty
  - spatial
  - panel
  - 패널
category: workflow
status: active
applies_to:
  - extensions/fork-panel
  - revive workflow
  - repanel workflow
source:
  - pilee-history:2026-05-05#39
  - pilee-history:2026-05-05#40
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - revive-over-transcript-recall
  - terminal-host-integration
  - session-identity-over-filenames
---

## Judgment

포크 패널의 위치는 단순한 창 배치가 아니라 사용자가 작업을 나누어 기억하는 맥락입니다. revive가 항상 한 방향으로만 열리거나, 기존 패널 위치를 바꾸려면 세션을 잃어야 한다면 회수성이 떨어집니다.

## Spatial Rule

`/revive`는 현재 패널, 좌/우/상/하 split, tab 같은 open target을 선택할 수 있어야 합니다. 이미 열린 세션의 위치를 바꾸는 `/repanel`은 같은 `pi --session`을 새 split에서 다시 열어 세션 정체성을 유지합니다.

## Guardrail

repanel은 원본 터미널을 닫고 새 split을 열기 때문에 terminal host 동작과 race condition에 민감합니다. marker 파일과 stale handoff 제거처럼 자동 handoff와 충돌하지 않는 장치가 필요합니다.
