---
name: verify
description: 구현 완료 후 frame.json의 success_criteria를 mechanically 검증하고, 사이드 이펙트·엣지 케이스·배포 가능성을 종합 판정한다. 증거 없이 완료 선언 금지.
---

# Verify

구현 완료 후 **고차원적 관점**에서 변경사항을 검증한다.
타입 검사, 빌드 검증, 테스트 실행 같은 기본 검증은 구현 중 또는 CI에서 이미 수행되므로 이 스킬은 상위 레벨에 집중한다.

**핵심 원칙: 증거 없이 완료를 선언하지 않는다.**

---

## 사전 조건 (Hard Gate)

`/verify`는 `<worktree>/.pi/frame.json`이 있을 때 동작한다.

- frame.json **없음** → `/verify`는 `/frame을 먼저 실행하세요`라고 안내하고 종료. 단, 사용자가 `--no-frame` 플래그로 명시적으로 우회 가능 (이 경우 자유 검증 모드로 진행, 단 Gate Function 강도 등급은 최저로 시작).
- frame.json **있음** → success_criteria, out_of_scope, boundaries, verify_plan, decisions를 메모리로 로드.

---

## Gate Function (완료 선언 전 필수 통과)

각 success_criteria마다:

1. **IDENTIFY**: 이 기준의 `verify_command` 또는 `evidence_locator`는?
2. **RUN**: 명령 실행 (신선한, 완전한 실행). 명령이 없으면 evidence_locator를 코드에서 직접 확인.
3. **READ**: 출력 전체를 읽고, exit code/실패 수/실제 결과 확인.
4. **VERIFY**: 출력이 statement를 확인하는가?
   - NO → "미달성"으로 분류, 증거와 함께 보고
   - YES → 강도 등급 부여 (아래)
5. **GRADE**: 다음 중 하나
   - `달성(코드+테스트)` — 코드 매핑 + 자동화 테스트 모두 PASS
   - `달성(코드만)` — 코드 매핑만 확인, 자동화 테스트 부재 또는 manual_check 필요
   - `부분` — 일부만 구현, TODO/주석/비활성 코드 존재
   - `미달성` — 매핑 안 됨 또는 테스트 FAIL

**어떤 단계든 건너뛰면 = 검증이 아니라 추측.**

---

## 실행 단계

### Step 1: 변경사항 파악

1. `pnpm get-changes` 또는 `git diff origin/<base>` 로 변경 파일 목록
2. frame.json 로드 (없으면 사전 조건 동작)
3. 변경 파일의 diff를 읽음

### Step 2: success_criteria 행 단위 검증

frame.json의 success_criteria 각 행에 대해 Gate Function 5단계 수행:

```
SC-1: <statement>
  evidence_locator: backend/billing/refund/refund.service.ts:processPartialRefund
  verify_command: pnpm -F billing test --filter=refund
  → IDENTIFY ✓
  → RUN: pnpm -F billing test ... (exit 0, 12 passed)
  → READ: 12/12 PASS, processPartialRefund spec 포함
  → VERIFY: statement = "주문 단위 부분 환불" → 매핑 확인
  → GRADE: 달성(코드+테스트)
```

각 SC의 결과를 표로 정리:

| ID | Statement | Grade | 근거 |
|---|---|---|---|
| SC-1 | 주문 단위 부분 환불 | 달성(코드+테스트) | refund.service.ts + spec PASS |
| SC-2 | 정산 시스템 반영 | 달성(코드만) | 코드 매핑 OK, 수동 검증 필요 |
| SC-3 | 관리자 UI 노출 | 부분 | UI 추가됐으나 i18n 누락 |

### Step 3: 의도하지 않은 변경 탐지 — 보고만, 복원 금지

diff와 frame.json의 `out_of_scope` 대조:

- out_of_scope에 명시된 영역이 변경됐는가?
- 요청과 무관해 보이는 파일 변경이 있는가?
- 포맷팅만 바뀐 파일, import 순서 변경 등 실수성 변경

**규칙: 발견된 항목은 보고만 한다. AI가 자동으로 되돌리지 않는다.**

발견 항목을 보고서에 기록 후 사용자에게 명시적으로 묻거나, 그대로 두고 PR 시점에 처리한다.

### Step 4: 영향 범위 + 사이드 이펙트 분석

변경된 코드를 **호출하는 쪽**을 추적:

- Grep으로 변경된 함수/컴포넌트 사용처 찾기
- 변경된 타입/인터페이스에 의존하는 코드 확인
- frame.json `boundaries.ask_first`/`never` 영역 침범 여부

발견된 영향을 보고서에 기록.

### Step 5: 보안/크리티컬 점검

frame.json `boundaries`와 `risk_register` 기반 체크리스트:

- `boundaries.never` 영역 변경 → 즉시 Blocked
- `boundaries.ask_first` 영역 변경 → 사용자 확인 필요 항목으로 분류
- 인증/권한/토큰 처리 변경 유무
- 입력 검증 누락/우회 가능성
- 데이터 손실 또는 장애 경로

크리티컬 리스크 발견 시 "배포 불가"로 분류, 수정 또는 분리 티켓 제안.

### Step 6: 사용자 플로우 점검

frame.json `success_criteria` + `edge_case_seeds`를 바탕으로:

- Happy path 시나리오
- Error path (실패 시 메시지/복구)
- 회귀 가능성이 높은 기존 흐름

각 항목의 검증 결과를 기록.

### Step 7: Decisions 회고

frame.json `decisions[]` 각 항목에 대해 실제 구현과 대조:

- 선택한 대안이 코드에 반영되었는가?
- 결정 시 수용한 트레이드오프가 실제로 발생했는가?
- 결정과 다르게 구현된 부분이 있는가?

불일치 발견 시 보고. 자동 수정 금지.

### Step 8: 엣지 케이스 — 유저 정책 결정 필요한 것만 묻는다

frame.json `edge_case_seeds`와 verify 중 발견한 엣지 케이스를 다음 3분류로 정렬:

| 분류 | 처리 |
|------|------|
| **처리됨 + 코드 근거 있음** | 묻지 않는다. 보고서에 기록 |
| **처리되지 않았으나 영향 작거나 회귀 아님** | 묻지 않는다. "추후 follow-up" 섹션에 기록 |
| **처리되지 않았고 유저 정책 결정 필요** | 이 항목만 옵션화하여 묻는다 |

규칙:
- 옵션이 **0개면 Step 8 건너뛴다**. (Step 10 메뉴에 "엣지 케이스 추가 도전" 옵션 둠)
- 옵션이 **4개 초과면 verify 자체가 너무 커진 신호** → /frame 또는 /decide로 되돌아갈 것을 제안.
- 옵션 본문에 결론(예: "처리됨", "무관")을 적지 않는다. **답이 정해져 있으면 묻지 마라.**

```json
{
  "questions": [{
    "question": "엣지 케이스 — 유저 정책 결정 필요한 항목들:",
    "options": [
      "<엣지 케이스 1: 미처리 + 정책 필요>",
      "<엣지 케이스 2: 미처리 + 정책 필요>",
      "이대로 진행 (위 항목 모두 follow-up으로 미룸)"
    ]
  }]
}
```

### Step 9: frame.json + 보고서 영속화

#### 9-1. frame.json에 verification 추가
```ts
frame.verifications.push({
  id: "VER-1",
  baseCommit: <git rev-parse --short HEAD>,
  gradedCriteria: [{ id: "SC-1", grade, evidence }, ...],
  unintendedChanges: [...],
  affectedScope: [...],
  securityFindings: [...],
  decisionAlignment: [...],
  edgeCasesHandled: [...],
  edgeCasesDeferred: [...],
  verifiedAt: Date.now()
});
```

#### 9-2. verify_check task 자동 closed
frame.verify_plan.manual_checks에서 만든 frame.verify_check task 중 검증된 항목은 `TaskUpdate(status="completed")`.

#### 9-3. 사람용 보고서 (frame.md `## Verifications` append)

```markdown
### {date} Verification VER-1

**검증 기준 커밋**: {short hash}

**Gate Function 결과**:
| ID | Grade | 근거 |
|----|-------|------|
| SC-1 | 달성(코드+테스트) | ... |
| SC-2 | 달성(코드만) | ... |

**의도하지 않은 변경**: {목록 / 없음}
**영향 범위**: {요약}
**보안/크리티컬 점검**: {결과}
**Decisions 반영**: {일치 / 불일치 항목}
**엣지 케이스 처리**: {확인된 항목}
**엣지 케이스 미처리 (follow-up)**: {목록}
**미검증 (수동 필요)**: {수동 검증 필요 항목 목록}

**배포 판정**: Ready / Ready (수동 확인 후) / Blocked
**근거**: {Gate Function 결과 요약}
```

### Step 10: 다음 단계 — "미검증" 가드

frame.json `verify_plan.manual_checks` 중 처리 안 된 항목이 있거나, GRADE에 `달성(코드만)`이 있으면 **`/create-pr` 옵션을 메뉴 첫 자리에서 제외**.

**미검증 항목 있을 때:**
```json
{
  "questions": [{
    "question": "검증 완료. 미검증 <n>건 (시각/수동 확인 필요). 다음:",
    "options": [
      "/make-report — 시각적 검증 리포트 (브라우저 자동화)",
      "/verify --resume — 미검증 항목 직접 처리",
      "수동 확인 후 verify에 기록 추가",
      "(미검증 무시) /create-pr — PR 생성"
    ]
  }]
}
```

**미검증 없을 때:**
```json
{
  "questions": [{
    "question": "검증 완료. 배포 판정: Ready. 다음:",
    "options": [
      "/create-pr — PR 생성",
      "/self-review — 코드 리뷰",
      "/reflect — 학습 캡처",
      "일단 멈춤"
    ]
  }]
}
```

---

## /verify 중 코드 수정 발생 시 — 무효화 절차

verify 실행 중 코드를 수정/커밋/리베이스하면, 검증 기준 커밋이 흔들린다. 이때:

### 옵션 A: verify를 중단
변경이 멈출 수 있거나 별도 작업으로 분리 가능하면:
1. 현재 verify 결과를 `verifications[VER-N].status = "INVALIDATED"`로 기록
2. implement 단계로 돌아감
3. 변경 끝나면 새 `/verify` 호출 — 새 VER ID 부여

### 옵션 B: 미세 수정으로 verify 안에서 처리
변경이 verify 게이트 통과를 위한 미세 수정(< 5줄, 외부 영향 0)이라면:
1. 수정 직후 검증 기준 커밋을 갱신
2. 수정 사유를 보고서 "Verify 도중 변경" 섹션에 기록
3. 수정한 파일의 호출부 추적을 다시 수행

**둘 중 어디 해당하는지 모르면 옵션 A.**

---

## AskUserQuestion 폭주 가드

verify 1회 실행 안에서 AskUserQuestion이 **5회를 넘으면 verify가 너무 커진 신호**.

즉시:
- 현재 verify를 중단하고 보고서에 "verify 중 발견된 미해결 의문 N건" 기록
- /frame 또는 /decide 단계로 되돌아갈 것을 사용자에게 권유

---

## AskUserQuestion 작성 규칙 (필수 준수)

과거 `/verify` 분석에서 다음 어색한 패턴들이 확인됐다. 이 규칙을 어기면 사용자가 "무슨 말이야?"로 되묻는다.

### 질문 작성 규칙

| 규칙 | 좋은 예 | 나쁜 예 |
|------|---------|---------|
| **한 줄 질문 (50자 이내)** | "어떤 패턴을 선택할까요?" | "Frame 기록 완료. 주요 의사결정 포인트: (1) X 패턴 대체... (2) Y 훅 제거..." |
| **배경 설명은 질문 앞 본문에 별도 출력** | (본문) "다음 결정이 필요합니다: ..." (질문) "어떻게 할까요?" | 질문 안에 백과사전식 설명 |
| **결정 카테고리만 묻기** | "이 결정에 도전을 받으시겠습니까?" | "도전: <5줄 분석>. 그래도 진행할까요?" |
| **하나의 결정만** | "변경된 X를 어떻게 처리?" | "X 처리 + Y 정책 + Z 추후작업 동시 결정?" |

### 옵션 작성 규칙

| 규칙 | 좋은 예 | 나쁜 예 |
|------|---------|---------|
| **짧은 명령형 또는 짧은 명사형 (30자 이내 권장)** | "그대로 진행 / 재고 / 멈춤" | "차단상태에서 외부 X 재수신 → PopConfirm 두 번 노출 가능 (사용자 혼란). 현재 자주 발생 안 됨." |
| **옵션 형식 통일** | 모두 명령형: "진행 / 재고 / 멈춤" | 진술문 + 명령형 혼합 |
| **옵션 안에 결론 미리 적기 금지** | "옵션 A — 처리 방식 1" | "옵션 A — 처리됨 (이미 코드에 반영)" |
| **상호 배타 (mutually exclusive)** | "A / B / C" 명확히 다른 선택 | "A / A의 변형 / 절충" 같은 미묘한 차이 |
| **옵션 4개 이내 권장** | 2~4개 | 5개 이상 (인지 부담) |
| **사실 진술을 옵션으로 만들지 않음** | "이 시나리오를 처리할까요?" + [예/아니오/follow-up] | "이 시나리오는 자주 발생 안 함" (이건 옵션 아니라 진술) |

### Productive Resistance 작성 규칙

도전 질문 만들 때:
- **반론은 한 줄**. 부연은 질문 본문 앞에 별도 출력.
- **구체적 시나리오 1개**로 좁힘. "여러 잠재 위험" 나열 금지.
- 옵션은 항상 `[진행 / 재고 / 멈춤]` 또는 `[진행 / 다른 대안 검토 / 프레임으로 돌아가기]` 같은 통일된 3-옵션 형식.

### 한국어 검수

스킬 안에서 한국어를 생성할 때:
- 영어 직역체 금지: "일이 나면" (X) → "발생하면" (O)
- 자체 신조어/축약어 금지: "쏼리" (X) → "쿼리" (O)
- 일반 한국어 어휘만 사용. 모르는 단어는 풀어 쓰기.
- 옵션 마지막 마침표/구두점 통일 (있으면 모두, 없으면 모두 없음)

### 메뉴 중복 방지

같은 세션에서 동일한 메뉴를 연속 두 번 띄우지 않는다.
- 직전 AskUserQuestion의 옵션 셋과 현재 옵션 셋이 같으면 → 그 메뉴를 건너뛰고 진행
- 만약 사용자 정정이 필요해서 다시 띄워야 하면, 질문에 변화 사유를 명시 ("이전 옵션에서 X를 보완하여 다시 묻습니다:")

---

## 합리화 차단

| 합리화 | 차단 |
|---|---|
| "테스트가 통과하니까 완료" | 테스트 통과 ≠ 요구사항 달성. success_criteria.statement와 evidence_locator를 다시 매핑하라. |
| "CI에서 잡아줄 것" | CI는 코드 품질만 검사. 비즈니스 로직 정합성은 못 잡는다. |
| "작은 변경이라 검증 불필요" | 작은 변경이 프로덕션 장애 일으킨 사례 무수히 많음. frame.json이 있으면 자동 매핑이라 비용 거의 없음. |
| "이전 verify에서 이미 확인" | 이후 코드 변경되면 이전 검증 무효. baseCommit 기록으로 자동 무효화 판단. |
| "직접 보니까 잘 동작한다" | 주관적 확인 ≠ 체계적 검증. Gate Function을 통과시켜라. |
| "Step 8에서 묻을 게 마땅찮다" | 묻을 게 없으면 묻지 마라. 옵션을 만들어내지 마라. |
| "미검증 있어도 일단 PR 올리자" | 메뉴 첫 자리에서 자동 비활성화됨. 무시하려면 명시적으로 마지막 옵션 선택. |
| "의도하지 않은 변경, 내가 되돌리고 진행" | 자동 복원 금지. 보고만 하고 사용자가 결정. |
