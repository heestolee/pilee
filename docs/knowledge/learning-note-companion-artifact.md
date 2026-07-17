---
title: 학습노트 companion은 독립 canonical을 sidecar로 연결한다
tags:
  - learning-note
  - companion-artifact
  - frame-v2
  - study-hard
  - worktree
  - checkpoint
  - review
category: architecture
status: active
confidence: high
applies_to:
  - extensions/learning-companion
  - extensions/frame-v2
  - extensions/study-hard
  - extensions/worktree
  - skills/frame-v2
  - skills/ship
  - skills/pr-ship
source:
  - user-direction:2026-07-17-learning-note-companion
reviewed_at: 2026-07-17
reviewed_commit: f24686c02d8552809de904565e22ae22905b227b
related:
  - frame-v2-learning-note-pilot
  - study-hard-public-engine-private-publisher
  - worktree-session-continuity
  - slice-auto-commit-rhythm
  - evidence-first-verification-gate
---

## Judgment

Frame v2 작업과 Study Hard 학습노트를 하나의 state나 workflow로 합치지 않습니다. 각각의 책임과 canonical을 유지하고, 동일 work unit이라는 사실만 `learning-companion.json` sidecar로 연결합니다.

```text
frame.json                    Study Hard state
작업 canonical                학습 canonical
     │                              │
     └── learning-companion.json ───┘
         stable companionId/runId
```

이 구조에서 기존 Frame v2의 이해→계약→구현 흐름과 Study Hard의 질문·revision·HTML·optional Notion 저장은 서로 독립적으로 계속 동작합니다.

## Sidecar Rule

`learning-companion.json`은 내용을 복제하지 않고 다음 포인터만 보존합니다.

- stable `companionId`
- Study Hard `runId`와 state path
- frame path, identity key, initial/latest canonical hash
- 현재 lifecycle phase
- Frame v2 manifest provenance

planning session에서 worktree로 전환할 때 sidecar는 target `.pi/learning-companion.json`으로 retarget하지만 `companionId`와 `runId`는 바꾸지 않습니다. target에 기존 sidecar가 있으면 덮어쓰지 않습니다.

## Failure Isolation

Companion은 관찰·학습 보조 artifact이므로 연결 실패가 작업 성공을 뒤집으면 안 됩니다.

- sidecar 누락·손상은 Frame ready, worktree fork, 구현, 검증, commit, push, PR 대응을 차단하지 않습니다.
- Study Hard state가 아직 없으면 sidecar만 보존하고 나중에 다시 연결할 수 있습니다.
- 연결이 깨져도 `frame.json`과 Study Hard state는 각각 독립적으로 남습니다.
- Notion publisher가 없거나 실패해도 HTML export와 작업은 계속됩니다.

## Event and Checkpoint Rule

모든 tool call이나 중간 로그를 기록하지 않습니다. 학습 가치가 있는 전환만 append-only event로 남깁니다.

- Frame ready와 worktree promotion
- implementation slice 시작·완료
- 의미 있는 검증 실패·해결
- commit/push와 pre-PR
- review received/applied와 review round
- merge와 post-merge 관찰

Event는 `dedupeKey`로 중복을 막고 전체 diff/log 대신 slice, commit, PR, review, evidence ref만 저장합니다. 학습노트 snapshot은 frame-ready, slice-complete, pre-PR, review-round, merged, post-merge 같은 checkpoint에서만 가리킵니다.

## Learning-to-Work Promotion Rule

학습 중 발견한 더 나은 방향은 바로 작업 canonical을 수정하지 않고 proposal로 승격합니다.

```text
학습 인사이트
  → proposed
  → 사용자 명시 수락
  → accepted
  → 기존 /decide · work_context · task · verify · 구현 workflow로 적용
  → concrete decision/task/commit/evidence ref
  → applied
```

`proposed`와 `accepted`는 상태 기록일 뿐 `frame.json`, work context, task, 코드를 직접 변경하지 않습니다. `applied`는 실제 적용 ref 없이는 허용하지 않습니다. 거절·보류도 학습 이력으로 남겨 같은 판단을 반복하지 않게 합니다.

## Surface and Export Rule

`/study-hard current`는 현재 `.pi/learning-companion.json`의 `runId`를 열며 새 URL 학습 prompt를 시작하지 않습니다. Live Study Hard와 standalone HTML은 작업 timeline, checkpoint 수, proposal 상태를 조건부로 보여줍니다.

Notion 저장은 기존 Study Hard payload와 private publisher 경계를 유지합니다. Companion metadata는 optional field로 전달되며, publisher 지원 여부가 기존 noteDocument·visual PNG·원본 spec 저장을 깨뜨리면 안 됩니다.

## Workflow Boundary

- Frame v2 continuation은 companion이 있을 때만 의미 있는 checkpoint를 기록합니다.
- light ship은 push 성공 terminal condition을 우선해 companion 후속을 생략합니다.
- standard/full ship과 pr-ship은 현재 sidecar가 있을 때만 push/review checkpoint를 기록합니다.
- Companion 내용을 PR timeline 일반 코멘트로 자동 게시하지 않습니다.
- merge observer나 자동 polling은 기본 경로가 아닙니다. merge가 확인된 workflow에서 명시적으로 checkpoint를 남깁니다.
