---
name: decide
description: 기술적 의사결정이 필요할 때 대안 비교·트레이드오프 도전 후 frame.json에 박제. /frame이 큐잉한 frame.decision task를 자동 처리하거나, 즉석 의사결정도 가능.
---

<PREREQUISITE>
이 스킬을 실행하기 전에 다음 두 스킬을 모두 읽었는지 확인하세요:
- `skills/tft-guidelines/SKILL.md` — 언제 묻고 언제 안 묻을지 (philosophy)
- `skills/ask-user-question-rules/SKILL.md` — 어떻게 물을지 (craft)
읽지 않았으면 먼저 읽고 오세요. 두 규칙 모두 decide 전체 과정에 적용됩니다.
</PREREQUISITE>

# Decide

기술적 의사결정 한 건을 처리한다. `/decide`의 목적은 선택지를 기록하는 것이 아니라 **트레이드오프를 비교하고, 선택을 한 번 공격한 뒤, 수용한 비용을 canonical에 남기는 것**이다.

결과는 **frame.json의 `decisions[]`에 기록**하여 /verify가 cross-reference할 수 있게 한다. frame이 없는 즉석 결정도 가능하지만, 후속 검증과 연결하려면 frame으로 통합해야 한다.

---

## Invariants

### 1. Tradeoff table은 판단용이어야 한다

비교표는 정보 나열이 아니라 선택을 흔드는 도구다. 각 대안마다 다음이 보여야 한다:

- 어떤 기준에서 이기는가
- 어디서 비용/리스크가 생기는가
- 되돌리기 비용은 어떤 형태인가
- 검증은 쉬운가 어려운가
- 구조 비용은 어떤가 — shallow module/분산 조건/public interface 복잡도를 늘리는가
- 정책축을 바꾸는가 — 시간 기준, 다중 적용, DEFAULT/fallback, 채널별 표시, migration/cache identity가 달라지는가
- 레이어 책임을 바꾸는가 — resolver/usecase/repository/VO/loader/entity 중 어느 레이어가 결정을 소유하는가
- 선택 시 수용해야 할 트레이드오프는 무엇인가

### 2. Productive Resistance는 항상 한다

`/decide`는 모든 결정에서 challenge를 수행한다. 단, **강도만 조절**한다.

| intensity | 조건 | 도전 방식 |
|---|---|---|
| `low` | 변경 범위 작음, 되돌리기 쉬움, ask_first 아님 | 한 줄 반론 + 유지/보완/재고 |
| `medium` | 여러 모듈 영향, 테스트/운영 비용 있음, 되돌리기 중간 | 비교표 기반 반론 + 완화책 선택 |
| `high` | DB/API/외부 계약/상태 모델/보안/운영 영향, 되돌리기 비쌈 | 가장 비싼 실패 시나리오 + frame 복귀 옵션 |
| `ask_first` | frame.boundaries.ask_first 또는 Non-delegable 영역 | 사용자 선택 필수, skip 금지, 선택 근거 명시 |

`low`라고 해서 skip하지 않는다. 짧게라도 반대편에서 찌른다.

### 3. Canonical 기록은 유지한다

선택, 반론, 사용자 응답, 완화책, challenge intensity를 `frame.json.decisions[]`에 남긴다. `frame.md`는 사람이 읽는 mirror이며, context prose만을 원천으로 삼지 않는다.

### 4. Decide는 선택 stage지만, 실행했다면 산출물은 남긴다

TFT 전체 cycle을 강제하지 않는다. `Frame → Decide → Verify → Verify Report`는 rich path일 뿐이고, Decide 없이 Verify를 해도 된다. 단, `/decide`를 실제로 수행했다면 결과가 Studio transcript에만 남으면 안 된다.

- `frame_studio`의 `answer`, `contextDigest`, `tabSnapshot`은 현재 Pi turn의 working context다.
- `transcriptRef.openCommand`(`/archive <transcriptPath>`)는 전문 provenance다.
- 최종 decision record는 `frame.json.decisions[]` 또는 frame이 없는 즉석 결정 파일에 남겨야 한다.

---

## 호출 방식

```bash
/decide                    # frame.decision 큐에서 첫 번째 자동 처리
/decide <taskId>           # 특정 frame.decision task 처리
/decide <freeform topic>   # 즉석 의사결정 (frame 없이)
```

---

## TFT Studio UI

Pi UI가 있고 `frame_studio` tool을 사용할 수 있으면, `/decide`의 모든 사용자 선택 질문은 현재 채팅 본문이 아니라 TFT Studio Decide tab에서 처리한다.

- Step 3 비교표는 `frame_studio action=update tab=decide`로 먼저 렌더링한다.
- Step 4 대안 선택, Step 5 challenge 응답, Step 7 다음 단계 선택은 `frame_studio action=ask tab=decide`로 묻는다.
- 질문 본문을 채팅에 번호형 메뉴로 출력하는 것은 `frame_studio ask` 결과가 `unavailable`, `cancelled`, `timeout`일 때만 허용한다.
- 사용자가 Studio에서 답하면 그 답변을 기준으로 바로 이어가고, 같은 질문을 채팅에서 다시 확인하지 않는다.
- canonical decision 저장 후 Step 7 답변까지 같은 Decide run에 남기되, Step 7에서 `Plan 모드`가 선택되면 **그 선택을 완료 보고로 끝내지 않는다**. 같은 Decide tab에서 implementation plan을 즉시 합성·렌더링하고, `구현 시작 / 부모에 handoff / 계획 수정 / 일단 멈춤` 같은 실제 다음 행동 gate까지 처리한 뒤 finish한다.

---

## 실행 단계

### Step 1: 의사결정 포인트 로드

호출 방식에 따라 다르게 동작:

**A. 인자 없음** (`/decide`)
1. `<worktree>/.pi/frame.json` 존재 확인
2. `TaskList()` → metadata.kind === "frame.decision" 필터
3. 가장 오래된 pending task 1개 선택
4. task의 `subject` = 결정 제목, `description` = 리스크/후보 옵션

**B. taskId 지정** (`/decide 5`)
1. `TaskGet(5)` → task 읽기
2. `metadata.kind` 확인 (frame.decision 아니면 경고 후 진행)

**C. 자유 텍스트** (`/decide Toss API 부분환불 한도 확인`)
1. 그 텍스트를 결정 제목으로 사용
2. frame.json이 있으면 결정 후 거기에 추가

frame.json도 없고 자유 텍스트도 없으면: "frame부터 진행하라"고 권유 후 종료.

### Step 2: 대안 탐색

각 대안에 대해 코드베이스 분석:

1. **코드 패턴 검색** — Grep, Glob, ast-grep로 유사 사례 찾기
2. **영향 범위 파악** — 변경될 파일/모듈 식별
3. **과거 결정 확인** — frame.json의 기존 `decisions[]` 또는 `.context/`의 관련 기록 검토
4. **외부 의존성 체크** — 라이브러리 문서, issue tracker/MCP로 관련 티켓 검색
5. **검증 가능성 확인** — 선택별 테스트/캡처/API 확인 가능성 정리
6. **정책축 확인** — frame.json `policy_axis_scan`이 있으면 미해결 축과 채널 매트릭스를 읽고, 각 대안이 시간 기준/다중 적용/DEFAULT/fallback/채널별 표시/migration/cache identity를 어떻게 바꾸는지 정리
7. **레이어 책임 확인** — frame.json `backend_layer_map`이 있으면 각 대안이 resolver/usecase/service/repository/VO/loader/entity 중 어느 레이어에 책임을 둘지 비교

대안은 **최소 2개, 최대 4개**. 1개밖에 없으면 결정이 아니라 실행이다. 정말 1개뿐이면 `(명백: 대안이 없음 — <근거>)`를 보고하고 frame success criteria 또는 구현으로 넘긴다.

### Step 3: 판단용 비교 테이블 제시

비교표는 선택이 흔들릴 만큼 구체적이어야 한다.

```markdown
| 기준 | A: 신규 테이블 | B: 기존 테이블 컬럼 추가 |
|---|---|---|
| 기존 패턴 일관성 | 높음 — Charge/Refund 분리 패턴 | 낮음 — Order가 환불 상태까지 소유 |
| 변경 범위 | 중 — 신규 repo/entity/migration | 낮음 — Order schema + service 수정 |
| 다중 이벤트 확장성 | 높음 — row 추가로 자연스러움 | 낮음 — 누적/덮어쓰기 정책 필요 |
| 검증 용이성 | 중 — migration + repo test 필요 | 높음 — 기존 Order test 확장 |
| 구조 비용/AI 탐색성 | 낮음 — Refund 경계가 명확 | 높음 — Order 의미가 넓어져 다음 변경 지점 탐색 어려움 |
| 정책축 영향 | 낮음 — 이벤트 시점/다중 이력 row로 표현 | 높음 — 현재 Order 상태에 과거 정책 의미가 섞임 |
| 레이어 책임 | 명확 — repo는 조회, VO는 계산, usecase는 흐름 조합 | 모호 — Order service가 조회/정책/표시 의미를 함께 소유 |
| 되돌리기 비용 | 중 — 테이블 rollback | 높음 — 기존 row 의미 변경 |
| 실패 시나리오 | 정산 join 누락 | Order 상태 의미 오염 |
| 추천 | A — 장기 일관성 우위 | B — 단기 구현 속도 우위 |
```

추가 행은 결정 성격에 따라 가감한다. 성능 결정이면 예상 처리량, 보안 결정이면 공격 표면, UI 결정이면 사용자 혼동/접근성, 운영 결정이면 rollback/observability를 넣는다. 코드 구조를 건드리는 결정이면 `구조 비용/AI 탐색성` 행을 넣어야 한다. 정책형 작업이면 `정책축 영향` 행을 넣어 시간 기준/다중 적용/DEFAULT/fallback/채널별 표시/migration/cache identity가 대안별로 어떻게 달라지는지 비교한다. backend 레이어 선택이 핵심이면 `레이어 책임` 행을 넣어 resolver/usecase/repository/VO/loader/entity 중 어디가 책임을 소유하는지 비교한다. 빠른 구현이 작은 module/wrapper/조건 분산을 늘리는지, 또는 단순한 interface 뒤로 복잡도를 숨기는지 비교한다.

### Step 4: AskUserQuestion — 대안 선택

TFT Studio를 사용할 수 있으면 아래 선택지는 `frame_studio action=ask tab=decide`로 표시한다. 채팅 번호 메뉴는 Studio ask fallback일 때만 쓴다.

```json
{
  "questions": [{
    "question": "어떤 접근을 선택하시겠습니까? (frame: <frame.json goal 한 줄>)",
    "options": [
      "A: <요약> — 핵심 트레이드오프: <한 줄>",
      "B: <요약> — 핵심 트레이드오프: <한 줄>",
      "C: <요약> — 핵심 트레이드오프: <한 줄>"
    ]
  }]
}
```

선택을 받으면 바로 저장하지 않는다. Step 5에서 반드시 challenge한다.

### Step 5: Productive Resistance — 항상 하되 강도 조절

선택된 대안에 대해 `challenge_intensity`를 산정한다.

산정 기준:
- `ask_first`: frame.boundaries.ask_first, 결제/보안/PII/스키마/외부 연동/동시성/운영 설정
- `high`: 되돌리기 비용 높음, 데이터 의미 변경, 외부 계약 변경, 상태 모델 변경, public interface 의미를 크게 바꾸는 구조 결정, 정책축 선택이 DB/API/cache/채널별 검증 모델을 바꿈, 레이어 책임 선택이 API/cache/transaction/source-of-truth를 바꿈
- `medium`: 영향 파일/모듈이 여러 개, 회귀 위험 있음, 검증 비용 중간 이상, shallow module/분산 조건 증가 가능성 있음, 정책축 일부가 구현 세부로 흩어질 가능성 있음, 레이어 책임이 여러 파일로 흩어질 가능성 있음
- `low`: 변경 범위 작고 되돌리기 쉬움

#### low challenge

```markdown
도전:
A안을 선택하면 구현은 단순하지만, 기존 B 패턴과 다른 예외 경로가 하나 더 생깁니다.

질문: 이 트레이드오프를 어떻게 처리할까요?

1. 선택 유지 — 차이를 수용하고 결정에 기록
2. 보완 후 유지 — 선택은 유지하되 완화책 추가
3. 재고 — 다른 대안 다시 비교
```

TFT Studio를 사용할 수 있으면 challenge 선택도 `frame_studio action=ask tab=decide`로 묻는다.

#### medium challenge

```markdown
도전:
A안은 장기 모델링은 좋지만 migration/test 범위가 늘어납니다. 이번 작업의 성공 기준이 “빠른 복구”라면 B안이 더 맞을 수 있습니다.

질문: 이 트레이드오프를 어떻게 처리할까요?

1. 선택 유지 — migration 비용을 수용
2. 보완 후 유지 — rollback/test 완화책 추가
3. 재고 — B/C안을 다시 비교
4. frame으로 돌아가기 — 범위/성공 기준 재정렬
```

#### high / ask_first challenge

```markdown
도전:
A안은 기존 데이터 의미를 바꿔 rollback이 어렵습니다. 배포 후 정산 리포트가 어긋나면 단순 revert로 복구되지 않을 수 있습니다.

질문: 이 위험을 감수하고 어떻게 진행할까요?

1. 선택 유지 — 위험과 rollback 비용을 명시적으로 수용
2. 보완 후 유지 — migration/rollback/검증 조건을 추가
3. 재고 — 다른 대안 다시 비교
4. frame으로 돌아가기 — 목표/범위/ask_first 재정렬
```

규칙:
- challenge는 선택을 무효화하려는 것이 아니라, 수용한 비용을 명시하기 위한 단계다.
- “괜찮나요?”처럼 추상적으로 묻지 않는다.
- 구조 비용이 발견되면 `tradeoffs_accepted` 또는 `mitigations`에 “이번에는 빠른 복구를 위해 수용”, “interface 정리 follow-up 생성”, “검증에서 architecture side-effect 확인”처럼 남긴다.
- 정책축 비용이 발견되면 `tradeoffs_accepted` 또는 `mitigations`에 “현재 기준만 지원”, “예약 시점 기준은 별도 SC로 검증”, “DEFAULT 병합은 범위 밖”, “cache key에 정책 조합 포함”처럼 남긴다.
- 레이어 책임 비용이 발견되면 `tradeoffs_accepted` 또는 `mitigations`에 “repo는 조회만, usecase가 정책 조합 소유”, “VO에 중복 방어 집중”, “loader key에 basis 값 포함”, “service 비대화 follow-up”처럼 남긴다.
- 옵션은 선택 후 `decisions[]`의 `tradeoffs_accepted`, `mitigations`, `challenge.response`가 달라져야 한다.
- `재고` 선택 시 Step 4로 복귀.
- `frame으로 돌아가기` 선택 시 `/frame`으로 이동 권유 후 종료.

### Step 6: Canonical-first 영속화

Decide 결과는 canonical 저장이 끝난 뒤에만 완료로 선언한다. TFT Studio를 사용했다면 Step 7 다음 단계 질문까지 처리한 뒤, 최종 decision 요약을 `frame_studio action=finish tab=decide`로 반드시 닫는다.

#### 6-1. frame.json 업데이트 (있는 경우)

```ts
frame.decisions.push({
  id: "DEC-1", // 자동 증분
  title: <결정 제목>,
  taskId: <연결된 task ID, 있으면>,
  alternatives_considered: ["A: ...", "B: ...", ...],
  selected: <선택된 대안>,
  rationale: <유저 답 또는 AI가 정리한 이유>,
  tradeoffs_accepted: <수용한 트레이드오프>,
  mitigations: [<보완 후 유지 선택 시 완화책>, ...],
  challenge: {
    intensity: "low" | "medium" | "high" | "ask_first",
    objection: <도전 반론>,
    response: "accepted" | "accepted_with_mitigation" | "reconsidered" | "returned_to_frame",
    userSelection: <Step 5 선택 텍스트>
  },
  challenged: true,
  tftStudio: {
    transcriptPath: <path>,
    transcriptRef: "/archive <path>",
    tab: "decide"
  },
  decidedAt: Date.now()
});
frame.updatedAt = Date.now();
```

저장 순서:
1. `frame.json`을 읽고 최신 `updatedAt` 확인
2. decision append
3. `frame.json.tmp`에 쓰고 rename
4. `frame.md`의 `## Decisions` 섹션은 `frame.json.decisions[]`에서 재생성 또는 append
5. `worktree-meta`가 canonical hash를 쓰는 경우 hash 갱신

#### 6-2. Task 상태 업데이트 (frame.decision task에서 호출된 경우)

```ts
TaskUpdate({
  taskId: <task ID>,
  status: "completed",
  metadata: {
    decisionId: "DEC-1",
    selected: <선택된 대안>,
    challengeIntensity: <intensity>,
    decidedAt: Date.now()
  }
});
```

#### 6-3. 즉석 결정 저장

frame이 없는 즉석 결정이면 `<cwd>/.pi/decisions/<YYYY-MM-DD>-<slug>.md`에 단독 파일로 저장한다. 이 파일도 선택/비교표/challenge/수용한 tradeoff를 모두 포함해야 한다.

#### 6-4. TFT Studio 저장 결과 update

TFT Studio를 쓰고 있으면 canonical 저장 직후 `frame_studio action=update tab=decide`로 저장 결과를 남긴다.

포함할 내용:
- decision id (`DEC-N`) 또는 즉석 결정 파일 path
- 선택한 대안
- challenge intensity와 사용자 응답
- 완화책/수용한 tradeoff
- canonical path와 transcript ref

아직 finish하지 않는다. Step 7 다음 단계 선택까지 같은 Decide run에 남긴 뒤 finish한다.

### Step 7: AskUserQuestion — 다음 단계

남은 frame.decision task가 있는지 확인 후 분기한다. TFT Studio를 사용할 수 있으면 다음 단계 선택도 `frame_studio action=ask tab=decide`로 묻고, 채팅 번호 메뉴는 fallback에서만 사용한다.

**남은 결정이 있을 때:**
```json
{
  "questions": [{
    "question": "결정 완료. 큐잉된 결정 <n>개 남았습니다. 다음:",
    "options": [
      "/decide — 다음 결정 처리",
      "Plan 모드 — 여기까지로 구현 계획 작성",
      "바로 구현 시작 — 남은 결정은 구현 중 처리",
      "일단 멈춤"
    ]
  }]
}
```

**남은 결정이 없을 때:**
```json
{
  "questions": [{
    "question": "모든 frame 결정 완료. 다음:",
    "options": [
      "Plan 모드 — 구현 계획 작성",
      "바로 구현 시작",
      "일단 멈춤"
    ]
  }]
}
```

Step 7의 선택은 **라벨 보고가 아니라 행동으로 소비**한다.

### Step 7-A: `Plan 모드` 선택 시 — 같은 Studio에서 plan 완결

사용자가 `Plan 모드`를 선택하면 다음을 즉시 수행한다.

1. **finish하지 않는다.** `"Plan 모드가 선택됐습니다"` 같은 최종 답변은 금지다.
2. `frame.json.implementation_plan`과 방금 저장한 `decisions[]`를 읽어 같은 Decide tab에 `Implementation plan synthesis`를 렌더링한다.
3. plan은 최소한 아래를 포함한다.
   - 구현 slice 순서
   - 각 slice의 목표와 예상 파일
   - 첫 안전 행동
   - validation 전에 확인해야 할 bootstrap/readiness 조건
   - ask_first gate, 특히 DB/migration/outbox/보안/외부 연동 경계
   - fork-panel이면 현재 패널에서 해도 되는 일과 부모 `P0`로 넘겨야 하는 일
4. plan 렌더링 후 다시 `frame_studio action=ask tab=decide`로 실제 다음 행동을 묻는다.

```json
{
  "questions": [{
    "question": "이 계획으로 다음 행동은?",
    "options": [
      "구현 시작 — 현재 패널에서 바로 착수",
      "부모에 handoff — fork panel 결과를 P0로 넘김",
      "계획 수정 — slice/검증/gate 보완",
      "일단 멈춤"
    ]
  }]
}
```

Panel-aware rule:
- 현재 세션이 fork child(`P1`, `P2`, …)이면 `구현 시작`을 자동으로 실행하지 않는다. 사용자가 명시적으로 현재 패널 구현을 선택한 경우에만 진행한다.
- protected/profiled worktree 생성·전환이 필요하면 child panel에서 실행하지 말고 `부모에 handoff`를 우선한다.
- `부모에 handoff`가 선택되면 Studio와 최종 응답에 handoff summary를 남기고, 사용자가 바로 `/handoff` 또는 `/done`으로 부모 inbox에 넘길 수 있게 한다. 가능한 경우 현재 extension/tool이 제공하는 handoff 수단을 사용하고, 불가능하면 “선택됨”으로 끝내지 말고 copy-ready handoff 본문을 제공한다.

### Step 7-B: `바로 구현 시작` 선택 시 — 시작 gate 소비

사용자가 `바로 구현 시작`을 선택하면 다음 중 하나로 반드시 이어진다.

- 현재 패널에서 구현 가능한 상황: 첫 안전 행동을 수행한다.
- bootstrap/readiness가 필요한 상황: readiness 확인을 먼저 수행하거나, 확인 전에는 lint/test/type-check/local-dev를 실행하지 않는다고 명시하고 코드 조사/작은 편집부터 시작한다.
- fork child에서 부모 handoff가 맞는 상황: handoff summary를 만들고 `/handoff`/`/done` 경로로 연결한다.

`바로 구현 시작`을 선택했는데 최종 답변이 “구현 시작이 선택됐습니다”로 끝나면 실패다.

### Step 7-C: finish 조건

TFT Studio를 쓰고 있으면 실제 다음 행동 gate를 소비한 뒤에만 **반드시** `frame_studio action=finish tab=decide`를 호출한다.

Finish markdown에는 다음을 포함한다:
- 저장된 decision id/path
- 남은 decision task 수
- 선택된 다음 단계가 아니라 **실제로 수행한 다음 행동**
- Plan mode를 거쳤다면 plan summary와 start/handoff/stop 결과
- canonical 저장 확인

질문이 `unavailable`, `cancelled`, `timeout`이어도 canonical decision 저장이 끝났다면 그 상태를 기록하고 finish한다. finish를 생략하면 같은 Decide run이 `running`으로 남아 다음 `/decide`와 구분이 흐려진다.

---

## 합리화 차단

| 합리화 | 차단 |
|---|---|
| "기술적으로 명백한 선택이다" | 명백하면 그 근거를 비교표에 적고, 그래도 tradeoff challenge를 한 번 수행한다. |
| "low risk라 도전은 생략" | low risk면 짧게 도전한다. `/decide`에서 challenge skip은 없다. |
| "시간 없으니 최선을 선택한다" | 시간 압박은 합리화 1번 원인. 1분 비교 vs 1시간 롤백. |
| "이전에 같은 결정을 했다" | frame.json `decisions[]` 또는 context 기록에 **명시적 ID와 근거**가 있는 경우에만 재사용. 기억으로 재사용 금지. |
| "Productive Resistance 매번 시간 낭비" | `/decide`는 결정의 비용을 드러내는 도구다. 강도는 낮출 수 있지만 생략하지 않는다. |
| "구조는 구현하면서 알아서 정리" | 결정 단계에서 구조 비용을 보지 않으면 빠른 구현이 shallow module을 늘리는 선택인지 기록되지 않는다. 비교표에 비용을 드러낸다. |
| "대안이 1개뿐인데 굳이 결정 절차?" | 1개면 실행. 정말 1개라면 `(명백)` 근거를 남기고 frame의 success_criteria로 충분. |
| "frame.json에 굳이 기록 안 해도..." | 다음 fork/세션/리뷰에서 "왜 이렇게?" 질문에 답할 수 없다. 기록 비용 30초 vs 재구성 비용 30분. |

---

## frame.json `decisions[]` 스키마

```ts
type Decision = {
  id: string;                      // DEC-1, DEC-2 ...
  title: string;
  taskId?: string;                 // 연결된 frame.decision task
  alternatives_considered: string[];
  selected: string;                // 선택된 대안 텍스트
  rationale: string;               // 유저 또는 AI가 정리한 근거
  tradeoffs_accepted: string;
  mitigations?: string[];
  challenge: {
    intensity: "low" | "medium" | "high" | "ask_first";
    objection: string;
    response: "accepted" | "accepted_with_mitigation" | "reconsidered" | "returned_to_frame";
    userSelection: string;
  };
  challenged: true;                // /decide는 항상 challenge 수행
  tftStudio?: {
    transcriptPath: string;
    transcriptRef: string;          // /archive <path>
    tab: "decide";
  };
  decidedAt: number;
};
```

---

## 즉석 결정 (frame 없음)

frame.json이 없는 상태에서 `/decide <topic>`을 호출하면:

1. 일반 절차 (Step 2~5) 동일하게 수행
2. 결과를 `<cwd>/.pi/decisions/<YYYY-MM-DD>-<slug>.md`에 저장
3. Step 7에서 "이 결정을 frame에 통합할까요?" 옵션 추가 — 선택 시 /frame 호출 권유

---

## §6: 실전 흐름 예시

```
USER: /decide

AI (Step 1):
컨텍스트:
- frame.json: atlanta-PROJ-123 (goal: "부분환불 지원")
- frame.decision 큐 2개 pending:
  · #5 "Refund 테이블 신설 vs Order 컬럼 추가"
  · #6 "Toss 부분환불 API 한도/제약 확인"
→ #5 처리 시작.

AI (Step 2):
대안 탐색:
- 대안 A: 신규 Refund 테이블
  · Order는 변경 안 함, Refund.orderId FK로 연결
  · 유사 패턴: Charge 별도 테이블
- 대안 B: Order에 refund_amount, refund_status 컬럼 추가
  · 단일 row 업데이트
  · 다중 부분환불 시 row 갱신 정책 필요

AI (Step 3, 판단용 비교 표):
| 기준 | A: 신규 Refund 테이블 | B: Order 컬럼 추가 |
|---|---|---|
| 기존 패턴 일관성 | 높음 — Charge 패턴과 유사 | 낮음 — Order 의미 확장 |
| 변경 범위 | 중 — 신규 테이블/repo | 낮음 — 기존 Order 수정 |
| 다중 부분환불 | 자연스러움 | 정책 필요 |
| 검증 용이성 | 중 — migration + repo test | 높음 — 기존 spec 확장 |
| 구조 비용/AI 탐색성 | 낮음 — Refund 경계가 명확 | 높음 — Order 의미가 넓어짐 |
| 되돌리기 비용 | 중 — 테이블 rollback | 높음 — 기존 row 의미 변경 |
| 실패 시나리오 | 정산 join 누락 | Order 상태 의미 오염 |
| 추천 | A — 장기 일관성 우위 | B — 단기 구현 속도 우위 |

AI (Step 4):
질문: 어떤 접근을 선택하시겠습니까? (frame: Toss 부분환불 지원)

1. A: 신규 Refund 테이블 — 장기 일관성, migration 비용
2. B: Order 컬럼 추가 — 빠른 구현, 상태 의미 오염 위험

USER: 1

AI (Step 5, challenge_intensity=medium):
도전:
A안은 장기 모델링은 좋지만 migration/test 범위가 늘어납니다. 이번 작업이 빠른 복구라면 B안이 더 작습니다.

질문: 이 트레이드오프를 어떻게 처리할까요?

1. 선택 유지 — migration 비용을 수용
2. 보완 후 유지 — rollback/test 완화책 추가
3. 재고 — B안을 다시 비교
4. frame으로 돌아가기 — 범위/성공 기준 재정렬

USER: 2

AI (Step 6):
- frame.json.decisions에 DEC-1 추가
  · selected: A 신규 Refund 테이블
  · challenge.intensity: medium
  · challenge.objection: migration/test 범위 증가
  · challenge.response: accepted_with_mitigation
  · mitigations: rollback 확인, migration test, 정산 join test
- TaskUpdate(5, completed, decisionId=DEC-1)
- frame.md mirror 업데이트

AI (Step 7):
질문: 결정 완료. 큐잉된 결정 1개 남았습니다. 다음:

1. /decide — 다음 결정 처리
2. Plan 모드 — 여기까지로 구현 계획 작성
3. 바로 구현 시작 — 남은 결정은 구현 중 처리
4. 일단 멈춤
```
