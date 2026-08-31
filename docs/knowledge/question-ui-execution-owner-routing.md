---
title: 질문 UI와 실행 owner는 분리한다
tags:
  - question-runtime
  - orchestration
  - direct
  - worker
  - study-hard
  - meta-review
  - transcript
category: architecture
status: active
confidence: high
applies_to:
  - extensions/questions
  - extensions/study-hard
  - extensions/pr-review
  - extensions/subagent
  - agents/study-hard-worker.md
  - agents/meta-review-question-worker.md
source:
  - user-direction:2026-08-30-question-execution-owner-routing
  - user-direction:2026-08-30-meta-review-question-attachments
  - user-direction:2026-08-30-meta-review-section-and-semantic-unit-selection
  - user-direction:2026-08-30-meta-review-declaration-range-navigation
  - user-direction:2026-08-30-meaning-and-structure-question-separation
  - review:2026-08-30-question-owner-race-invariants
  - user-direction:2026-08-30-study-hard-question-drawer-overlay
  - user-direction:2026-08-31-meta-review-study-hard-worker-lifecycle-parity
reviewed_at: 2026-08-31
reviewed_commit: 9d3e5cb
related:
  - study-hard-worker-flexible-generation-strict-apply
  - human-pr-review-precedent-harness
  - ai-worker-readiness-orchestrator
  - parallel-workflow-analysis-single-writer
  - subagent-prompt-specificity
---

## Judgment

사용자가 보는 질문 UI와 실제 답변 실행 owner는 같은 결정이 아닙니다. Study Hard와 Meta Review는 검증된 오른쪽 drawer, 전체/선택 scope, 대화 bubble, composer를 공유하지만 모든 질문을 같은 executor에 보내지는 않습니다.

질문은 먼저 `routing` 상태로 owner Pi에 전달합니다. 현재 board·selection·이미 연결된 source만으로 답이 닫히면 owner session이 `direct`로 답하고, 외부 조사·실행 검증·여러 독립 경로 비교·canonical 변경안이 필요하면 격리 worker가 맡습니다. 글자 수, 파일 수, 특정 단어, 정규식 같은 고정 임계값은 실제 work graph를 대신하지 못하므로 route 근거로 사용하지 않습니다.

## Surface Default

두 surface는 공통 state machine을 쓰되 기존 사용 성격에 맞는 애매한 경우의 기본값을 유지합니다.

- Study Hard: 현재 학습 문맥만으로 닫히는 설명은 direct, 학습 노트 변경·외부 조사·실행 검증은 worker입니다. 애매하면 기존 안전 경계와 호환되도록 worker를 택합니다.
- Meta Review: 선택 section·line·hunk·card의 좁은 질문은 exact PR checkout session이 direct로 답합니다. 전체 PR 재분석이나 독립 검증 축이 실제로 생기면 worker로 승격합니다. 애매하면 기존 direct 성격을 유지합니다.

사용자에게 `direct / worker` 선택 control을 보여주지 않습니다. UI에는 `답변 경로 확인 → 현재 Pi 확인 → worker 전환/실행 → 완료/실패/stale`처럼 현재 상태만 자연스럽게 표시합니다.

## Drawer Layout Boundary

질문 drawer는 학습노트 canonical을 설명·질문하는 보조 surface이지 본문의 layout owner가 아닙니다. 학습노트에서는 drawer를 오른쪽 overlay로 열고, open/close 동안 `noteBody` padding, `noteDocument` max-width·margin, reference grid geometry와 scroll position을 바꾸지 않습니다. 코드 리뷰처럼 drawer와 본문을 동시에 지속적으로 읽어야 하는 별도 surface만 명시적으로 공간을 예약할 수 있습니다.

Layout property를 애니메이션하면서 child grid를 재배치하면 WKWebView compositor가 이전 rounded border 위치를 paint fragment로 남길 수 있습니다. 따라서 drawer animation은 drawer 자신의 transform에만 두고, 학습노트 본문은 같은 geometry를 유지합니다. 회귀 검증은 반복 open/close 전후의 note/card rect와 pixel diff를 함께 비교합니다.

## One-Way Ownership Rule

```text
routing
├─ direct answering ───────────────→ answered
│                └─ scope expanded → escalating → worker-starting
└─ worker-starting → worker-running ─────────────→ answered
                                      ├───────────→ failed
                                      └───────────→ stale
```

- `direct → worker`만 허용합니다. direct 조사 중 새 독립 작업 축이 발견됐을 때 같은 question ID로 한 번 승격합니다.
- worker가 시작된 뒤 direct로 되돌리지 않습니다. generic state patch는 current canonical의 owner-protected question card와 기존 질문 순서를 그대로 보존하고, patch 배열의 누락·역순·중복 ID를 삭제·재정렬·복제로 해석하지 않습니다.
- `answered / failed / stale`는 terminal입니다. 늦은 answer, fail, worker completion과 중복 direct response는 기존 결과를 덮어쓰거나 processing 상태를 되살리지 않습니다.
- status, execution phase, answer/error는 한 append-only snapshot으로 전환합니다. 부분 snapshot을 먼저 쓰고 다음 전이에서 실패하는 구조를 만들지 않습니다.

## Launch and Recovery Rule

worker route를 state에 저장한 사실과 실제 worker launch claim은 다릅니다. coordinator는 random reservation token, route pin, trusted question snapshot을 process-global active launch lease에 함께 보관해 extension reload 뒤에도 기존 callback ownership을 유지합니다. 표준 dispatcher와 legacy fallback 모두 token compare-and-set에 성공한 한 실행만 launch하며, claim 전 route 재호출도 같은 active lease에서 새 dispatch를 만들지 않습니다.

Programmatic dispatcher가 없는 legacy runtime은 hidden P0 fallback을 한 번만 남깁니다. P0는 `worker_started(reservationToken)` 응답의 `claimed=true`일 때만 worker를 실행하고, false면 tool이 turn을 종료합니다. claim 승자에게만 별도 completion capability를 발급하고 provider-visible tool `content`로 전달하며, started/apply/fail은 이 capability를 요구합니다. renderer 전용 `details`만으로 capability를 전달했다고 간주하지 않습니다. 전달되지 않은 unclaimed fallback은 lease가 만료된 뒤 새 reservation token으로만 재예약할 수 있습니다.

## Selection Provenance

선택 UI는 보이는 label만 넘기지 않고 server가 다시 검증할 provenance를 전송합니다.

- `session`: 선택 context를 함께 보낼 수 없는 전체 PR 범위입니다.
- `section`: `overview`, `relationships`처럼 server allowlist에 있는 상단 문서 section만 허용합니다. 임의 section ID나 file/card/evidence 혼합은 거부합니다.
- `meaning`: canonical `document.meanings[]`의 실제 meaning ID와 전체 evidence가 일치해야 합니다. 임의 의미 ID나 일부 evidence는 거부합니다.
- `declaration`: captured before/after source의 실제 구조 ID, side, file, 전체 changed evidence가 모두 일치해야 합니다. 일부 evidence, 임의 range, 존재하지 않는 side는 거부합니다.
- `file | card | evidence`: captured source의 실제 file, ReviewCard, line/hunk evidence와 일치해야 합니다.
- source snapshot이 있으면 changed row는 가장 작은 statement 또는 declaration-owned block을 선택합니다. 상위·하위 범위와 before/after 전환은 같은 captured tree 안에서만 이동하고 inline toolbar는 클릭한 row 옆에 남습니다. Snapshot이 없을 때만 hunk → line fallback을 사용합니다.

Direct와 worker는 동일한 `scope`, `sectionId`, meaning ID, declaration ID/side 또는 file/card/evidence와 selection kind/id를 받습니다. 의미를 구조 질문으로, 구조를 hunk/한 줄 evidence로 강등하지 않습니다.

## Transcript Boundary

사용자 대화와 내부 control envelope를 분리합니다.

- 질문·답변·실패/stale: owner Pi lineage에 `display:true`로 기록합니다.
- run path, tool action, worker result path, dispatch 규칙: `display:false` control message로만 전달합니다.
- event key를 question state에 보존해 reload·retry·중복 completion에서 같은 visible 대화를 다시 만들지 않습니다.
- visible lineage는 사용자가 “아까 질문 drawer에서 무슨 대화를 했나”라고 물을 때 현재 session이 답할 수 있는 기록입니다. 영구 canonical은 Study Hard state 또는 Meta Review `questions.jsonl`입니다.

## Attachment Boundary

Study Hard와 Meta Review 질문 composer는 이미지 붙여넣기 계약도 공유합니다. 입력창의 이미지 `⌘V`, preview, 전송 전 제거, 질문당 최대 4장 제한을 동일하게 유지합니다. 질문이 server에 수락된 뒤에는 문구와 첨부 draft를 함께 비우고, 전송 실패 시에는 둘 다 보존해 재시도할 수 있어야 합니다.

이미지 byte와 data URL은 Study Hard의 run-local attachment store에만 둡니다. Meta Review `questions.jsonl`에는 attachment ID와 검증된 `{ name, mimeType, path, url }` provenance만 고정하며 visible transcript, routing control message, worker task에 raw image를 복제하지 않습니다. 질문에 연결되기 전 draft attachment는 제거할 수 있지만, 질문 canonical에 연결된 파일은 답변·재시도·worker 승격이 끝날 때까지 제거하지 않습니다.

Direct owner와 worker는 같은 pinned provenance를 받습니다. 이미지가 있다는 사실만으로 worker를 선택하지 않고, 현재 review source와 첨부만으로 답이 닫히는지는 기존 work-shape routing 기준으로 판단합니다. 따라서 첨부 없는 기존 질문 payload와 direct→worker one-way ownership 계약은 달라지지 않습니다.

## Worker Trust Boundary

Worker output은 답변 근거가 아니라 검증 대상입니다.

- worker는 지정된 run-local result artifact만 제안하고 canonical state를 직접 바꾸지 않습니다.
- coordinator는 result path, run/question identity, schema, route 시점 source/head pin을 검사합니다.
- source hash는 mutable artifact나 worker가 쓸 수 있는 `questions.jsonl`을 trust anchor로 삼지 않고 route 시점의 coordinator launch lease에 pin합니다. Meta Review question 전체 canonical은 process-global coordinator registry가 소유합니다. worker가 다른 question/Q999 snapshot을 추가하거나 JSONL을 truncate해도 전체 파일 불일치를 감지하고 trusted canonical + active failed snapshot으로 복구합니다.
- GitHub PR worker에서 current panel `ctx.cwd`는 실행 위치일 뿐 review truth가 아닙니다. `sourcePath`의 immutable evidence를 우선하고 추가 source는 `repository + expectedHeadSha`를 지정한 remote API 또는 pinned git object로 읽습니다. `expectedSourceSha256`는 `source.json` 파일 바이트 hash가 아니라 JSON의 `sourceSha256` 필드이자 normalized `source.diff` identity입니다.
- 적용 직전 GitHub PR 질문은 저장된 immutable `source.diff`와 `source.json.sourceSha256`가 route pin과 같은지 검증합니다. PR 최신 head 변화는 별도 freshness badge와 명시적 새 run refresh가 담당하며, 기존 run에 달린 질문은 그 revision에 귀속합니다.
- current-work 질문만 captured root의 현재 HEAD와 base 대비 tracked·untracked diff를 다시 계산합니다. 관찰된 head/hash/root/diff가 pin과 다를 때 `stale`로 끝냅니다.

## Failure Modes

- UI를 공유한다는 이유로 executor까지 하나로 고정하면 짧은 clarification은 worker handoff 비용을 내고, 넓은 조사는 owner session을 오래 점유합니다.
- 글자 수·파일 수로 route하면 짧지만 외부 검증이 필요한 질문과 길지만 현재 문맥으로 닫히는 질문을 반대로 분류합니다.
- worker state 저장 뒤 launch acknowledgement를 구분하지 않으면 interrupted launch가 영구 `worker-starting`에 머뭅니다.
- terminal status와 execution phase를 별도 snapshot으로 쓰면 늦은 callback이 `status=answered, execution=failed` 같은 모순을 만듭니다.
- 질문 drawer를 열 때 학습노트 padding과 max-width를 함께 바꾸면 auto-fit grid가 반복 reflow되고, 닫힌 뒤 이전 card border가 균열처럼 남을 수 있습니다. Drawer만 transform하고 note geometry는 고정합니다.
- generic update가 question execution을 덮거나 patch 누락·역순·중복을 chronology 변경으로 해석하면 worker→direct 역전, terminal reopen, callback 대상 소실, 잘못된 active question 선택을 만들 수 있습니다.
- worker-writable question snapshot이나 artifact를 source pin으로 다시 읽거나 active ID 하나만 검사하면 prompt injection이 다른 질문과 durable log를 forge할 수 있습니다. reservation token을 completion 권한으로 재사용하면 claim 패자도 canonical을 종료할 수 있습니다. 반대로 GitHub PR 질문을 current panel HEAD나 live PR 최신 상태에 묶으면 immutable run 질문이 panel 이동·후속 push만으로 실패하고, normalized diff identity를 `source.json` 파일 바이트 hash로 오해하면 valid artifact도 생성되지 않습니다. current-work에서는 반대로 live diff 재계산을 빼면 stale 답변을 승인합니다.
- 내부 dispatch prompt를 `display:true`로 노출하면 사용자 대화가 run path와 tool 지침으로 오염됩니다.
- 상단 문서 section을 session으로 저장하거나 구조 선택을 hunk/line으로 저장하면 사용자가 고른 연속 source 범위와 canonical 질문 범위가 달라집니다.
- 변경 의미를 관련 구조 단위 하나의 질문으로 저장하면 다대다 계약 전환의 일부 evidence만 조사하게 됩니다.
- Parent/child UI가 client에서 임의 range를 만들고 server가 declaration ID·side·전체 evidence를 재검증하지 않으면 source 일부만으로 더 넓은 범위를 주장할 수 있습니다.

## Review Trigger

다음 변화가 생기면 이 판단을 다시 검토합니다.

- 세 번째 질문 surface가 같은 runtime에 연결될 때
- route 판단을 별도 classifier/model로 옮길 때
- worker retry·cancel·timeout UI를 추가할 때
- Meta Review source capture 방식이나 review worktree freshness 계약이 바뀔 때
- Pi custom lineage entry의 display/context 동작이 바뀔 때
