---
name: human-pr-review
description: GitHub PR을 읽기 전용으로 검토해 exact diff evidence에 연결된 코드·리뷰 초안·설명·LLM 재발 방지 메타 관점 카드를 만든다. pilee `/pr-review <PR URL>` extension이 내부에서 인라인 로드하는 전용 workflow다. GitHub 댓글 게시, 코드 수정, Issue 생성은 하지 않는다.
disable-model-invocation: true
---

# Human PR Review

`/pr-review <PR URL>`이 캡처한 immutable diff를 먼저 독립적으로 검토하고, 각 리뷰 포인트를 사람이 채택·수정·폐기할 수 있는 카드로 만든다.

## 핵심 경계

- 읽기 전용이다. checkout, 코드 수정, commit, push, GitHub review 게시, thread resolve를 하지 않는다.
- 현재 PR을 이해하기 전에 과거 사례를 먼저 보지 않는다. 인간 리뷰 corpus는 blind finding 뒤의 검증·보강 근거다.
- 모든 카드는 현재 source bundle의 `D...` evidence에 연결한다. agent가 코드 블록을 다시 작성하지 않는다.
- 리뷰가 없다는 결과는 가능하다. `no finding`을 승인이나 안전 보장으로 표현하지 않는다.
- 다른 작업자의 agent trace가 없으면 skill·guide를 사용하지 않았다고 단정하지 않는다.

## Workflow

### 1. run 상태를 읽는다

`pr_review_run` tool을 사용한다.

```json
{"action":"status","runId":"<run-id>"}
```

PR 목적, base/head SHA, 파일·chunk 수, 아직 읽지 않은 chunk를 확인한다.

### 2. 모든 diff chunk를 읽는다

```json
{"action":"inspect","runId":"<run-id>","chunkId":"C001"}
```

마지막 chunk까지 읽기 전에 최종 finding을 고정하지 않는다. 큰 literal·generated 후보도 실제 owner·consumer·side effect를 확인한 뒤 판단한다.

필요하면 head SHA 기준으로 주변 정의·호출자·테스트를 읽는다. 현재 local working tree가 PR head라고 가정하지 않는다.

- GitHub blob/API 또는 `git show <headSha>:<path>`를 우선한다.
- 기존 review thread가 확인되면 같은 지적을 중복 카드로 만들지 않는다.
- PR 설명의 완료 주장과 실제 diff·CI·검증 근거를 분리한다.

### 3. blind review 후보를 만든다

이 단계에서는 인간 리뷰 corpus를 사용하지 않는다.

각 후보는 다음을 갖는다.

- exact file과 `D...` evidence
- 어떤 조건에서 어떤 문제가 발생하는지
- 사용자·도메인·API·운영 계약에 미치는 영향
- 바로 사용할 수 있는 작성자-facing 리뷰 초안
- `required | question | optional` 강도
- `high | medium | low` confidence

다음은 버린다.

- 구체적인 발생 조건이 없는 가능성 나열
- 현재 diff에 근거가 없는 과거 사례 복제
- 이미 타입·테스트로 닫힌 문제
- correctness처럼 표현한 개인 취향
- 같은 원인의 중복 코멘트

### 4. 인간 리뷰 precedent로 검증·보강한다

`pr_review_run`이 corpus search를 지원하면 blind 후보 뒤에만 검색한다.

- supporting precedent는 영향 반경·설명을 보강한다.
- contrasting precedent는 과잉 일반화를 줄인다.
- 검색 결과만으로 새 finding을 확정하지 않는다. 현재 diff에서 독립 증거를 다시 찾아야 한다.
- 원본 링크, 닮은 점, 현재 PR과 다른 점을 card precedent에 남긴다.

Corpus가 없거나 검색을 지원하지 않으면 blind review를 계속하고 precedent를 비워 둔다.

### 5. 각 finding에 메타 관점을 덧붙인다

메타 관점은 일반 리뷰를 대체하지 않는다. 구체적인 리뷰 포인트에 아래 질문을 추가한다.

1. **기존 가드** — 관련 skill·guide·lint·test가 있는가? 사용 증거가 없으면 확인 질문으로 쓴다.
2. **구조적 방지** — 타입, API, 도메인 함수, 책임 경계로 같은 패턴을 만들기 어렵게 할 수 있는가?
3. **기계적 방지** — lint warning, focused test, type error, CI로 정확히 잡을 수 있는가?
4. **범위** — current PR, follow-up, both, none 중 어디인가?

반복 근거나 정확한 대체 행동이 없으면 메타 summary에 `별도 시스템 개선까지 일반화할 근거가 부족해 이번 리뷰로 닫는다`고 명시하고 `scope: none`으로 둔다.

### 6. ReviewCard를 제출한다

[카드 계약](references/review-card-contract.md)을 따른다.

```json
{
  "action": "submit",
  "runId": "<run-id>",
  "cards": []
}
```

제출 전 모든 chunk가 inspected 상태여야 한다. 근거가 없는 카드를 만들기 위해 coverage 기준을 낮추지 않는다.

## 완료 응답

- 대상 PR과 head SHA
- 전체/일부 검토 범위
- 최종 카드 수
- corpus 사용 여부와 coverage gap
- 생성된 review artifact 경로

GitHub에 게시했다고 말하지 않는다. 사용자가 별도로 게시를 요청하더라도 이 workflow는 초안까지만 만들고, 외부 write workflow의 명시적 승인 Gate로 넘긴다.
