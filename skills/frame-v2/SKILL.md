---
name: frame-v2
description: 기존 /frame과 /study-hard를 바꾸지 않고, 작업 이해를 먼저 학습노트로 만들고 Study Hard 방식으로 소화·다듬은 뒤 HTML/Notion 저장과 작업 시작까지 이어가는 pilot workflow. `/frame-v2`, “초안 먼저 frame”, “질문하며 학습노트”, “이해한 다음 작업 시작” 요청에 사용한다.
argument-hint: "[--draft|--guided] <주제·티켓·URL>"
disable-model-invocation: false
---

# Frame v2

`/frame-v2`는 **구현 전에 작업을 이해하는 학습노트**를 만들고, 사용자가 충분히 소화할 때까지 다듬은 뒤 기존 Frame-compatible 작업 계약으로 전환하는 독립 pilot이다.

기존 `/frame`, `/decide`, `/study-hard`의 동작과 저장 구조는 수정하지 않는다.

## 역할 분리

```text
/frame-v2
  ├─ --draft: 조사된 최초 학습노트를 먼저 제시
  └─ 기본/--guided: 현재 /frame 질문 규율로 함께 최초 학습노트 작성
       ↓
TFT Studio: 기존 Frame 시각화로 구조·ERD·flow 확인
       ↓
Study Hard board: 질문·답변·revision으로 소화하며 다듬기
       ↓
HTML / Notion export
       ↓
표준 frame.json 확정 → /decide 또는 구현/worktree 시작
```

## 절대 규칙

1. `/frame`과 `/study-hard` 구현을 대체하거나 암묵적으로 바꾸지 않는다.
2. **사용자의 이해 여부는 artifact 존재나 질문 정답으로 추정하지 않는다.** 사용자가 충분히 소화했다고 말해야 finalization으로 간다.
3. TFT Studio는 최초 구조화·시각화 surface, Study Hard board는 이후 소화·revision surface다. 같은 내용을 두 canonical로 유지하지 않는다.
4. refinement 전에는 Study Hard board state가 살아 있는 학습노트 원천이다. 작업 시작 전에는 표준 `frame.json`이 canonical로 승격된다.
5. `--draft`는 최초 학습노트를 보여주기 전 계약 질문을 하지 않는다. 불확실성은 가정·열린 질문으로 표시한다.
6. guided mode는 질문을 임의로 줄이거나 늘리지 않고 현재 `../frame/SKILL.md`의 Deep Interview, `(명백)`, Productive Resistance 규율을 그대로 따른다.
7. 코드·문서·티켓으로 확인 가능한 사실을 사용자에게 되묻지 않는다. 다만 목표·범위·성공 기준·검증 축처럼 사용자의 계약을 바꾸는 값은 현재 Frame 규칙대로 확인한다.
8. 작업 시작 뒤에도 Study Hard와 Frame을 하나의 canonical로 합치지 않는다. `frame.json`은 작업 canonical, Study Hard state는 학습 canonical이며 `learning-companion.json`은 두 원천을 잇는 sidecar다. sidecar 실패는 구현·검증·commit·push를 막지 않는다.

## Runtime contract

Command shim이 다음 값을 prompt에 제공한다.

- mode: `draft | guided`
- frame identity와 storage dir
- `frame-v2.json` manifest path
- Study Hard `runId`, source URL, 예상 state path
- ready 이후 생성되는 `learning-companion.json` sidecar
- 초기 학습노트 skeleton

상세 저장 계약은 `references/artifact-contract.md`를 읽는다.

## Workflow

### 1. 기존 Frame 규칙과 source를 읽는다

1. command shim의 Frame identity hint를 우선한다.
2. `../frame/SKILL.md`에서 다음 현재 규칙을 읽는다.
   - 기획 근거 대응형 Frame
   - Backend Layer Map / Architecture Flow / Data Model Migration Map gate
   - Deep Interview 질문 규율
   - Canonical-first 저장 원칙
   - Step 8/9와 `frame.json` schema
3. URL/Jira/Notion/Slack/PRD/코드가 있으면 실제 source를 먼저 읽는다.
4. 구현은 시작하지 않는다.

### 2. 최초 학습노트를 만든다

두 모드는 **질문의 순서만 다르고 산출물 품질은 같다.**

#### `--draft` — 초안 먼저

- 조사 가능한 source와 코드 구조를 먼저 읽는다.
- 완전한 최초 학습노트를 TFT Studio에 먼저 보여준다.
- 확인하지 못한 내용은 `가정`, `열린 질문`, `근거 부족`으로 표시한다.
- 사용자가 초안을 본 뒤 정정·질문을 시작한다.

#### guided — 질문하며 만들기

- 현재 `/frame`의 질문 규율을 그대로 따른다.
- 질문이 많았던 원래 목적은 당연한 전제를 몰래 확정하지 않는 것이다. 이를 “질문을 줄여라”로 재해석하지 않는다.
- 한 번에 한 가지 결정만 묻는다.
- 권장 답이 명백해도 계약을 바꾸면 `(명백: 근거)`를 보여주고 확인한다.
- 질문 자체가 목적이 되지 않도록 source로 닫힌 사실은 AI가 채운다.

최초 노트에는 필요할 때 다음을 포함한다.

- 문제와 목표, mental model
- 확인된 사실 / 가정 / 열린 질문
- Requirement Matrix와 Domain Work Map
- 데이터 모델·ERD·PK/FK/UNIQUE/fallback
- Backend Layer Map
- Architecture/Data/User Action Flow
- 성공 기준, 검증 evidence, 구현 slice 초안
- Productive Resistance 결과

### 3. TFT Studio에서 현재 Frame 시각화를 사용한다

1. `frame_studio action=start tab=frame`으로 identity-bound TFT Studio를 연다.
2. 최초 학습노트 markdown을 `frame_studio action=update tab=frame`으로 렌더링한다.
3. 구조 이해가 필요한 경우 현재 Frame 형식의 fenced `tft-visual`을 사용한다.
   - `kind: "backend-layer-map"`
   - `kind: "architecture-flow"`
   - `kind: "data-model-migration-map"`
4. 시각 자료 선택 기준은 `../frame/SKILL.md` gate를 그대로 따른다. TFT visual, Mermaid, Study Hard flow 중 주제에 가장 적합한 표현을 고르고, 단순 작업에 모든 지도를 의례적으로 그리지 않는다.
5. Study Hard에서도 계속 볼 TFT visual은 원본 spec을 유지한 stable note block으로 넘긴다: `{"id":"...","type":"visual","title":"...","body":"...","visual":{...}}`. prose나 screenshot-only placeholder로 평탄화하지 않는다.
6. guided mode 질문은 `frame_studio action=ask tab=frame`으로 묻는다. `unavailable/cancelled/timeout`일 때만 번호형 fallback을 쓴다.
7. 최초 노트가 정리되면 Studio에 “Study Hard로 넘길 내용”을 한 번 보여주고 `frame_studio action=finish tab=frame`으로 닫는다.

### 4. Study Hard board로 전환한다

최초 노트가 생긴 뒤에만 `study_hard_board action=start`를 호출한다.

필수 전달값:

- command shim의 `runId`, `sourceUrl`, title, hints
- `noteDocument`: TFT Studio 최초 학습노트의 구조화 버전. 보존할 TFT visual은 `type: "visual"` block과 원본 `visual` spec을 포함한다.
- `nodes/edges`: 개념·책임의 hierarchy만 표현
- `flows`: runtime/data/user-action sequence
- `mermaid`: ERD처럼 관계도가 더 직관적인 경우 보조 사용
- `goals`, `quickMap`, `summary`, `recommendedNodeId`

전환 뒤에는 Study Hard board가 학습노트 원천이다. TFT markdown과 별도 복사본을 동시에 수동 갱신하지 않는다.

### 5. 사용자가 소화할 때까지 다듬는다

- 사용자가 board에서 문단/노드/flow를 선택해 질문할 수 있게 한다.
- Tutor 답변 → Editor 병합 → revision 기록 흐름을 존중한다.
- 답변을 Q&A 로그로만 붙이지 말고 mental model, 실행 순서, 오해 방지 설명으로 기존 문단에 흡수한다.
- 사용자의 정정은 기존 확정 사실보다 우선하되 source와 충돌하면 충돌을 드러낸다.
- 새 질문으로 계약이 바뀌면 성공 기준·검증·구현 지도도 함께 갱신한다.
- 사용자가 “더 봐야 할 것 없다”, “이해했다”, “작업하자”처럼 명시하기 전에는 finalization을 서두르지 않는다.

### 6. Export

- HTML은 Study Hard board의 `HTML 내보내기`를 사용한다. TFT visual은 동작하는 self-contained renderer와 PNG fallback, 원본 spec을 함께 보존한다.
- Notion은 runtime profile/`STUDY_HARD_SYNC_SCRIPT`가 있을 때 `Notion 저장`을 사용한다. TFT visual은 전체 container 고해상도 PNG와 설명, 원본 spec toggle로 저장한다.
- Notion publisher가 없어도 HTML과 작업 시작은 막지 않는다.
- export는 현재 revision snapshot 기준이며, 저장 중 바뀐 revision은 사용자에게 알린다.

### 7. 표준 Frame으로 확정한다

사용자가 충분히 소화했다고 확인하면 현재 Study Hard state를 표준 Frame 계약으로 합성한다.

1. `../frame/SKILL.md` Step 8과 §5 schema를 다시 읽는다.
2. identity storage dir에 `frame.json.tmp → rename` 순서로 표준 `frame.json`을 쓴다.
3. `provenance`에 `frame-v2.json`, Study Hard state path/runId, export artifact를 refs로 남긴다.
4. `canonicalHash`를 계산하고 `frame.md` mirror를 재생성한다.
5. 남은 decision은 `decision_queue`, 열린 검증은 `verify_plan`, 실행 단위는 `implementation_plan.slices[]`로 보존한다.
6. `frame-v2.json.status`를 `ready`로 갱신한다.
7. `frame_v2_state action=ready`가 Frame ref와 Study Hard runId를 `learning-companion.json`으로 연결한다. Study Hard state가 아직 없으면 sidecar만 보존하고 작업은 계속한다.
8. canonical write 전에는 worktree fork나 구현을 시작하지 않는다.

### 8. 다음 행동

다음 중 현재 상황에 맞는 것만 묻는다.

1. Study Hard에서 더 다듬기
2. HTML / Notion 저장
3. `/decide`로 남은 판단 처리
4. fork해서 구현 시작
5. 현재 worktree에서 구현 시작
6. 여기서 멈춤

- `fork해서 구현 시작`이면 `frame_v2_worktree_fork` tool을 호출한다.
- tool이 `BLOCKED`면 절대경로로 구현을 이어가지 말고 이유를 보고한다.
- 현재 worktree 구현이면 `work_context refresh/set_slice` 후 첫 slice부터 시작한다.

### 작업 시작 뒤 Companion continuity

- worktree fork는 `.pi/learning-companion.json`을 retarget하되 같은 `companionId`와 Study Hard `runId`를 유지한다.
- `/study-hard current`는 현재 sidecar의 run을 다시 열며 새 URL 학습 prompt를 시작하지 않는다.
- `learning_companion record/checkpoint`는 slice 완료, 검증 판정, pre-PR, review round, merge처럼 의미 있는 전환에만 사용한다. 모든 tool call이나 commit 준비 과정을 기록하지 않는다.
- 학습 중 더 나은 방향을 발견하면 `learning_companion action=propose`로 먼저 제안한다. `proposed`/`accepted` 상태는 `frame.json`, work context, task, 코드를 직접 수정하지 않는다.
- 사용자가 수락하면 기존 `/decide`, `work_context`, task, `/verify`, 구현 workflow로 반영하고, 실제 decision/task/commit/evidence ref가 생긴 뒤에만 proposal을 `applied`로 닫는다.
- companion이 없거나 손상됐으면 경고만 남기고 기존 작업 흐름을 계속한다.

## Output contract

채팅 완료 보고는 짧게 유지한다.

- 현재 단계: 최초 노트 / Study Hard refinement / ready
- artifact: `frame-v2.json`, Study Hard state, `frame.json`, export refs
- 남은 열린 질문/decision
- 선택된 다음 행동

## Validation

완료 전에 확인한다.

- [ ] `--draft`가 최초 노트 전 질문을 강제하지 않았다.
- [ ] guided mode가 현재 Frame 질문 규율을 임의로 재해석하지 않았다.
- [ ] 필요한 ERD/flow/layer map이 TFT Studio에서 직관적으로 보였다.
- [ ] Study Hard board에 최초 노트가 구조 손실 없이 넘어갔고, 보존 대상 TFT visual은 `visual` block 원본 spec으로 다시 렌더됐다.
- [ ] 같은 visual fixture가 live note, HTML renderer + PNG fallback, Notion PNG + spec toggle에 모두 연결됐다.
- [ ] 사용자가 이해 완료를 말하기 전 `frame.json` ready/구현 시작을 선언하지 않았다.
- [ ] export와 worktree 시작이 서로 독립적으로 가능하다.
- [ ] worktree 전환 뒤에도 같은 companionId/runId로 `/study-hard current`가 열린다.
- [ ] 학습 제안은 사용자 수락과 기존 workflow 적용 전 작업 canonical을 바꾸지 않는다.
- [ ] companion 누락·손상이 구현·검증·commit·push를 차단하지 않는다.
- [ ] 기존 `/frame`, URL 기반 `/study-hard` 동작을 변경하지 않았다.
