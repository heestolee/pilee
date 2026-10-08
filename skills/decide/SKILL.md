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

## 결정 surface 선택

**구현 중 추가 결정은 현재 대화가 기본 surface다.** 이 스킬의 조사·비교·기록 계약만 재사용하며 `/decide` 호출이나 웹뷰를 요구하지 않는다. 채팅에서 선택을 받았으면 canonical과 Task/work_context를 갱신하고 승인된 작업으로 돌아간다.

사용자가 명시 `/decide`를 호출하거나 웹뷰 비교를 요청한 경우에는 Pi UI와 `frame_studio`가 있으면 같은 work unit의 `tab=decide`를 사용한다. 사용자가 채팅을 원하면 채팅을 우선한다. 복잡한 비교에 visual이 유용하더라도 결정·저장은 웹뷰 가용성과 독립적이다.

### Studio를 선택한 결정만

아래 규칙은 이번 결정을 Studio에서 진행할 때만 적용한다. 과거에 같은 work unit의 창을 열었다는 이유로 inline decision을 Studio 결정으로 취급하지 않는다.

- 조사 결과와 비교표는 `action=update`로 보여준다.
- 실제 선택이 필요할 때만 `action=ask`를 쓴다. `question`은 짧은 제목, 판단 맥락 카드는 `markdown`에 넣는다.
- `unavailable`, `cancelled`, `timeout`이면 번호형 text-mode fallback을 쓴다. UI에서 받은 선택을 채팅으로 다시 확인하지 않는다.
- 이번 결정을 Studio에서 진행했다면 canonical 저장 후 실제 다음 행동 또는 중단 결과까지 기록하고 `action=finish`로 닫는다.
- 채팅 결정의 state 저장만으로 `frame_studio`의 update/finish/open을 호출하거나 창을 재오픈하지 않는다. 기존 창에 설명을 mirror하는 것은 별도 필요·요청이 있을 때의 선택 사항이며 canonical 저장 조건이 아니다.
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

## Step 4: Pending 기록 후 필요한 선택을 한 번 받기

질문 전에 최신 canonical을 읽어 `decision_queue`에 stable ID(`id`, 예: `DEC-1`), 제목, 조사 근거(`evidence`), 영향 slice(`blocks`와 slice의 `blockedBy`), 다음 행동(`nextAction`)을 기록한다. 기존 pending 항목은 같은 ID를 재사용한다. legacy 항목에 `taskId`만 있으면 이를 연결 키로 보존하고 결정 ID와 매핑한다. Step 5와 같은 atomic write/hash/mirror 규칙을 적용한 뒤 기존 TaskCreate/TaskUpdate로 `kind="decision"`, `owner="user"`, `metadata.kind="frame.decision"`인 pending Task를 연결하고, 반환된 `taskId`를 canonical에 반영한다. `work_context refresh`로 해당 slice만 막혔는지 확인한다.

Frame이 없으면 `<cwd>/.pi/decisions/<YYYY-MM-DD>-<slug>.md`에 같은 stable ID·근거·영향·다음 행동과 pending 상태를 기록한다. 즉석 결정을 위해 Frame이나 Studio를 새로 만들지 않는다.

선택한 surface에서 아래 맥락과 선택지를 제시하고 **명시 답변을 기다린다**. 구현 중에는 현재 대화에서 묻고, 명시 `/decide`·웹뷰 요청으로 Studio를 선택했다면 해당 탭의 `ask`로 묻는다. 침묵·취소·모호한 답은 승인이 아니다. 명시적 보류도 pending 유지이지 구현 승인이 아니다. 답변 전에는 `decisions[]`에 선택을 기록하거나 Task를 completed로 바꾸거나 의존 구현을 시작하지 않는다. 독립적이며 승인된 ready slice는 계속할 수 있다.

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

사용자의 명시 선택을 받으면 Step 5로 바로 기록한다. 번호 또는 자연어 선택이 어느 대안인지 명확하면 충분하며 저장 확인이나 이미 공개한 비용의 재승인은 필요하지 않다. 모호하면 결정에 필요한 차이만 다시 묻고 pending을 유지한다.

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

1. 최신 canonical과 `updatedAt`/hash를 다시 읽고 pending과 같은 ID로 `decisions[]`에 선택·이유·수용한 손익·`taskId`·`decidedAt`을 기록한다. 대화 중 다른 변경을 덮어쓰지 않고, 재시도 시 같은 결정 ID를 중복 생성하지 않는다.
2. 대응하는 `decision_queue` 항목만 해소한다. 해당 선택으로 해결된 `risk_register.needs_decision`, slice의 `blockedBy`/설명, `implementation_plan`의 blockers/status/derivedFrom/첫 안전 행동을 갱신한다. 다른 미결정과 다른 task blocker는 보존한다. 남은 결정이 있으면 전체 plan의 `blocked_by_decision`은 유지할 수 있지만 독립 slice까지 막지 않는다.
3. 선택으로 달라진 성공 기준·`verify_plan`·slice validation을 반영하고 `verifyHandoffHints`를 남긴다. 새 계약에 맞지 않는 기존 검증 결과는 재검증 대상으로 표시하며, 선택 저장 자체를 검증 PASS로 만들지 않는다.
4. `frame.json.tmp` → rename으로 atomic write하고, `provenance.canonicalHash`를 제외한 payload hash와 `frame.md` mirror를 Frame 규칙대로 갱신한다. canonical write 실패 시 Task 완료/의존 slice 재개를 하지 않는다. mirror만 실패하면 그 gap을 알리고 재생성한다.
5. canonical 저장 성공 후 해당 `taskId`만 `TaskUpdate status=completed`로 바꾸고 metadata에 `decisionId`, `selected`, `decidedAt`을 남긴다. 기존 Task 도구는 completed 의존성을 열린 blocker에서 제외하므로 `blockedBy` 배열을 통째로 비우지 않는다. linked slice/verify Task의 설명·acceptance도 달라진 계약에 맞추되 실제 완료 전 completed로 바꾸지 않는다. 실제 추가 검토를 한 경우에만 challenge metadata를 남긴다.
6. `work_context refresh` 후 `openQuestions`, 영향받는 slice, verify focus를 확인한다. 필요하면 `set_slice`로 승인된 ready slice를 선택해 재개한다. Task/work_context 동기화가 실패하면 canonical을 되돌리거나 해결됐다고 보고하지 말고 남은 동기화 gap부터 복구한다. canonical 저장 성공을 새 실행 권한으로 해석하지 않는다.
7. Frame 없는 즉석 결정은 pending 기록과 같은 파일/ID에 선택·이유·수용한 손익을 반영한다. 연결된 Task/work_context가 있으면 해당 결정만 동기화하고 다른 질문은 보존한다.
8. 채팅에는 decision ID와 저장 위치·다음 행동을 짧게 보고한다. 이번 결정을 Studio에서 진행한 경우에만 그 탭에 결과와 transcript ref를 표시한다.

`challenge`는 선택적 이력이다. 기존 `challenged: true` 기록을 지우거나 새 기록에 거짓 challenge를 만들지 않는다. `/verify`는 challenge 유무가 아니라 실제 선택·약속한 완화책·검증 증거를 대조한다.

## Step 6: 다음 행동으로 연결

이미 승인된 다음 의도가 있으면 재메뉴 없이 수행한다. 의도가 없을 때만 현재 가능한 선택지를 제시한다.

| 현재 상태 | 다음 행동 |
|---|---|
| 다음 판단에 필요한 사실이 부족함 | 해당 사실을 좁게 조사 |
| 근거가 모인 중요한 미결정이 남음 | 구현 중에는 현재 대화에서 다음 결정을 묻고 기록. 명시 `/decide`/웹뷰 요청이면 해당 경로 사용 |
| 결정과 독립적인 ready slice가 있고 구현 승인도 있음 | 해당 slice의 첫 실행 |
| 구현 계획을 원함 | 현재 surface에서 `implementation_plan` 합성·저장 |
| 새로운 실행·외부 쓰기·worktree 권한이 필요함 | 필요한 승인만 받기 |
| 사용자가 멈춤을 선택함 | canonical 저장 상태와 남은 판단을 남기고 종료 |

`Plan 모드`를 선택했다면 선택 요약으로 끝내지 않는다. slice 목표/범위/증거, 첫 안전 행동, readiness, ask-first gate를 합성·저장하고 현재 surface에 보여준다. 구현까지 이미 승인됐으면 준비된 범위를 시작하고, 계획만 요청했으면 구현 승인을 추정하지 않는다.

worktree/panel 이동은 기존 명시적 승인과 전용 도구 계약을 따른다. `/frame-v2`에서 Frame promotion fork를 선택했다면 `frame_v2_worktree_fork`를 사용한다. 실패를 다른 경로나 절대경로 작업으로 우회하지 않는다.

이번 결정을 Studio에서 진행했다면 canonical 저장과 실제 다음 행동/중단 결과를 `action=finish tab=decide`로 닫는다. 채팅 결정이면 Studio를 호출하지 않는다. 미해결 의존성이 있으면 이를 감춘 채 구현을 시작하지 않는다.

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
- [ ] 질문 전 pending을 기록하고 명시 답변 전에는 의존 구현·완료 처리를 보류했는가?
- [ ] 채팅 결정이 웹뷰 없이 canonical/verify/Task/work_context에 반영됐는가?
- [ ] 실제 다음 행동을 수행하거나 중단 결과를 기록했는가? 이번 결정을 Studio에서 진행한 경우에만 finish했는가?
