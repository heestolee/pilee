---
name: frame
description: 작업 시작 전에 목표·성공 기준·범위·검증 계획을 한 번에 정렬하고, 이후 /decide·/verify가 mechanically 읽을 수 있는 frame.json을 워크트리에 박제한다.
---

<PREREQUISITE>
이 스킬을 실행하기 전에 `skills/ask-user-question-rules/SKILL.md`를 읽었는지 확인하세요.
읽지 않았으면 먼저 읽고 오세요. AskUserQuestion 호출 시 모든 규칙이 frame 전체 과정에 적용됩니다.
</PREREQUISITE>

# Frame

`/frame`은 **한 작업의 시작점**이 아니라 **사이클 setup**이다.

산출물(`frame.json`)은 `/decide`·`/verify`가 입력으로 사용한다. 자연어 markdown만 남기지 않는다. 이 스킬이 끝나면 다음이 보장된다:

- 워크트리에 검증 가능한 성공 기준이 박제됨
- 의사결정이 필요한 항목들이 `kind="frame.decision"` 태스크로 큐잉됨
- /verify가 돌릴 명령·수동 체크가 미리 정해짐
- Non-delegable / Ask-first 영역이 명시됨

**핵심 원칙: frame.json이 없으면 /verify는 의미 있게 동작하지 못한다.**

---

## 실행 단계

### Step 1: 컨텍스트 자동 수집 (질문 없이)

순서대로 수행:

1. cwd가 worktree인지 확인 → `<worktree>/.pi/worktree-meta.json` 읽기
2. 메타에 `ticket`이 있으면 MCP `jira_getIssue`로 본문/acceptance/status 가져옴
3. 메타에 `ticket`이 없으면 사용자 첫 입력에서 `[A-Z]{2,}-\d+` 패턴 추출 시도. 발견되면 fetch + 메타에 저장 제안
4. `git status` + `git log --oneline -5`로 진행 상태 파악
5. 기존 `<worktree>/.pi/frame.json`이 있으면 **재진입 모드** — 덮어쓰기 전 사용자 확인
6. 워크트리에 결합된 이전 fork-panel summary가 있으면 한 줄 인용

이 단계에선 **유저에게 묻지 않는다.** 출력은 단 하나: 수집된 컨텍스트 요약 카드.

### Step 2: 가정 명시 (Surface Assumptions)

수집한 컨텍스트로 AI가 4~6개의 가정 리스트를 **선언**한다.

```
가정:
1. 대상 런타임은 atlanta backend (Node 20, NestJS)
2. 검증 명령: `pnpm -F billing test`, `pnpm typecheck`
3. 성공 판정은 acceptance criteria 모든 항목 충족
4. DB 스키마는 변경하지 않는다 (변경 필요 시 별도 티켓)
→ 틀린 항목이 있으면 지금 정정. 없으면 "ok".
```

**AskUserQuestion을 쓰지 않는다.** 자유 텍스트 정정만 받는 단일 턴.

### Step 3: AskUserQuestion — 목표 확인 + Productive Resistance (1턴)

질문 1개에 두 가지를 합친다:
- AI가 파악한 **한 줄 목표**
- AI가 식별한 **놓쳤을 만한 분기점 1개** (없으면 생략)

```json
{
  "questions": [{
    "question": "이 작업의 목표가 '<AI가 파악한 한 줄>' 맞나요? (참고: 가장 비싼 결정은 <X>로 보입니다.)",
    "options": [
      "맞다 — 진행",
      "맞지만 <X> 결정은 미루고 싶다",
      "목표가 다르다 (정정 입력)",
      "잘 모르겠다 — 더 탐색 필요"
    ]
  }]
}
```

원칙:
- "맞지만 <X>는 미루고 싶다" → 그 항목은 `out_of_scope`로 즉시 박제
- "잘 모르겠다" → 탐색용 read-only 작업만 1라운드 후 다시 Step 3
- "목표가 다르다" → 정정 입력받고 다시 한 줄 요약 제안

### Step 4: 자기 판단으로 frame draft 작성 (질문 없이)

AI가 다음을 **자기 판단으로 작성**한다. 사용자 검수는 Step 5에서 한 번에:

- `success_criteria[]`: 각 항목 `{ id, statement, evidence_locator, verify_command? }`
  - `evidence_locator`: 코드 경로/함수/엔드포인트/UI 셀렉터 등 **검증이 무엇을 가리켜야 하는지**
  - `verify_command`: 가능하면 `pnpm vitest run path/to/spec.ts -t "..."` 같은 실행 가능한 명령
- `out_of_scope[]`: Step 3에서 미룬 항목 + AI가 식별한 명시 제외
- `boundaries`: `{ always[], ask_first[], never[] }`
  - 결제·보안·PII·스키마·외부 연동·동시성·운영은 자동으로 `ask_first`에 시드
  - 도메인별 추가는 코드/티켓 분석으로 추정
- `risk_register[]`: `{ risk, severity, mitigation, needs_decision }`
  - 롤백 비용 큰 결정 우선
  - `needs_decision: true` 항목은 Step 6에서 task로 큐잉됨
- `edge_case_seeds[]`: 도메인별 흔한 5개 (예: 빈 입력, 동시 요청, 권한 경계, i18n, 모바일/데스크톱)
- `verify_plan`: `{ commands[], manual_checks[] }`
  - `commands` = success_criteria의 verify_command 합집합
  - `manual_checks` = 자동화 불가능한 수동 확인 (시각, UX, 외부 연동)

### Step 5: AskUserQuestion — 단일 검수 (1턴)

생성된 frame draft 요약을 보여주고 멀티셀렉트 검수.

```json
{
  "questions": [{
    "question": "Frame draft를 검토해주세요. 수정 필요한 항목을 모두 선택:",
    "options": [
      "성공 기준 추가/수정",
      "out_of_scope 추가",
      "boundaries(Ask first/Never) 추가",
      "엣지 케이스 추가",
      "verify_plan 명령 수정",
      "이대로 OK"
    ],
    "multiSelect": true
  }]
}
```

선택된 항목만 자유 텍스트로 받아 patch한다. "이대로 OK"만 선택되면 Step 6.

### Step 6: 영속화 + 의사결정 큐잉

1. `<worktree>/.pi/frame.json` 저장 (스키마는 §5 참조)
2. `<worktree>/.pi/frame.md` 사람 친화 미러 생성
3. `worktree-meta.json`에 `frame: { path, updatedAt, summary }` 키 추가
4. `risk_register` 중 `needs_decision: true` 항목 → 각 항목당 `TaskCreate`:
   - `subject`: 결정 제목
   - `description`: 리스크 설명 + 후보 옵션
   - `metadata: { kind: "frame.decision", riskRef, frameVersion }`
5. `verify_plan.manual_checks` → 각 항목당 `TaskCreate`:
   - `metadata: { kind: "frame.verify_check" }`

### Step 7: AskUserQuestion — 다음 단계 (1턴)

```json
{
  "questions": [{
    "question": "<n>개의 결정 큐잉 / verify_plan 명령 <m>개 박제됨. 다음 단계는?",
    "options": [
      "/decide — 큐잉된 결정 처리",
      "Plan 모드 — 구현 계획 작성",
      "/verify dry-run — verify_plan을 사람이 미리 검수",
      "바로 구현 시작",
      "여기서 멈춤 (frame까지만)"
    ]
  }]
}
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

---

## §5: frame.json 스키마

```ts
type FrameDoc = {
  version: 1;
  workspace: string;          // worktree 이름 (예: "atlanta-COM-1234")
  worktree: string;           // 절대 경로
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
2. 검증 명령: `pnpm test --filter=billing`, `pnpm typecheck`
3. DB 스키마는 변경 가능 (Refund 테이블 신설 추정)
4. 외부 PG 연동(Toss/PayPal) — 부분 환불 API 가능 여부 미확인 (리스크)
5. 관리자 UI는 frontend/admin/, this PR 범위에 포함
→ 틀리면 정정.

USER: 4번 — Toss는 부분 환불 가능, PayPal은 이번 범위 밖.

AI (Step 3, AskUserQuestion):
"이 작업의 목표가 'Toss 결제 한정으로 주문 단위 부분 환불을 지원하고 정산 시스템에 반영' 맞나요?
참고: 가장 비싼 결정은 'Refund 테이블 신설 vs 기존 Order에 컬럼 추가'로 보입니다."
[맞다] [맞지만 스키마 결정은 미루고 싶다] [목표 다름] [잘 모르겠다]

USER: 맞다.

AI (Step 4, frame draft 작성, 질문 없이):
- success_criteria 4개 (SC-1 부분환불 API 동작, SC-2 정산 반영, SC-3 관리자 UI, SC-4 Toss 한정)
- out_of_scope 3개 (PayPal, UI 다국어, 모바일 검증)
- boundaries.never: ["정산 retro 변경"]
- edge_case_seeds 5개
- verify_plan.commands 3개 + manual_checks 2개

AI (Step 5, AskUserQuestion):
"Frame draft 검토 — 수정 항목 모두 선택:"
[성공 기준 추가] [out_of_scope 추가] [boundaries 추가] [엣지케이스 추가] [verify_plan 수정] [이대로 OK]

USER: 엣지케이스 추가 — "환불 후 같은 결제 재시도".

AI: edge_case_seeds patch. frame.json/frame.md 저장.

AI (Step 6, 백그라운드):
- worktree-meta.json 업데이트 (frame 키 추가)
- TaskCreate × 2 (kind: frame.decision):
  · "Refund 테이블 신설 vs Order 컬럼 추가"
  · "Toss 부분환불 API 한도/제약 확인"
- TaskCreate × 2 (kind: frame.verify_check):
  · "관리자 UI 환불 표시 수동 확인"
  · "정산 리포트 환불 액수 일치 수동 확인"

AI (Step 7):
"2개 결정 큐잉 / verify 명령 3개 박제됨. 다음:"
[/decide] [Plan 모드] [/verify dry-run] [바로 구현] [여기서 멈춤]
```
