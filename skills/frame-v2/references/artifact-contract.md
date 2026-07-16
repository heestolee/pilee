# Frame v2 artifact contract

Frame v2는 단계별 원천을 명확히 나눈다. 같은 의미를 여러 파일에 동시에 수동 유지하지 않는다.

## Artifact lifecycle

| 단계 | Canonical | Mirror / provenance |
|---|---|---|
| command 시작 | `frame-v2.json` runtime manifest | Pi transcript |
| 최초 노트 | TFT Studio transcript는 임시 drafting surface | `frame-v2.json`이 run refs 보존 |
| refinement | Study Hard state JSON | TFT transcript, HTML/Notion snapshot |
| 작업 준비 완료 | 표준 `frame.json` | `frame.md`, Study Hard state, export refs |

## `frame-v2.json`

identity storage dir의 `frame-v2.json`은 workflow runtime manifest다. 기획 내용 자체를 중복 저장하지 않는다.

```json
{
  "schemaVersion": 1,
  "status": "drafting | refining | ready | started",
  "mode": "draft | guided",
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
    "runId": "frame-v2-...",
    "statePath": "~/.pi/agent/study-hard/<runId>.json",
    "sourceUrl": "https://..."
  },
  "framePath": "<identity storage dir>/frame.json",
  "createdAt": 0,
  "updatedAt": 0
}
```

Status transition:

```text
drafting → refining → ready → started
```

- `drafting`: 최초 학습노트 생성 중
- `refining`: Study Hard board로 전환됨
- `ready`: 사용자가 이해 완료를 확인했고 표준 `frame.json` 저장 완료
- `started`: worktree/current worktree에서 구현 시작

Manifest 수정은 temporary file을 쓴 뒤 rename한다.

## Study Hard state

Study Hard state가 refinement 단계의 학습노트 원천이다.

- `noteDocument`: 읽고 다듬는 본문
- `nodes/edges`: concept/responsibility hierarchy
- `flows`: runtime/data/user action 순서
- `mermaid`: ERD 등 관계형 보조도
- `questions`: learner/coach thread와 이해 상태
- `revision`, history snapshots: 변경 이력

TFT Studio에서 만든 최초 markdown을 그대로 문자열 한 덩어리로 넣지 않는다. `noteDocument.sections[].blocks[]`로 구조화하고, 시각 자료는 목적에 맞는 board field로 분리한다.

## Visual mapping

| 이해 대상 | TFT Studio 최초 surface | Study Hard refinement surface |
|---|---|---|
| Backend 책임 | `tft-visual kind=backend-layer-map` | hierarchy nodes + 책임 note section |
| Runtime/Data/User flow | `tft-visual kind=architecture-flow` | `flows` + flow note section |
| DB/ERD/Migration | `tft-visual kind=data-model-migration-map` | Mermaid ERD + data model note section |
| Requirement ownership | Requirement Matrix / Domain Work Map | contract note section + concept refs |

TFT visual JSON과 Study Hard state를 1:1 UI schema로 억지로 맞추지 않는다. 의미가 같은지 검산하고 각 surface에 맞게 변환한다.

## Standard `frame.json` promotion

작업 시작 전에는 반드시 current `skills/frame/SKILL.md` Step 8과 §5 schema를 읽어 표준 `frame.json`을 생성한다. Frame v2 전용 축약 schema를 만들지 않는다.

추가 provenance 권장값:

```json
{
  "provenance": {
    "transcriptPath": "<TFT Studio transcript>",
    "notes": [
      "Frame v2 manifest: <path>/frame-v2.json",
      "Study Hard state: <path>/frame-v2-....json",
      "Study Hard runId: frame-v2-...",
      "HTML export: <optional path>",
      "Notion export: <optional URL>"
    ]
  }
}
```

Promotion gate:

1. 사용자가 이해 완료를 명시했다.
2. Study Hard 최신 revision의 목표·가정·열린 질문을 읽었다.
3. 성공 기준과 검증 evidence가 닫힌 문장이다.
4. 남은 결정은 숨기지 않고 `decision_queue`에 있다.
5. implementation plan은 decision 상태와 모순되지 않는다.
6. atomic write와 canonical hash 검증이 끝났다.
7. `frame.md` mirror가 regenerated 됐다.

이 gate 전에는 `frame_v2_worktree_fork`를 호출하지 않는다.

## Worktree continuation

`frame_v2_worktree_fork`는 `/frame-v2` command context를 재사용해 실제 `/wt fork` 경로를 실행한다.

- planning `frame.json`은 target worktree `.pi/frame.json`으로 승격된다.
- full transcript continuity가 기본이다.
- 새 세션 follow-up은 promoted `.pi/frame.json`과 Study Hard state ref를 읽는다.
- tool이 `BLOCKED`를 반환하면 worktree를 만들지 않은 것으로 취급한다.
- 절대경로로 target worktree 구현을 대신 진행하지 않는다.
