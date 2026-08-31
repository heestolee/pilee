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
  - extensions/pr-review
  - extensions/worktree
  - skills/frame-v2
  - skills/ship
  - skills/pr-ship
source:
  - user-direction:2026-07-17-learning-note-companion
  - user-direction:2026-08-30-study-hard-meta-review-shared-shell
reviewed_at: 2026-08-31
reviewed_commit: 9cbc99c3a7169ce00afb150b296f8ca734997be3
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

이 구조에서 Frame 기획, Study Hard의 질문·revision·HTML·optional Notion 저장, 구현은 서로 독립적으로 계속 동작합니다. Frame v2는 이들을 직렬로 강제하지 않고 선택한 순서와 병렬 흐름을 연결합니다.

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

## Study-first Attachment Rule

Standalone Study Hard run도 사용자가 작업 기획으로 전환하려 할 때 같은 companion 구조에 합류할 수 있습니다.

```text
current Study Hard runId
  → frame_v2_state adopt-study-hard
  → 같은 runId/statePath를 쓰는 frame-v2 manifest
  → Frame 작성·보완
  → companion attach
```

Adopt는 학습 state를 복제하거나 초기화하지 않습니다. companion 연결 revision은 추가될 수 있지만 기존 Q&A와 note history는 유지합니다.

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

`/study-hard current`는 현재 `.pi/learning-companion.json`의 `runId`를 열며 새 URL 학습 prompt를 시작하지 않습니다. Live Study Hard는 Frame이 있으면 학습노트 최상단에 전체 Frame을 기본 접힘 read-only view로 표시하고, Frame이 없으면 이 영역을 생략합니다. Standalone HTML도 같은 details view를 export 시점에 파생합니다.

Notion 저장은 기존 Study Hard payload와 private publisher 경계를 유지합니다. Companion metadata는 optional field로 전달되며, publisher 지원 여부가 기존 noteDocument·visual PNG·원본 spec 저장을 깨뜨리면 안 됩니다.

## Shared Shell Ownership Rule

학습노트와 코드 리뷰처럼 같은 Study Hard state를 소비하는 surface는 각 extension이 별도 Glimpse 창을 직접 열지 않습니다. Study Hard extension 하나가 window·server·run 선택을 소유하고, Meta Review는 shared `pi.events` broker에 review link와 surface 전환을 요청합니다. Broker owner identity는 extension별 `ExtensionAPI` 객체가 아니라 shared event bus이며, request claim으로 한 owner만 open을 수행합니다.

기존 창 재사용은 canonical source URL만 같다는 이유로 persisted state를 임의 선택하지 않습니다. 마지막 `study_hard_board start/open`으로 current가 된 **실제 열린 Glimpse handle**만 재사용하고, dormant·닫힌 run은 학습노트 canonical을 가로채지 않습니다. 열린 matching handle이 없거나 broker가 없는 legacy runtime에서는 deterministic Meta Review run을 여는 기존 fallback을 유지합니다.

이 계약의 회귀 테스트는 서로 다른 ExtensionAPI wrapper가 같은 event bus를 공유하는 조건에서 다음을 함께 확인합니다.

- Glimpse open 횟수가 늘지 않고 기존 window를 `show`합니다.
- 기존 `noteDocument`와 run identity를 보존한 채 `metaReview`와 `activeSurface=review`만 연결합니다.
- 같은 URL의 dormant run은 선택하지 않습니다.
- generated browser `render()`와 `setSurface()`를 실제 DOM에서 실행했을 때 코드 리뷰 탭과 review surface가 활성화됩니다.

## Review Conversation Ownership Rule

Meta Review 질문은 Pi transcript 알림만으로 완료하지 않습니다. `questions.jsonl`의 질문·답변이 canonical이고, Study Hard 코드 리뷰 drawer는 범위별 필터와 전체 대화 복구 경로를 함께 제공합니다.

- `전체 PR`은 `session` 질문만 표시합니다.
- `선택 블록`은 현재 selection과 정확히 연결된 질문만 표시합니다.
- `모든 대화`는 selection scope와 무관하게 canonical Q&A 전체를 표시합니다.
- 최초 reload에 기존 질문이 있으면 `모든 대화`를 열어 과거 Q&A를 다시 찾을 수 있게 합니다.
- polling과 answer re-render는 사용자가 고른 탭을 바꾸지 않습니다.
- 다른 selection을 명시적으로 선택하면 이전 질문을 강제로 끼워 넣지 않습니다. 원래 selection 또는 `모든 대화`로 돌아가면 다시 볼 수 있습니다.
- `모든 대화` composer의 새 질문은 전체 PR `session` scope로 전달합니다.
- 질문이 없으면 실행 phase도 없으며 `답변 경로 확인 중` 같은 유령 상태를 표시하지 않습니다.

질문의 source scope와 evidence anchor는 답변 근거이자 필터 경계입니다. “thread 유지”는 대화를 삭제하지 않고 같은 drawer에서 다시 찾을 수 있다는 뜻이지, 범위가 다른 모든 화면에 같은 질문을 노출한다는 뜻이 아닙니다. Pi transcript는 durable notification이고, 질문·답변을 읽고 이어가는 사용자-facing owner는 같은 Study Hard drawer입니다.

## Workflow Boundary

- Frame v2 continuation은 companion이 있을 때만 의미 있는 checkpoint를 기록합니다.
- light ship은 push 성공 terminal condition을 우선해 companion 후속을 생략합니다.
- standard/full ship과 pr-ship은 현재 sidecar가 있을 때만 push/review checkpoint를 기록합니다.
- Companion 내용을 PR timeline 일반 코멘트로 자동 게시하지 않습니다.
- merge observer나 자동 polling은 기본 경로가 아닙니다. merge가 확인된 workflow에서 명시적으로 checkpoint를 남깁니다.
