---
title: Study Hard worker는 유연하게 생성하고 extension coordinator가 엄격하게 적용한다
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
  - user-direction:2026-07-23-main-lineage-without-p0-turn-gate
reviewed_at: 2026-07-24
reviewed_commit: c66306f73f53227c863dc8ed61fc7d33aa096c38
related:
  - parallel-workflow-analysis-single-writer
  - study-hard-public-engine-private-publisher
  - subagent-prompt-specificity
  - learning-note-companion-artifact
  - workflow-guard-enforced-flow
---

## Judgment

Study Hard Glimpse 입력은 메인 session lineage의 다른 입구다. 질문·답변·결정은 P0 context에 귀속하지만, P0 LLM turn이 worker launch나 정상 completion apply의 gate가 되어서는 안 된다. extension coordinator가 표준 `study-hard-worker --main` subagent dispatcher를 즉시 호출하고 callback으로 결과를 받는다.

worker의 생성 범위를 선택 블록에 하드 제한하지 않는다. 선택 블록은 작업의 초점이며, 사용자 의도를 닫는 데 필요하면 주변 블록·다른 섹션·표·callout·Mermaid·visual·순서까지 함께 제안할 수 있다. 자유로운 생성과 안전한 동시 적용은 같은 문제가 아니다. worker는 전체 `proposedNoteDocument`를 result artifact에 만들지만 state를 직접 쓰지 않는다. extension coordinator가 `base / proposed / current`를 비교하고 충돌 없는 변경만 적용한다.

## Dispatch Rule

```text
Glimpse learner input
├─ learner question을 메인 session transcript에 기록
└─ extension event bus로 표준 subagent dispatcher 즉시 호출
   → subagent run study-hard-worker --main
   → 표준 #N widget
   → completion callback
   → artifact 검증 + strict 3-way apply
   → worker 답변·노트 반영을 메인 session transcript에 기록
```

- 별도 `pi -p --no-session` runner를 만들지 않는다.
- 기존 isolated Tutor/Editor runner로 돌아가지 않는다.
- `--main`은 P0 context snapshot과 session reference를 worker에 제공한다.
- launch·정상 apply를 위해 P0가 hidden request를 읽고 tool을 호출할 때까지 기다리지 않는다.
- subagent start/completion과 Study Hard 질문·답변은 `triggerTurn: false`로 원래 session lineage에 남는다.
- 두 번째 merge conflict처럼 실제 판단이 필요한 예외만 P0 turn으로 올린다.
- worker stdout에는 전체 note JSON을 넣지 않고 artifact path와 짧은 summary만 둔다.

## Artifact Write Boundary

`workerResultPath`에 result artifact를 생성하는 일은 worker의 정상 완료 조건입니다. 이 파일은 canonical Study Hard state나 제품 코드를 직접 바꾸지 않는 sidecar이므로, 요청 문장에 “설명”, “왜”, “제품 코드는 수정하지 마세요”가 포함됐다는 이유로 read-only mutation block을 적용하면 안 됩니다.

Worker는 지정된 result path만 쓰고 canonical state는 직접 수정하지 않습니다. 현재 panel에 제품 Work Context가 있더라도 그 card의 repository 밖에 있는 worker artifact까지 제품 slice scope로 막지 않습니다. 생성 이후의 schema 검증, base/proposed/current merge, conflict와 rebase 판정은 기존 strict apply coordinator가 담당합니다. 일반 mutation을 soft-guided로 다루는 판단은 [반복 워크플로 실패는 guard/flow로 고정한다](./workflow-guard-enforced-flow.md)의 File Mutation Rule을 따릅니다.

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

첫 conflict는 completion callback에서 같은 subagent run을 최신 note 기준으로 한 번 `continue`하여 rebase한다. 다시 충돌하면 Glimpse를 즉시 `conflict`로 갱신하고 silent overwrite하지 않으며, 이 예외만 P0 판단을 요구한다. completion 재전달은 artifact hash로 멱등 처리한다.

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
- P0 hidden follow-up을 launch gate로 사용하면 P0의 긴 구현 turn 뒤에서 head-of-line blocking이 생겨 학습 응답이 작업 종료까지 밀린다.
- P0를 lineage SSOT에서 제거하면 작업과 학습의 결정 연결이 끊긴다. 따라서 lineage 귀속과 LLM turn gating을 분리해야 한다.
