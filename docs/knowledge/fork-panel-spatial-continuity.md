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
confidence: high
applies_to:
  - extensions/fork-panel
  - extensions/utils/ghostty-panels.ts
  - revive workflow
  - repanel workflow
source:
  - pilee-history:2026-05-05#39
  - pilee-history:2026-05-05#40
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-11-20-source-panel-anchor
reviewed_at: 2026-11-20
reviewed_commit: 458e5c1b501c8bde0e0056a18f84091058bbc5a5
related:
  - workspace-action-panel-activation-contract
  - terminal-workspace-restore
  - revive-over-transcript-recall
  - terminal-host-integration
  - session-identity-over-filenames
---

## Judgment

포크 패널의 위치는 단순한 창 배치가 아니라 사용자가 작업을 나누어 기억하는 맥락입니다. revive가 항상 한 방향으로만 열리거나, 기존 패널 위치를 바꾸려면 세션을 잃어야 한다면 회수성이 떨어집니다.

## Spatial Rule

`/revive`는 현재 패널, 좌/우/상/하 split, tab 같은 open target을 선택할 수 있어야 합니다. 이미 열린 세션의 위치를 바꾸는 `/repanel`은 같은 session file을 새 split에서 다시 열어 세션 정체성을 유지합니다. 이때 launch command는 bare `pi`가 아니라 현재 Pi command/wrapper를 보존해야 새 shell의 PATH 차이로 다른 설치본을 실행하지 않습니다.

## Source Panel Rule

새 패널의 기준은 요청이 나온 패널, 즉 그 Pi가 실행 중인 패널입니다. 포커스된 패널은 기준이 아닙니다. 에이전트가 작업 중에 패널을 여는 시점에는 사용자가 다른 패널을 보고 있을 수 있어서, 포커스를 기준으로 삼으면 엉뚱한 패널 옆에 열립니다.

- 새 패널을 열어도 사용자의 포커스는 열기 전 그대로 둡니다. 새 탭도 선택하지 않습니다. 어디에 열었는지는 요청한 패널의 응답·알림으로 전합니다.
- Ghostty가 맨 앞 앱이 아니면 Ghostty를 앞으로 끌어오지 않습니다. 앞으로 끌어올 수밖에 없는 동작(새 탭 만들기)은 끝난 뒤 원래 앱을 다시 앞으로 보냅니다.
- 한 요청(사용자 메시지부터 그 응답이 끝날 때까지)에서 같은 위치로 여러 개를 열면 묶습니다. 새 탭은 첫 번째만 탭을 만들고 나머지는 그 탭 안에 같은 너비로 나란히 놓습니다. 오른쪽 패널은 첫 번째만 요청한 패널 옆에 열고 나머지는 그 아래로 쌓아, 요청한 패널이 계속 반으로 좁아지지 않게 합니다. 묶던 패널이 닫혔으면 새로 시작합니다. 별도 옵션은 두지 않습니다.
- 요청한 패널을 찾지 못한 열기는 포커스된 패널 기준으로 열고 그 사실을 알립니다. 잘못 열려도 닫으면 되돌릴 수 있기 때문입니다.
- 자기 패널을 닫거나 교체하거나 명령을 입력하는 동작(`/done`, `/repanel`, `/revive` 현재 패널)은 자기 패널 id만 대상으로 합니다. 자기 패널을 찾지 못하면 실행하지 않습니다. 다른 패널을 닫거나 다른 패널에 입력하면 되돌릴 수 없기 때문입니다.
- 자기 패널은 패널 제목에 잠깐 표식을 넣어 찾고 프로세스 단위로 기억합니다. 창·탭은 순번이 아니라 id로 찾습니다. 순번은 사용자가 창을 옮기는 사이에 다른 창을 가리킬 수 있습니다.
- 같은 Pi 안의 패널 열기는 한 번에 하나씩 실행합니다. 동시에 실행하면 Ghostty 스크립트가 섞이고 묶기 순서도 정해지지 않습니다.
- Ghostty·키 입력 AppleScript는 공통 모듈(`extensions/utils/ghostty-panels.ts`)에만 둡니다. 창 전체를 저장·복원하는 workspace capture/restore만 예외입니다. 이 경계는 모듈 밖 스크립트를 찾는 테스트로 지킵니다.

## Anchor-path Rule

단일 방향은 “요청한 패널(`/repanel`이면 그 패널을 닫은 뒤 같은 탭에 남은 패널)을 그 방향으로 split”한다는 뜻입니다. 두 개 이상의 split 방향은 앞 방향들을 anchor 이동 경로로 해석하고 마지막 방향을 실제 split 방향으로 사용합니다. 예를 들어 `/repanel right down`은 현재 패널 기준 오른쪽 split으로 이동해 그 terminal을 anchor로 잡은 뒤, 현재 세션을 그 anchor 아래에 다시 엽니다. `/fork-panel right down`과 `/revive last right down`도 같은 placement 문법을 사용합니다.

`/repanel`은 원본 terminal을 닫기 전에 anchor path를 먼저 확인해야 합니다. Ghostty `goto_split:<dir>`이 실패하거나 focus가 움직이지 않으면 원본 terminal을 닫지 않고 중단합니다. anchor path가 다시 현재 terminal로 돌아오는 경우도 닫기 전에 거부합니다.

## Orientation Rule

공간 기억은 화면 위치만으로 닫히지 않습니다. 부모는 `P0`, 자식은 `P1`, `P2`처럼 visible label을 가져야 하며, revive/repanel 이후에도 사용자가 어느 패널이 기준 세션인지 즉시 알아볼 수 있어야 합니다. label은 위치 이동의 안전벨트입니다. 따라서 panel label은 process env만 신뢰하지 않고, 현재 session file이 fork-panel recent record와 일치하면 그 기록의 `panelLabel`로 복구합니다.

## Guardrail

repanel은 원본 터미널을 닫고 새 split을 열기 때문에 terminal host 동작과 race condition에 민감합니다. marker 파일과 stale handoff 제거처럼 자동 handoff와 충돌하지 않는 장치가 필요합니다.
