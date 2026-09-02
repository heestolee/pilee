---
title: Meta Review는 전체 diff 설명 뒤에 독립 판단과 precedent를 붙인다
tags:
  - pr-review
  - human-review
  - precedent
  - evidence
  - glimpse
  - meta-review
category: workflow
status: active
confidence: high
applies_to:
  - extensions/pr-review
  - extensions/worktree
  - extensions/diff-overlay
  - skills/meta-review
  - extensions/study-hard
source:
  - conversation:2026-08-11-human-meta-review-corpus
  - conversation:2026-08-18-easy-review-harness
  - user-direction:2026-08-25-workspace-activation-redesign
  - user-direction:2026-08-29-right-question-drawer-and-pr-5052-runtime
  - user-direction:2026-08-30-easy-review-hierarchy-and-file-relationships
  - user-direction:2026-08-30-overview-relationship-reading-rail-restoration
  - user-direction:2026-08-30-declaration-symbol-selection-hierarchy
  - user-direction:2026-08-30-structure-selection-and-source-backed-change-meaning
  - user-direction:2026-08-30-color-semantic-meaning-diagrams
  - user-direction:2026-08-30-meaning-chart-zoom-overlay
  - user-direction:2026-08-31-meta-review-study-hard-worker-lifecycle-parity
  - user-direction:2026-09-02-study-hard-code-review-discoverability
  - user-direction:2026-09-02-pr-review-current-panel-or-tab
  - user-direction:2026-09-03-meta-review-export-actions
  - user-direction:2026-09-03-meta-review-export-reading-flow
reviewed_at: 2026-09-03
reviewed_commit: "342898c"
related:
  - evidence-first-verification-gate
  - live-artifact-preview-pattern
  - private-overlay-package-boundary
  - stress-interview-multi-axis-review
  - skills-as-portable-procedures
  - workspace-action-panel-activation-contract
  - question-ui-execution-owner-routing
---

## Judgment

인간 리뷰 corpus는 현재 PR을 대신 판단하는 정답지가 아니라, 현재 diff만으로 먼저 만든 review finding을 검증하고 더 잘 설명하기 위한 precedent memory입니다. 과거 사례를 먼저 보여주면 현재 변경에서 그 사례와 닮은 문제만 찾는 anchoring이 생기므로, `/meta-review`는 immutable diff inspection과 전체 설명, blind review를 선행하고 나서만 corpus search를 허용합니다. `/meta-review`는 현재 작업과 외부 PR을 모두 다루며 `/diff`를 대체하지 않습니다.

## Evidence Bundle

Review source는 원본 diff, 파싱된 line, stable `D...` evidence id, chunk inspection 상태, source hash를 분리해 저장합니다. 설명 hunk와 ReviewCard의 code block은 agent가 다시 쓰지 않고 evidence id가 가리키는 원본 줄에서 extension이 파생합니다. 모든 chunk를 읽지 않았다면 submit을 막고, no finding은 승인이나 안전 보장으로 표현하지 않습니다.

## Guided Diff Coverage

Meta Review는 사용자가 코드를 능숙하게 읽는다고 가정하지 않습니다. 모든 변경 파일에 파일의 책임, 이 변경에서 수정된 이유, 호출·데이터 흐름, 사용자·후속 consumer 영향을 먼저 설명합니다. 모든 addition/deletion evidence는 정확히 하나의 `E-...` semantic explanation hunk에 배정합니다. 한 줄마다 같은 문장을 반복하지 않고 같은 의도의 연속 줄을 묶되, 변경 이유·코드/도메인 근거·레이어 책임·사용 개념·흐름 영향·불확실성을 빠뜨리지 않습니다.

중립적인 학습 설명, 실제 review finding, 작성자에게 확인할 정책 질문은 시각적으로 분리합니다. generated·lock·대량 반복 데이터도 생략하지 않고 source-of-truth와 생성 이유를 파일 또는 hunk 수준에서 설명합니다. 설명 coverage와 finding 수는 별도 지표입니다.

## Large Complete Snapshot Transport

큰 PR의 `document + guides + cards` complete snapshot은 모든 evidence ID 때문에 tool argument 한도를 넘을 수 있습니다. 이때 의미 있는 semantic hunk를 파일 단위로 합치거나 설명을 삭제해 payload만 줄이면 guided diff 품질이 깨집니다. `meta_review_run status`가 제공하는 현재 run의 고정 `submission.json` 경로에 complete snapshot을 생성·검증하고 `submissionPath`로 submit합니다.

artifact transport는 canonical이 아닙니다. extension은 현재 runDir의 정확한 파일만 허용하고, lexical path와 realpath를 모두 확인해 run 밖 경로와 symlink를 거부하며, 일반 파일·1 byte 이상·5MB 이하·유효한 `{ document, guides, cards }` JSON만 읽습니다. coverage·ReviewCard·파일 관계 검증이 성공한 뒤 transport 파일을 제거하고 canonical `document.json`, `guides.json`, `cards.json`, `review.md`만 남깁니다. 작은 snapshot의 inline submit은 계속 지원합니다.

## ReviewCard Contract

각 리뷰 포인트는 네 개의 사용자-facing 섹션을 가집니다.

1. exact code block
2. GitHub에 바로 쓸 수 있는 review draft
3. 발생 조건과 영향을 설명하는 rationale
4. 같은 패턴을 LLM이 다시 만들지 않게 하는 meta perspective

메타 관점은 기존 skill/guide가 적용 가능한지, 타입·API·도메인 구조로 잘못 만들기 어렵게 할 수 있는지, lint·test·CI로 정확히 잡을 수 있는지, 현재 PR과 follow-up 중 어디에서 닫을지를 다룹니다. 반복 근거나 정확한 대체 행동이 없으면 `scope: none`이 올바른 결과입니다.

## Document-First Render Rule

Study Hard shell의 `코드 리뷰` 탭은 카드 대시보드가 아니라 Easy Review처럼 순서대로 읽히는 리뷰 문서입니다. `한눈에 보기 → 변경 파일 관계 → 먼저 볼 점 → compact 파일 목록 → semantic explanation → 실제 inline review` 순서를 유지합니다. `한눈에 보기`는 PR 목적·파일 관계 요약·검토 초점·coverage를 한 화면에서 분리해 보여주며, 관계 설명과 실제 finding을 같은 2열 카드에 다시 결합하지 않습니다.

파일 관계는 raw Mermaid가 아니라 captured diff 경로를 참조하는 structured `from/to/label` edge와 전체 reading order로 저장합니다. 정적인 레이어·데이터·검증 관계는 flowchart, 시간 순서가 판단의 핵심인 런타임 호출은 sequence diagram을 선택하며 둘을 기계적으로 모두 만들지 않습니다. Mermaid source는 extension이 구조 데이터에서 결정적으로 만들고 strict renderer로 표시합니다. 관계도는 독립된 전체 폭 section에서 읽을 수 있는 최소 크기를 유지하고, 좁은 화면에서는 unreadable하게 축소하는 대신 가로 스크롤을 허용합니다. 번호·화살표·edge label의 의미와 `from → to` 관계를 텍스트 해설로 함께 제공해 그림만 보고 호출 책임을 다시 추론하게 하지 않습니다.

`relationships.readingOrder`는 질문 drawer와 별개의 sticky `읽는 흐름` rail로 렌더링합니다. drawer가 열리면 본문 폭을 지키기 위해 rail을 숨기고, 좁은 화면에서는 본문 위의 일반 panel로 전환합니다. 과거 `.review-companion`처럼 질문·minimap·읽기 안내를 하나의 legacy component로 합치지 않습니다. 상단 finding은 짧은 index와 코드 위치 이동, 선택 질문 context만 제공하고 review draft·결정 action의 canonical 본문은 evidence 위치에 둡니다.

파일 목록은 번호·전체 경로·한 줄 요약·증감 수치·토글을 가진 compact row를 유지합니다. 접힘 상태에서도 파일 역할, 변경 이유, 호출·데이터 흐름, 사용자·후속 영향을 summary 안에 남기고 실제 diff와 semantic explanation만 접습니다. explanation은 evidence의 addition/deletion line을 기준으로 `변경 전 L… · 변경 후 L…` 범위를 표시하며 떨어진 범위는 합치지 않습니다. 메타 관점·인간 precedent·문구 편집은 접고, 결정 버튼은 리뷰 본문을 지배하지 않는 작은 inline action으로 둡니다.

`E-...` explanation hunk는 changed evidence coverage를 닫는 설명 단위이지 source 선택이나 변경 의미 boundary가 아닙니다. 구조 선택은 capture 시점의 exact before/after source에서 AST owner가 소유한 가장 작은 연속 statement 또는 `{}` range로 시작합니다. Owner가 변수·함수·메서드·class·type·test label을 결정하며, 코드 길이로 종류를 추정하지 않습니다. 기본 diff는 `/diff`처럼 평평하게 유지하고 선택 범위만 `▶/┃/┗` accent로 표시합니다. Inline toolbar에서 상위·하위 구조와 before/after source로 이동하고 선택을 해제합니다.

변경 의미는 구조 단위와 다대다 관계인 별도 `document.meanings[]` canonical입니다. 같은 파일·함수·인접 줄이 아니라 contract, explicit definition/deprecation, producer-consumer, call-flow, test 인과관계로 fact를 묶고 Before 계약·After 계약·전환 메커니즘·영향·source basis·confidence를 기록합니다. High confidence는 diff 이외의 source-backed basis가 필요합니다. 선택 preview와 의미 질문은 각각 declaration ID/side/file/evidence와 meaning ID/전체 evidence를 server에서 재검증합니다. Source snapshot은 file side당 512KB, 전체 4MB로 제한하고 snapshot hash는 diff freshness hash와 분리합니다.

책임·데이터·소유권·계약 구조가 이동하는 meaning은 구조화 `flowchart`, 호출 순서·비동기·실패·재시도·CAS 충돌이 핵심인 meaning은 구조화 `sequence` visual을 하나만 가질 수 있습니다. Raw Mermaid는 canonical에 저장하지 않고 group/node/edge 또는 actor/message reference를 검증한 뒤 renderer가 파생합니다. 역할 색상은 제거·deprecated=빨강 점선, 신규·강화=초록, 책임 이동·통합=보라, 유지 경계=파랑, 검증·충돌=주황, 주변 문맥=회색으로 고정합니다. Diagram은 inline 320px 높이 안에서 primary 설명이 되지만 텍스트 Before/After·메커니즘·영향·source basis를 대체하지 않습니다.

Inline 압축 때문에 label을 읽기 어려우면 각 카드의 `확대해서 보기`가 같은 구조화 source를 별도 SVG로 다시 렌더링합니다. Overlay는 원본 벡터를 75–250% 범위로 확대·축소하고 양방향 scroll, reset, Esc·backdrop·close 종료를 제공하며 카드 질문 selection을 바꾸지 않습니다. DOM의 기존 SVG를 복제하지 않고 새 Mermaid render ID를 사용해 marker/definition ID 충돌을 피합니다. Glimpse page zoom은 전체 shell을 키우는 host 기능이고, chart overlay zoom은 한 visual만 자세히 읽는 surface 기능으로 분리합니다.

서로 멀리 떨어진 evidence를 하나의 `min..max` 코드 블록으로 합치지 않습니다. changed line은 설명 coverage에서 숨기지 않고, 긴 unchanged context만 fold할 수 있습니다. finding이 없는 파일도 역할·변경 이유와 모든 semantic hunk 설명을 유지합니다.

## Checkout Execution Boundary

`/meta-review <URL>`과 `/diff <URL>`은 같은 checkout 준비 계층을 사용합니다. GitHub PR head SHA에서 전용 `review/pr-<number>-<head>` worktree를 만들고, `.pi/review-context.json`에 base/head/선택적 run/source-target session/activation provenance를 저장합니다. legacy `.pi/pr-review.json`은 읽기 fallback으로만 유지합니다. `/diff <URL>`은 Meta Review artifact를 만들지 않고 exact checkout session에서 raw diff를 바로 열 수 있으며, 이후 같은 세션에서 `/meta-review`를 실행하면 동일 source context에 run을 연결합니다.

Review worktree가 필요하다는 사실은 별도 분할 panel이 필요하다는 뜻이 아닙니다. Checkout 준비 뒤 열기 위치는 `현재 패널 | 새 탭` 두 개만 제시합니다. 현재 패널을 고르면 Pi의 session replacement API로 exact review session을 열고, 새 탭을 고르면 source panel을 유지한 채 durable READY 뒤 continuation을 실행합니다. 현재 panel HEAD와 PR HEAD가 다를 때만 선택 전에 경고하며, 이 경고는 source worktree의 branch/HEAD를 직접 수정하지 않고 panel의 active session/cwd가 바뀐다는 사실을 설명해야 합니다. Session replacement 뒤 original command context는 stale이므로 command handler는 `switched`를 terminal handoff로 처리하고 새 context에서만 status 정리와 follow-up 전송을 수행합니다.

Review worktree는 read-only 실행 경계입니다. dependency bootstrap을 자동 실행하지 않고 사용자가 수정 요청을 별도로 주기 전에는 repository를 변경하지 않습니다. `/diff`는 explicit `--base`가 없을 때 review context를 먼저 읽고 captured head와 현재 HEAD가 같을 때만 base SHA와의 merge-base를 사용합니다. Head가 drift하면 기존 설명과 finding을 유효한 것처럼 보여주지 않고 stale 오류를 냅니다.

## Discoverable First Entry

Study Hard의 `코드 리뷰` 탭은 Meta Review가 아직 연결되지 않았더라도 항상 보여야 합니다. 숨겨진 기능을 사용자가 `/meta-review` 명령으로 다시 발견하게 만들면 같은 학습노트에서 시작할 수 있는 흐름이 별도 Glimpse 생성 문제로 바뀝니다.

미연결 상태의 첫 클릭은 현재 Study Hard handle의 작업 cwd를 PR Review extension에 전달해 current-work source를 capture하고, immutable initial revision과 분석 prompt를 만든 뒤 반환된 `runId/runDir/source`만 현재 Study Hard state에 연결합니다. 학습노트 URL·제목·본문 canonical은 바꾸지 않으며 별도 창도 열지 않습니다. 이미 연결된 상태에서는 새 run을 만들지 않고 기존 코드 리뷰 surface를 열며, 이후 변경은 명시적 `갱신하기`와 revision 계약을 그대로 사용합니다.

## Guided Review Conversation

코드 리뷰 탭은 학습노트와 같은 오른쪽 detail drawer를 질문 surface로 재사용합니다. 본문 하단에 별도 composer를 중복하지 않고, 코드 리뷰 진입 때 drawer를 한 번 열며 toolbar의 `질문 패널`로 다시 열 수 있습니다. 본문은 drawer 너비만큼 줄어들어 선택 context와 diff를 동시에 읽습니다.

질문 scope는 `전체 PR`과 `선택 블록`으로 분리합니다. `한눈에 보기`와 `변경 파일 관계`는 allowlisted `section` provenance를, file intro·diff line·semantic explanation hunk·ReviewCard는 exact `file | line | hunk | card` provenance와 evidence를 저장합니다. 선택 블록 대화는 같은 evidence를 공유하더라도 selection kind/id가 다른 블록과 섞지 않습니다. 질문은 같은 Pi session transcript에 visible user event로 기록되고 내부 run/tool 지침은 hidden control envelope로 분리합니다.

Meta Review drawer는 모든 설명·검증·변경 요청을 Study Hard와 같은 `launchProgrammaticQuestionWorker`로 즉시 실행합니다. 메인 Pi에 routing follow-up을 보내지 않으며 worker는 표준 `#N` lifecycle로 질문 thread에 답변·실패·stale·재시도를 돌려줍니다. GitHub PR worker는 current panel checkout이 아니라 immutable run source와 `repository + expectedHeadSha`를 읽고, current-work worker만 captured root의 live diff freshness를 요구합니다. 공통 상태 전이와 recovery 계약은 [질문 UI와 실행 owner는 분리한다](./question-ui-execution-owner-routing.md)를 따릅니다.

사용자가 current-work에서 명시적으로 수정을 요청하면 worker는 repository를 직접 편집하지 않고 patch artifact를 만듭니다. Coordinator가 source pin과 root를 다시 검증하고 patch·targeted validation을 적용한 뒤 새 Meta Review revision을 캡처합니다. 기존 Q&A snapshot은 새 run identity로 승계하고, 기존 Meta Review completion prompt를 owner Pi에 전달해 pending chunk inspection과 submit을 자동으로 시작합니다. GitHub PR immutable source에서는 변경 artifact를 거부합니다.

답변은 `쉬운 설명 → 코드에서 확인된 사실 → 아직 모르는 정책/가정 → 리뷰 판단` 순서와 source evidence를 갖고 `questions.jsonl` append-only snapshot으로 보존됩니다. terminal answer/fail/stale는 한 snapshot으로 기록하고 늦은 callback이 다시 열지 못합니다. pending execution이 있는 동안만 live state를 polling하고 모두 끝나면 멈춥니다. Polling 중에는 open details, 문서·drawer·thread scroll, composer draft와 focus를 복원해 읽던 위치를 초기화하지 않습니다.

Study Hard의 메모보드는 `학습 메모 | 코드 리뷰` 탭을 가진 하나의 공통 card renderer입니다. 두 canonical을 합치지 않고 adapter만 공용화하며 코드 리뷰 메모에는 worker 번호, 변경 파일, validation, refresh revision을 함께 표시합니다. 질문 ID가 같아도 source별 UI key를 사용하며 refresh run이 ready 되기 전후를 `갱신 중/완료`로 구분합니다.

Meta Review session의 review truth는 immutable run과 checkout metadata이지만, workflow가 source conversation에서 시작됐다면 전체 transcript와 `parentSession` lineage도 기본 보존합니다. Source context는 정책·의도·이전 판단을 제공하고, run/head metadata는 코드 revision truth를 제공합니다.

## Export And Action Menu Contract

코드 리뷰 toolbar의 화살표는 갱신 방식뿐 아니라 현재 review artifact의 추가 작업을 여는 action menu입니다. `<summary>` 안에 다시 `<button>`을 중첩하지 않고, 같은 화살표 재클릭·메뉴 바깥 클릭·`Esc`·항목 선택에서 닫혀야 합니다. 열린 메뉴가 review 본문과 다음 조작을 계속 가리는 상태는 단순 미관 문제가 아니라 조작 lifecycle의 구멍입니다.

`HTML 내보내기`와 `Notion 저장`은 화면 DOM이나 오래된 `review.md`를 임의 복사하지 않습니다. 최신 ready revision의 `document.json`, `guides.json`, `cards.json`, `questions.jsonl`, immutable source를 하나의 구조화 export snapshot으로 변환합니다. Overview, 관계와 읽는 순서, source-backed 변경 의미, finding과 사람 결정, 모든 설명 hunk의 changed-line evidence, 질문·답변이 같은 snapshot에 포함되어야 합니다.

- HTML은 학습노트와 같은 standalone renderer를 재사용하되 artifact label을 `Meta Review`로 구분하고 configured Downloads 경로에 저장합니다. 다만 Easy Review 계열의 핵심 navigation인 `relationships.readingOrder`를 일반 list로만 평탄화하지 않습니다. Snapshot이 파일 순서·이유·section anchor를 별도로 전달하고, renderer는 Meta Review에서만 sticky `읽는 흐름` rail·진행률·파일 이동 anchor를 복원합니다. 좁은 화면에서는 rail을 본문 위 panel로 전환하며, script가 실행되지 않아도 본문의 명시적 `읽는 흐름` 목록으로 같은 순서를 읽을 수 있어야 합니다.
- Notion은 같은 구조화 문서를 기존 private publisher에 전달합니다. Synthetic state는 Study Hard board 전체를 spread하지 않고 export 필드만 allowlist해 학습 목표·요약·후속 복습이 review 문서에 섞이지 않게 합니다. 연결된 Study Hard `runId`로 같은 학습노트를 찾고, review series의 stable artifact ID와 page/section hash는 source run의 `export-state.json` sidecar에만 보존합니다. 학습노트가 있으면 HTML ZIP까지 children으로 포함한 단일 `🔎 Meta Review` toggle을 최하단에서 최신 revision으로 교체하고, 없으면 같은 Study Hard ID의 페이지를 생성합니다.
- Meta Review는 generated review canonical이므로 Notion에서 유지하거나 직접 정리한 block을 `document.json`·`guides.json`·`cards.json`·`questions.jsonl`로 역수입하지 않습니다. 양쪽 변경이 겹치면 기존 block diff UI에서 이번 Notion 저장 결과만 선택합니다.
- 저장 중 새 ready revision이 생기면 저장된 revision과 현재 revision을 분리해 stale 상태를 알립니다. 외부 write는 사용자가 `Notion 저장`을 누른 경우에만 실행합니다.

## Explicit Refresh and Revisions

코드 리뷰 본문은 임의 background check만으로 바뀌지 않습니다. 외부 PR의 head/base 또는 현재 worktree diff hash는 읽기 전용으로 비교해 `새 변경 있음` badge만 표시합니다. 사용자가 `갱신하기`를 누르거나 current-work change artifact가 coordinator를 통해 실제 적용됐을 때만 새 immutable run을 series의 다음 revision으로 추가합니다.

이전 head가 최신 head의 ancestor이고 base가 유지된 안전한 선형 변경은 incremental로 처리합니다. 이전 revision과 diff가 동일한 파일은 guide·ReviewCard·사람 편집 문구·인간 결정을 최신 evidence ID로 remap하고, unchanged 파일만 포함한 file-isolated chunk는 auto-inspect합니다. agent는 pending chunk와 impacted file만 다시 읽습니다. rebase, force-push, base/merge-base 변경, ancestry 불명은 full review로 승격하며 사용자는 `전체 다시 검토`를 강제할 수 있습니다. 이전 revision의 질문·AI 원문·사람이 편집한 문구·인간 결정은 덮어쓰지 않습니다. 새 설명 hunk는 `new`, 동일 hunk는 `unchanged`, 같은 identity의 코드가 달라지면 `review-again`, 근거가 사라지면 `evidence-removed`로 reconcile합니다.

## Corpus Boundary

Canonical corpus는 Git에 넣지 않고 local state의 `events.jsonl`, `cases.jsonl`, `manifest.json`으로 둡니다. `index.sqlite`는 언제든 재생성할 수 있는 FTS5 파생물입니다. Public pilee에는 schema·index/search engine만 두고, 회사 repository와 corpus 위치는 private profile에 둡니다.

Human-authored review event와 case annotation도 구분합니다. 원문 코멘트는 human source지만 `strong`, `partial`, `counterexample` 같은 해석은 별도 human review가 끝나기 전까지 `machine-draft`입니다. 검색 결과는 닮은 점뿐 아니라 현재 PR과 다른 점을 기록하며, supporting과 contrasting lane을 함께 제공합니다.

## Human Decision Gate

Meta Review의 코드 리뷰 탭은 GitHub write 도구가 아닙니다. `review-only`, `review-with-meta`, `edit`, `follow-up`, `hold`, `dismiss` 결정을 local sidecar로 저장합니다. 사람이 편집한 문장은 `editedReviewDraft`에 남기고 원래 agent draft를 덮어쓰지 않습니다. 댓글 게시, Issue 생성, lint·skill 수정은 별도의 명시적 외부 write 또는 구현 workflow로 넘깁니다.

## Failure Modes

- 과거 사례를 먼저 검색하면 review가 사례 편향적으로 변합니다.
- 인간 코멘트 문장만 복사하면 당시 code context와 outcome을 잃습니다.
- machine-draft annotation을 팀 합의처럼 쓰면 잘못된 규칙을 증폭합니다.
- 모든 review point에 lint·skill 후속을 강제하면 `no-meta-action`을 표현하지 못합니다.
- local working tree를 PR head로 가정하면 diff와 주변 코드의 revision이 달라질 수 있습니다.
- 코드 리뷰 탭을 Meta Review 연결 뒤에만 노출하면 사용자는 이미 구현된 갱신 경로를 발견하지 못하고 `/meta-review`를 다시 시작해 별도 창 문제를 만듭니다.
- 코드 리뷰 탭이 열렸다는 사실만으로 explanation coverage, finding 품질, 사용자 채택을 증명할 수 없습니다.
- `/diff`와 `/meta-review`가 다른 checkout/head를 보면 Pi 대화와 문서형 리뷰가 서로 다른 코드를 설명하게 됩니다.
- background freshness check가 artifact를 자동 갱신하면 사용자가 읽던 판단 기준이 중간에 바뀝니다.
- 큰 complete snapshot을 inline argument에 맞추려고 semantic hunk를 파일 하나로 합치면 changed evidence coverage는 통과해도 학습 가능한 설명 단위가 사라집니다.
- 파일 관계를 raw Mermaid 문자열로만 저장하면 존재하지 않는 파일과 검증되지 않은 관계를 그릴 수 있고 reading order의 전체 파일 coverage도 확인할 수 없습니다.
- 접힘 상태에서 파일 역할과 흐름까지 숨기면 사용자는 diff를 열기 전 어떤 파일부터 읽어야 하는지 다시 추론해야 합니다.
- 전체 PR 질문과 선택 블록 질문을 한 thread로 렌더링하거나 selection ID 없이 evidence 교집합만 비교하면 서로 다른 section/line/hunk/card 대화가 섞입니다.
- 관계도와 실제 finding을 한 2열 attention 카드에 다시 결합하면 관계도는 축소되고, 중립적인 구조 설명과 코드 문제 판정의 시각적 위계가 무너집니다.
- 읽는 흐름 rail과 질문 drawer를 동시에 고정 노출하면 diff 본문 폭이 이중으로 줄어듭니다.
- changed row를 모두 line이나 explanation hunk로 선택하면 새 파일 전체와 떨어진 변경 행이 하나의 범위처럼 보이고 지역 변수·상위 함수 질문을 구분하지 못합니다.
- 모든 구조 range에 header와 box를 표시하면 선택하지 않은 범위도 선택된 것처럼 보이고 parent header가 반복됩니다. 평면 diff에서 active range만 강조합니다.
- identifier rename·파일 인접성만으로 변경 의미를 만들면 구현체 교체를 계약 전환으로 과잉 해석합니다. Source-backed 인과관계가 없으면 confidence를 낮추거나 의미를 만들지 않습니다.
- Agent가 raw Mermaid를 제출하게 하면 syntax·보안·색상 문법이 canonical에 섞입니다. 구조화 visual만 저장하고 renderer가 Mermaid를 파생합니다.
- 전체 시스템 지도를 모든 meaning 카드에 넣으면 inline diff보다 diagram이 더 커집니다. Flowchart 12 node·20 edge, sequence 8 actor·16 message 안에서 해당 전환만 압축합니다.
- Inline chart의 CSS 높이만 무제한으로 늘리면 review 문서 흐름이 깨집니다. Inline은 compact하게 유지하고 자세히 보기는 full-screen overlay와 내부 scroll로 분리합니다.
- 기존 SVG DOM을 그대로 clone하면 Mermaid marker·definition ID가 문서에서 중복될 수 있습니다. Overlay는 canonical source를 unique render ID로 다시 렌더링합니다.
- action menu를 native toggle에만 맡기면서 interactive element를 중첩하거나 item/outside/Esc close를 생략하면 한 번 열린 메뉴가 사용자의 다음 조작을 가립니다.
- HTML과 Notion이 서로 다른 source를 변환하거나 Notion 내용을 review canonical로 역수입하면 같은 revision의 설명·finding·질문이 서로 달라집니다.
- Meta Review를 자체 ID의 별도 페이지로 저장하거나 기존 toggle을 archive하지 않고 append만 하면 같은 학습 흐름이 분리되거나 revision별 중복 section이 누적됩니다.
- declaration source를 render 시 mutable checkout에서 다시 읽으면 immutable review run과 다른 코드를 질문하게 됩니다.
- diff freshness hash에 full-source hash를 섞으면 기존 remote/current diff stale 검산과 호환되지 않습니다.
