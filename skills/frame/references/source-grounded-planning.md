# Source-grounded Planning Matrix

정확한 기획 근거(Jira, Notion, Slack, 와이어프레임, PRD, 디자인 캡처 등)가 있으면 `/frame`은 큰틀 요약으로 끝나면 안 된다. 기획 근거 원문을 구현/검증 계약으로 추적 가능한 형태로 바꿔야 한다.

이 문서는 `/frame`에서 다음 세 산출물을 만드는 기준이다.

1. Requirement Matrix — 기획 근거와 구현/검증의 1:1 추적표
2. Domain Work Map — FE Web/Admin/BE/DB·Ops/Verification 같은 작업 레인 지도
3. Backend Layer Map — backend 레이어별 기획 책임 분배표

## 1. Source-grounded mode trigger

다음 중 하나라도 있으면 source-grounded mode를 켠다.

- 사용자가 Jira/Notion/Slack/wireframe/PRD/기획 본문을 제공했다.
- ticket body, acceptance criteria, comment thread, 디자인 캡처처럼 요구사항 원문이 존재한다.
- 사용자가 “기획대로”, “Jira 요구대로”, “와이어프레임 기준”, “본문에 적힌 대로”라고 말한다.
- 이전 구현이 “큰 목표는 맞지만 세부 기획이 샜다”는 피드백을 받았다.

source-grounded mode에서는 기획 원문을 요약만 하지 않는다. 원문 조항을 요구사항 ID로 쪼개고, 각 ID가 어떤 구현 slice와 어떤 verification evidence로 닫히는지 추적한다.

## 2. Requirement Matrix

### 목적

기획 문장과 구현 상세가 서로 바뀌어도 눈에 띄게 한다. 특히 “재사용”, “동일한 방식”, “영향 없음”, “자동 반려”, “로그 보관” 같은 표현은 구현자가 임의로 축소하기 쉽기 때문에 matrix에서 별도 행으로 잡는다.

### 템플릿

```markdown
## Requirement Matrix

| ID | Source | 기획 근거 원문 | 구현 계약 | 검증 증거 | 상태 |
|---|---|---|---|---|---|
| R1 | Jira §FE(1) | 기존 “메인 이미지” 영역 제거, “이미지” 영역 배치 | Partner Admin form에서 label/section 교체 | UI capture: old area absent + new area visible | pending |
| R2 | Jira §FE(1) | 일반 어드민 이미지 편집 컴포넌트 재사용 | 저장 callback과 presentational UI를 분리해 공통 UI import | code diff + Partner/Admin parity capture | decision-needed |
| R3 | Jira §FE(2) | 언어 선택 드롭다운, 존재 언어만 일반 어드민 순서 | language option builder + selected language state | dropdown option capture + language switch GIF | pending |
```

### 필드 규칙

Shape hard gate:
- `상태` 컬럼은 필수다. `상태` 없는 Requirement Matrix는 무효다.
- `상태`는 `pending`, `confirmed`, `decision-needed`, `gap`, `blocked`, `out-of-scope` 중 하나다.
- 기획 원문이 “컴포넌트 재사용”, “동일한 방식”처럼 강한 표현인데 구현 계약이 “동일 UX”, “유사 방식”, “또는”으로 완화되면 `confirmed`/`pending`으로 두지 않는다. 실제 구현 대안 승인이 필요하면 `decision-needed`, 이미 부족한 구현이면 `gap`이다.

- `ID`: `R1`, `R2`처럼 짧고 안정적인 요구사항 ID를 붙인다.
- `Source`: Jira section, Notion heading, Slack permalink, wireframe frame name처럼 출처를 적는다.
- `기획 근거 원문`: 가능한 한 사용자/문서의 원문 표현을 유지한다.
- `구현 계약`: 파일명이 아니라 “무엇이 구현되어야 하는가”를 쓴다. 파일은 뒤의 plan/slice에 둔다.
- `검증 증거`: UI capture, GIF, network payload, BE test, DB dry-run, code diff, log 등 PASS에 필요한 증거를 쓴다.
- `상태`: `pending`, `confirmed`, `decision-needed`, `gap`, `blocked`, `out-of-scope` 중 하나를 사용한다.

### 축소/이탈 감지

기획 원문과 구현 계약이 다르면 matrix에서 반드시 드러낸다.

```markdown
| R2 | Jira §FE(1) | 일반 어드민 이미지 편집 컴포넌트 재사용 | source/model만 동일하게 사용 | code diff | gap |
```

위처럼 “재사용”이 “source/model 동일”로 축소되면 `gap`이다. 올바른 처리는 다음 중 하나다.

1. 구현 계약을 기획에 맞게 바꾼다.
2. 그대로 구현하기 위험하면 `decision-needed`로 올리고 사용자에게 대안 승인을 받는다.
3. 명시적으로 scope 밖이면 `out-of-scope`와 근거를 남긴다.

## 3. Domain Work Map

### 목적

큰 성공 기준을 FE/BE/DB/검증 레인으로 다시 펼쳐서, 한 도메인에 집중하다가 다른 도메인 요구를 놓치는 일을 막는다. Domain Work Map은 work-task board와 연결되는 사용자-facing 작업 지도다.

### 기본 레인

필요한 레인만 사용한다.

- FE Web
- FE Admin
- FE Mobile/App
- BE Entry/API
- BE Application
- BE Domain/Data
- DB / Migration
- Ops / Runbook
- Verification / Evidence
- Docs / PR / Release

### 템플릿

```markdown
## Domain Work Map

### FE Admin
- [R1,R2,R3] Partner Admin 이미지 영역 교체, 언어 드롭다운, 공통 이미지 UI 재사용
  - 구현: `TravelPartnerUpdateSpotBasicInfoForm`, shared image editor UI
  - 검증: Partner Admin capture + language switch GIF
- [R5] Ops Review 언어별 원본/요청 비교
  - 검증: review screen capture

### BE
- [R4] `SPOT_INFO / SPOT_IMAGES` payload를 언어별 목표 상태로 확장
  - 검증: GraphQL schema/codegen + create request test
- [R6] 승인 시 `spot_trans_has_media` 반영
  - 검증: approval integration/unit test

### DB / Ops
- [R7] pending legacy main image 요청 dry-run/반려/log
  - 검증: dry-run count, execute gate, 사후 SELECT/log artifact

### Verification
- [R1,R2,R3] Partner/Admin parity capture
- [R4,R6] payload + BE test
- [R7] dry-run/execute evidence
```

### Work task 생성 규칙

Domain Work Map의 leaf 항목은 반드시 `[R1]`, `[R1,R2]`처럼 requirement ID prefix를 가진다. prefix가 없으면 도메인별 할 일 목록일 뿐, 기획 근거 추적표가 아니다.

Frame 저장 시 Domain Work Map의 leaf 항목은 가능한 한 `TaskCreate`로 내려간다.

- `area`: `FE Admin`, `FE Web`, `BE`, `DB/Ops`, `Verification`처럼 사용자가 보는 레인을 적는다.
- `refs.requirements`: 해당 task가 닫는 `R1`, `R2` 같은 요구사항 ID를 넣는다.
- `acceptance`: 해당 task가 PASS되려면 필요한 증거를 적는다.
- 사용자 결정이 필요한 항목은 `owner=user` 또는 decision task로 둔다.

## 4. Backend Layer Map as planning surface

Backend Layer Map은 구현 파일 순서가 아니라, 기획 책임이 backend 레이어 어디에 놓이는지 보여주는 표다. `references/backend-layer-map.md`의 레이어 책임을 따르되, source-grounded mode에서는 각 레이어가 어떤 요구사항 ID를 닫는지 함께 표시한다.

### 템플릿

```markdown
## BE Layer Map

Flow:
Partner Admin submit
  → GraphQL mutation / DTO
  → Create update request usecase
  → Request detail persistence
  → Ops review query
  → Approval usecase
  → Repository/entity write
  → Ops script/log

| Layer | 요구사항 | 책임 | 구현 후보 | 검증 |
|---|---|---|---|---|
| Entry/API | R4 | `imagesByLanguage` input/output shape | DTO, GraphQL schema | schema/codegen |
| Application Flow | R4,R6 | 즉시 저장 금지, 요청 생성/승인 흐름 | create/approve usecase | integration test |
| Domain Rule | R3,R4 | 언어별 목표 상태, main 1개, 순서 | helper/VO/validation | unit test |
| Data Access | R6 | `spot_trans_has_media` 조회/replace/order | repository calls | repo/mock test |
| Persistence | R4 | request detail content 저장 | request entity/detail | payload DB 확인 |
| Ops | R7 | pending legacy 요청 dry-run/반려/log | script/runbook | dry-run + log artifact |
| Consumer | R1,R5 | Partner/Ops UI가 같은 source를 표시 | FE query/component | UI capture |
```

Backend Layer Map row에는 `요구사항` 컬럼이 반드시 있어야 한다. requirement ID가 없으면 기획 책임 분배표가 아니라 일반 아키텍처 설명으로 간주한다.

### 미해결 책임 질문

레이어 책임이 불분명하면 파일 plan으로 넘어가기 전에 한 가지 질문으로 승격한다.

```markdown
질문 제목: 레이어 책임 선택

현재 이해:
- Jira는 언어별 이미지 목표 상태를 수정 요청 payload로 저장하라고 합니다.
- 승인 시 실제 source는 `spot_trans_has_media`입니다.

막힌 결정:
언어별 목표 상태 diff/validation을 어느 레이어가 소유할지 정해야 합니다.

추천:
Usecase는 request flow를 조합하고, domain/helper가 main 1개·순서 invariant를 검증하는 방향을 추천합니다.

질문:
언어별 이미지 목표 상태 검증 책임을 어디에 둘까요?

1. Usecase 내부 — 빠르지만 흐름과 규칙이 섞임
2. Domain/helper — 추천, 테스트와 재사용이 쉬움
3. Repository — DB 상태 기준으로만 검증
4. 먼저 기존 유사 흐름을 더 읽고 결정
```

## 5. Frame draft/plan integration

source-grounded mode의 Frame draft는 최소한 다음을 포함한다.

1. `source_evidence[]` — 사용한 Jira/Notion/Slack/wireframe provenance
2. `requirement_matrix[]` — 요구사항 ID, source, 원문, 구현 계약, 검증 증거, 상태
3. `domain_work_map[]` — 레인별 task 후보와 requirement refs
4. `backend_layer_map` — backend trigger가 있으면 requirement refs가 붙은 layer map
5. `implementation_plan.slices[]` — Domain Work Map에서 파생된 실행 slice
6. `verify_plan.manual_checks[]` — Requirement Matrix의 검증 증거에서 파생

기존 `frame.json` schema에 당장 새 필드가 없다면 다음 fallback을 사용한다.

- `requirement_matrix`: `success_criteria[].evidence_locator`, `review_lenses`, `verify_plan.manual_checks`에 요구사항 ID를 명시한다.
- `domain_work_map`: `implementation_plan.slices[]`와 TaskCreate `area`/`refs.requirements`로 표현한다.
- `backend_layer_map`: 기존 `backend_layer_map.layers[]`에 `ownsDecision`/`verification`과 requirement ID를 포함한다.

## 6. Verification rule

`/verify`와 `/verify-report`는 source-grounded frame에서 다음 기준을 따른다.

- 모든 requirement ID는 `PASS`, `GAP`, `BLOCKED`, `OUT_OF_SCOPE` 중 하나여야 한다.
- UI 요구는 캡처/GIF 없이 PASS가 아니다.
- “영향 없음” 요구도 consumer path 확인 없이 PASS가 아니다.
- “자동 반려/로그” 요구는 dry-run/execute gate/log evidence 없이 PASS가 아니다.
- 구현 중 위험해서 기획과 다르게 처리한 항목은 decision record 또는 사용자 승인 없이는 PASS가 아니다.
