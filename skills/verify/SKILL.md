---
name: verify
description: AI가 구현한 변경사항을 요구사항·문서·도메인 언어·diff와 대조해 사용자가 리뷰할 수 있는 감사 브리핑을 만든다. 무엇을 바꿨는지, 어디까지 믿어도 되는지, 무엇을 직접 봐야 하는지, 다음 행동이 캡처/수정/PR 중 무엇인지 판정할 때 사용한다.
---

<PREREQUISITE>
이 스킬을 실행하기 전에 다음 두 스킬을 모두 읽었는지 확인하세요:
- `skills/tft-guidelines/SKILL.md` — 언제 묻고 언제 안 묻을지 (philosophy)
- `skills/ask-user-question-rules/SKILL.md` — 어떻게 물을지 (craft)
읽지 않았으면 먼저 읽고 오세요. 두 규칙 모두 verify 전체 과정에 적용됩니다.
</PREREQUISITE>

# Verify

`/verify`는 QA 완료 선언자가 아니라 **AI 구현물 감사관**이다.

사용자는 보통 “AI가 구현은 했는데 뭘 했는지 모르겠으니 검토시키고 싶다”는 의도로 `/verify`를 호출한다. 따라서 `/verify`는 “통과/실패”보다 먼저 다음 질문에 답해야 한다.

1. AI가 무엇을 바꿨는가?
2. 요구사항과 diff가 어떻게 연결되는가?
3. 어디까지 믿어도 되는가?
4. 아직 못 믿는 것은 무엇인가?
5. 문서/티켓/도메인 용어와 어긋난 해석은 없는가?
6. 사람이 리뷰할 때 어디를 먼저 봐야 하는가?
7. 다음 행동은 코드 수정, 화면 캡처, PR, 보류 중 무엇인가?

**핵심 원칙: 증거 없이 완료를 선언하지 않는다.**

---

## 역할과 금지

### 목표

- 이번 변경이 무엇인지 사용자가 빠르게 이해하게 한다.
- 요구사항, frame, 티켓, 문서, 기존 코드와 실제 diff를 연결한다.
- 코드상 믿어도 되는 것과 실제로 아직 못 믿는 것을 분리한다.
- 문서/도메인 용어/스펙 해석이 diff에서 임의로 바뀌지 않았는지 그릴링한다.
- 사람이 리뷰할 우선순위를 제시한다.
- 다음 행동이 코드 수정인지, 화면 캡처인지, PR 준비인지 판정한다.

### 금지

- 증거 없이 “완료”, “Ready”, “문제없음” 선언 금지.
- 코드에 있으니 실제 UI/동작도 된다고 말하지 않는다.
- frame 항목을 기계적으로 길게 펼치기만 하지 않는다.
- 사용자가 바로 쓸 수 없는 내부 검증표만 출력하지 않는다.
- 처리된 항목을 AskUserQuestion 옵션으로 다시 묻지 않는다.
- 문서/코드 충돌을 AI가 임의로 단정하지 않는다.

---

## 신뢰 판정 단위

각 claim, requirement, risk, evidence gap은 다음 중 하나로 분류한다.

| 판정 | 의미 |
|---|---|
| `믿어도 됨` | 자동 검증 또는 명확한 코드 근거가 claim을 닫음 |
| `코드상 그럴듯함` | diff상 구현은 보이나 runtime/UI/consumer evidence는 없음 |
| `아직 못 믿음` | 화면, 클릭, 데이터, 권한, 외부 효과 등 실제 소비 경로 미확인 |
| `문제 있음` | 실패 로그, 코드 결함, 요구사항 누락 확인 |
| `범위 밖` | 이번 작업 요구가 아님 |

명령 성공은 사용자 성공이 아니다. 명령 결과가 어떤 claim을 닫는지 반드시 명시한다.

---

## 사전 조건 (Hard Gate)

`/verify`는 기본적으로 `<worktree>/.pi/frame.json`이 있을 때 가장 잘 동작한다.

- frame.json **없음** → `/frame을 먼저 실행하세요`라고 안내하고 종료한다. 단, 사용자가 `--no-frame` 플래그로 명시적으로 우회하면 자유 감사 모드로 진행한다.
- frame.json **있음** → success_criteria, out_of_scope, boundaries, verify_plan, decisions, requirement_matrix, domain_work_map, policy_axis_scan, backend_layer_map, architecture_flow_map을 로드한다.

TFT Studio는 Verify를 강제로 요구하지 않는다. 하지만 `/verify`를 실제로 수행했다면 결과는 Studio transcript에만 남기지 않는다.

- 최종 판정, 신뢰 경계, evidence gap, docs grill 결과, risk findings, next action은 `frame.json.verifications[]` 또는 `--no-frame` 자유 검증 보고서에 남긴다.
- `frame_studio`를 사용하면 진행/요약은 `tab=verify`에 렌더링하고, 사용자 선택이 필요한 질문은 `frame_studio action=ask tab=verify`로 처리한다.
- 질문 본문을 채팅에 번호형 메뉴로 출력하는 것은 `frame_studio ask` 결과가 `unavailable`, `cancelled`, `timeout`일 때만 허용한다.
- canonical 저장과 다음 단계 선택까지 같은 Verify run에 남긴 뒤 `frame_studio action=finish tab=verify`로 닫는다.

---

## 실행 단계

### Step 1: 변경 요약

1. 기준 commit과 diff 범위를 확인한다.
2. 변경 파일 목록을 확인한다.
3. diff를 읽고 “AI가 바꾼 것”을 사용자 언어로 3~7개 bullet로 요약한다.

반복되는 unrelated validation 실패는 agent가 자동 preflight baseline 흐름으로 분리한다. Bash validation 결과가 `[preflight] Known baseline failure`로 주석 처리되면 최종 보고에서 별도 분리하되, 이번 diff가 같은 실패를 건드렸다면 baseline으로 취급하지 말고 새 실패로 재검증한다. 새 unrelated baseline이라고 판단되면 사용자에게 slash command를 요구하지 말고 `preflight_baseline` tool로 기록한다.

### Step 2: 요구사항 매핑

frame success criteria, requirement matrix, Jira/문서 요구사항, 사용자 요청을 diff와 연결한다.

각 요구사항은 다음 형식으로 분류한다.

| 요구 | 구현 상태 | 근거 | 신뢰도 |
|---|---|---|---|
| R1 | 코드상 구현 | `Foo.tsx:42` | 코드상 그럴듯함 |

규칙:
- `PASS` 같은 단어를 남발하지 않는다. 기본 언어는 신뢰도다.
- 코드 독해만으로 user-facing behavior를 `믿어도 됨`으로 올리지 않는다.
- UI/TUI/렌더링/리포트는 실제 화면 또는 artifact 캡처가 없으면 `아직 못 믿음` 또는 `코드상 그럴듯함`이다.
- 모든 requirement ID는 `믿어도 됨`, `코드상 그럴듯함`, `아직 못 믿음`, `문제 있음`, `범위 밖` 중 하나여야 한다.
- frame에 `requirement_matrix`가 있으면 **source-grounded requirement coverage 검증**을 수행한다. 원문 요구 ID, source text, 구현 계약, evidence 상태를 빠짐없이 연결한다.
- frame에 `domain_work_map`이 있으면 **Domain Work Map coverage**를 별도로 정리한다. domain lane leaf task가 닫히지 않았는데 SC만 닫힌 것처럼 보고하지 않는다.

### Step 3: Post-implementation Docs Grill Lens

구현된 diff를 문서, 티켓, 도메인 언어, 기존 코드와 다시 부딪힌다. 이는 구현 전 `grill-with-docs`의 사후 버전이다.

확인 질문:

1. 티켓/Frame의 핵심 명사와 코드 명사가 같은 개념인가?
2. “동일한 형태”, “유지”, “전체”, “상태”, “기존”처럼 모호한 표현이 diff에서 임의 해석되지 않았나?
3. 기존 코드/문서에 canonical term이나 기존 UX 패턴이 있는데 새 구현이 다른 이름/형태를 만들었나?
4. 요구사항이 말한 consumer path와 실제 수정한 파일이 같은 경로인가?
5. 구현 후에야 드러난 결정이 있는데 AI가 조용히 선택해버리지 않았나?
6. 문서/코드가 충돌한다면, 어느 쪽을 기준으로 삼아야 하는가?

출력은 `문서/도메인 그릴 결과`에 기록한다.

| 항목 | 확인 결과 | 판단 |
|---|---|---|
| “동일한 형태” | 기존 컴포넌트 직접 재사용은 아님. 전용 shallow wrapper로 유사 구조 구현 | 리뷰 필요 |

AskUserQuestion으로 승격하는 경우:
- 답이 없으면 구현 자체가 틀렸을 수 있다.
- 신규 API/DB/권한/정책 같은 `ask_first` 영역으로 넘어간다.
- 같은 용어를 다르게 해석하면 diff를 되돌려야 할 수 있다.
- PR 전에 반드시 제품 판단이 필요하다.

그 외 의문은 `리뷰어에게 던질 질문`으로 남긴다. 처리된 항목이나 단순 캡처 필요 항목을 의례적으로 묻지 않는다.

### Step 4: 신뢰 경계 분리

다음을 분리해 보고한다.

- 믿어도 되는 것
- 코드상 그럴듯하지만 아직 증거가 없는 것
- 아직 못 믿는 것
- 명확한 문제
- 범위 밖

신뢰 경계는 사용자-facing 판단을 돕는 핵심 출력이다. 내부 검증표보다 위에 둔다.

### Step 5: 실행 검증

필요한 검증 명령을 실행하되 fan-out을 좁힌다.

권장 검증:
- 변경 파일 lint/format/static check
- 관련 unit/component test
- 필요한 경우 타입체크 또는 build
- UI 변경이면 화면 evidence는 `/verify-report` 또는 수동 확인으로 넘김

규칙:
- 검증 명령은 claim과 연결한다. “명령이 성공했다”가 아니라 “이 명령이 무엇을 닫았는지”를 말한다.
- wrapper script가 path 인자를 무시할 수 있으면 package.json을 확인하거나 직접 executable을 호출한다.
- wrapper 불확실성만으로 검증을 hard block하지 않는다. 대신 실행 전 `예상 fan-out: ...` 체크리스트를 적고, 실행 후 결과가 실제로 그 범위를 닫았는지 확인한다.
- whole app/repo/workspace validation은 current diff와 연결되는 이유를 한 줄로 남긴다.
- 같은 validation family가 두 번 실패하면 조용히 재시도하지 말고 원인, 시도한 조치, 다음 선택지를 보고한다.

### Step 6: Risk lens + overlay

`references/risk-lenses.md`를 읽고 diff trigger에 맞는 lens를 고른다. Project/private overlay가 있으면 함께 적용한다.

자주 쓰는 lens:
- UI layout/viewport/copy → Visual / responsive lens
- UI consumes backend/domain value → UI data flow lens
- GraphQL/gRPC/REST/event schema → API contract lens
- migration/DDL/backfill/runbook → DB schema, data preservation, ops runbook lens
- DataLoader/cache/singleton provider → cache/loader lens
- auth/role/token/PII → Security / permission / PII lens
- price/rate/refund/point/commission → Money / entitlement lens
- 새 wrapper/조건 분산/구조 비용 → Architecture friction lens
- frame `requirement_matrix`/`domain_work_map` → source-grounded requirement coverage lens
- frame `backend_layer_map.triggered` → backend layer responsibility lens
- frame `architecture_flow_map.triggered` → architecture/data flow lens

Overlay 규칙:
- overlay는 generic lens를 대체하지 않고 concrete command/checklist를 추가한다.
- overlay가 새 사용자 정책 결정을 요구하면 `/decide` 또는 AskUserQuestion으로 분리한다.
- high-risk lens가 코드 위치 설명만으로 남으면 `믿어도 됨`이 아니라 `코드상 그럴듯함` 또는 `아직 못 믿음`이다.
- frame에 `architecture_flow_map.triggered`가 있으면 **Architecture/Data Flow 검증**을 수행한다. lane/node/edge/source-of-truth가 실제 diff와 맞는지 보고, mismatch는 신뢰 경계와 리뷰 질문에 연결한다.

### Step 7: 의도하지 않은 변경과 out-of-scope 탐지

Diff와 frame boundaries를 대조한다.

확인:
- out_of_scope에 명시된 영역이 변경됐는가?
- 요청과 무관해 보이는 파일 변경이 있는가?
- 포맷팅만 바뀐 파일, import 순서 변경 등 실수성 변경이 있는가?
- `boundaries.never` 또는 `boundaries.ask_first`를 침범했는가?

규칙:
- 발견된 항목은 보고한다. AI가 자동으로 되돌리지 않는다.
- 명확한 current diff 결함은 수정 후보로 분류한다.
- 사용자 판단이 필요한 범위 변경은 AskUserQuestion으로 승격한다.

### Step 8: 영향 범위와 사용자 플로우

변경된 코드의 consumer path를 추적한다.

확인:
- 변경된 함수/컴포넌트/타입 사용처
- happy path
- error path
- 기존 회귀 가능성이 높은 흐름
- UI/동작/데이터가 실제 소비 경로에서 같은 source-of-truth를 쓰는지

출력은 “영향 범위”보다 “사람이 먼저 봐야 할 곳”에 우선 반영한다.

### Step 9: 리뷰 우선순위와 질문

사람이 먼저 봐야 할 곳을 1~5개로 제시한다.

우선순위:
1. 기획 문구 해석이 애매한 곳
2. UI/runtime evidence가 필요한 곳
3. 기존 동작 회귀 가능성이 있는 곳
4. API/권한/DB/상태 변경 경계
5. AI가 조용히 선택한 구현 방식

`리뷰어에게 던질 질문`은 AskUserQuestion이 아니다. 사용자가 PR/수동 리뷰에서 바로 확인할 수 있는 질문이다.

### Step 10: canonical 저장

Verify 결과는 canonical 저장이 끝난 뒤에만 완료로 보고한다.

frame.json이 있으면 `frame.verifications[]`에 다음을 기록한다.

```ts
frame.verifications.push({
  id: "VER-1",
  baseCommit,
  verdict: "Ready | Reviewable | Needs changes | Blocked",
  oneLineJudgment,
  changedSummary: [...],
  requirementMapping: [{ id, status, evidence, trust }],
  docsGrillFindings: [{ item, finding, judgment }],
  trustBoundary: {
    reliable: [...],
    plausibleButUnproven: [...],
    notYetTrusted: [...],
    problems: [...],
    outOfScope: [...]
  },
  humanReviewPriorities: [...],
  reviewerQuestions: [...],
  riskSignals: [...],
  validationRuns: [{ command, result, closesClaim, note }],
  riskLensFindings: [...],
  unintendedChanges: [...],
  affectedScope: [...],
  verifyReportHandoff: [...],
  nextAction,
  tftStudio: { transcriptPath, transcriptRef, tab: "verify" },
  verifiedAt: Date.now()
});
```

frame.md 또는 자유 검증 보고서에는 아래 Output Format을 append한다.

### Step 11: 다음 단계 선택

최종 판정과 evidence gap에 따라 다음 행동을 정한다.

미검증 UI/동작 evidence가 있으면 `/create-pr`를 첫 번째 추천으로 두지 않는다.

추천 순서 예:
- Visual/runtime gap 있음 → `/verify-report` 또는 수동 확인 후 verify 기록 추가
- 코드 결함 있음 → 수정 후 `/verify --resume`
- 코드 리뷰는 가능하지만 배포 Ready 아님 → 미검증 명시하고 PR 준비
- 모든 evidence 닫힘 → `/create-pr`, `/stress-interview`, `/reflect`, 일단 멈춤

`/verify-report` handoff 후보는 각 항목을 `reuse/revise/add/drop/blocked` 중 하나로 표시한다. 예: 기존 test plan item을 그대로 쓰면 `reuse`, 캡처 축을 바꾸면 `revise`, 새 evidence가 필요하면 `add`, 범위 밖이면 `drop`, 데이터/계정/환경 때문에 막히면 `blocked`.

질문이 실제 행동을 바꾸지 않으면 묻지 말고 추천만 보고한다. 선택이 필요하면 TFT Studio ask를 사용한다.

---

## Output Format

최종 사용자-facing 출력은 내부 검증표보다 **감사 브리핑**을 우선한다.

```markdown
# Verify 결과 — AI 구현물 감사 브리핑

## 1. 한 줄 판정

**판정**: Reviewable / Needs changes / Blocked / Ready

{한 문장 요약}

---

## 2. AI가 바꾼 것

- {변경 1}
- {변경 2}
- {변경 3}

---

## 3. 요구사항 매핑

| 요구 | 구현 상태 | 근거 | 신뢰도 |
|---|---|---|---|
| R1 | 코드상 구현 | `Foo.tsx:42` | 코드상 그럴듯함 |

---

## 4. 문서/도메인 그릴 결과

| 항목 | 확인 결과 | 판단 |
|---|---|---|
| {스펙/용어/문구} | {코드/문서와 대조한 결과} | 코드상 일치 / 리뷰 필요 / 결정 필요 / 문제 있음 |

---

## 5. 믿어도 되는 것

- {자동 검증 또는 명확한 코드 근거로 닫힌 항목}
- {side effect 없음이 확인된 항목}

---

## 6. 아직 못 믿는 것

- {화면/동작/데이터/권한/외부 효과 미확인 항목}
- {코드는 있으나 runtime evidence가 없는 항목}

---

## 7. 리뷰어가 먼저 봐야 할 곳

1. {리뷰 포인트 1}
2. {리뷰 포인트 2}
3. {리뷰 포인트 3}

---

## 8. 리뷰어에게 던질 질문

- {질문 1}
- {질문 2}
- {질문 3}

---

## 9. 위험 신호

| 위험 | 정도 | 이유 | 다음 행동 |
|---|---|---|---|
| UI 캡처 없음 | 높음 | 핵심 요구가 화면 변경 | `/verify-report` 또는 수동 캡처 |

---

## 10. 실행한 검증

| 검증 | 결과 | 닫은 claim | 비고 |
|---|---|---|---|
| 변경 파일 ESLint | PASS | 문법/린트 품질 | 사용자 동작 보증 아님 |

---

## 11. 최종 판정

- 코드 리뷰 후보: 가능 / 불가
- PR 생성: 가능 / 미검증 명시 필요 / 보류
- 배포 Ready: 예 / 아니오
- 추천 다음 단계: {다음 행동}
```

---

## Verdict 기준

### Ready

다음이 모두 참일 때만 사용한다.

- 요구사항 매핑 완료
- 자동 검증 통과 또는 baseline 분리
- user-facing 변경은 화면/동작 evidence 확보
- critical risk 없음
- 문서/도메인 해석 충돌 없음

### Reviewable

코드는 리뷰 가능한 상태지만, 다음 중 하나가 남은 경우.

- UI 캡처 필요
- runtime 클릭/refresh 확인 필요
- 문서 표현 해석이 약간 애매함
- type-check baseline이 current diff와 무관하게 존재

### Needs changes

다음 중 하나가 있으면 사용한다.

- 요구사항 누락
- current diff로 인한 lint/test/type 오류
- 접근성/회귀/상태 처리 결함
- out_of_scope 침범
- 코드로 봐도 명확히 잘못된 구현

### Blocked

다음 중 하나가 있으면 사용한다.

- 사용자 결정 필요
- 환경/데이터/계정 없어서 핵심 evidence 불가
- ask_first 영역 침범 가능성
- 실제 consumer path를 확인할 수 없음
- UI 변경인데 캡처가 전혀 없고 Ready 판단을 요구함

---

## AskUserQuestion 승격 규칙

묻지 말고 보고서에 남길 것:
- 캡처 필요
- 리뷰어가 확인해야 함
- 코드상 이렇다
- baseline으로 분리됨
- 범위 밖으로 보임

사용자에게 물을 것:
- 해석에 따라 구현을 되돌리거나 크게 바꿔야 함
- 신규 API/DB/권한/정책이 필요해짐
- 티켓/문서와 코드가 충돌함
- 같은 용어가 서로 다른 의미로 쓰임
- PR 전에 반드시 제품 판단이 필요함

---

## Modes

### `/verify`

기본값. AI 구현물 감사 브리핑 중심으로 실행한다.

### `/verify --deep`

Gate Function, success criteria, risk lens, canonical schema를 상세히 펼친다. 기본 출력의 감사 브리핑을 생략하지 말고, 상세 표를 아래에 추가한다.

### `/verify --report-ready`

`/verify-report`에 넘길 캡처/동작 evidence 후보만 정리한다. UI 변경에서 유용하다.

### `/verify --commit-audit`

커밋 단위로 리뷰 가능한지 확인한다. 큰 diff 분리, 범위 밖 변경, commit message, validation 결과를 중심으로 본다.

---

## 합리화 차단

| 합리화 | 차단 |
|---|---|
| “테스트가 통과하니까 완료” | 테스트 통과 ≠ 요구사항 달성. 어떤 claim을 닫았는지 매핑한다. |
| “코드상 보이니까 UI도 됨” | UI/TUI/렌더링 claim은 실제 화면 또는 artifact evidence가 필요하다. |
| “CI에서 잡아줄 것” | CI는 비즈니스 해석과 사용자 플로우 정합성을 보장하지 않는다. |
| “작은 변경이라 검증 불필요” | 작은 변경도 user-facing 신뢰 경계를 흐릴 수 있다. |
| “엣지 케이스를 확인했으니 사용자에게 물어보자” | 결정이 필요한 경우만 묻고, 처리된 항목은 보고서에만 남긴다. |
| “미검증 있어도 Ready라고 하자” | 미검증은 신뢰 경계에 남기고 Ready 대신 Reviewable/Blocked를 사용한다. |

---

## 최종 핵심 문장

`/verify`는 AI가 만든 변경을 완료로 선언하는 도구가 아니라, 사용자가 리뷰할 수 있게 변경 의도·요구사항 매핑·신뢰 경계·문서/도메인 해석 리스크를 정리하는 감사 브리핑이다.

항상 마지막에 이 질문에 답한다.

> 지금 이 변경에서 사용자가 믿어도 되는 것과 직접 봐야 하는 것은 무엇인가?
