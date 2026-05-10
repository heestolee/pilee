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
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-10
reviewed_commit: 636a43145119d118752bb118758e030d932990df
related:
  - revive-over-transcript-recall
  - terminal-host-integration
  - session-identity-over-filenames
---

## Judgment

포크 패널의 위치는 단순한 창 배치가 아니라 사용자가 작업을 나누어 기억하는 맥락입니다. revive가 항상 한 방향으로만 열리거나, 기존 패널 위치를 바꾸려면 세션을 잃어야 한다면 회수성이 떨어집니다.

## Spatial Rule

`/revive`는 현재 패널, 좌/우/상/하 split, tab 같은 open target을 선택할 수 있어야 합니다. 이미 열린 세션의 위치를 바꾸는 `/repanel`은 같은 session file을 새 split에서 다시 열어 세션 정체성을 유지합니다. 이때 launch command는 bare `pi`가 아니라 현재 Pi command/wrapper를 보존해야 새 shell의 PATH 차이로 다른 설치본을 실행하지 않습니다.

## Orientation Rule

공간 기억은 화면 위치만으로 닫히지 않습니다. 부모는 `P0`, 자식은 `P1`, `P2`처럼 visible label을 가져야 하며, revive/repanel 이후에도 사용자가 어느 패널이 기준 세션인지 즉시 알아볼 수 있어야 합니다. label은 위치 이동의 안전벨트입니다. 따라서 panel label은 process env만 신뢰하지 않고, 현재 session file이 fork-panel recent record와 일치하면 그 기록의 `panelLabel`로 복구합니다.

## Guardrail

repanel은 원본 터미널을 닫고 새 split을 열기 때문에 terminal host 동작과 race condition에 민감합니다. marker 파일과 stale handoff 제거처럼 자동 handoff와 충돌하지 않는 장치가 필요합니다.
