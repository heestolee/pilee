---
title: Idle UI는 장식이 아니라 ambient status다
tags:
  - idle-screensaver
  - tasks
  - spinner
  - status
  - ambient
  - ui
category: ui
status: active
applies_to:
  - extensions/idle-screensaver
  - extensions/tasks
  - extensions/spinner
  - extensions/usage-reporter
source:
  - pilee-history:2026-05-01#14
  - pilee-history:2026-05-02#screensaver
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-05-19-screensaver-status
  - user-direction:2026-05-19-screensaver-last-interaction
  - user-direction:2026-05-20-screensaver-render-contract
reviewed_at: 2026-05-20
reviewed_commit: 1d95b54893314cb41efd4ea31d62d4fdace63c11
related:
  - tool-output-noise-management
  - backlog-source-session-provenance
---

## Judgment

Idle screensaver나 spinner는 단순 장식보다 “지금 무엇을 기다리고 있는가”를 알려주는 ambient status surface입니다. 사용자가 화면을 다시 봤을 때 마지막 응답, 진행 중 task, 대기 상태를 빠르게 회수할 수 있어야 합니다.

## Status Rule

마지막 assistant 메시지 요약, in-progress/pending task, 마지막 인터랙션 시간, 현재 작업 상태를 짧게 보여줍니다. idle 화면은 사용자가 돌아왔을 때 “얼마나 오래 비웠고, 어디서 다시 잡으면 되는지”를 즉시 회수하게 해야 합니다. 마지막 인터랙션 시간은 manual preview 명령 입력 시각이 아니라 현재 세션 transcript의 최신 user/assistant 메시지 timestamp를 우선 source-of-truth로 삼아야 합니다.

장식적 애니메이션은 정보를 방해하지 않을 때만 의미가 있습니다. 캐릭터 이미지는 screensaver 기능 전체 on/off와 별개의 전역 preference로 두어, 사용자가 ambient status는 유지하면서 시각 장식만 끌 수 있어야 합니다. 설정/도움말에 표시 정보 목록을 보여줄 때는 현재 toggle 상태를 반영해 실제로 보이는 정보와 숨겨진 정보를 구분해야 합니다. 화면 렌더링은 전체 폭에 문자열을 바로 흘리지 말고 가운데 content box를 잡은 뒤, title은 중앙 정렬하고 상태/응답/TODO는 box 안에서 읽기 좋게 배치해야 합니다. 마지막 assistant 응답은 한 줄 앞부분만 보여주지 말고 최대 5줄 wrap으로 복원 가능한 맥락을 제공해야 합니다. dismiss 안내는 실제 입력 처리 계약과 테스트로 보장해야 합니다. task 경로처럼 상태 source가 바뀌면 UI도 실제 저장 위치를 따라가야 합니다.

## Global Preference Rule

ambient UI의 on/off는 패널별 임시 상태보다 사용자 전역 preference로 다룹니다. screensaver처럼 모든 패널에서 체감되는 기능은 설정 파일을 공유하고, 각 패널이 변경을 감지해 stale timer를 취소하거나 다시 예약해야 합니다. 단, 명시적인 manual preview는 설정값과 별개로 현재 화면 확인을 위해 허용할 수 있습니다.

## Failure Mode

예쁜 idle 화면이 현재 상태를 알려주지 못하면 사용자는 세션을 다시 읽어야 합니다. pilee의 ambient UI는 attention을 훔치지 않되, 돌아왔을 때 맥락을 복구해야 합니다.
