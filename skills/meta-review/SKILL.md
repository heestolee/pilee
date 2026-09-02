---
name: meta-review
description: 현재 세션의 작업 diff 또는 지정한 GitHub PR을 읽기 전용으로 검토해 거의 모든 diff를 학습 가능한 설명으로 풀고, exact evidence에 연결된 리뷰 초안·판단·LLM 재발 방지 메타 관점을 만든다. `/meta-review`는 현재 작업, `/meta-review <PR URL>`은 지정 PR을 source로 삼는다. GitHub 댓글 게시, 코드 수정, Issue 생성은 하지 않는다.
disable-model-invocation: true
---

# Meta Review

`/meta-review`가 캡처한 immutable diff를 먼저 독립적으로 읽고, 모든 변경 파일과 추가·삭제 줄을 semantic explanation hunk로 설명한 뒤 각 실제 리뷰 포인트를 사람이 채택·수정·폐기할 수 있게 만든다.

## Source contract

- 인자 없는 `/meta-review`가 기본 경로다. 현재 세션 worktree의 base→HEAD·staged·unstaged diff와 untracked 파일을 현재 작업 source로 캡처한다.
- `/meta-review <GitHub PR URL>`은 다른 사람의 PR이나 고정된 원격 review source를 명시할 때 사용한다.
- PR 생성 전이라는 이유로 URL을 요구하지 않는다. 현재 작업 diff가 있으면 Meta Review를 시작할 수 있다.
- 두 경로 모두 실행 시점 source를 immutable snapshot으로 고정한 뒤 동일한 설명·리뷰 workflow를 사용한다.

## 핵심 경계

- Meta Review 생성 workflow는 읽기 전용이다. checkout, 코드 수정, commit, push, GitHub review 게시, thread resolve를 하지 않는다. 다만 질문 drawer의 명시적 reviewed-code 변경 요청은 공통 worker coordinator가 pinned patch artifact로 처리한다. GitHub PR도 원본 run은 immutable로 유지한 채 일치하는 clean local review checkout에만 patch를 적용하고 current-work revision으로 전환한다.
- 현재 PR을 이해하기 전에 과거 사례를 먼저 보지 않는다. 인간 리뷰 corpus는 blind finding 뒤의 검증·보강 근거다.
- 모든 설명 hunk와 리뷰 카드는 현재 source bundle의 `D...` evidence에 연결한다. agent가 코드 블록을 다시 작성하지 않는다.
- 모든 변경 파일에 역할·변경 이유·호출/데이터 흐름을 기록하고, 모든 addition/deletion evidence를 정확히 하나의 설명 hunk에 배정한다.
- 중립적인 코드 설명과 실제 review finding, 작성자에게 확인할 정책 질문을 섞지 않는다.
- 리뷰가 없다는 결과는 가능하다. `no finding`을 승인이나 안전 보장으로 표현하지 않는다.
- 다른 작업자의 agent trace가 없으면 skill·guide를 사용하지 않았다고 단정하지 않는다.

## Workflow

### 1. run 상태를 읽는다

`meta_review_run` tool을 사용한다.

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

### 3. 전체 diff 설명을 먼저 만든다

각 파일마다 다음을 기록한다.

- 이 파일이 소유한 책임과 레이어 역할
- 이 변경에서 파일이 수정된 이유
- entry point부터 consumer까지의 호출·데이터 흐름
- 사용자·운영·후속 consumer 영향

모든 추가·삭제 줄은 `E-...` explanation hunk 하나에 포함한다. hunk는 같은 의도의 변경을 설명하고 coverage를 닫는 단위이며, 사용자가 선택하는 source declaration과는 별도 계약이다. 같은 의도의 연속 줄은 한 덩어리로 설명하고, 변경 이유·근거·책임·사용 개념·흐름과 영향·불확실성을 빠뜨리지 않는다. generated/lock/bulk 변경도 source-of-truth와 생성 이유를 파일 또는 hunk 단위로 설명한다.

TS/TSX/JS/JSX source가 capture되면 UI는 parser가 만든 가장 작은 연속 statement 또는 declaration-owned `{}` 범위를 구조 선택 단위로 사용합니다. AST owner가 `변수 | 함수 | 메서드 | class | type | test` label을 결정하고, 코드 길이로 종류를 추정하지 않습니다. 사용자는 선택 위치의 inline toolbar에서 상위·하위 구조와 before/after source로 이동합니다. 기본 diff는 `/diff`처럼 평평하게 유지하고 선택한 범위만 accent로 표시합니다. Parser 미지원·source capture 실패·크기 제한 초과 시에만 semantic hunk → line fallback을 사용합니다.

### 3.5 변경 의미를 구조 선택과 별도로 만든다

변경 의미는 identifier 교체나 인접한 diff가 아니라 여러 코드 delta가 함께 만드는 **계약·책임·흐름의 Before → After 전환**입니다. 구조 선택과 변경 의미는 다대다 관계이며 서로의 boundary를 대신하지 않습니다.

1. 각 구조 단위에서 제거·추가된 symbol, type, payload, 호출, side effect를 fact로 추출합니다.
2. symbol 정의, explicit contract/JSDoc/deprecation, producer-consumer, call-flow, test 근거를 head-pinned source에서 확인합니다.
3. 같은 계약 결과·trigger·producer/consumer·인과 chain을 만드는 fact만 하나의 의미로 연결합니다. 같은 파일·함수·인접 줄이라는 이유만으로 묶지 않습니다.
4. 독립된 결과가 섞이면 분리하고, rename·이동만 확인되면 그 이상을 단정하지 않습니다.
5. 제목은 구현체 이름보다 가장 안정적인 계약 전환으로 씁니다. `A를 B로 변경`보다 `분산된 책임을 공통 lifecycle로 이동`, `암묵적 상태를 명시적 계약으로 전환` 같은 수준을 선택합니다.
6. `high` confidence는 `explicit-contract | definition | producer-consumer | call-flow | test` basis가 하나 이상 있어야 합니다. diff·이름·인접성뿐이면 medium/low로 낮추고 uncertainty를 기록합니다.

각 meaning은 `M-...` ID, title, beforeContract, afterContract, mechanism, impact, changed paths/evidenceIds, basis, confidence를 가집니다. 의미가 없다고 판단되면 억지로 만들지 않고 빈 배열을 제출합니다.

구조·순서가 텍스트만으로 잘 보이지 않는 meaning에는 `visual`을 하나만 추가합니다. Raw Mermaid 문자열은 제출하지 않고 아래 구조화 schema만 사용합니다.

- `flowchart`: 책임·데이터·소유권·계약 구조가 이동할 때 사용합니다. `before`와 `after` group을 모두 두고 node/edge를 연결합니다.
- `sequence`: 호출 순서, 비동기 처리, 실패·재시도·CAS 충돌이 핵심일 때 actor/message 순서로 사용합니다.
- actor가 거의 없거나 단순 값·문구 변경이면 visual을 만들지 않습니다.
- role은 `removed | new | moved | preserved | guard | context`만 사용합니다. 제거는 빨강 점선, 신규는 초록, 책임 이동은 보라, 유지 경계는 파랑, 검증·충돌은 주황, 주변 문맥은 회색으로 렌더링됩니다.
- visual은 title과 `readingHint`를 가지며, 텍스트 Before/After 계약·메커니즘·영향·source basis를 대체하지 않습니다.
- flowchart는 group 2–6, node 2–12, edge 1–20; sequence는 actor 2–8, message 1–16 범위로 압축합니다. 전체 시스템 지도를 inline meaning에 넣지 않습니다.

### 4. blind review 후보를 만든다

이 단계에서는 인간 리뷰 corpus를 사용하지 않는다. 설명 자체를 문제로 표현하지 말고, 실제 correctness·policy·운영 위험만 review 후보로 승격한다.

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

### 5. 인간 리뷰 precedent로 검증·보강한다

`meta_review_run`이 corpus search를 지원하면 blind 후보 뒤에만 검색한다.

- supporting precedent는 영향 반경·설명을 보강한다.
- contrasting precedent는 과잉 일반화를 줄인다.
- 검색 결과만으로 새 finding을 확정하지 않는다. 현재 diff에서 독립 증거를 다시 찾아야 한다.
- 원본 링크, 닮은 점, 현재 PR과 다른 점을 card precedent에 남긴다.

Corpus가 없거나 검색을 지원하지 않으면 blind review를 계속하고 precedent를 비워 둔다.

### 6. 각 finding에 메타 관점을 덧붙인다

메타 관점은 일반 리뷰를 대체하지 않는다. 구체적인 리뷰 포인트에 아래 질문을 추가한다.

1. **기존 가드** — 관련 skill·guide·lint·test가 있는가? 사용 증거가 없으면 확인 질문으로 쓴다.
2. **구조적 방지** — 타입, API, 도메인 함수, 책임 경계로 같은 패턴을 만들기 어렵게 할 수 있는가?
3. **기계적 방지** — lint warning, focused test, type error, CI로 정확히 잡을 수 있는가?
4. **범위** — current PR, follow-up, both, none 중 어디인가?

반복 근거나 정확한 대체 행동이 없으면 메타 summary에 `별도 시스템 개선까지 일반화할 근거가 부족해 이번 리뷰로 닫는다`고 명시하고 `scope: none`으로 둔다.

### 7. 설명과 ReviewCard를 함께 제출한다

[카드 계약](references/review-card-contract.md)을 따른다. 초기·전체 검토에서는 모든 파일 guide를 제출합니다. incremental revision에서는 `meta_review_run refresh`가 unchanged 파일의 guide·card·인간 결정을 최신 evidence로 remap하고 해당 chunk를 auto-inspect하므로, pending chunk와 `impactedPaths`만 다시 조사해 그 파일의 guides/cards를 제출합니다. seeded unchanged 항목은 extension이 병합하며 agent가 다시 작성하지 않습니다.

모든 새 submission에는 `document`를 함께 제출합니다. `overview`는 PR 전체 목적과 검토 초점을 설명하고, `meanings`는 구조 선택과 별개인 source-backed 계약·책임·흐름 전환을 보존하며, `relationships`는 변경 파일 사이의 실제 계약·호출·데이터·검증 관계와 전체 파일의 권장 읽기 순서를 보존합니다. 정적인 레이어·데이터 의존성은 `flowchart`, 시간 순서가 핵심인 런타임 호출은 `sequence`를 선택합니다. 둘을 기계적으로 모두 만들지 않습니다. relation의 `from`/`to`와 reading order의 `path`는 captured diff의 파일 경로만 사용합니다. incremental revision도 현재 파일 집합 기준으로 document 전체를 다시 판단합니다.

작은 complete snapshot은 inline으로 제출한다.

```json
{
  "action": "submit",
  "runId": "<run-id>",
  "document": {
    "overview": {
      "summary": "PR 전체 변경 목적",
      "reviewFocus": "리뷰에서 먼저 확인할 계약과 위험"
    },
    "meanings": [
      {
        "id": "M-explicit-contract",
        "title": "암묵적 상태 허용을 명시적 계약으로 전환",
        "beforeContract": "새 상태가 부정 조건을 통과하면 자동으로 허용될 수 있었습니다.",
        "afterContract": "명시한 상태만 허용됩니다.",
        "mechanism": "producer가 allowlist를 소유하고 consumer가 그 결과를 사용합니다.",
        "impact": "향후 상태 추가가 자동 허용으로 이어지지 않습니다.",
        "paths": ["src/query.ts", "src/ui.tsx"],
        "evidenceIds": ["D000001", "D000002"],
        "basis": [
          { "kind": "producer-consumer", "path": "src/ui.tsx", "line": 42, "summary": "consumer가 policy 결과를 사용합니다." }
        ],
        "confidence": "high",
        "visual": {
          "kind": "flowchart",
          "title": "암묵적 허용에서 명시적 정책으로",
          "readingHint": "빨강 점선은 제거된 조건, 보라는 책임 이동, 초록은 새 계약입니다.",
          "direction": "LR",
          "legend": ["removed", "moved", "new"],
          "groups": [
            { "id": "before", "label": "기존", "phase": "before" },
            { "id": "after", "label": "변경 후", "phase": "after" }
          ],
          "nodes": [
            { "id": "implicit", "label": "부정 조건", "role": "removed", "groupId": "before" },
            { "id": "policy", "label": "Policy owner", "role": "moved", "groupId": "after" },
            { "id": "allowlist", "label": "명시적 allowlist", "role": "new", "groupId": "after" }
          ],
          "edges": [
            { "from": "implicit", "to": "policy", "label": "책임 이동", "role": "moved" },
            { "from": "policy", "to": "allowlist", "label": "정책 생산", "role": "new" }
          ]
        }
      }
    ],
    "relationships": {
      "summary": "변경 파일이 함께 동작하는 방식",
      "diagram": "flowchart",
      "relations": [
        { "from": "src/query.ts", "to": "src/ui.tsx", "label": "조회 결과 전달", "detail": "선택 상태의 입력이 됩니다." }
      ],
      "readingOrder": [
        { "path": "src/query.ts", "reason": "데이터 계약을 먼저 확인합니다." },
        { "path": "src/ui.tsx", "reason": "소비 UI와 사용자 영향을 확인합니다." }
      ]
    }
  },
  "guides": [],
  "cards": []
}
```

큰 PR에서 complete snapshot이 tool argument 한도에 가까워지면 semantic hunk를 파일 단위로 합치거나 설명을 삭제하지 않는다. 먼저 `status`의 `details.submissionPath`를 확인하고, 정확히 그 run-local `submission.json`에 `{ "document": {...}, "guides": [...], "cards": [...] }` 전체를 생성·검증한 뒤 path로 제출한다.

```json
{
  "action": "submit",
  "runId": "<run-id>",
  "submissionPath": "<status.details.submissionPath>"
}
```

artifact path는 현재 run의 고정 파일만 허용하며, 성공한 뒤 transport artifact는 제거되고 canonical `document.json`, `guides.json`, `cards.json`, `review.md`가 남는다. 제출 전 모든 chunk가 inspected 상태여야 한다. 근거가 없는 카드를 만들거나 payload를 줄이기 위해 coverage·semantic 설명 기준을 낮추지 않는다.

## 질문 worker·변경 요청 경계

Meta Review drawer는 메인 Pi routing turn을 만들지 않고 Study Hard와 같은 programmatic worker lifecycle을 바로 사용합니다. 질문·답변·실패는 같은 question ID/thread에 남고 실패·stale는 같은 ID로 재시도합니다.

사용자가 명시적으로 reviewed code 수정을 요청하면 worker는 source를 직접 편집하지 않고 schema v2 patch artifact를 제안합니다. Coordinator가 route pin을 다시 검증하고, current-work는 현재 diff freshness를 확인하며, GitHub PR은 local review checkout의 repository·HEAD·clean 상태가 pinned PR과 일치하는지 확인한 뒤 patch와 좁은 validation을 적용합니다. GitHub PR의 원본 run과 evidence는 그대로 두고 적용 결과를 새 current-work Meta Review revision으로 캡처합니다. 기존 질문 thread는 새 run identity로 승계하고 기존 Meta Review completion workflow를 owner Pi에 전달해 pending inspection과 submit을 이어갑니다. commit, push, GitHub review 게시 같은 원격 write는 이 경로에서 계속 금지합니다.

Pending execution이 있는 동안만 polling하며 open details, scroll, draft와 focus를 복원합니다. 메모보드의 `학습 메모 | 코드 리뷰` 탭은 같은 card renderer를 쓰되 canonical state는 합치지 않고 source별 UI key를 사용합니다. 변경 적용 뒤에는 refresh revision 상태를 `갱신 중/완료/실패`로 구분합니다.

## 완료 응답

- 대상 PR과 head SHA
- 전체/일부 검토 범위
- 최종 카드 수
- corpus 사용 여부와 coverage gap
- 생성된 review artifact 경로

GitHub에 게시했다고 말하지 않는다. 사용자가 별도로 게시를 요청하더라도 이 workflow는 초안까지만 만들고, 외부 write workflow의 명시적 승인 Gate로 넘긴다.
