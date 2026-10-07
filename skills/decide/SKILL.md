---
name: decide
description: 공개 계약·보안 보장·운영/되돌리기/유지보수 비용을 바꾸는 미해결 기술 선택을 조사·비교하고 frame.json에 기록한다. /frame과 /frame-v2의 결정 큐 또는 즉석 의사결정에 사용하며, 의무 반론이나 이미 정한 결정의 재승인을 요구하지 않는다.
---

<PREREQUISITE>
- `../tft-guidelines/SKILL.md` — 질문 승격 판단의 단일 원천
- `../ask-user-question-rules/SKILL.md` — 짧은 질문 제목 + 판단 맥락 카드
두 지침을 읽고 적용한다.
</PREREQUISITE>

# Decide

기술적 의사결정 한 건을 **사실 조사 → 근거·대안·추천·손익 비교 → 선택 → 기록 → 다음 행동**으로 닫는다. 질문 횟수나 반론 수행 여부가 목적이 아니다. 중요한 기술 선택을 정책 질문으로 축소하거나 AI 단독 실행 세부로 숨기지 않는다.

결과는 `frame.json.decisions[]`에 남긴다. frame이 없는 즉석 결정은 `<cwd>/.pi/decisions/<YYYY-MM-DD>-<slug>.md`에 기록한다. Studio transcript와 `frame.md`는 provenance/mirror이지 canonical이 아니다.

## Invariants

- 확인 가능한 사실은 먼저 조사한다. 미확인 사실을 사용자 취향이나 설계 선택지로 바꾸지 않는다.
- 대안 수가 아니라 실질적인 계약·보안·비용 차이로 질문을 승격한다. 기존 지시·결정·컨벤션으로 충분한 실행 세부는 근거를 남기고 승인된 범위에서 수행한다.
- **기본 흐름에 의무 Productive Resistance나 challenge 단계는 없다.** 비용과 실패 가능성은 선택 전 비교에 넣는다. 이미 비교하고 선택한 tradeoff는 기록만 한다.
- 새로운 중요한 사실·미해결 비용이 선택을 바꾸거나 사용자가 명시적으로 grill/반론 검토를 요청할 때만 추가 검토한다. 같은 손익을 다시 유지/보완/재고 메뉴로 묻지 않는다.
- 위험 결정·외부 실행·새 worktree의 승인 경계는 유지한다. 설계 선택 승인은 운영 실행 승인이 아니다.
- 결정 하나가 남았다는 이유로 독립 slice까지 막지 않는다. 반대로 독립 slice 승인을 막힌 slice의 설계 승인으로 확대하지 않는다.

## 호출 방식

```text
/decide                 # frame.decision 큐의 다음 미해결 판단
/decide <taskId>        # 특정 결정
/decide <topic>         # 즉석 의사결정
```

## TFT Studio

Pi UI와 `frame_studio`가 있으면 같은 work unit의 `tab=decide`를 사용한다.

- 조사 결과와 비교표는 `action=update`로 보여준다.
- 실제 선택이 필요할 때만 `action=ask`를 쓴다. `question`은 짧은 제목, 판단 맥락 카드는 `markdown`에 넣는다.
- `unavailable`, `cancelled`, `timeout`이면 번호형 text-mode fallback을 쓴다. UI에서 받은 선택을 채팅으로 다시 확인하지 않는다.
- canonical 저장 후 실제 다음 행동 또는 중단 결과까지 기록하고 `action=finish`로 닫는다.
- `contextDigest`와 `tabSnapshot`은 현재 turn의 요약이고 `transcriptRef.openCommand`는 전문 참조다. 결정을 transcript에만 남기지 않는다.

## Step 1: 결정과 영향 범위 읽기

1. 현재 identity의 `frame.json`과 `decision_queue`, `decisions`를 읽는다. worktree이면 `.pi/frame.json`, planning이면 Frame identity의 storage path를 사용한다.
2. 인자 없음: `TaskList`에서 `metadata.kind === "frame.decision"`인 pending 항목을 canonical과 대조한다. 이미 해결된 task는 반복 질문하지 않고 동기화한다.
3. taskId가 있으면 `TaskGet`으로 읽고, 자유 주제이면 그 주제를 사용한다.
4. 무엇이 **미확인 사실**이고 무엇이 **미해결 선택**인지, 어떤 slice가 의존하는지 구분한다.
5. frame도 주제도 없으면 무엇을 결정할지 한 번 묻는다. 즉석 결정을 위해 전체 Frame 생성을 강제하지 않는다.

## Step 2: 비교할 사실부터 조사

필요한 범위에서 기존 구현·소비 경로·저장 계약·운영 이력·이전 결정을 확인한다. 외부 문서는 대안 판단에 필요한 것만 확인한다.

- 사실로 확인할 수 있는 질문은 직접 조사하고, 자료/권한이 부족하면 `확인되지 않은 사실`과 다음 조회를 남긴다.
- 목표·성공 기준·정책과 구현 제안(수단)을 구분한다. 제안된 기술이 유일한 요구사항인 것처럼 다루지 않는다.
- 기존 결정의 조건이 그대로면 재사용한다. 조건이 바뀌었으면 무엇이 달라졌는지 밝힌다.
- 선택 가능한 대안이 하나뿐이면 가짜 비교표나 질문을 만들지 않는다. 근거와 남은 실행 승인 경계를 기록한다.

## Step 3: 판단용 비교

선택을 좌우하는 기준만 비교한다. 동일한 내용을 여러 지도/표로 반복하거나 모든 결정에 모든 행을 채우지 않는다.

```markdown
| 기준 | A: 기존 저장 구조 재사용 | B: 조회 인덱스 추가 |
|---|---|---|
| 확인된 근거 | 기존 기록의 식별자·보존 기간 | 조회 부하와 필요한 검색 조건 |
| 제공하는 계약 | 가능한 범위와 제한 | 새롭게 보장하는 범위 |
| 보안·권한 | 소유권 확인 경로 | 추가로 관리할 권한 경계 |
| 운영/유지보수 비용 | 조회·복구 비용 | 동기화·누락 복구 비용 |
| 되돌리기 | 기존 상태 복구 조건 | 데이터 이관·rollback 조건 |
| 검증 | 계약을 증명할 관찰 | 추가 불변조건을 증명할 관찰 |
```

- 추천은 기준·근거·수용할 비용을 설명한다. 확인되지 않은 수치나 장점을 만들어내지 않는다.
- 구조가 달라지면 책임/인터페이스 복잡도, source-of-truth, 다음 변경 비용을 비교한다.
- source-grounded Frame이면 **요구사항 추적성**, **Domain Work Map 영향**, **Architecture/Data Flow 영향**을 필요한 requirement ID/lane/edge와 연결한다. 해당 없는 표를 의무 생성하지 않는다.
- `policy_axis_scan`, `backend_layer_map`, `architecture_flow_map`이 있으면 실제로 달라지는 정책·계층·소비 경계를 대조한다.
- 구조 이해에 도움이 되면 기존 TFT visual/call-flow를 사용한다. visual은 canonical을 대체하지 않는다.

## Step 4: 필요한 선택을 한 번 받기

```markdown
질문 제목: 접근 선택

현재 이해:
- 확인된 사실과 기존 계약

막힌 결정:
- 아직 정해지지 않은 중요한 기술적 손익

왜 중요한가:
- 선택에 따라 달라지는 공개 계약·보안·운영/되돌리기 비용

추천:
- 근거에 기반한 추천과 감수할 비용

선택 후 달라지는 것:
- A: 제공 범위와 수용할 비용
- B: 제공 범위와 수용할 비용

질문:
어떤 접근을 선택할까요?
```

사용자의 선택을 받으면 Step 5로 바로 기록한다. 저장 확인이나 이미 공개한 비용의 재승인은 필요하지 않다.

선택 후 새로운 중요한 근거가 발견되면 `기존 결정 / 새 근거 / 영향받는 slice / 가능한 대응`을 보여주고 달라진 판단만 묻는다. 위험도가 높다는 이유만으로 동일한 질문을 반복하지 않는다.

## Step 5: Canonical-first 기록과 해제

`decisions[]`에는 선택뿐 아니라 **왜 선택했고 어떤 비용을 수용했는지**를 남긴다.

```ts
type Decision = {
  id: string; // DEC-1 ...
  title: string;
  taskId?: string;
  alternatives_considered: string[];
  selected: string;
  rationale: string;
  tradeoffs_accepted: string;
  mitigations?: string[];
  requirementIds?: string[];
  domainLanesImpacted?: string[];
  architectureFlowImpacts?: string[];
  verifyHandoffHints?: string[]; // reuse/revise/add/drop/blocked 후보와 이유
  challenge?: { // 명시적 grill 또는 새 근거로 실제 추가 검토한 경우만
    intensity: "low" | "medium" | "high" | "ask_first";
    objection: string;
    response: "accepted" | "accepted_with_mitigation" | "reconsidered" | "returned_to_frame";
    userSelection: string;
  };
  challenged?: boolean; // legacy true 보존; 미수행은 false 또는 생략
  tftStudio?: { transcriptPath: string; transcriptRef: string; tab: "decide" };
  decidedAt: number;
};
```

1. 최신 canonical과 `updatedAt`을 읽고 해당 결정을 append한다. 같은 결정 ID를 중복 생성하지 않는다.
2. 대응하는 `decision_queue` 항목을 해소한다. 다른 미결정은 남기고, 그 결정을 참조하는 slice의 `blockedBy`/설명과 `implementation_plan`을 갱신한다.
3. `frame.json.tmp` → rename으로 atomic write하고, `provenance.canonicalHash`를 제외한 payload hash와 mirror를 Frame 규칙대로 갱신한다.
4. 연결된 `TaskUpdate`를 completed로 바꾸고 `decisionId`, `selected`, `decidedAt`을 남긴다. 실제 추가 검토를 한 경우에만 challenge metadata를 남긴다.
5. `work_context refresh` 후 선택한 slice와 열린 질문의 해제 상태를 확인한다. 불일치가 있으면 명시적으로 동기화한다. canonical 저장 성공을 실행 권한으로 해석하지 않는다.
6. frame이 없는 즉석 결정은 같은 근거·선택·tradeoff·완화책을 독립 파일에 저장한다.
7. Studio에 decision id/path, 남은 미결정과 영향 slice, 수용한 비용·완화책, transcript ref를 표시한다.

`challenge`는 선택적 이력이다. 기존 `challenged: true` 기록을 지우거나 새 기록에 거짓 challenge를 만들지 않는다. `/verify`는 challenge 유무가 아니라 실제 선택·약속한 완화책·검증 증거를 대조한다.

## Step 6: 다음 행동으로 연결

이미 승인된 다음 의도가 있으면 재메뉴 없이 수행한다. 의도가 없을 때만 현재 가능한 선택지를 제시한다.

| 현재 상태 | 다음 행동 |
|---|---|
| 다음 판단에 필요한 사실이 부족함 | 해당 사실을 좁게 조사 |
| 근거가 모인 중요한 미결정이 남음 | 다음 `/decide` 비교 |
| 결정과 독립적인 ready slice가 있고 구현 승인도 있음 | 해당 slice의 첫 실행 |
| 구현 계획을 원함 | 같은 Decide tab에서 `implementation_plan` 합성 |
| 새로운 실행·외부 쓰기·worktree 권한이 필요함 | 필요한 승인만 받기 |
| 사용자가 멈춤을 선택함 | canonical 저장 상태와 남은 판단을 남기고 종료 |

`Plan 모드`를 선택했다면 선택 요약으로 끝내지 않는다. slice 목표/범위/증거, 첫 안전 행동, readiness, ask-first gate를 합성·저장하고 같은 tab에 보여준다. 구현까지 이미 승인됐으면 준비된 범위를 시작하고, 계획만 요청했으면 구현 승인을 추정하지 않는다.

worktree/panel 이동은 기존 명시적 승인과 전용 도구 계약을 따른다. `/frame-v2`에서 Frame promotion fork를 선택했다면 `frame_v2_worktree_fork`를 사용한다. 실패를 다른 경로나 절대경로 작업으로 우회하지 않는다.

Studio를 사용했다면 canonical 저장과 실제 다음 행동/중단 결과를 `action=finish tab=decide`로 닫는다. 미해결 의존성이 있으면 이를 감춘 채 구현을 시작하지 않는다.

## 예시: 비교한 비용은 다시 묻지 않는다

```text
USER: /decide 검색 결과를 언제 갱신할지 정하자
AI: 현재 producer의 갱신 주기와 consumer의 신선도 요구를 조사한다.
AI: 요청마다 계산 vs 저장된 결과 재사용의 지연·신선도·장애복구 비용을 비교하고 추천한다.
USER: 저장된 결과를 재사용하자. 5분 지연은 허용하고 실패 시 마지막 결과를 보여줘.
AI: 선택·허용 지연·실패 처리·검증 조건을 DEC-1에 기록한다.
AI: 이미 비교한 비용의 유지/보완/재고 메뉴 없이 승인된 다음 행동으로 이어간다.
```

## 검증

- [ ] 사실 조사와 중요한 기술 선택을 구분했는가?
- [ ] 비교 근거·추천·수용한 비용이 canonical에 남았는가?
- [ ] 의무 반론·반복승인·가짜 대안을 만들지 않았는가?
- [ ] 해결한 결정은 큐/task/slice에서 해제되고 다른 미결정은 유지됐는가?
- [ ] 설계 승인과 외부 실행 승인을 구분했는가?
- [ ] 실제 다음 행동을 수행하거나 중단 결과를 기록하고 Studio를 finish했는가?
