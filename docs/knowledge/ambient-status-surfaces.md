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
reviewed_at: 2026-05-13
reviewed_commit: ca6dec9d7f8a3eeda24ee5b0d35c64752d02a76a
related:
  - tool-output-noise-management
  - backlog-source-session-provenance
---

## Judgment

Idle screensaver나 spinner는 단순 장식보다 “지금 무엇을 기다리고 있는가”를 알려주는 ambient status surface입니다. 사용자가 화면을 다시 봤을 때 마지막 응답, 진행 중 task, 대기 상태를 빠르게 회수할 수 있어야 합니다.

## Status Rule

마지막 assistant 메시지 요약, in-progress/pending task, 현재 작업 상태를 짧게 보여줍니다. 장식적 애니메이션은 정보를 방해하지 않을 때만 의미가 있습니다. task 경로처럼 상태 source가 바뀌면 UI도 실제 저장 위치를 따라가야 합니다.

## Global Preference Rule

ambient UI의 on/off는 패널별 임시 상태보다 사용자 전역 preference로 다룹니다. screensaver처럼 모든 패널에서 체감되는 기능은 설정 파일을 공유하고, 각 패널이 변경을 감지해 stale timer를 취소하거나 다시 예약해야 합니다. 단, 명시적인 manual preview는 설정값과 별개로 현재 화면 확인을 위해 허용할 수 있습니다.

## Failure Mode

예쁜 idle 화면이 현재 상태를 알려주지 못하면 사용자는 세션을 다시 읽어야 합니다. pilee의 ambient UI는 attention을 훔치지 않되, 돌아왔을 때 맥락을 복구해야 합니다.
