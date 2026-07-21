---
title: Study Hard 엔진은 public이고 개인 publisher만 private다
tags:
  - study-hard
  - public-private-boundary
  - notion
  - runtime-profile
  - local-state
category: architecture
status: active
confidence: high
applies_to:
  - extensions/study-hard
  - extensions/learning-companion
  - extensions/utils/private-profiles
source:
  - user-direction:2026-07-17-study-hard-public-migration
  - user-direction:2026-07-21-study-hard-notion-static-export
reviewed_at: 2026-07-21
reviewed_commit: 778f16ee03062c7b383aec477972f501372b7623
related:
  - private-overlay-package-boundary
  - context-loading-minimal-surface
  - live-artifact-preview-pattern
  - embedded-webview-script-escape-boundary
  - frame-v2-learning-note-pilot
  - learning-note-companion-artifact
  - study-hard-worker-flexible-generation-strict-apply
---

## Judgment

Study Hard의 concept map, flow, 학습노트, Tutor/Editor/Coach, revision, HTML export, local state는 특정 회사나 개인 정보에 의존하지 않는 범용 Pi 학습 엔진입니다. 이 엔진은 public pilee에 둡니다.

개인 Notion database와 연결되는 sync script 위치, 개인 Downloads 경로 같은 실행 값만 private runtime profile 또는 환경변수에 둡니다.

## Public Engine

Public `extensions/study-hard`가 소유하는 범위:

- `/study-hard` command와 `study_hard_board` tool
- concept hierarchy와 runtime flow model
- 구조화 `noteDocument`와 canonical TFT `visual` block
- P0-linked `study-hard-worker --main` 병렬 처리, 3-way note merge, Coach navigation
- Q&A transcript integration
- revision/history snapshot과 restore
- standalone HTML export와 interactive visual/PNG fallback
- macOS Glimpse native visual snapshot, 비-macOS browser capture fallback
- `~/.pi/agent/study-hard` local state lifecycle
- optional learning companion event/checkpoint/proposal metadata와 `/study-hard current` reopen
- capability token, origin/host check, worker secret stripping

이 기능은 publisher가 없어도 완전하게 동작해야 합니다.

## Private Publisher Profile

Public engine은 다음 generic 설정만 읽습니다.

```json
{
  "studyHard": {
    "syncScript": "{home}/path/to/study_hard_sync.py",
    "downloadDir": "{home}/Downloads"
  }
}
```

환경변수 `STUDY_HARD_SYNC_SCRIPT`, `STUDY_HARD_DOWNLOAD_DIR`가 profile보다 우선합니다. 구체적인 개인 경로와 Notion destination 규칙은 private overlay 또는 local config에 남습니다.

Notion token, database ID, page naming, upload body schema를 public extension에 넣지 않습니다. Public engine은 generic visual PNG asset과 원본 spec까지만 publisher에 넘기고, private publisher가 이를 Notion image block·설명·spec toggle로 변환합니다. Publisher가 없어도 HTML export와 학습·작업 시작은 계속 가능합니다.

### Publisher Readability Rule

Publisher는 화면 snapshot을 그대로 업로드하는 것으로 완료하지 않습니다.

- PNG는 전체 구조를 빠르게 읽는 overview로 사용합니다.
- visual spec의 관계·migration·verification처럼 핵심 판단에 필요한 상세는 Notion native heading/table/list로 기본 노출합니다.
- raw JSON·Mermaid처럼 보조적인 source만 toggle에 두고, toggle 제목에는 visual 종류·주제·항목 수를 넣습니다.
- generic `원본 spec 보기`나 정적 PNG 안의 닫힌 disclosure만 남아 독자가 내용을 추측해야 하면 publish 실패입니다.
- 실제 저장 뒤에는 page block ancestry와 업로드 image hash를 다시 읽어 visible 배치와 artifact 일치를 확인합니다.

## Migration Rule

Private에서 public으로 옮길 때는 source를 복사한 뒤 양쪽 command를 동시에 유지하지 않습니다.

1. 최신 private 엔진과 회귀 테스트를 public으로 이관합니다.
2. 개인 경로를 runtime profile interface로 치환합니다.
3. public tests가 통과한 뒤 private duplicate extension과 전용 dependencies를 제거합니다.
4. private에는 profile만 남깁니다.
5. 실제 package load에서 `/study-hard`와 `study_hard_board`가 한 번만 등록되는지 확인합니다.

## State Compatibility

Public 이관 뒤에도 기본 state dir과 schema를 바꾸지 않습니다. 기존 `~/.pi/agent/study-hard/*.json`은 그대로 reopen할 수 있어야 합니다. 이관을 이유로 학습 기록을 복사하거나 reset하지 않습니다.

Frame v2 작업에 연결된 state만 optional `companion` metadata를 가집니다. 일반 URL 기반 Study Hard state에는 이 필드가 없어도 기존과 동일하게 동작합니다. Live/HTML은 companion이 있을 때만 작업 timeline과 proposal을 조건부 렌더하고, Notion publisher는 이 optional field를 지원하지 않더라도 기존 noteDocument·visual 저장을 계속해야 합니다.

## Transcript Hydration Rule

현재 session에서 새로 생긴 질문, Tutor 답변, Coach 확인, note merge는 Pi transcript에 그대로 남겨 후속 대화가 방금 일어난 학습 흐름을 이어받게 합니다. 반면 persisted run을 다른 Pi session에서 다시 열 때는 과거 Q&A event 전체를 `sendMessage`로 재생하지 않습니다.

- 같은 session에 이미 있는 event는 stable event key로 중복 발행하지 않습니다.
- 새 session에서는 기존 질문 수, 적용/실패 수, 최근 주제와 run reference를 담은 summary 하나만 연결합니다.
- 질문·답변 전문은 Study Hard state와 보드가 보존하며, 필요할 때 UI에서 다시 봅니다.
- `triggerTurn: false`는 즉시 agent turn만 막을 뿐, `sendMessage`로 보낸 긴 historical event가 LLM context에서 사라진다는 뜻이 아닙니다.

이 경계가 없으면 이전 질문이 새 사용자 prompt처럼 연속 노출되고, 현재 질문과 폐기된 시행착오가 같은 무게로 섞입니다. durable artifact 보존과 현재 LLM context hydration을 같은 것으로 취급하지 않습니다.

## Worker Scope And Apply Rule

Glimpse의 learner 질문은 P0가 실제 `study-hard-worker --main` subagent로 dispatch합니다. 선택 surface는 worker가 시작할 초점과 근거를 제공하지만 쓰기 경계로 사용하지 않습니다. worker는 사용자 의도를 닫는 데 필요한 전체 `proposedNoteDocument`를 만들 수 있습니다.

안전 경계는 생성 범위가 아니라 적용 권한입니다.

- worker는 Study Hard state를 직접 수정하지 않고 question별 result artifact만 씁니다.
- P0 transcript에는 artifact path, worker #N, 짧은 summary와 최종 feedback만 남깁니다.
- merge coordinator가 base/proposed/current를 비교해 실제 changed path를 계산합니다.
- disjoint 블록·필드·삽입은 완료 순서와 무관하게 보존합니다.
- 같은 필드의 다른 변경, 삭제 대 수정, 양립 불가능한 순서 변경은 conflict로 둡니다.
- 첫 conflict는 같은 worker run을 최신 state로 한 번 continue하고, 재충돌은 P0 판단으로 남깁니다.
- artifact hash로 duplicate completion을 멱등 처리합니다.

이 계약은 **생성은 유연하게, 적용은 엄격하게** 유지합니다. target block만 바꿀 수 있게 제한해 충돌을 피하려 하지 않고, 실제 제안 diff를 최신 state에 적용하는 순간 검증합니다.

## Failure Mode

- 엔진까지 private에 두면 Frame v2 같은 public workflow가 generic 학습 기능을 재사용하지 못하고 bridge 또는 복제 코드가 생깁니다.
- 개인 publisher까지 public에 두면 경로·Notion schema·계정 맥락이 공개 package에 새어 나옵니다.
- public과 private에 command를 동시에 남기면 load order에 따라 어느 구현이 활성인지 불명확해집니다.
- persisted Q&A 전문을 새 session에 재생하면 transcript 보존이 아니라 현재 context 오염이 됩니다.
- worker가 전체 proposed note를 transcript에 출력하면 병렬 질문 수만큼 P0 context가 중복됩니다.
- worker가 state를 직접 쓰거나 last-write-wins를 사용하면 병렬 결과가 조용히 유실됩니다.
- target block을 하드 쓰기 경계로 만들면 문맥상 필요한 주변 수정도 재시도되어 학습 상호작용이 답답해집니다.

경계는 **public engine + private publisher profile**, runtime context는 **P0-linked worker event + compact artifact summary**, 적용은 **single merge coordinator**입니다.
