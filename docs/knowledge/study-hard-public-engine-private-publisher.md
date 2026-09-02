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
  - extensions/pr-review
  - extensions/learning-companion
  - extensions/utils/private-profiles
source:
  - user-direction:2026-07-17-study-hard-public-migration
  - user-direction:2026-07-21-study-hard-notion-static-export
  - user-direction:2026-09-03-meta-review-export-actions
  - user-direction:2026-09-03-meta-review-export-reading-flow
reviewed_at: 2026-09-03
reviewed_commit: "342898c"
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
- P0-lineage에 연결된 `study-hard-worker --isolated` 병렬 처리, 3-way note merge, Coach navigation
- Q&A transcript integration
- revision/history snapshot과 restore
- standalone HTML export와 interactive visual/PNG fallback
- Meta Review ready revision을 같은 structured document renderer/publisher contract로 내보내는 adapter
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

### Meta Review Export Adapter Rule

Meta Review도 별도 Notion SDK나 개인 destination을 public code에 추가하지 않습니다. Public `extensions/pr-review`가 최신 ready revision의 document·guide·finding·changed-line evidence·질문을 `noteDocument` 호환 구조로 변환하고, Study Hard가 기존 HTML renderer와 configured publisher를 실행합니다. HTML과 Notion은 반드시 같은 export snapshot을 소비합니다.

Renderer 재사용은 review 전용 navigation을 평탄화해도 된다는 뜻이 아닙니다. Export snapshot은 `relationships.readingOrder`의 파일 순서·이유·대상 section anchor를 일급 `readingFlow`로 함께 보존합니다. Meta Review standalone HTML은 넓은 화면에서 오른쪽 sticky `읽는 흐름` rail과 읽기 진행률을, 좁은 화면에서 본문 위 일반 panel을 렌더링합니다. 같은 순서는 `noteDocument` 안에도 명시적 `읽는 흐름` heading과 ordered list로 남겨 Notion·인쇄·script 비활성 환경에서도 읽을 수 있어야 합니다. 일반 Study Hard export에는 review rail을 추가하지 않습니다.

Meta Review의 sync metadata는 학습노트 state가 아니라 source review run의 `export-state.json` sidecar에 둡니다. Publisher payload를 만들 때 Study Hard board state를 통째로 spread하지 않고 review export에 필요한 필드만 allowlist해 goals·summary·followups 같은 학습 전용 section이 섞이지 않게 합니다. Public adapter는 연결된 Study Hard `runId`를 `targetSessionId`, review series에서 파생한 stable ID를 `artifactInstanceId`로 분리해 전달하고, 개인 database ID, token, tag와 페이지 naming은 publisher가 계속 소유합니다.

Private publisher는 `targetSessionId`가 같은 학습노트를 우선 찾습니다. 있으면 기존 본문과 비관리 block을 보존한 채 문서 최하단의 단일 `🔎 Meta Review` toggle을 최신 revision으로 갱신하고, 없으면 같은 Study Hard ID로 새 페이지를 생성합니다. 갱신은 새 toggle 전체를 쓰고 semantic hash를 read-back 검증한 뒤 이전 toggle만 archive하여 중복을 남기지 않습니다. 중간 자식 쓰기가 실패하면 부분 toggle을 정리합니다. Notion에서 선택한 내용을 generated review canonical로 역수입하지 않으며, 충돌 선택은 해당 Notion write 결과에만 적용합니다. 따라서 publisher가 없거나 실패해도 HTML 내보내기와 로컬 Meta Review는 계속 동작합니다.

### Section Sync And Conflict Rule

Notion publisher는 페이지 전체를 managed document 하나로 취급하지 않습니다. `noteDocument.sections[].id`를 stable sync unit으로 사용하고, `sectionHashes`, `sectionSourceHashes`, `sectionBlockIds`, `sectionModes`를 local Study Hard state에 보존합니다.

- 변경되지 않은 section과 비관리 block은 API write 대상에서 제외합니다.
- 변경된 section은 기존 page 안의 managed container children만 교체하고 read-back semantic hash로 검증합니다.
- page ID, title property, 사용자가 만든 비관리 block은 유지합니다.
- Notion 수동 편집과 Study Hard 변경이 겹치면 publisher가 단순 실패하거나 자동 덮어쓰지 않습니다.
- Notion만 바뀌었으면 publisher가 native paragraph/callout/list/table/code/image를 Study Hard의 같은 structured block type으로 역변환해 canonical note에 import합니다. Markdown 한 덩어리로 평탄화하지 않습니다.
- managed heading과 container 사이에 사용자가 직접 넣은 top-level block도 인접 section의 Notion 변경으로 귀속하되, publisher가 임의 삭제하지 않습니다.
- 양쪽이 바뀌었으면 Studio가 section별 `현재 Notion` / `변경될 Study Hard` / `직접 정리`를 보여주고 `conflictResolution`으로 재실행합니다.
- 비교 화면은 글자 수로 자른 단일 preview 문자열이 아니라 full structured blocks를 block별로 렌더합니다. paragraph 줄바꿈, list/table/code 경계, image thumbnail·caption을 보존하고 긴 쪽은 pane 내부에서 스크롤합니다.
- modal 너비는 고정 pixel 상한 없이 viewport 비율로 확대하고 화면 경계만 넘지 않게 하며, 높이는 viewport 경계 안에서 사용자가 직접 resize할 수 있어야 합니다. 좁은 화면에서만 diff를 1열로 바꿉니다.
- 저장 transaction은 계속 section 단위지만 판단 표면은 block diff입니다. semantic content LCS로 동일 block을 접고, exact anchor 사이의 같은 type block을 changed로 짝지으며 나머지를 removed/added로 표시합니다. `− 현재`는 붉은색, `+ 변경`은 초록색을 사용합니다.
- semantic key는 normalized block 객체 전체가 아니라 block type별 의미 필드만 projection합니다. 예를 들어 callout은 tone/title/body, table은 columns/rows, paragraph는 text만 비교합니다. Notion round-trip에서 생기는 무관한 `level`, `tone`, `ordered:false`, 빈 문자열·빈 배열·undefined 차이는 변경으로 취급하지 않습니다.
- 직접 정리의 자동 초안은 unchanged 1회, current-only 보존, desired-only 추가, changed는 current 기본값으로 구성합니다. 사용자는 changed row마다 current/desired source를 고르고 block 내부 필드를 수정하거나 block을 삭제·재배열할 수 있습니다.
- Notion에만 추가된 block이 있으면 개수와 image 포함 여부를 경고하고, `변경될 Study Hard 적용` 시 제거된다는 결과를 선택 전에 명시합니다. Notion-only 변경은 modal을 띄우지 않고 자동 import하되 완료 상태에 가져온 section·image 수를 표시합니다.
- `직접 정리`는 Markdown editor가 아니라 기존 block type·id·순서를 유지하는 block editor입니다. paragraph text, callout title/body, list item, table cell, code, image caption처럼 block 내부 텍스트만 편집해 structured blocks로 양쪽 canonical에 저장합니다.
- Study Hard 일반 section은 기존 section 단위 부분 동기화를 유지합니다. Meta Review만 `targetSessionId`의 페이지 하단 단일 toggle을 관리하며, 같은 `artifactInstanceId`의 반복 저장은 새 section을 추가하지 않고 최신 revision으로 교체합니다.
- 매 저장 시 같은 revision의 standalone HTML을 생성합니다. Study Hard는 page 하단 managed file block으로 교체하고, Meta Review는 HTML ZIP heading/file을 `🔎 Meta Review` toggle children에 포함해 그 toggle 하나가 실제 최종 top-level block이 되게 합니다. File block identity/hash는 sync state에 보존합니다.

이 계약은 merge conflict와 같습니다. 충돌 검출은 publisher가 담당하지만 최종 선택은 사용자에게 돌려주고, 자동 import도 block 구조를 보존해야 합니다.

### Image Block Rule

대화에 첨부된 로컬 이미지와 원문에서 가져온 HTTPS 이미지는 첨부 목록에만 남기지 않고 stable `image` note block으로 승격할 수 있습니다.

- 로컬 이미지는 `attachmentId` 또는 `path`로 연결하고 publisher가 Notion File Upload API로 올립니다.
- 원문 이미지는 `https url`을 Notion external image block으로 만듭니다.
- `alt`는 이미지 정체성, `caption`은 학습자가 무엇을 확인해야 하는지를 설명합니다.
- Studio, standalone HTML, Notion이 같은 image block 의미를 렌더링합니다.
- 이미지가 학습 설명에 실제로 필요할 때만 본문 block으로 올리고, 단순 참고 첨부는 attachments에 남길 수 있습니다.

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

Glimpse의 learner 질문은 extension coordinator가 실제 `study-hard-worker --isolated` subagent로 dispatch합니다. P0 전체 transcript 대신 명시적 task와 최신 board state를 전달하고, 완료 lineage만 P0 session에 연결합니다. 선택 surface는 worker가 시작할 초점과 근거를 제공하지만 쓰기 경계로 사용하지 않습니다. worker는 사용자 의도를 닫는 데 필요한 전체 `proposedNoteDocument`를 만들 수 있습니다.

안전 경계는 생성 범위가 아니라 적용 권한입니다.

- worker는 Study Hard state를 직접 수정하지 않고 question별 result artifact만 씁니다.
- P0 transcript에는 artifact path, worker #N, 짧은 summary와 최종 feedback만 남깁니다. Raw start/completion lifecycle은 durable entry로 보존하되 미래 P0 LLM turn에 다시 주입하지 않습니다.
- 같은 question orchestration은 `requestId` single-flight로 정확히 한 worker만 실행합니다. extension reload 시 이전 launcher listener를 즉시 교체하고, atomic claim으로 겹친 listener도 한 실행만 소유합니다.
- merge coordinator가 base/proposed/current를 비교해 실제 changed path를 계산합니다.
- disjoint 블록·필드·삽입은 완료 순서와 무관하게 보존합니다.
- 같은 필드의 다른 변경, 삭제 대 수정, 양립 불가능한 순서 변경은 conflict로 둡니다.
- 첫 conflict는 같은 worker run을 최신 state로 한 번 continue하고, 재충돌은 P0 판단으로 남깁니다.
- 최초 accepted result 뒤의 late success/failure는 멱등 no-op입니다. `answered/applied`는 `failed`로 역행하지 않으며, persisted `answered + failed` 모순도 load 시 `applied`로 복구합니다.
- 재시도는 terminal failure에서만 새 orchestration으로 실행합니다. 실행 중이거나 이미 답변된 질문에는 retry를 노출하지 않습니다.
- note image block의 `attachmentId`는 worker context의 실제 attachment path와 Studio의 capability-protected HTTP source 양쪽으로 해석합니다.

이 계약은 **생성은 유연하게, 적용은 엄격하게** 유지합니다. target block만 바꿀 수 있게 제한해 충돌을 피하려 하지 않고, 실제 제안 diff를 최신 state에 적용하는 순간 검증합니다.

## Failure Mode

- 엔진까지 private에 두면 Frame v2 같은 public workflow가 generic 학습 기능을 재사용하지 못하고 bridge 또는 복제 코드가 생깁니다.
- 개인 publisher까지 public에 두면 경로·Notion schema·계정 맥락이 공개 package에 새어 나옵니다.
- public과 private에 command를 동시에 남기면 load order에 따라 어느 구현이 활성인지 불명확해집니다.
- 페이지 전체 shadow swap은 section 단위 부분 동기화 계약을 깨고 page identity·수동 정리·비관리 block을 불필요하게 교체합니다.
- conflict를 오류 문자열로만 반환하면 사용자는 어떤 section이 충돌했는지, 어느 쪽을 보존할지 결정할 수 없습니다.
- 이미지를 attachments에만 남기면 학습노트의 설명 순서와 Notion 본문에서 그림의 의미가 사라집니다.
- Meta Review가 별도 개인 Notion client를 public extension에 넣으면 같은 publisher 계약이 복제되고 private destination 정보가 새어 나갑니다.
- Notion Meta Review snapshot을 generated review canonical로 역수입하면 immutable source 기반 설명과 외부 편집본의 책임이 섞입니다.
- Meta Review 자체 ID만으로 별도 페이지를 찾으면 같은 Study Hard 학습 흐름이 Notion에서 분리되고, 반복 저장마다 toggle을 append만 하면 동일 review section이 중복됩니다.
- persisted Q&A 전문을 새 session에 재생하면 transcript 보존이 아니라 현재 context 오염이 됩니다.
- worker가 전체 proposed note를 transcript에 출력하면 병렬 질문 수만큼 P0 context가 중복됩니다.
- worker가 state를 직접 쓰거나 last-write-wins를 사용하면 병렬 결과가 조용히 유실됩니다.
- target block을 하드 쓰기 경계로 만들면 문맥상 필요한 주변 수정도 재시도되어 학습 상호작용이 답답해집니다.

경계는 **public engine + private publisher profile**, runtime context는 **P0-linked worker event + compact artifact summary**, 적용은 **single merge coordinator**입니다.
