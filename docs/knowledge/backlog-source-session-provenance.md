---
title: Backlog는 원 세션 출처를 보존한다
tags:
  - backlog
  - tasks
  - provenance
  - source-session
  - session
  - 맥락
category: workflow
status: active
applies_to:
  - extensions/backlog
  - extensions/tasks
  - extensions/session-title
  - extensions/archive-to-html
source:
  - pilee-history:2026-05-05#51
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - session-identity-over-filenames
  - artifact-archive-reopenability
---

## Judgment

Backlog item은 제목과 노트만 저장하면 시간이 지난 뒤 왜 생겼는지 잃어버립니다. 장기 백로그는 원 대화 세션의 출처를 함께 보존해야 다시 작업할 때 맥락을 회수할 수 있습니다.

## Provenance Rule

새 backlog item에는 session file, session title, cwd, leaf entry, capturedAt을 `sourceSession`으로 저장합니다. 사람이 읽는 `sourceReference`도 함께 남겨 미래 에이전트가 “이 세션 전문에서 확인”이라는 경로를 바로 이해하게 합니다.

## Promotion Rule

Backlog에서 task로 옮겨도 provenance를 버리지 않습니다. 단기 작업 추적 시스템으로 승격될수록 오히려 원 세션을 열 수 있는 링크와 전문 export가 중요해집니다.
