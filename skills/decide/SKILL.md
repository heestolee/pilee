---
name: decide
description: 기술적 의사결정이 필요할 때 대안 비교·트레이드오프 분석 후 frame.json에 박제. /frame이 큐잉한 frame.decision task를 자동 처리하거나, 즉석 의사결정도 가능.
---

<PREREQUISITE>
이 스킬을 실행하기 전에 `skills/ask-user-question-rules/SKILL.md`를 읽었는지 확인하세요.
읽지 않았으면 먼저 읽고 오세요. AskUserQuestion 호출 시 모든 규칙이 decide 전체 과정에 적용됩니다.
</PREREQUISITE>

# Decide

기술적 의사결정 한 건을 처리한다. 결과는 **frame.json의 `decisions[]`에 기록**하여 /verify가 cross-reference할 수 있게 한다.

## 호출 방식

```bash
/decide                    # frame.decision 큐에서 첫 번째 자동 처리
/decide <taskId>           # 특정 frame.decision task 처리
/decide <freeform topic>   # 즉석 의사결정 (frame 없이)
```

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
4. **외부 의존성 체크** — 라이브러리 문서, MCP로 Jira 관련 티켓 검색

대안은 **최소 2개, 최대 4개**. 1개밖에 없으면 결정이 아니라 실행이다.

### Step 3: 비교 테이블 제시

```markdown
| 기준 | 대안 A | 대안 B | 대안 C |
|------|--------|--------|--------|
| 구현 복잡도 | | | |
| 기존 패턴 일관성 | | | |
| 변경 범위 | | | |
| 테스트 용이성 | | | |
| 되돌리기 비용 | | | |
| 외부 의존 | | | |
```

추가 행은 결정 성격에 따라 가감. (예: 성능 결정이면 "예상 처리량", 보안 결정이면 "공격 표면")

### Step 4: AskUserQuestion — 대안 선택

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

### Step 5: Productive Resistance — 조건부 도전 질문

도전 질문은 **다음 중 하나라도 해당될 때만** 던진다:

- frame.json의 `risk_register`에서 이 결정과 매칭되는 항목 `severity === "high"`
- 선택된 대안의 "되돌리기 비용" 행이 "비싸다" / 큰 영향
- frame.json의 `boundaries.ask_first`에 닿는 영역
- 외부 시스템과의 계약 (API, DB 스키마, 외부 연동) 변경

이 조건들 중 하나도 해당 안 되면 Step 5 건너뛰고 Step 6으로.

```json
{
  "questions": [{
    "question": "<선택한 대안>에 대한 도전: <AI가 생성한 가장 강력한 반론>. 이래도 진행하시겠습니까?",
    "options": [
      "진행 — 이 트레이드오프를 수용한다",
      "재고 — 다른 대안을 다시 검토",
      "프레임으로 돌아가기 — 더 큰 그림 점검"
    ]
  }]
}
```

도전 질문 생성 원칙:
- "되돌리기 비용이 가장 큰 측면"에서 생성
- frame.json의 `risk_register`를 1차 시드로 사용
- 막연한 "확실해?"가 아니라 **구체적 시나리오**를 가정한 반론

"재고" 선택 시 → Step 4로 복귀.
"프레임으로 돌아가기" 선택 시 → /frame으로 이동 권유 후 종료.

### Step 6: 영속화

#### 6-1. frame.json 업데이트 (있는 경우)
```ts
frame.decisions.push({
  id: "DEC-1" (자동 증분),
  title: <결정 제목>,
  taskId: <연결된 task ID, 있으면>,
  alternatives_considered: ["A: ...", "B: ...", ...],
  selected: <선택된 대안>,
  rationale: <유저 답 또는 AI가 정리한 이유>,
  tradeoffs_accepted: <수용한 트레이드오프>,
  challenged: <Step 5 수행 여부>,
  decidedAt: Date.now()
});
frame.updatedAt = Date.now();
```

#### 6-2. Task 상태 업데이트 (frame.decision task에서 호출된 경우)
```ts
TaskUpdate({
  taskId: <task ID>,
  status: "completed",
  metadata: {
    decisionId: "DEC-1",
    selected: <선택된 대안>,
    decidedAt: Date.now()
  }
});
```

#### 6-3. frame.md 미러 업데이트
사람용 frame.md의 `## Decisions` 섹션에 새 항목 append.

frame이 없는 즉석 결정이면: `<cwd>/.pi/decisions/<date>-<slug>.md`에 단독 파일로 저장.

### Step 7: AskUserQuestion — 다음 단계

남은 frame.decision task가 있는지 확인 후 분기:

**남은 결정이 있을 때:**
```json
{
  "questions": [{
    "question": "결정 완료. 큐잉된 결정 <n>개 남았습니다. 다음:",
    "options": [
      "/decide — 다음 결정 처리",
      "Plan 모드 — 여기까지로 구현 계획 작성",
      "바로 구현 시작 (남은 결정은 구현 중 처리)",
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

---

## 합리화 차단

| 합리화 | 차단 |
|---|---|
| "기술적으로 명백한 선택이다" | 명백하면 결정이 아니라 default. 사용자에게 한 번 confirm은 30초. |
| "시간 없으니 최선을 선택한다" | 시간 압박은 합리화 1번 원인. 1분 비교 vs 1시간 롤백. |
| "이전에 같은 결정을 했다" | frame.json `decisions[]` 또는 context 기록에 **명시적 ID와 근거**가 있는 경우에만 재사용. 기억으로 재사용 금지. |
| "Productive Resistance 매번 시간 낭비" | 조건부 가드(severity high, ask_first 영역, 외부 계약)에서만 발화. low risk면 자동 skip. |
| "대안이 1개뿐인데 굳이 결정 절차?" | 1개면 실행. 정말 1개라면 frame의 success_criteria로 충분. |
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
  challenged: boolean;             // Step 5 수행 여부
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
- frame.json: atlanta-COM-1234 (goal: "Toss 부분환불 지원")
- frame.decision 큐 2개 pending:
  · #5 "Refund 테이블 신설 vs Order 컬럼 추가"
  · #6 "Toss 부분환불 API 한도/제약 확인"
→ #5 처리 시작.

AI (Step 2):
대안 탐색:
- 대안 A: 신규 Refund 테이블
  · backend/billing/refund/ 모듈 신설
  · Order는 변경 안 함, Refund.orderId FK로 연결
  · 유사 패턴: backend/billing/charge/ (Charge 별도 테이블)
- 대안 B: Order에 refund_amount, refund_status 컬럼 추가
  · 단일 row 업데이트
  · 다중 부분환불 시 row 갱신 정책 필요

AI (Step 3, 비교 표):
| 기준 | A: 신규 테이블 | B: Order 컬럼 추가 |
|---|---|---|
| 구현 복잡도 | 중 (Repo+Entity 신설) | 낮 |
| 기존 패턴 일관성 | 높 (Charge 패턴 답습) | 낮 |
| 변경 범위 | 신규 모듈 1개 | Order 모듈 + 정산 모듈 |
| 다중 부분환불 | 자연스러움 (row 추가) | 정책 필요 |
| 되돌리기 비용 | 중 (테이블 마이그레이션) | 높 (Order 데이터 의미 변경) |
| 정산 시스템 영향 | 분리됨 | 강결합 |

AI (Step 4):
"어떤 접근을 선택하시겠습니까? (frame goal: Toss 부분환불 지원)"
[A: 신규 Refund 테이블 — 패턴 일관, 마이그레이션 비용]
[B: Order 컬럼 — 단순, 다중 부분환불 정책 필요]

USER: A

AI (Step 5, risk_register 확인):
risk_register 매칭: "Refund 테이블 마이그레이션 — severity: med"
→ severity가 high가 아니고 외부 계약도 변경 안 됨.
→ Step 5 자동 skip.

AI (Step 6):
- frame.json.decisions에 DEC-1 추가
- TaskUpdate(5, status="completed", metadata.decisionId="DEC-1")
- frame.md 미러 업데이트

AI (Step 7):
"결정 완료. 큐잉된 결정 1개 남았습니다 (#6 Toss API 한도 확인). 다음:"
[/decide] [Plan 모드] [바로 구현] [멈춤]
```
