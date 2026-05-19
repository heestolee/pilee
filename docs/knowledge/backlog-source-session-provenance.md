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
  - user-direction:2026-05-19-explicit-backlog-is-not-task
reviewed_at: 2026-05-13
reviewed_commit: ca6dec9d7f8a3eeda24ee5b0d35c64752d02a76a
related:
  - session-identity-over-filenames
  - artifact-archive-reopenability
---

## Judgment

Backlog item은 제목과 노트만 저장하면 시간이 지난 뒤 왜 생겼는지 잃어버립니다. 장기 백로그는 원 대화 세션의 출처를 함께 보존해야 다시 작업할 때 맥락을 회수할 수 있습니다.

## Provenance Rule

새 backlog item에는 session file, session title, cwd, leaf entry, capturedAt을 `sourceSession`으로 저장합니다. 사람이 읽는 `sourceReference`도 함께 남겨 미래 에이전트가 “이 세션 전문에서 확인”이라는 경로를 바로 이해하게 합니다.

## Capture Surface Boundary Rule

사용자가 “backlog에 넣어줘”, “백로그에 남겨줘”, “나중에 볼 수 있게 backlog”처럼 `backlog`/`백로그`를 명시하면 장기 보관 surface가 이미 결정된 것입니다. 이때 `TaskCreate`나 work-unit task board를 사용하지 않습니다. 실제 backlog 저장소(`/backlog`, `BacklogCreate`, `~/.pi/agent/state/backlog.json`)에 기록해야 합니다.

하드 차단은 `backlog`/`백로그`가 캡처 동사(넣다/남기다/기록하다/저장하다 등)와 함께 나온 명시적 backlog 저장 요청에만 적용합니다. `나중에`, `보류`, `언젠가`, `later`, `deferred` 같은 표현은 장기 보관 후보라는 판단 신호지만, 현재 work-unit task에도 자연스럽게 들어갈 수 있으므로 tool-level hard block 조건으로 쓰지 않습니다. 이 경우에는 맥락상 task/backlog를 판단하거나 필요하면 짧게 확인합니다.

반대로 `/task`, “현재 작업 task”, “이번 slice에서 추적”처럼 현재 work-unit 추적을 명시한 경우에만 task board를 사용합니다. Task는 active work를 외부화하는 보드이고, Backlog는 당장 진행하지 않는 장기 기억입니다.

실수로 backlog 요청을 task로 만들었다면 사용자에게 “원하면 옮길까요?”라고 되묻지 않습니다. 그 순간 이미 사용자의 명시 지시를 위반한 것이므로 task에서 제거하고 backlog로 옮긴 뒤 정정 결과를 보고합니다.

## Manual Edit Fallback Rule

가능하면 `/backlog add`나 `BacklogCreate`를 사용해 provenance capture를 자동으로 태웁니다. 수동으로 local backlog JSON을 편집해야 하는 예외 상황에서도 `sourceSession`과 `sourceReference`를 생략하지 않습니다.

수동 편집 시 최소로 남길 것:

- `sourceSession.title`
- `sourceSession.sessionFile`
- `sourceSession.cwd`
- `sourceSession.entryId` 또는 그에 준하는 leaf reference
- `sourceSession.capturedAt`
- 사람이 읽는 `sourceReference`
- 발단이 된 외부 자료가 있으면 note 안의 URL/제목

공개 문서나 PR body에는 개인 session path나 private 원문을 복사하지 않습니다. 이 정보는 로컬 backlog 회수성만을 위한 provenance입니다.

## Promotion Rule

Backlog에서 task로 옮겨도 provenance를 버리지 않습니다. 단기 작업 추적 시스템으로 승격될수록 오히려 원 세션을 열 수 있는 링크와 전문 export가 중요해집니다.

## Reopen Rule

출처 보존은 raw path 저장만으로 충분하지 않습니다. 사용자가 backlog/task를 다시 볼 때 source session export나 artifact browser를 통해 원 대화를 열 수 있어야 합니다. `/backlog`와 `/archive`는 같은 session export helper를 공유해 Pi의 공식 HTML session exporter를 호출해야 합니다. 이렇게 해야 sidebar/tree/filter(`Default`, `No-tools`, `User`, `Labeled`, `All`)가 있는 “세션 전문” UX가 유지됩니다. 이 helper는 반복 열기 속도를 위해 source fingerprint와 cache version이 맞는 HTML을 재사용하고, session 전문의 기본 정보 위계를 위해 `No-tools`를 기본 filter로 설정합니다. 공개 PR에는 session path를 복사하지 않지만, 로컬 시스템 안에서는 provenance가 revive/export/reopen 동작으로 이어져야 합니다.

## Artifact Label Rule

source session title과 workspace metadata는 backlog뿐 아니라 capture artifact를 묶는 label에도 재사용될 수 있습니다. 다만 공개 PR에는 session path나 private 원문을 복사하지 않고, 로컬 Artifact Browser 안에서만 작업 단위를 알아보게 하는 provenance hint로 사용합니다.
