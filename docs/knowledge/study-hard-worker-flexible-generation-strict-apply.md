---
title: Study Hard worker는 유연하게 생성하고 P0가 엄격하게 적용한다
tags:
  - study-hard
  - subagent
  - worker
  - three-way-merge
  - optimistic-concurrency
  - glimpse
category: architecture
status: active
confidence: high
applies_to:
  - extensions/study-hard
  - extensions/subagent
  - agents/study-hard-worker.md
source:
  - user-direction:2026-07-19-study-hard-worker-flexible-generation-strict-apply
reviewed_at: 2026-07-19
reviewed_commit: 4421708
related:
  - parallel-workflow-analysis-single-writer
  - study-hard-public-engine-private-publisher
  - subagent-prompt-specificity
  - learning-note-companion-artifact
---

## Judgment

Study Hard Glimpse 입력은 P0의 다른 입구다. 긴 노트 다듬기를 P0가 동기로 수행하지 않고, 실제 pilee `study-hard-worker --main` subagent로 dispatch한다. worker의 생성 범위를 선택 블록에 하드 제한하지 않는다. 선택 블록은 작업의 초점이며, 사용자 의도를 닫는 데 필요하면 주변 블록·다른 섹션·표·callout·Mermaid·visual·순서까지 함께 제안할 수 있다.

자유로운 생성과 안전한 동시 적용은 같은 문제가 아니다. worker는 전체 `proposedNoteDocument`를 result artifact에 만들지만 state를 직접 쓰지 않는다. P0의 merge coordinator가 `base / proposed / current`를 비교하고 충돌 없는 변경만 적용한다.

## Dispatch Rule

```text
Glimpse learner input
→ P0 hidden learner-request
→ study_hard_board worker_started
→ subagent run study-hard-worker --main
→ 표준 #N widget
→ compact completion follow-up to P0
→ apply_worker_result
```

- 별도 `pi -p --no-session` runner를 만들지 않는다.
- 기존 isolated Tutor/Editor runner로 돌아가지 않는다.
- `--main`은 P0 context snapshot과 session reference를 worker에 제공한다.
- worker completion은 원래 P0 session에 돌아와 후속 worker와 P0가 이전 결과를 이어받는다.
- worker stdout에는 전체 note JSON을 넣지 않고 artifact path와 짧은 summary만 둔다.

## Flexible Generation Rule

worker는 다음을 할 수 있다.

- 한 블록을 여러 블록으로 분할하거나 여러 블록을 병합
- 필요한 주변 설명과 다른 섹션의 중복·용어를 함께 정리
- paragraph, table, callout, code, Mermaid, visual 구조를 변경
- 블록·섹션을 삽입·삭제·이동·재배열
- 설명만 필요하면 note를 바꾸지 않고 feedback만 반환

제약은 “선택 블록 밖 수정 금지”가 아니라 “사용자 요청에 필요하지 않은 취향 개선 금지”다. 생성 모델의 범위를 줄여 충돌을 피하려 하지 않고, 실제 diff를 적용 단계에서 검사한다.

## Strict Apply Rule

merge coordinator는 worker가 주장한 write set을 그대로 믿지 않는다. artifact의 base와 proposed를 비교해 실제 변경을 계산하고 최신 current에 3-way merge한다.

- worker만 바꾼 값 → proposed 적용
- current만 바꾼 값 → current 보존
- 양쪽이 같은 값으로 변경 → 한 번만 보존
- 서로 다른 블록·필드 변경 → 함께 병합
- 같은 필드를 다른 값으로 변경 → conflict
- 삭제 대 최신 수정 → conflict
- 서로 양립할 수 없는 순서 변경 → conflict
- 독립 삽입·분할 → stable id와 order constraint로 함께 보존

첫 conflict는 같은 subagent run을 최신 note 기준으로 한 번 `continue`하여 rebase한다. 다시 충돌하면 silent overwrite하지 않고 `conflict`로 남겨 P0 판단을 요구한다. completion 재전달은 artifact hash로 멱등 처리한다.

## State Rule

learner question은 다음 상태를 가진다.

```text
queued → running → result-ready → merging → applied
                                  └→ rebasing → applied
                                               └→ conflict
```

`applied`는 worker가 답을 생성했다는 뜻이 아니라 최신 Study Hard state에 병합까지 끝났다는 뜻이다. 표준 subagent run id를 question에 연결해 Glimpse와 Pi의 `#N study-hard-worker`를 추적할 수 있게 한다.

## Failure Mode

- worker가 state를 직접 쓰면 서로 다른 블록 작업도 전역 revision에서 충돌하거나 마지막 결과가 앞 결과를 덮어쓴다.
- 선택 블록을 하드 쓰기 경계로 만들면 자연스러운 문서 재구성마다 scope-expanded 재시도가 발생해 worker가 답답해진다.
- 전체 proposed note를 P0 transcript에 넣으면 병렬 작업 수만큼 context가 중복된다.
- conflict를 last-write-wins로 처리하면 사용자가 보지 못한 채 학습 설명이 유실된다.
- custom runner를 만들면 표준 #N widget, origin session completion, `--main` context 계승이 사라져 과거 Direct Refiner 실패를 반복한다.
