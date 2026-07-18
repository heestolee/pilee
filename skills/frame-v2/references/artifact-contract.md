# Frame v2 artifact contract

Frame v2는 Frame, Study Hard, 구현을 하나의 상태 머신으로 합치지 않는다. 같은 work unit이라는 관계만 연결하고, 각 canonical은 독립적으로 유지한다.

## Canonical과 파생 view

| 영역 | Canonical | 파생·연결 artifact |
|---|---|---|
| 작업 기획 | standard `frame.json` | `frame.md`, Study Hard 최상단 작업 기획 view |
| 학습 | Study Hard state JSON | HTML/Notion snapshot |
| 조정 상태 | `frame-v2.json` | Pi transcript |
| 작업·학습 연결 | `learning-companion.json` | Study Hard companion section |
| 구현 | code, work context, task, verification | companion events/checkpoints |

`frame.json` 내용을 `noteDocument`에 복사하지 않는다. Study Hard의 작업 기획 dropdown은 Frame을 열 때 읽는 read-only 파생 view다.

## `frame-v2.json`

identity storage dir의 `frame-v2.json`은 내용 canonical이 아니라 runtime manifest다.

```json
{
  "schemaVersion": 1,
  "status": "drafting | refining | ready | started",
  "mode": "draft | guided",
  "entryMode": "frame-first | study-hard-first",
  "topic": "...",
  "identity": {
    "mode": "worktree | planning-ticket | planning-session",
    "key": "...",
    "displayTitle": "...",
    "storageDir": "...",
    "ticket": "optional",
    "sessionFile": "optional"
  },
  "studyHard": {
    "runId": "...",
    "statePath": "~/.pi/agent/study-hard/<runId>.json",
    "sourceUrl": "https://..."
  },
  "learningCompanion": {
    "manifestPath": "optional",
    "companionId": "optional"
  },
  "framePath": "<identity storage dir>/frame.json",
  "createdAt": 0,
  "updatedAt": 0
}
```

- `entryMode`는 시작 방향만 기록한다. 이후 lane 이동을 제한하지 않는다.
- `mode`는 이전 호출 호환과 최초 note 작성 방식이다. 사용자-facing 기본 진입은 시작 방향 선택 UI다.
- `status`는 aggregate runtime 기록이며 작업 허가 gate가 아니다.
  - `drafting`: manifest가 생기고 선택된 첫 lane이 진행 중
  - `refining`: 이전 linear run과의 호환 상태
  - `ready`: standard frame을 검증하고 companion 연결을 시도함
  - `started`: 전용 Frame promotion fork가 시작됨
- Manifest 수정은 temporary file을 쓴 뒤 rename한다.

## 시작 방향

```text
/frame-v2 <주제>
  ├─ Frame 먼저
  └─ Study Hard 먼저
```

명령 handler가 선택을 받고 `entryMode`에 저장한다. agent는 같은 선택을 다시 묻지 않는다.

두 lane은 이후 독립적으로 이어진다.

```text
Frame ──────────────┬─ 구현
                    ├─ Study Hard
                    └─ 구현 + Study Hard

Study Hard ─────────┬─ 학습만
                    ├─ Frame
                    ├─ 구현
                    └─ Frame + 구현
```

Frame v2 자체는 학습 완료·Frame ready를 다른 정상 구현 흐름의 hard gate로 쓰지 않는다. 기존 ask-first, protected worktree, DB·운영 승인 규칙은 그대로 적용한다.

## Study Hard-first adoption

Standalone `/study-hard` run도 나중에 같은 학습 기록으로 Frame lane을 추가할 수 있다.

```text
study_hard_board status
  → current runId/revision
  → frame_v2_state adopt-study-hard(runId)
  → frame-v2.json이 같은 runId/statePath를 참조
  → standard Frame 작성·보완
  → frame_v2_state ready
  → learning-companion 연결
```

`adopt-study-hard` 계약:

- existing runId와 state path 재사용
- noteDocument, nodes/flows, Q&A, revision을 수정하지 않음
- 현재 Frame identity storage에 manifest 생성
- frame.json을 대신 작성하지 않음
- 작업 시작을 허가하거나 차단하지 않음

Companion 연결은 기존 revision sequence에 새 metadata revision을 추가할 수 있다. 이전 note history와 Q&A를 초기화하지 않는다.

## Study Hard 작업 기획 view

Study Hard client state는 저장 state를 그대로 보내지 않고 Frame 존재 여부를 매번 materialize한다.

Frame 후보 순서:

1. `state.companion.frame.path`
2. current worktree `<cwd>/.pi/frame.json`

Frame이 있으면 client state에는 작은 metadata만 추가한다.

```json
{
  "workContract": {
    "title": "Frame · ...",
    "hash": "optional canonical hash"
  }
}
```

전체 내용은 dropdown을 펼칠 때 `GET /work-contract`로 lazy load한다.

- `frame.md`가 있으면 사람이 읽는 mirror를 렌더
- mirror가 없으면 `frame.json` 전체를 JSON code block으로 렌더
- 기본 접힘
- 학습노트 최상단
- noteDocument와 history snapshot에 복제하지 않음
- Frame이 없거나 읽을 수 없으면 field와 dropdown 모두 생략

HTML export도 같은 details view를 export 순간에 파생한다. Notion payload는 `workContract { title, hash, markdown }`를 noteDocument와 분리해 전달한다.

## Study Hard state

Study Hard state는 학습 원천이다.

- `noteDocument`: 학습자용 본문
- `nodes/edges`: concept/responsibility hierarchy
- `flows`: runtime/data/user action 순서
- `mermaid`: ERD 등 관계형 보조도
- `questions`: learner/coach thread와 이해 상태
- `revision`, history snapshots: 변경 이력
- `companion`: optional 작업 연결 metadata

학습 본문은 Frame 항목을 옮긴 문서가 아니라 다음 서사로 구성한다.

```text
배경 → 선수 지식 → Mental Model → Before/After
→ 데이터·실행 흐름 → 코드 읽기 → 원칙 → 한계 → 이해 확인
```

## Visual mapping

| 이해 대상 | Frame/TFT surface | Study Hard surface |
|---|---|---|
| Backend 책임 | `backend-layer-map` | hierarchy nodes + 책임 설명 |
| Runtime/Data/User flow | `architecture-flow` | `flows` + flow note section |
| DB/ERD/Migration | `data-model-migration-map` | Mermaid 또는 TFT visual block |
| 작업 계약 | Requirement Matrix / success criteria | 최상단 work contract dropdown |

보존할 TFT visual은 stable `type: "visual"` block과 원본 `visual` spec으로 전달한다. PNG나 prose만 남기지 않는다.

## Standard `frame.json`

Frame을 만들거나 보완할 때는 current `skills/frame/SKILL.md` schema와 atomic write 규칙을 그대로 사용한다. Frame v2 전용 축약 schema를 만들지 않는다.

권장 provenance:

```json
{
  "provenance": {
    "notes": [
      "Frame v2 manifest: <path>/frame-v2.json",
      "Study Hard state: <path>/<runId>.json",
      "Study Hard runId: <runId>",
      "HTML/Notion export: <optional refs>"
    ]
  }
}
```

`frame_v2_state ready`는 frame.json의 version, identity, goal, success criteria, verify plan, implementation plan, provenance를 확인한 뒤 companion 연결을 시도한다. 이 검증은 잘못된 Frame promotion을 막는 tool-local 조건이지, 일반 구현 전체의 새 gate가 아니다.

## Worktree continuation

`frame_v2_worktree_fork`는 **Frame promotion을 포함한 전용 fork**다.

- standard frame.json과 ready manifest 필요
- planning frame을 target worktree `.pi/frame.json`으로 승격
- transcript continuity와 companion runId 유지
- BLOCKED일 때 전용 fork가 시작되지 않은 것으로 취급

Frame이 없거나 전용 promotion이 필요하지 않은 구현은 기존 worktree·현재 worktree workflow를 사용한다. 전용 tool의 precondition을 Frame v2 전체의 작업 금지 규칙으로 일반화하지 않는다.
