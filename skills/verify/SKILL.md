---
name: verify
description: 구현 완료 후 frame.json의 success_criteria를 mechanically 검증하고, diff 기반 generic risk lens와 project/private overlay lens로 사이드 이펙트·엣지 케이스·배포 가능성을 종합 판정한다. 증거 없이 완료 선언 금지.
---

<PREREQUISITE>
이 스킬을 실행하기 전에 다음 두 스킬을 모두 읽었는지 확인하세요:
- `skills/tft-guidelines/SKILL.md` — 언제 묻고 언제 안 묻을지 (philosophy)
- `skills/ask-user-question-rules/SKILL.md` — 어떻게 물을지 (craft)
읽지 않았으면 먼저 읽고 오세요. 두 규칙 모두 verify 전체 과정에 적용됩니다.
</PREREQUISITE>

# Verify

구현 완료 후 **고차원적 관점**에서 변경사항을 검증한다.
타입 검사, 빌드 검증, 테스트 실행 같은 기본 검증은 구현 중 또는 CI에서 이미 수행되므로 이 스킬은 상위 레벨에 집중한다.

**핵심 원칙: 증거 없이 완료를 선언하지 않는다.**

---

## 사전 조건 (Hard Gate)

`/verify`는 `<worktree>/.pi/frame.json`이 있을 때 동작한다.

- frame.json **없음** → `/verify`는 `/frame을 먼저 실행하세요`라고 안내하고 종료. 단, 사용자가 `--no-frame` 플래그로 명시적으로 우회 가능 (이 경우 자유 검증 모드로 진행, 단 Gate Function 강도 등급은 최저로 시작).
- frame.json **있음** → success_criteria, out_of_scope, boundaries, verify_plan, decisions, policy_axis_scan, backend_layer_map을 메모리로 로드.

TFT Studio는 Verify를 강제로 요구하지 않는다. 하지만 `/verify`를 실제로 수행했다면 결과는 Studio transcript에만 남기지 않는다.

- `frame_studio`의 `contextDigest`/`tabSnapshot`은 현재 Pi turn의 working context다.
- `transcriptRef.openCommand`(`/archive <transcriptPath>`)는 전문 provenance다.
- 최종 PASS/FAIL/GAP, evidence, side-effect, self-healing run, re-verify result는 `frame.json.verifications[]` 또는 `--no-frame` 자유 검증 보고서에 남긴다.

---

## Gate Function (완료 선언 전 필수 통과)

각 success_criteria마다:

0. **LENS**: 이 기준에 적용되는 risk lens와 project/private overlay lens는?
1. **IDENTIFY**: 이 기준의 `verify_command` 또는 `evidence_locator`는?
2. **RUN**: 명령 실행 (신선한, 완전한 실행). 명령이 없으면 evidence_locator를 코드에서 직접 확인.
3. **READ**: 출력 전체를 읽고, exit code/실패 수/실제 결과 확인.
4. **VERIFY**: 출력이 statement와 선택된 risk lens 질문을 확인하는가?
   - NO → "미달성" 또는 "부분/미검증"으로 분류, 증거와 함께 보고
   - YES → 강도 등급 부여 (아래)
5. **GRADE**: 다음 중 하나
   - `달성(코드+테스트)` — 코드 매핑 + 자동화 테스트 + 선택된 high-risk lens 증거 모두 PASS
   - `달성(코드만)` — 코드 매핑은 확인했고, 선택된 lens에 blocking gap이 없지만 자동화 테스트가 부재하거나 manual_check 필요
   - `부분` — 일부만 구현, TODO/주석/비활성 코드, 또는 high-risk lens 질문이 증거로 닫히지 않음
   - `미달성` — 매핑 안 됨 또는 테스트 FAIL

**어떤 단계든 건너뛰면 = 검증이 아니라 추측.**

---

## TFT Studio UI

Pi UI가 있고 `frame_studio` tool을 사용할 수 있으면, `/verify`의 사용자 선택 질문은 현재 채팅 본문이 아니라 TFT Studio Verify tab에서 처리한다.

- 검증 진행/요약은 `frame_studio action=update tab=verify`로 렌더링한다.
- Step 8의 결정 필요한 엣지 케이스와 Step 10의 다음 단계 선택은 `frame_studio action=ask tab=verify`로 묻는다.
- 질문 본문을 채팅에 번호형 메뉴로 출력하는 것은 `frame_studio ask` 결과가 `unavailable`, `cancelled`, `timeout`일 때만 허용한다.
- 사용자가 Studio에서 답하면 그 답변을 기준으로 바로 이어가고, 같은 질문을 채팅에서 다시 확인하지 않는다.
- canonical verification 저장 후 Step 10 답변까지 같은 Verify run에 남기고, 마지막에는 `frame_studio action=finish tab=verify`로 닫는다.

---

## 실행 단계

### Step 1: 변경사항 파악

1. `pnpm get-changes` 또는 `git diff origin/<base>` 로 변경 파일 목록
2. frame.json 로드 (없으면 사전 조건 동작)
3. 변경 파일의 diff를 읽음

반복되는 unrelated validation 실패는 agent가 자동 preflight baseline 흐름으로 분리한다. Bash validation 결과가 `[preflight] Known baseline failure`로 주석 처리되면 최종 보고에서 별도 분리하되, 이번 diff가 같은 실패를 건드렸다면 baseline으로 취급하지 말고 새 실패로 재검증한다. 새 unrelated baseline이라고 판단되면 사용자에게 slash command를 요구하지 말고 `preflight_baseline` tool로 기록한다.

### Step 1.5: Generic Risk Lens 선택 + overlay 로드

`references/risk-lenses.md`를 읽고 diff trigger에 맞는 lens를 고른다. 예:

- migration/DDL/backfill/runbook → DB schema, data preservation, ops runbook lens
- ORM relation/include/model mapping → ORM association lens
- DataLoader/cache/singleton provider → cache/loader lens
- GraphQL/gRPC/REST/event schema → API contract lens
- UI copy/locale/translation → i18n/UI data flow lens
- Slack/email/webhook → external notification lens
- price/rate/refund/point/commission → money/entitlement lens
- frame.json `policy_axis_scan.triggered` → policy axis lens
- frame.json `backend_layer_map.triggered` → backend layer responsibility lens

Project/private overlay가 있으면 Step 2 전에 함께 로드한다. Overlay는 public pilee에 넣기 어려운 concrete repo/path/command/account/domain convention을 제공한다.

Overlay 탐색 규칙:

- 사용 가능한 skills 목록에서 현재 repo/org/domain 이름과 맞는 `*-verify-lenses`, `*-verify-context`, `*-db-*`, `*-local-dev` 같은 private/project skill이 있으면 읽는다.
- overlay가 없어도 generic risk lens로 진행한다.
- overlay는 generic lens를 대체하지 않고 concrete command/checklist를 추가한다.
- overlay가 새 사용자 정책 결정을 요구하면 `/decide` 또는 AskUserQuestion으로 분리한다.

Lens 결과는 각 SC의 근거 또는 별도 `Risk lens findings` 섹션에 기록한다. High-risk lens가 선택됐는데 증거가 닫히지 않으면 `달성(코드만)`으로 올리지 않는다.

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

Risk lens 결과도 함께 정리:

| Lens | Trigger | Result | 근거/GAP |
|---|---|---|---|
| ORM association | FK가 business key를 참조 | GAP | targetKey 증거 없음 → SC-2 부분 |
| Ops runbook | DB write runbook | PASS | pre/post/rollback/log 포함 |

### Step 2.5: 정책축 검증

frame.json에 `policy_axis_scan.triggered`가 있으면 success_criteria와 별도로 정책축을 행 단위로 대조한다. 이 단계는 “요구사항 문구는 맞지만 기준 시간이 틀림” 같은 후반 결함을 잡기 위한 필수 lens다.

| Axis | 확인 질문 | PASS 근거 |
|---|---|---|
| time_basis | 현재 기준/예약·구매·생성 시점 기준이 채널별로 구현됐는가? | query/usecase/input/test가 basisTime을 전달하고 사용하는 증거 |
| application_cardinality | 단일/다중 정책 허용 여부와 우선순위·합산·병합·차단 규칙이 구현됐는가? | DB 제약, repo query, domain value object, 중복/겹침 테스트 |
| default_fallback | DEFAULT가 fallback인지 병합인지 숨김인지 채널별 규칙과 맞는가? | formatter/usecase/notice selection test |
| channel_matrix | Web/Admin/예약 후 화면/Slack/API 등 소비 채널이 각자의 기준 시간·표시 규칙을 따르는가? | 채널별 코드 경로 + 테스트/캡처/로그 |
| data_migration | seed, 운영 이력 보존, idempotent re-run, rollback/restore 조건이 닫혔는가? | migration test/dev runbook/pre-post result |
| api_cache_identity | GraphQL id/cache/loader key가 정책 조합·기간을 안정적으로 표현하는가? | generated schema, id composition, loader key test |

미해결 axis가 있으면 `부분` 또는 `GAP`으로 보고하고, frame의 success_criteria에 없더라도 policy axis finding으로 남긴다. 사용자의 새 정책 결정이 필요한 경우에만 Step 8 AskUserQuestion으로 승격한다.

### Step 2.6: 백엔드 레이어 책임 검증

frame.json에 `backend_layer_map.triggered`가 있으면 실제 diff가 레이어 맵과 일치하는지 확인한다. 이 단계는 “동작은 되지만 책임이 repo/usecase/VO/loader에 잘못 흩어짐”을 잡기 위한 lens다.

| Layer | 확인 질문 | PASS 근거 |
|---|---|---|
| entry_point | Resolver/Controller가 API 연결만 하고 복잡한 정책/DB 조건을 소유하지 않는가? | resolver diff + usecase/repo 위임 증거 |
| application_flow | Usecase/Service가 사용자 행동, 기준 시간, 권한, transaction 조합을 소유하는가? | usecase/service test + 호출 흐름 |
| domain_rule | VO/Domain service/Entity method가 계산·불변식·중복 방어를 소유하는가? | VO/domain test + IO 없음 |
| data_access | Repository/ORM query가 where/include/order/lock만 명확히 소유하는가? | repo query/test + 정책 표시 포맷 없음 |
| cache_batching | Loader/cache key가 기준 값, 권한, scope를 빠뜨리지 않는가? | loader key/test + request scope 확인 |
| persistence | Entity/Migration/Schema가 source-of-truth와 제약을 표현하는가? | schema/migration/generated artifact |
| consumer | Web/Admin/Slack/job이 재계산하지 않고 받은 결과를 표시/전달하는가? | consumer diff/test/capture |

레이어 맵과 실제 구현이 다르면 `Architecture side-effects` 또는 별도 `Backend layer findings`로 보고한다. 계약 위반이나 decision mitigation 누락이면 `부분`/`GAP`으로 연결하고, 단순 구조 개선 후보면 follow-up으로 분리한다.

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
- 새 wrapper/작은 module/분산 조건/public interface 증가 여부

발견된 영향을 보고서에 기록.

#### Architecture side-effect check

코드 구조를 건드렸거나 `/frame`/`/decide`에서 구조 비용 렌즈가 선택됐으면 추가로 확인한다.

| 확인 | 질문 |
|---|---|
| 탐색성 | 다음 사람/AI가 변경 지점을 한두 단계 안에 찾을 수 있는가? |
| 모듈 깊이 | 단순한 interface 뒤에 구현이 숨겨졌는가, 아니면 작은 shallow module이 늘었는가? |
| 용어 일관성 | 같은 개념을 새 이름/새 wrapper로 다시 만들지 않았는가? |
| 결정 반영 | `/decide`에서 수용한 architecture tradeoff/mitigation이 코드·테스트·문서에 반영됐는가? |

이 체크는 자동 리팩터링 지시가 아니다. 발견 결과는 `Architecture side-effects`로 보고하고, frame 계약을 위반하거나 decision mitigation이 빠진 경우에만 Blocked/부분으로 연결한다. 범위 밖인 구조 개선은 follow-up 또는 backlog로 분리한다.

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
- Productive Resistance에서 기록한 `challenge.objection`이 실제 구현에서 완화됐는가?
- `tradeoffs_accepted`에 구조 비용/탐색성 비용이 있으면 실제 diff가 그 비용을 넘어서지 않았는가?
- `mitigations[]`가 있다면 테스트/코드/문서에 반영됐는가?
- 결정과 다르게 구현된 부분이 있는가?

불일치 발견 시 보고. 자동 수정 금지.

### Step 8: 엣지 케이스 — 검증 결과는 본문에, 정말로 결정 필요한 것만 묻기

이 단계는 가장 자주 어색해진다. **이유: AI가 "엣지 케이스를 확인했다"는 행위 자체를 의례화하려고 옵션을 만들어내기 때문.**

#### 1단계: 엣지 케이스 분류 (본문에서 처리)

frame.json `edge_case_seeds`와 verify 중 발견된 엣지 케이스를 다음 3분류로 정렬하여 **본문에 보고**:

```markdown
**엣지 케이스 검증 결과:**

| 시나리오 | 결과 | 근거 |
|---------|------|------|
| 빈 입력 | 처리됨 | components/Foo.tsx:42 — early return |
| 동시 요청 | 처리됨 | useMutation 락 → 중복 차단 |
| 권한 경계 | 처리됨 | guards/PartnerGuard.ts:18 |
| 모바일 회전 | 미처리 (영향 작음) | window resize 무시, 고정 너비 — follow-up |
| 0개 소유 | **결정 필요** | UX 정책: 빈 상태 메시지 vs 안내 모달 |
```

#### 2단계: AskUserQuestion 유무 결정

분류 표에서 `결정 필요` 행이 있는지 확인:

| 결정 필요 항목 수 | 동작 |
|---|---|
| **0개** | **AskUserQuestion 건너뛰기.** Step 9로 직행. (메뉴 안 띄움) |
| **1~4개** | 그 항목들만 옵션화. TFT Studio를 사용할 수 있으면 `frame_studio action=ask tab=verify`로 묻는다. |
| **5개 이상** | verify 너무 커진 신호 → /frame이나 /decide 권유 |

#### 3단계: 옵션 작성 (필요할 때만)

**금지:**
- ❌ 옵션 안에 "(처리됨)", "(미처리)", "무관" 같은 결론 적기
- ❌ "충분하다 — 다음 단계로 진행" 같은 통과용 옵션 (이미 분류 끝냄)
- ❌ 처리된 항목을 옵션에 다시 나열

**권장 형식:**
```json
{
  "questions": [{
    "question": "엣지 케이스 정책 결정이 필요합니다:",
    "options": [
      "0개 소유 시: 빈 상태 메시지",
      "0개 소유 시: 안내 모달 + CTA",
      "0개 소유 시: 페이지 자체 미노출"
    ]
  }]
}
```

각 옵션은 **mutually exclusive한 처리 방식**만 나열. 사실 진술 금지.

### Step 9: frame.json + 보고서 영속화

Verify 결과는 canonical 저장이 끝난 뒤에만 완료로 선언한다. TFT Studio를 사용했다면 Step 10 다음 단계 질문까지 처리한 뒤, 최종 verification 요약을 `frame_studio action=finish tab=verify`로 반드시 닫는다.

#### 9-1. frame.json에 verification 추가
```ts
frame.verifications.push({
  id: "VER-1",
  baseCommit: <git rev-parse --short HEAD>,
  gradedCriteria: [{ id: "SC-1", grade, evidence }, ...],
  unintendedChanges: [...],
  affectedScope: [...],
  architectureFindings: [...],
  securityFindings: [...],
  decisionAlignment: [...],
  edgeCasesHandled: [...],
  edgeCasesDeferred: [...],
  selfHealingRuns: [...],      // 실패/gap 이후 실행한 repair loop가 있으면 기록
  reverifyResult: <summary>,   // self-healing 이후 재검증 결과가 있으면 기록
  tftStudio: {
    transcriptPath: <path>,
    transcriptRef: "/archive <path>",
    tab: "verify"
  },
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
**Risk lens findings**: {선택한 lens별 PASS/GAP/BLOCKED와 근거}
**아키텍처 side-effect**: {탐색성/모듈 깊이/인터페이스 복잡도 결과}
**보안/크리티컬 점검**: {결과}
**Decisions 반영**: {일치 / 불일치 항목}
**엣지 케이스 처리**: {확인된 항목}
**엣지 케이스 미처리 (follow-up)**: {목록}
**미검증 (수동 필요)**: {수동 검증 필요 항목 목록}

**배포 판정**: Ready / Ready (수동 확인 후) / Blocked
**근거**: {Gate Function 결과 요약}
```

#### 9-4. TFT Studio 저장 결과 update

TFT Studio를 쓰고 있으면 canonical 저장 직후 `frame_studio action=update tab=verify`로 저장 결과를 남긴다.

포함할 내용:
- verification id (`VER-N`)
- 기준 commit
- 배포 판정
- SC grade 요약
- risk lens PASS/GAP/BLOCKED 요약
- canonical path와 transcript ref

아직 finish하지 않는다. Step 10 다음 단계 선택까지 같은 Verify run에 남긴 뒤 finish한다.

### Step 10: 다음 단계 — "미검증" 가드

frame.json `verify_plan.manual_checks` 중 처리 안 된 항목이 있거나, GRADE에 `달성(코드만)`이 있으면 **`/create-pr` 옵션을 메뉴 첫 자리에서 제외**.

**미검증 항목 있을 때:**

미검증이 있으면 다음 행동이 달라지므로 AskUserQuestion을 사용한다. TFT Studio를 사용할 수 있으면 `frame_studio action=ask tab=verify`로 묻고, text-mode fallback은 Studio ask가 `unavailable`, `cancelled`, `timeout`일 때만 쓴다. 추천 경로가 명백하면 질문 앞에 `(명백: ...)` 근거를 붙인다.

```markdown
(명백: UI 캡처와 운영 post-SELECT가 남아 있어 PR보다 검증 보강이 우선입니다.)
질문: 검증 완료. 미검증 <n>건. 다음 단계는?

1. /verify-report — 캡처/검증 리포트
2. /verify --resume — 미검증 직접 처리
3. 수동 확인 후 verify에 기록 추가
4. 미검증 명시하고 PR 준비
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

다음 단계 질문 처리 후 TFT Studio를 쓰고 있으면 **반드시** `frame_studio action=finish tab=verify`를 호출한다.

Finish markdown에는 다음을 포함한다:
- 저장된 verification id
- 최종 배포 판정
- 남은 manual/blocked/gap 수
- 선택된 다음 단계 또는 “다음 단계 미선택”
- canonical 저장 확인

질문이 `unavailable`, `cancelled`, `timeout`이어도 canonical verification 저장이 끝났다면 그 상태를 기록하고 finish한다. finish를 생략하면 Studio에서 Verify run이 `running`으로 남아 re-verify run과 구분이 흐려진다.

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

## AskUserQuestion 호출 시

`skills/ask-user-question-rules/SKILL.md`의 규칙을 따른다 (PREREQUISITE).
verify는 특히 Step 8 엣지 케이스 분류와 Step 10 미검증 후속 단계 선택에서 이 규칙을 엄격히 적용한다.

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
| "테스트 통과했으니 구조 side-effect는 검증 아님" | 구조 비용은 다음 변경 가능성의 증거다. 코드 구조를 건드렸다면 탐색성/모듈 깊이/인터페이스 복잡도를 보고한다. |
