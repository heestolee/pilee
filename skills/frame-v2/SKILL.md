---
name: frame-v2
description: Frame과 Study Hard 중 시작 방향을 선택하고, 작업 기획·학습·구현을 같은 work unit에서 순차 또는 병렬로 연결하는 pilot workflow. `/frame-v2`, “Frame 먼저 정리하고 공부”, “Study Hard부터 보고 작업으로 전환”, “작업과 학습 병행” 요청에 사용한다.
argument-hint: "<주제·티켓·URL>"
disable-model-invocation: false
---

# Frame v2

`/frame-v2`는 Frame, Study Hard, 구현을 한 줄로 강제하는 절차가 아니라 **서로 독립적인 작업·학습 흐름을 연결하는 coordinator**다.

명령 직후 extension이 다음 시작 방향을 물으며, 선택 결과는 runtime contract의 `entry mode`로 전달된다.

1. Frame 먼저
2. Study Hard 먼저

같은 선택을 다시 묻지 않는다.

## 핵심 모델

```text
같은 work unit
├─ Frame lane       작업 목표·범위·결정·성공 기준
├─ Study Hard lane  개념·Mental Model·Before/After·코드 읽기·이해 확인
└─ Work lane        구현·검증·리뷰
```

세 lane은 필요한 순서로 이동하거나 병행할 수 있다.

- Frame → 구현
- Frame → Study Hard → 구현
- Frame → 구현 + Study Hard 병행
- Study Hard → 학습만 완료
- Study Hard → Frame으로 작업 정리
- Study Hard → 작업 + Frame 보완

## 절대 규칙

1. **Frame v2 전용 hard gate를 만들지 않는다.** 학습 완료나 Frame v2 상태는 정보이지 작업 허가증이 아니다. 결제·보안·PII·DB·외부 연동 같은 기존 ask-first와 worktree 안전 규칙은 그대로 따른다.
2. Frame과 Study Hard는 하나의 문서나 canonical로 합치지 않는다.
   - `frame.json`: 작업 canonical
   - Study Hard state: 학습 canonical
   - `learning-companion.json`: 두 원천을 연결하는 optional sidecar
3. Frame 내용을 Study Hard 본문에 복사하지 않는다. 학습 본문은 학습자용 서사로 다시 구성한다.
4. Frame이 있으면 Study Hard 문서 최상단에 **전체 Frame을 읽기 전용·기본 접힘 작업 기획**으로 표시한다. Frame이 없으면 이 영역을 만들지 않는다.
5. 학습 인사이트가 작업 변경을 뜻하면 바로 Frame·task·코드를 바꾸지 않고 proposal로 남긴다. 사용자 수락 뒤 기존 `/decide`, work context, task, verify, 구현 workflow로 적용한다.
6. 사용자의 이해 여부는 artifact·정답·AI 판정으로 추정하지 않는다. 다만 이해 완료가 구현 시작의 필수 조건도 아니다.
7. companion 누락·손상은 구현·검증·commit·push를 막지 않는다.

## Runtime contract

Command shim이 다음 값을 제공한다.

- `entry mode`: `frame-first | study-hard-first`
- note mode: `draft | guided` — 이전 호출 호환과 내부 작성 방식
- frame identity와 storage dir
- `frame-v2.json` manifest path
- standard `frame.json` 예상 path
- Study Hard `runId`, state path, source URL
- 학습노트 skeleton

상세 artifact 계약은 `references/artifact-contract.md`를 따른다.

## 공통 시작 단계

1. command shim의 Frame identity와 선택된 `entry mode`를 읽는다.
2. `../frame/SKILL.md`의 source-grounded planning, Deep Interview, canonical write 규칙을 읽는다.
3. URL/Jira/Notion/Slack/PR/코드가 있으면 실제 source를 읽는다.
4. standard frame path에 `frame.json`이 있는지 확인한다.
5. 선택된 lane으로 바로 진행한다. 시작 방향을 다시 확인하지 않는다.

## Frame 먼저

### 1. 작업 기획 정리

현재 `/frame` 규칙으로 목표·범위·결정·성공 기준·구현 지도를 정리한다.

- 이미 유효한 `frame.json`이 있으면 덮어쓰지 말고 재진입 규칙을 따른다.
- 필요한 결정만 `/decide`로 보낸다.
- `frame_v2_state action=ready`는 frame.json을 검증하고 Study Hard run과 연결하는 상태 기록이다. 구현 허가 gate가 아니다.

### 2. 다음 흐름

Frame 정리 후 사용자 의도에 맞는 항목만 제시한다.

- 바로 구현
- Study Hard 열기
- 구현과 Study Hard 병행
- 여기서 멈춤

Study Hard를 선택하지 않아도 정상 흐름이다.

### 3. Study Hard 연결

Study Hard를 열기 직전에 frame path를 다시 확인한다.

- 있으면 learning companion을 연결하고 문서 최상단에 전체 Frame 작업 기획을 기본 접힘으로 표시한다.
- 없으면 Frame 없는 학습노트로 시작하고, 나중에 Frame이 생기면 같은 runId에 연결한다.

## Study Hard 먼저

### 1. Frame 존재 확인

Study Hard board를 열기 전에 standard frame path를 확인한다.

- Frame 있음: 같은 run과 연결하고 전체 Frame 작업 기획 dropdown을 제공한다.
- Frame 없음: dropdown 없이 학습을 시작한다. Frame 생성을 강제하지 않는다.

### 2. 학습노트 작성

학습노트는 Frame 항목 순서가 아니라 다음 학습 서사를 기본으로 한다.

1. 왜 이 작업이 필요한가
2. 먼저 알아야 할 개념
3. 핵심 Mental Model
4. Before / After · 무엇이 왜 바뀌는가
5. 데이터·실행 흐름
6. 실제 코드 읽는 순서
7. 재사용할 원칙
8. 한계와 오해하기 쉬운 점
9. 이해 확인

Frame의 Requirement Matrix, 결정, 성공 기준, verify plan, 구현 slice는 학습 본문에 그대로 펼치지 않는다. 필요한 내용만 사례·트레이드오프·코드 읽기 설명으로 변환하고 전체 원문은 작업 기획 dropdown에서 본다.

### 3. 이후 흐름

사용자가 원하는 시점에 다음으로 이어갈 수 있다.

- 계속 학습
- 이 학습으로 Frame 만들기
- 작업 먼저 시작
- 작업과 학습 병행
- 학습만 마치기

Study Hard에서 Frame을 만들 때는 새 학습 run을 만들지 않는다.

1. `study_hard_board action=status`로 현재 runId와 revision을 읽는다.
2. `frame_v2_state action=adopt-study-hard runId=<현재 runId>`로 같은 run을 Frame v2 manifest에 연결한다.
3. 학습에서 확인된 사실·위험·열린 작업 결정을 Frame draft의 입력으로 사용한다.
4. 부족한 계약만 현재 `/frame` 질문으로 채운다.
5. frame.json 작성 뒤 `frame_v2_state action=ready`로 companion을 연결한다.

Adopt 자체는 noteDocument·Q&A를 수정하지 않고 revision 숫자도 유지한다. 이후 companion 연결은 기존 revision sequence에 새 연결 revision 하나를 추가할 수 있지만, 이전 Q&A와 note history를 초기화하지 않는다.

## 작업과 학습 병행

같은 Pi session에서는 Study Hard Glimpse 창을 유지한 채 메인 agent나 worker가 구현을 진행할 수 있다.

- 작업 변화는 companion event/checkpoint로 요약한다.
- 학습 본문 변경은 Study Hard revision으로 남긴다.
- 학습에서 찾은 작업 변경은 proposal로 남긴다.
- proposal이 수락됐더라도 실제 decision/task/commit/evidence ref가 생기기 전에는 `applied`로 닫지 않는다.

별도 Pi panel을 쓸 때도 Frame·코드 writer와 Study Hard writer를 구분한다. 같은 canonical을 두 panel이 동시에 덮어쓰지 않는다.

## Study Hard 작업 기획 dropdown

Study Hard 렌더러는 매번 연결된 Frame의 존재를 확인한다.

```text
▶ 작업 기획 전체 보기 · Frame revision/hash
```

규칙:

- 학습노트 최상단, 기본 접힘
- 요약이 아니라 Frame 전체 내용
- `frame.json` 또는 해당 mirror에서 읽는 read-only 파생 view
- 목표·범위·가정·Requirement Matrix·결정·성공 기준·검증·구현 slice·열린 작업 질문 포함
- noteDocument에 복제하지 않음
- Frame이 없거나 읽을 수 없으면 dropdown 자체를 표시하지 않음
- Frame이 나중에 생기거나 갱신되면 다음 렌더에서 최신 내용 사용

## Visual과 refinement

- 구조 이해가 필요하면 현재 `tft-visual`, Mermaid, Study Hard flow 중 가장 적합한 형식을 고른다.
- TFT visual을 Study Hard에서 유지할 때는 `type: "visual"` block과 원본 spec을 보존한다.
- Tutor 답변은 Q&A 로그에만 쌓지 않고 Mental Model·실행 순서·오해 방지 설명에 흡수한다.
- 작업상 열린 결정과 학습자가 헷갈리는 질문을 구분한다.

## Export

- HTML/Notion은 현재 Study Hard revision snapshot을 사용한다.
- 작업 기획 dropdown도 Frame이 있으면 export에 포함하되 기본 접힘을 유지한다.
- Notion publisher가 없어도 HTML, 학습, 작업을 막지 않는다.

## Worktree와 구현

- Frame이 있고 Frame promotion을 포함한 fork를 원할 때만 `frame_v2_worktree_fork`를 사용한다.
- Frame이 없거나 해당 전용 fork가 필요하지 않으면 기존 worktree·구현 흐름을 사용한다. Frame v2가 별도 차단을 만들지 않는다.
- worktree 전환 뒤 companion이 있으면 같은 companionId/runId를 유지한다.
- 새 세션은 존재하는 canonical만 읽고 없는 artifact를 이유로 다른 정상 작업 흐름을 막지 않는다.

## Output contract

보고에는 현재 상태만 간결히 남긴다.

- 선택된 시작 방향
- Frame 존재/연결 여부
- Study Hard run과 현재 revision
- work/learning 진행 상태
- 학습 proposal 또는 작업상 열린 결정
- 사용자가 선택한 다음 행동

## Validation

- [ ] `/frame-v2 <주제>` 직후 `Frame 먼저 / Study Hard 먼저` 선택 UI가 열렸다.
- [ ] 선택 결과를 command가 다시 묻지 않고 prompt와 manifest에 보존했다.
- [ ] Study Hard 완료 여부가 구현 hard gate가 되지 않았다.
- [ ] Study Hard 시작 전에 Frame 존재 여부를 확인했다.
- [ ] Frame이 있으면 학습노트 최상단에 전체 기획 dropdown이 기본 접힘으로 보였다.
- [ ] Frame이 없으면 dropdown이 나타나지 않았다.
- [ ] 학습 본문은 Mental Model·Before/After·코드 읽기·이해 확인 중심이다.
- [ ] Frame과 Study Hard를 서로 복사 canonical로 만들지 않았다.
- [ ] Study Hard-first에서 Frame으로 전환해도 같은 runId·Q&A·revision을 유지했다.
- [ ] 작업·학습 병행 중 proposal이 수락·적용 ref 없이 작업 canonical을 바꾸지 않았다.
- [ ] 기존 ask-first, worktree 안전, visual, export, companion failure-isolation 규칙을 유지했다.
