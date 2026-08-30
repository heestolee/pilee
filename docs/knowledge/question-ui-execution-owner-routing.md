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
  - review:2026-08-30-question-owner-race-invariants
reviewed_at: 2026-08-30
reviewed_commit: 5ad8414936162ebbf868be6f7624416a3cbb01a2
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
- Meta Review: 선택 line·hunk·card의 좁은 질문은 exact PR checkout session이 direct로 답합니다. 전체 PR 재분석이나 독립 검증 축이 실제로 생기면 worker로 승격합니다. 애매하면 기존 direct 성격을 유지합니다.

사용자에게 `direct / worker` 선택 control을 보여주지 않습니다. UI에는 `답변 경로 확인 → 현재 Pi 확인 → worker 전환/실행 → 완료/실패/stale`처럼 현재 상태만 자연스럽게 표시합니다.

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
- worker가 시작된 뒤 direct로 되돌리지 않습니다. generic state patch나 늦은 direct completion도 worker 소유권을 바꿀 수 없습니다.
- `answered / failed / stale`는 terminal입니다. 늦은 answer, fail, worker completion은 기존 결과를 덮어쓰지 않습니다.
- status, execution phase, answer/error는 한 append-only snapshot으로 전환합니다. 부분 snapshot을 먼저 쓰고 다음 전이에서 실패하는 구조를 만들지 않습니다.

## Launch and Recovery Rule

worker route를 state에 저장한 사실과 실제 worker start acknowledgement는 다릅니다. `worker-starting` 또는 `escalating`인데 `workerRunId`가 없으면 같은 deterministic request를 재전송할 수 있어야 합니다. 표준 dispatcher는 동일 request ID를 중복 실행하지 않고, `worker_started` 이후에는 route 재호출이 새 worker를 만들지 않습니다.

Programmatic dispatcher가 없는 legacy runtime은 hidden P0 fallback을 남기되 같은 question, artifact path, source pin을 유지합니다. fallback apply도 route 시점 pin을 명시적으로 전달해야 합니다.

## Transcript Boundary

사용자 대화와 내부 control envelope를 분리합니다.

- 질문·답변·실패/stale: owner Pi lineage에 `display:true`로 기록합니다.
- run path, tool action, worker result path, dispatch 규칙: `display:false` control message로만 전달합니다.
- event key를 question state에 보존해 reload·retry·중복 completion에서 같은 visible 대화를 다시 만들지 않습니다.
- visible lineage는 사용자가 “아까 질문 drawer에서 무슨 대화를 했나”라고 물을 때 현재 session이 답할 수 있는 기록입니다. 영구 canonical은 Study Hard state 또는 Meta Review `questions.jsonl`입니다.

## Worker Trust Boundary

Worker output은 답변 근거가 아니라 검증 대상입니다.

- worker는 지정된 run-local result artifact만 제안하고 canonical state를 직접 바꾸지 않습니다.
- coordinator는 result path, run/question identity, schema, source hash, checkout head를 검사합니다.
- source hash는 mutable artifact를 자기비교하지 않고 route 시점에 pin합니다.
- 적용 직전 GitHub PR은 clean checkout, remote head, remote diff를 다시 확인하고 current-work는 base 대비 tracked·untracked diff를 다시 계산합니다.
- HEAD가 같아도 diff가 바뀌면 `stale`로 끝내며 답변을 visible transcript에 publish하지 않습니다.

## Failure Modes

- UI를 공유한다는 이유로 executor까지 하나로 고정하면 짧은 clarification은 worker handoff 비용을 내고, 넓은 조사는 owner session을 오래 점유합니다.
- 글자 수·파일 수로 route하면 짧지만 외부 검증이 필요한 질문과 길지만 현재 문맥으로 닫히는 질문을 반대로 분류합니다.
- worker state 저장 뒤 launch acknowledgement를 구분하지 않으면 interrupted launch가 영구 `worker-starting`에 머뭅니다.
- terminal status와 execution phase를 별도 snapshot으로 쓰면 늦은 callback이 `status=answered, execution=failed` 같은 모순을 만듭니다.
- generic update가 question execution을 덮을 수 있으면 worker→direct 역전과 terminal reopen을 우회할 수 있습니다.
- artifact의 source hash를 같은 mutable `source.json`과만 비교하거나 HEAD만 확인하면 working diff가 바뀐 stale 답변을 승인할 수 있습니다.
- 내부 dispatch prompt를 `display:true`로 노출하면 사용자 대화가 run path와 tool 지침으로 오염됩니다.

## Review Trigger

다음 변화가 생기면 이 판단을 다시 검토합니다.

- 세 번째 질문 surface가 같은 runtime에 연결될 때
- route 판단을 별도 classifier/model로 옮길 때
- worker retry·cancel·timeout UI를 추가할 때
- Meta Review source capture 방식이나 review worktree freshness 계약이 바뀔 때
- Pi custom lineage entry의 display/context 동작이 바뀔 때
