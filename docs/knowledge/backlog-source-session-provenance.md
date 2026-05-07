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
confidence: high
applies_to:
  - extensions/backlog
  - extensions/tasks
  - extensions/session-title
  - extensions/archive-to-html
source:
  - pilee-history:2026-05-05#51
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: d601ac0041243e78871b352c51f38b50f22be4bb
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

## Reopen Rule

출처 보존은 raw path 저장만으로 충분하지 않습니다. 사용자가 backlog/task를 다시 볼 때 source session export나 artifact browser를 통해 원 대화를 열 수 있어야 합니다. `/backlog`와 `/show-report`는 같은 session export helper를 공유해 Pi의 공식 HTML session exporter를 호출해야 합니다. 이렇게 해야 sidebar/tree/filter(`Default`, `No-tools`, `User`, `Labeled`, `All`)가 있는 “세션 전문” UX가 유지됩니다. 공개 PR에는 session path를 복사하지 않지만, 로컬 시스템 안에서는 provenance가 revive/export/reopen 동작으로 이어져야 합니다.

## Artifact Label Rule

source session title과 workspace metadata는 backlog뿐 아니라 capture artifact를 묶는 label에도 재사용될 수 있습니다. 다만 공개 PR에는 session path나 private 원문을 복사하지 않고, 로컬 Artifact Browser 안에서만 작업 단위를 알아보게 하는 provenance hint로 사용합니다.
