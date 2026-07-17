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
reviewed_at: 2026-07-17
reviewed_commit: e8a5212fb8212e0ebd97a9baa6b6da0791e630ff
related:
  - private-overlay-package-boundary
  - context-loading-minimal-surface
  - live-artifact-preview-pattern
  - embedded-webview-script-escape-boundary
  - frame-v2-learning-note-pilot
  - learning-note-companion-artifact
---

## Judgment

Study Hard의 concept map, flow, 학습노트, Tutor/Editor/Coach, revision, HTML export, local state는 특정 회사나 개인 정보에 의존하지 않는 범용 Pi 학습 엔진입니다. 이 엔진은 public pilee에 둡니다.

개인 Notion database와 연결되는 sync script 위치, 개인 Downloads 경로 같은 실행 값만 private runtime profile 또는 환경변수에 둡니다.

## Public Engine

Public `extensions/study-hard`가 소유하는 범위:

- `/study-hard` command와 `study_hard_board` tool
- concept hierarchy와 runtime flow model
- 구조화 `noteDocument`와 canonical TFT `visual` block
- Tutor 병렬 처리, Editor merge, Coach navigation
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

## Tutor Scope Rule

Tutor prompt도 질문 surface에 맞게 좁힙니다.

- `note-block` — 선택한 block과 section label을 중심으로 답하고 Note 전체를 반복하지 않습니다.
- `flow-step` — 선택 flow와 step만 자세히 전달합니다.
- `node` — 선택 node와 root mental model을 전달합니다.
- `session` — 자료 전체를 묻는 질문이므로 `noteDocument`와 `flows` 전체를 허용합니다.

Editor는 답변을 기존 noteDocument에 병합해야 하므로 전체 노트를 볼 수 있지만, Tutor까지 항상 전체 상태를 받으면 이전 prompt의 내용이 현재 국소 질문에 불필요하게 섞입니다.

## Failure Mode

- 엔진까지 private에 두면 Frame v2 같은 public workflow가 generic 학습 기능을 재사용하지 못하고 bridge 또는 복제 코드가 생깁니다.
- 개인 publisher까지 public에 두면 경로·Notion schema·계정 맥락이 공개 package에 새어 나옵니다.
- public과 private에 command를 동시에 남기면 load order에 따라 어느 구현이 활성인지 불명확해집니다.
- persisted Q&A 전문을 새 session에 재생하면 transcript 보존이 아니라 현재 context 오염이 됩니다.
- note-block 질문에도 Note/flow 전체를 넣으면 국소 질문이 과거 설명을 반복하는 긴 답변으로 변합니다.

경계는 **public engine + private publisher profile**, runtime context는 **live event + compact resume summary**입니다.
