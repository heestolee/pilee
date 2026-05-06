---
name: frame
description: 작업 시작 전에 구체 질문으로 목표·성공 기준·범위·검증 초점을 함께 좁히고, 이후 /decide·/verify가 mechanically 읽을 수 있는 frame.json을 워크트리에 박제한다.
---

<PREREQUISITE>
이 스킬을 실행하기 전에 다음 두 스킬을 모두 읽었는지 확인하세요:
- `skills/tft-guidelines/SKILL.md` — 언제 묻고 언제 안 묻을지 (philosophy)
- `skills/ask-user-question-rules/SKILL.md` — 어떻게 물을지 (craft)
읽지 않았으면 먼저 읽고 오세요. 두 규칙 모두 frame 전체 과정에 적용됩니다.
</PREREQUISITE>

# Frame

`/frame`은 **한 작업의 시작점**이 아니라 **사이클 setup**이다. 동시에 사용자가 무엇을 신경 써서 봐야 하는지 드러내는 co-thinking 단계다.

산출물(`frame.json`)은 `/decide`·`/verify`가 입력으로 사용한다. 자연어 markdown만 남기지 않는다. 이 스킬이 끝나면 다음이 보장된다:

- 워크트리에 검증 가능한 성공 기준이 박제됨
- 의사결정이 필요한 항목들이 `kind="frame.decision"` 태스크로 큐잉됨
- /verify가 돌릴 명령·수동 체크가 미리 정해짐
- Non-delegable / Ask-first 영역이 명시됨

**핵심 원칙: frame.json이 없으면 /verify는 의미 있게 동작하지 못한다.**

---

## Frame Studio UI

Pi UI가 있고 `frame_studio` tool을 사용할 수 있으면, 번호형 텍스트만 출력하지 말고 Glimpse Frame Studio를 우선 사용한다.

- Step 1 직후: `frame_studio action=start`로 identity-bound Studio를 연다.
- Step 2/5: 현재 markdown을 `action=update`로 렌더링한다.
- Step 3/4/6/8: 선택이 필요한 지점은 `action=ask`를 호출해 버튼/체크박스/직접입력으로 답을 받는다.
- tool 결과가 `unavailable`, `cancelled`, `timeout`이면 `ask-user-question-rules`의 번호형 text-mode fallback으로 이어간다.
- Frame Studio 제목과 identity는 command shim의 **Frame identity hint**를 따른다. P0/P1 panel label이 아니라 worktree/ticket/session planning identity에 귀속한다.

---

## 실행 단계

### Step 1: 컨텍스트 자동 수집 + frame identity 결정 (질문 없이)

순서대로 수행:

1. command shim이 제공한 **Frame identity hint**를 먼저 읽는다.
2. cwd가 worktree인지 확인 → `<worktree>/.pi/worktree-meta.json` 읽기
3. worktree가 있으면 **worktree-bound frame**으로 진행한다.
   - 저장 위치: `<worktree>/.pi/frame.json`, `<worktree>/.pi/frame.md`
   - 표시 이름: `Frame · <worktreeName> · <ticket?>`
4. worktree가 없고 티켓이 있으면 **ticket-bound planning frame**으로 진행한다.
   - 저장 위치: `~/.pi/agent/frame-planning/planning-ticket-<TICKET>/frame.json`
   - 표시 이름: `Planning · <TICKET> · <sessionTitle?>`
5. worktree도 티켓도 없으면 **session-bound planning frame**으로 진행한다.
   - 저장 위치: `~/.pi/agent/frame-planning/planning-session-<sessionFileHash>/frame.json`
   - 표시 이름: `Planning · <하단 session title>`
   - 내부 key는 session file hash를 쓰고, 하단 타이틀은 사람이 보는 label로만 쓴다.
6. 홈 디렉토리 자체(`/Users/...`)는 identity로 쓰지 않는다. 홈은 여러 기획 탭이 공유하므로 충돌한다.
7. 메타/인자/하단 session title에서 `[A-Z]{2,}-\d+` 티켓 패턴을 추출한다. 발견되면 MCP `jira_getIssue`로 본문/acceptance/status 가져온다.
8. `git status` + `git log --oneline -5`로 진행 상태 파악 (git repo가 아니면 planning mode로 생략 사유 기록)
9. 기존 frame이 있으면 **재진입 모드** — 덮어쓰기 전 사용자 확인
10. 워크트리에 결합된 이전 fork-panel summary가 있으면 한 줄 인용

이 단계에선 **유저에게 묻지 않는다.** 출력은 단 하나: identity + 수집된 컨텍스트 요약 카드.

planning frame은 나중에 worktree가 만들어지면 해당 worktree의 `.pi/frame.json`으로 승격할 수 있어야 한다. 따라서 ticket, session title, 원래 session file, source cwd를 frame metadata에 남긴다.

### Step 2: 사고 초점 카드 (Surface Assumptions + Review Lenses)

수집한 컨텍스트로 AI가 아래 두 가지를 먼저 보여준다.

1. **가정 4~6개** — 틀리면 사용자가 바로 정정할 수 있는 문장
2. **이번 frame에서 같이 봐야 할 렌즈 3개** — 사용자가 무엇을 신경 써야 하는지 알려주는 구체 항목

예:

```markdown
가정:
1. 대상은 admin 예약 취소 UI다.
2. 성공 판정은 “취소 버튼 노출”이 아니라 “권한별 취소 가능/불가 흐름”이다.
3. DB 스키마 변경은 없다.
4. 검증은 admin UI 캡처 + 관련 mutation 테스트가 필요하다.

같이 볼 렌즈:
1. 권한 경계 — 누가 취소할 수 있고 누가 못 하는가
2. UX 실패 경로 — 취소 실패 시 메시지/복구가 보이는가
3. 검증 증거 — 테스트만으로 충분한가, 화면 캡처가 필요한가

틀린 가정이 있으면 번호로 정정해주세요. 없으면 `ok`.
```

**AskUserQuestion을 쓰지 않는다.** 자유 텍스트 정정만 받는 단일 턴이다. 이 단계의 목적은 plan 제시가 아니라, 사용자가 볼 사고 렌즈를 먼저 잡는 것이다.

### Step 3: AskUserQuestion — 목표/범위 구체화 (1턴)

목표 확인 질문은 추상 카테고리가 아니라 **이번 작업의 실제 분기**를 옵션화한다. Pi에서 native interactive UI가 약하면 `ask-user-question-rules`의 번호형 text-mode fallback을 사용한다.

```markdown
질문: 목표를 어디까지로 잡을까요?

1. 최소 목표 — 취소 버튼 노출 조건만 수정
2. 표준 목표 — 버튼 조건 + 실패 메시지까지 수정
3. 넓은 목표 — 관련 예약 상태 전환 전체 점검
4. 먼저 탐색 — 기존 예약 상태 모델을 더 읽고 다시 결정

답은 번호로 주세요. 예: `2`
```

원칙:
- 옵션은 매번 도메인 구체어로 작성한다. `성공 기준 수정`, `범위 수정` 같은 메타 옵션만 쓰지 않는다.
- 가장 비싼 결정이 있으면 질문 앞 본문에 한 줄로 표시한다.
- Non-delegable 영역이면 이 단계에서 반드시 사용자 선택을 받는다.
- 사용자가 숫자로 답하면 해당 옵션을 선택한 것으로 보고 바로 진행한다.

### Step 4: AskUserQuestion — 검증/리스크 초점 선택 (선택적 1턴)

사용자가 “뭘 신경 써야 하는지 모르겠다”는 상황을 막기 위해, draft 작성 전에 검증 초점을 좁힌다. 단순 작업이고 초점이 명백하면 `(명백: ...)`로 본문에 표시하고 건너뛴다.

```markdown
질문: frame draft에서 무엇을 가장 엄격히 볼까요? (최대 2개)

1. 사용자 흐름 — 실제 화면/상태 변화 캡처
2. 데이터 정합성 — 저장값/API 응답/캐시 무효화
3. 권한·보안 — 접근 가능/불가 경계
4. 회귀 방지 — 기존 정상 흐름 유지

답은 번호로 주세요. 예: `1,4`
```

선택 결과는 `assumptions`, `success_criteria`, `verify_plan`, `risk_register` 작성의 우선순위가 된다.

### Step 5: frame draft 작성 — 구현 plan 금지

AI가 frame draft를 작성한다. 단, `/frame`은 구현 계획을 만드는 단계가 아니다.

금지:
- 파일별 구현 순서
- “이 파일을 이렇게 고친다” 수준의 plan
- 아직 확인하지 않은 세부 구현을 확정하는 말

작성할 것:
- `success_criteria[]`: 각 항목 `{ id, statement, evidence_locator, verify_command? }`
  - `evidence_locator`: 코드 경로/함수/엔드포인트/UI 셀렉터 등 **검증이 무엇을 가리켜야 하는지**
  - `verify_command`: 가능하면 `pnpm vitest run path/to/spec.ts -t "..."` 같은 실행 가능한 명령
- `out_of_scope[]`: Step 3에서 미룬 항목 + AI가 식별한 명시 제외
- `boundaries`: `{ always[], ask_first[], never[] }`
  - 결제·보안·PII·스키마·외부 연동·동시성·운영은 자동으로 `ask_first`에 시드
- `risk_register[]`: `{ risk, severity, mitigation, needs_decision }`
  - 롤백 비용 큰 결정 우선
  - `needs_decision: true` 항목은 Step 7에서 task로 큐잉됨
- `edge_case_seeds[]`: Step 4 초점에 맞춘 3~5개
- `verify_plan`: `{ commands[], manual_checks[] }`

Draft를 보여줄 때 맨 위에 반드시 다음을 붙인다:

```markdown
검수할 때 볼 것:
1. 성공 기준이 실제 사용자/시스템 결과를 말하는가
2. 이번 작업에서 제외할 범위가 충분히 명시됐는가
3. 검증 증거가 테스트/캡처/로그 중 무엇인지 분명한가
```

### Step 6: AskUserQuestion — 구체 patch 메뉴 (1턴)

검수 질문은 카테고리 메뉴가 아니라 **draft에서 바로 고칠 수 있는 구체 항목**으로 만든다. Pi에서는 번호로 답할 수 있게 출력한다.

```markdown
질문: 저장 전에 무엇을 고칠까요? (복수 선택 가능)

1. SC-2에 “취소 실패 메시지 노출” 추가
2. out_of_scope에 “정산 상태 변경” 추가
3. ask_first에 “예약 상태 enum 변경” 추가
4. verify_plan에 admin 화면 캡처 추가
5. 이대로 저장

답은 번호로 주세요. 예: `1,4` 또는 `5`
```

원칙:
- 가능한 한 실제 draft 항목을 옵션으로 쓴다.
- 메타 옵션(`성공 기준 수정`)은 구체 항목을 만들 수 없을 때만 fallback으로 쓴다.
- `이대로 저장`은 “통과 의례”가 아니라 저장 action이다. 선택 시 Step 7로 진행한다.
- 선택된 항목만 자유 텍스트로 받아 patch한다. patch 후 같은 메뉴를 반복하지 말고, 변경 요약을 보여준 뒤 저장 확인만 짧게 받는다.

### Step 7: 영속화 + 의사결정 큐잉

1. `<worktree>/.pi/frame.json` 저장 (스키마는 §5 참조)
2. `<worktree>/.pi/frame.md` 사람 친화 미러 생성
3. `worktree-meta.json`에 `frame: { path, updatedAt, summary }` 키 추가
4. `risk_register` 중 `needs_decision: true` 항목 → 각 항목당 `TaskCreate`:
   - `subject`: 결정 제목
   - `description`: 리스크 설명 + 후보 옵션
   - `metadata: { kind: "frame.decision", riskRef, frameVersion }`
5. `verify_plan.manual_checks` → 각 항목당 `TaskCreate`:
   - `metadata: { kind: "frame.verify_check" }`

### Step 8: AskUserQuestion — 다음 단계 (1턴)

```markdown
질문: <n>개 결정 큐잉 / verify 명령 <m>개 저장됨. 다음은?

1. /decide — 큐잉된 결정 처리
2. Plan 모드 — 구현 계획 작성
3. /verify dry-run — 검증 계획만 먼저 점검
4. 바로 구현 시작
5. 여기서 멈춤

답은 번호로 주세요. 예: `1`
```

---

## 합리화 차단

| 합리화 | 차단 |
|---|---|
| "frame.json까지 만들 정도는 아니야" | 작은 작업이면 success_criteria 1줄 + verify_command 1개로 30초 안에 끝난다. 그게 안 되는 작업은 작은 게 아니다. |
| "성공 기준은 코드 보면 알아" | verify는 코드를 다시 본다. frame.json은 verify가 코드를 보지 *않고도* PASS/FAIL을 정의할 수 있게 만든다. |
| "ticket은 머리에 있으니 메타 안 적어도 됨" | 다음 fork·세션에서 사라진다. 30초 적는 비용 vs 30분 재구성 비용. |
| "엣지 케이스는 verify에서 도출하면 됨" | verify 시점엔 구현이 끝났다. frame이 미리 시드를 박아야 구현 중 처리된다. |
| "Ask first 영역까지 매번 적는 건 과하다" | 결제/보안/PII가 ask_first에 없으면 합리화로 우회된다. 5초로 가장 비싼 사고를 막는다. |
| "AI가 draft를 잘 만들었으니 사용자는 OK만 누르면 됨" | TFT 실패다. draft 전에 사용자가 볼 렌즈와 실제 분기를 번호형 질문으로 좁힌다. |
| "구현 계획까지 같이 주면 친절하다" | `/frame`은 plan 단계가 아니다. 구현 순서는 Plan 모드에서 다룬다. |

---

## §5: frame.json 스키마

```ts
type FrameDoc = {
  version: 1;
  identity: {
    mode: "worktree" | "planning-ticket" | "planning-session";
    key: string;              // worktree:<hash> | planning:ticket:COM-1234 | planning:session:<hash>
    displayTitle: string;     // Glimpse/보고서에 보여줄 이름
    sourceSessionFile?: string;
    sourceSessionTitle?: string;
    promotedToWorktree?: string;
  };
  workspace: string;          // worktree 이름 또는 planning label
  worktree?: string;          // worktree mode일 때 절대 경로
  ticket?: {
    key: string;              // "COM-1234"
    url: string;
    summary: string;
    acceptance?: string;      // Jira AC 본문
  };
  goal: string;               // 한 줄
  scope_size: "small" | "standard" | "risky";  // Non-delegable 감지 시 자동 risky
  assumptions: string[];      // Step 2 결과
  success_criteria: Array<{
    id: string;               // SC-1, SC-2 ...
    statement: string;
    evidence_locator: string; // 파일/엔드포인트/셀렉터/메트릭
    verify_command?: string;  // 실행 가능한 명령
  }>;
  out_of_scope: string[];
  boundaries: {
    always: string[];         // 항상 해야 하는 것
    ask_first: string[];      // 변경 전 사용자 확인 필요
    never: string[];          // 절대 안 함
  };
  risk_register: Array<{
    risk: string;
    severity: "low" | "med" | "high";
    mitigation: string;
    needs_decision: boolean;  // true면 frame.decision task로 큐잉
  }>;
  edge_case_seeds: string[];
  verify_plan: {
    commands: string[];       // 자동화 가능
    manual_checks: string[];  // 수동 확인 (frame.verify_check task로 큐잉)
  };
  decision_queue: Array<{
    taskId: string;
    title: string;
  }>;
  links: {
    jira?: string;
    slack_threads?: string[];
    notion?: string[];
  };
  createdAt: number;
  updatedAt: number;
};
```

`/verify`는 단 하나의 계약을 지킨다: **frame.json이 없으면 frame부터 하라고 차단; 있으면 success_criteria의 row 단위로 evidence를 집계.**

---

## §6: 실전 흐름 예시

워크트리: `~/conductor/workspaces/product/atlanta-COM-1234/`, 메타에 `ticket: "COM-1234"`.

```
USER: /frame  결제 취소 시 부분 환불 지원해줘

AI (Step 1, 질문 없음):
컨텍스트:
- worktree: atlanta-COM-1234 (branch: feat/COM-1234/partial-refund)
- ticket(자동): COM-1234 — "부분 환불 지원" (Jira)
  acceptance: ① 주문 단위 부분 환불 ② 정산 시스템에 환불 액수 반영 ③ 관리자 UI 노출
- 변경 없음 (clean)

AI (Step 2):
가정:
1. 런타임: atlanta backend NestJS, 정산 모듈은 backend/billing/
2. 성공 판정은 “부분환불 API 호출 성공”이 아니라 “정산 반영까지 일치”다.
3. DB 스키마 변경 가능성이 있다.
4. 외부 PG 연동은 Toss만 확인했고 PayPal은 미확인이다.
5. 관리자 UI는 frontend/admin/ 범위에 포함될 수 있다.

같이 볼 렌즈:
1. 정산 데이터 정합성 — 환불 금액이 리포트까지 일치하는가
2. 외부 PG 경계 — Toss만 할지, 다른 PG를 제외할지
3. 관리자 UX — 부분환불 상태가 사람이 확인 가능하게 보이는가

틀린 가정이 있으면 번호로 정정해주세요. 없으면 `ok`.

USER: 4번 — Toss는 부분 환불 가능, PayPal은 이번 범위 밖.

AI (Step 3, 번호형 AskUserQuestion):
질문: 목표를 어디까지로 잡을까요?

1. Toss 부분환불 API만 지원
2. Toss 부분환불 + 정산 반영까지 포함
3. Toss 부분환불 + 정산 + 관리자 UI까지 포함
4. 먼저 기존 환불 모델을 더 탐색

답은 번호로 주세요. 예: `2`

USER: 3

AI (Step 4, 번호형 AskUserQuestion):
질문: frame draft에서 무엇을 가장 엄격히 볼까요? (최대 2개)

1. 정산 데이터 정합성
2. Toss API 실패/재시도 경계
3. 관리자 UI 캡처
4. 기존 전액환불 회귀 방지

답은 번호로 주세요. 예: `1,4`

USER: 1,3

AI (Step 5, frame draft):
검수할 때 볼 것:
1. 성공 기준이 정산/관리자 결과까지 말하는가
2. PayPal 제외 범위가 명확한가
3. 검증 증거가 테스트와 화면 캡처로 나뉘는가

- success_criteria 4개 (SC-1 Toss 부분환불 API, SC-2 정산 반영, SC-3 관리자 UI, SC-4 PayPal 제외)
- out_of_scope 2개 (PayPal, 모바일 앱)
- ask_first: DB 스키마, PG 계약 변경
- edge_case_seeds 4개
- verify_plan.commands 2개 + manual_checks 2개

AI (Step 6, 번호형 AskUserQuestion):
질문: 저장 전에 무엇을 고칠까요? (복수 선택 가능)

1. SC-2에 “정산 리포트 금액 일치”를 더 명시
2. out_of_scope에 “PayPal 부분환불” 추가
3. verify_plan에 관리자 UI 캡처 추가
4. edge_case에 “부분환불 후 같은 결제 재시도” 추가
5. 이대로 저장

답은 번호로 주세요. 예: `1,4` 또는 `5`

USER: 4

AI: edge_case_seeds patch 후 frame.json/frame.md 저장.

AI (Step 7, 백그라운드):
- worktree-meta.json 업데이트 (frame 키 추가)
- TaskCreate × 2 (kind: frame.decision):
  · "Refund 테이블 신설 vs Order 컬럼 추가"
  · "Toss 부분환불 API 한도/제약 확인"
- TaskCreate × 2 (kind: frame.verify_check):
  · "관리자 UI 환불 표시 수동 확인"
  · "정산 리포트 환불 액수 일치 수동 확인"

AI (Step 8):
질문: 2개 결정 큐잉 / verify 명령 2개 저장됨. 다음은?

1. /decide — 큐잉된 결정 처리
2. Plan 모드 — 구현 계획 작성
3. /verify dry-run — 검증 계획만 먼저 점검
4. 바로 구현 시작
5. 여기서 멈춤
```
