---
title: Study Hard worker는 유연하게 생성하고 extension coordinator가 엄격하게 적용한다
tags:
  - study-hard
  - subagent
  - worker
  - three-way-merge
  - optimistic-concurrency
  - glimpse
  - attachment
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
  - user-direction:2026-07-25-completion-transcript-before-final-response
  - user-direction:2026-08-04-study-hard-worker-attachment-import
  - user-direction:2026-08-05-understanding-answer-disclosure
reviewed_at: 2026-09-01
reviewed_commit: 20ea93e
related:
  - parallel-workflow-analysis-single-writer
  - study-hard-public-engine-private-publisher
  - subagent-prompt-specificity
  - learning-note-companion-artifact
  - workflow-guard-enforced-flow
  - question-ui-execution-owner-routing
---

## Judgment

Study Hard Glimpse 입력은 메인 session lineage의 다른 입구다. 질문·답변·결정은 P0 lineage에 귀속하고, 질문은 먼저 owner Pi가 현재 board 문맥으로 닫히는 direct 답변인지 독립 조사·노트 변경이 필요한 worker 작업인지 의미적으로 route한다. P0 전체 transcript를 worker 입력으로 복제하지 않으며, worker가 선택된 뒤의 launch·정상 completion apply는 P0의 수동 subagent 호출이 아니라 extension coordinator의 표준 `study-hard-worker --isolated` dispatcher와 callback이 소유한다. 공통 owner 전이와 terminal 불변식은 [질문 UI와 실행 owner는 분리한다](./question-ui-execution-owner-routing.md)를 따른다.

lineage의 영구 기록, 사용자에게 보이는 카드, 모델 context 전달을 분리한다. `appendEntry`가 durable SSOT와 즉시 표시할 custom entry를 만들고, entry renderer가 현재 완료 흐름 안에서 카드를 보여준다. 모델용 복사본만 `display:false + nextTurn`으로 전달한다. 따라서 여러 완료 카드가 있어도 assistant 응답을 카드 사이에서 반복하지 않고, 다음 사용자 질문 시점에 과거 카드가 뒤늦게 나타나지도 않는다.

worker의 생성 범위를 선택 블록에 하드 제한하지 않는다. 선택 블록은 작업의 초점이며, 사용자 의도를 닫는 데 필요하면 주변 블록·다른 섹션·표·callout·Mermaid·visual·순서까지 함께 제안할 수 있다. 자유로운 생성과 안전한 동시 적용은 같은 문제가 아니다. worker는 전체 `proposedNoteDocument`를 result artifact에 만들지만 state를 직접 쓰지 않는다. extension coordinator가 `base / proposed / current`를 비교하고 충돌 없는 변경만 적용한다.

## Dispatch Rule

```text
Glimpse learner input
├─ learner question을 메인 session transcript에 기록
└─ owner Pi가 의미적으로 route
   ├─ direct → 현재 board/source 확인 → drawer 답변
   └─ worker → extension event bus로 표준 subagent dispatcher 호출
      → subagent run study-hard-worker --isolated
      → 표준 #N widget
      → completion callback
      → artifact 검증 + strict 3-way apply
      → worker 답변·노트 반영을 메인 session transcript에 기록
```

- 별도 `pi -p --no-session` runner를 만들지 않는다.
- 기존 isolated Tutor/Editor runner로 돌아가지 않는다.
- `--isolated`는 P0의 긴 transcript를 복제하지 않는다. worker가 필요한 학습 맥락은 dispatcher task와 `statePath`의 최신 board state로 전달한다.
- worker model은 Sol을 primary로 사용하고 실패 시 Terra, 그다음 Spark 순서로 fallback한다. provider 오류가 persisted session fallback으로 감지돼도 실제 `errorMessage`를 retry 판정에 보존한다.
- P0 hidden request는 direct/worker의 의미 route까지만 소유한다. worker가 선택된 뒤 launch·정상 apply를 위해 P0가 다시 subagent tool을 수동 호출할 때까지 기다리지 않는다.
- subagent start/completion과 Study Hard 질문·답변은 `appendEntry`로 origin session에 즉시 durable하게 기록한다.
- 새 durable entry에는 명시적 display flag를 넣고 entry renderer로 즉시 보여준다. 과거 entry에는 이 flag가 없으므로 업데이트 뒤 오래된 카드가 중복 노출되지 않는다.
- 모델 context용 custom message는 `display:false + nextTurn`으로 전달한다. 화면에는 나타나지 않지만 다음 사용자 turn의 모델이 lineage를 이어받는다.
- 실행 중인 P0는 현재 tool result를 근거로 visible 카드 뒤에 마지막 완료 답변을 이어간다. 여러 카드 각각이 별도 P0 assistant turn을 만들지 않는다.
- 두 번째 merge conflict처럼 실제 판단이 필요한 예외만 P0 turn으로 올린다.
- worker stdout에는 전체 note JSON을 넣지 않고 artifact path와 짧은 summary만 둔다.

## Artifact Write Boundary

`workerResultPath`에 result artifact를 생성하는 일은 worker의 정상 완료 조건입니다. 이 파일은 canonical Study Hard state나 제품 코드를 직접 바꾸지 않는 sidecar이므로, 요청 문장에 “설명”, “왜”, “제품 코드는 수정하지 마세요”가 포함됐다는 이유로 read-only mutation block을 적용하면 안 됩니다.

Worker는 지정된 result path만 쓰고 canonical state는 직접 수정하지 않습니다. 현재 panel에 제품 Work Context가 있더라도 그 card의 repository 밖에 있는 worker artifact까지 제품 slice scope로 막지 않습니다. 생성 이후의 schema 검증, base/proposed/current merge, conflict와 rebase 판정은 기존 strict apply coordinator가 담당합니다. 일반 mutation을 soft-guided로 다루는 판단은 [반복 워크플로 실패는 guard/flow로 고정한다](./workflow-guard-enforced-flow.md)의 File Mutation Rule을 따릅니다.

## Attachment Import Boundary

노트의 image block이 로컬 `path`만 참조하면 WebView는 보안상 해당 파일을 직접 렌더링할 수 없습니다. worker가 state나 attachment 저장소를 직접 수정하는 방식으로 해결하지 않고, result artifact의 `attachmentImports` manifest로 import 의도만 제안합니다.

- `sourcePath`는 최신 Board가 이미 image path 또는 attachment path로 참조 중인 정확한 파일만 허용합니다.
- worker가 새 local `image.path`를 노트에 심어 다음 질문에서 신뢰 경로로 승격시키지 못하도록 merged note의 local path도 current state와 대조합니다.
- worker는 proposed image block을 같은 `attachmentId`에 연결하고 임의 로컬 경로를 탐색·추가하지 않습니다.
- coordinator는 확장자와 실제 PNG/JPEG/GIF/WebP signature, 10MB 제한, target block, 중복 ID, 파일 hash를 검증합니다.
- note merge가 성공한 뒤 run 전용 attachment 디렉터리로 복사하고 `noteDocument + attachments + question 상태`를 한 revision에 저장합니다.
- 여러 파일 중간 import가 실패하면 그 apply에서 새로 복사한 파일을 rollback합니다.
- 같은 artifact가 다시 전달되면 question hash와 attachment ID로 중복 등록하지 않습니다.

따라서 worker의 자유는 “어떤 그림이 학습 설명에 필요하다”를 제안하는 데 있고, 로컬 파일 접근·복사·공개 URL 발급은 신뢰 경계인 coordinator가 소유합니다.

## Flexible Generation Rule

worker는 다음을 할 수 있다.

- 한 블록을 여러 블록으로 분할하거나 여러 블록을 병합
- 필요한 주변 설명과 다른 섹션의 중복·용어를 함께 정리
- paragraph, table, callout, code, Mermaid, visual 구조를 변경
- 블록·섹션을 삽입·삭제·이동·재배열
- 설명만 필요하면 note를 바꾸지 않고 feedback만 반환

제약은 “선택 블록 밖 수정 금지”가 아니라 “사용자 요청에 필요하지 않은 취향 개선 금지”다. 생성 모델의 범위를 줄여 충돌을 피하려 하지 않고, 실제 diff를 적용 단계에서 검사한다.

## Understanding Answer Disclosure Rule

학습 노트의 `이해 확인`·복습 문항은 정답을 먼저 노출하는 요약 목록이 아니라, 사용자가 질문을 읽고 자기 말로 답한 뒤 비교할 수 있는 retrieval practice surface입니다.

- 섹션 첫머리에 `tone: info`로 “먼저 내 말로 답한 뒤 펼쳐서 확인” 안내를 펼친 상태로 둡니다.
- 각 문항은 기존 `callout` block에 `tone: question`과 `presentation: { container: details, defaultOpen: false }`를 사용합니다.
- `title`은 질문, `body`는 핵심 답·이유·필요한 예시입니다. 근거가 부족하면 억지 정답 대신 근거 공백을 표시합니다.
- 접기 UI를 얻기 위해 `visual`을 사용하지 않습니다. `visual`은 관계·구조·흐름 자체를 그림으로 봐야 이해가 닫힐 때만 사용합니다.
- Architecture visual의 공통 glossary인 `PK/FK`, `source-of-truth`, `legacy`는 실제 데이터 구조와 관련될 때만 노출합니다. 이해 확인 답안과 무관한 고정 장식으로 붙이면 안 됩니다.
- 과거 worker가 `reflection`의 이해 확인 문항을 `visual.presentation.container=details`로 만든 경우, Study Hard load boundary가 이를 callout disclosure로 정규화해 architecture iframe과 무관한 glossary를 제거합니다.
- Notion처럼 disclosure UI를 지원하지 않는 downstream은 같은 `callout` 내용을 펼친 상태로 보존해 답안 유실을 막습니다. 다시 import할 때 `presentation`이 사라져도 이해 확인 섹션의 `tone: question`이며 물음표로 끝나는 실제 문항은 disclosure를 복구하고, 안내 callout은 펼친 상태로 유지합니다.

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
- attachment import → 최신 state의 신뢰 경로와 proposed image attachmentId가 일치할 때만 복사·연결

첫 conflict는 completion callback에서 같은 subagent run을 최신 note 기준으로 한 번 `continue`하여 rebase한다. 다시 충돌하면 Glimpse를 즉시 `conflict`로 갱신하고 silent overwrite하지 않습니다. 사용자는 같은 block merge editor에서 section별 `기존 Study Hard` / `변경될 Study Hard` / `직접 정리`를 선택합니다. 직접 정리는 Markdown으로 평탄화하지 않고 기존 block type·id·순서를 유지한 채 내부 텍스트만 수정하며, 충돌 없는 3-way merge 결과는 함께 보존됩니다. completion 재전달은 artifact hash로 멱등 처리합니다.

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
- custom runner를 만들면 표준 #N widget과 origin session completion이 사라져 과거 Direct Refiner 실패를 반복한다. 격리는 표준 dispatcher의 `--isolated` mode로 유지한다.
- P0 hidden follow-up이 semantic route를 넘어 worker launch·completion apply까지 수동 소유하면 P0의 긴 구현 turn 뒤에서 head-of-line blocking이 생긴다. route 이후 worker lifecycle은 coordinator가 맡아야 한다.
- `followUp + triggerTurn:false`는 현재 P0가 완전히 끝난 뒤 전달되므로 완료 카드가 마지막 답변 뒤에 붙거나 별도 follow-up queue를 소비할 수 있다.
- visible `nextTurn`은 이미 끝난 완료 카드를 다음의 무관한 사용자 질문 시점에 노출해 대화 경계를 흐린다.
- 완료 카드마다 `steer`를 보내면 Pi가 steering message를 하나씩 소비해 `카드 → assistant 응답 → 카드 → assistant 응답`처럼 완료 답변이 반복될 수 있다.
- custom entry만 쓰면 모델 context가 끊기고, context message만 쓰면 표시 시점이나 assistant turn을 제어하기 어렵다. durable visible entry와 hidden `nextTurn` context 복사본을 함께 두되 역할을 섞지 않는다.
- P0를 lineage SSOT에서 제거하면 작업과 학습의 결정 연결이 끊긴다. 따라서 lineage 귀속, 화면 표시, LLM turn gating을 분리해야 한다.
- worker가 로컬 path를 직접 URL로 넣거나 coordinator가 임의 sourcePath를 믿으면 WebView 표시 실패를 숨기거나 로컬 파일 노출 경계를 넓힐 수 있다.
- attachment만 등록하고 image block을 `attachmentId`로 연결하지 않으면 파일은 존재해도 학습 노트에는 계속 표시되지 않는다.
