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
reviewed_at: 2026-08-30
reviewed_commit: 4176907
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

`E-...` explanation hunk는 변경 의도와 coverage를 설명하는 단위이지 source 선택 단위가 아닙니다. TS/TSX/JS/JSX는 capture 시점의 exact before/after source를 TypeScript AST로 파싱해 변수·함수·컴포넌트·hook·메서드·class·type·test declaration tree를 별도 저장합니다. changed code row는 가장 작은 declaration을 기본 선택하고, breadcrumb와 상위·이전 하위·더 작은 범위 control로 함수·class·파일까지 확장·축소합니다.

선택 preview는 pinned source의 선언 전체를 연속된 줄 범위로 보여주고 before/after를 전환합니다. 질문 provenance는 declaration ID, side, file, 그 선언 안의 전체 changed evidence를 함께 검증합니다. Source snapshot은 file side당 512KB, 전체 4MB로 제한하고 snapshot hash는 diff freshness hash와 분리합니다. Parser 미지원·capture 실패·크기 초과 run만 semantic hunk → line fallback을 유지합니다.

서로 멀리 떨어진 evidence를 하나의 `min..max` 코드 블록으로 합치지 않습니다. changed line은 설명 coverage에서 숨기지 않고, 긴 unchanged context만 fold할 수 있습니다. finding이 없는 파일도 역할·변경 이유와 모든 semantic hunk 설명을 유지합니다.

## Checkout Execution Boundary

`/meta-review <URL>`과 `/diff <URL>`은 같은 checkout 준비 계층을 사용합니다. GitHub PR head SHA에서 전용 `review/pr-<number>-<head>` worktree를 만들고, `.pi/review-context.json`에 base/head/선택적 run/source-target session/activation provenance를 저장합니다. legacy `.pi/pr-review.json`은 읽기 fallback으로만 유지합니다. `/diff <URL>`은 Meta Review artifact를 만들지 않고 exact checkout session에서 raw diff를 바로 열 수 있으며, 이후 같은 세션에서 `/meta-review`를 실행하면 동일 source context에 run을 연결합니다.

Review worktree는 read-only 실행 경계입니다. dependency bootstrap을 자동 실행하지 않고 사용자가 수정 요청을 별도로 주기 전에는 repository를 변경하지 않습니다. `/diff`는 explicit `--base`가 없을 때 review context를 먼저 읽고 captured head와 현재 HEAD가 같을 때만 base SHA와의 merge-base를 사용합니다. Head가 drift하면 기존 설명과 finding을 유효한 것처럼 보여주지 않고 stale 오류를 냅니다.

## Guided Review Conversation

코드 리뷰 탭은 학습노트와 같은 오른쪽 detail drawer를 질문 surface로 재사용합니다. 본문 하단에 별도 composer를 중복하지 않고, 코드 리뷰 진입 때 drawer를 한 번 열며 toolbar의 `질문 패널`로 다시 열 수 있습니다. 본문은 drawer 너비만큼 줄어들어 선택 context와 diff를 동시에 읽습니다.

질문 scope는 `전체 PR`과 `선택 블록`으로 분리합니다. `한눈에 보기`와 `변경 파일 관계`는 allowlisted `section` provenance를, file intro·diff line·semantic explanation hunk·ReviewCard는 exact `file | line | hunk | card` provenance와 evidence를 저장합니다. 선택 블록 대화는 같은 evidence를 공유하더라도 selection kind/id가 다른 블록과 섞지 않습니다. 질문은 같은 Pi session transcript에 visible user event로 기록되고 내부 run/tool 지침은 hidden control envelope로 분리합니다.

Owner Pi는 질문을 글자 수나 파일 수가 아니라 work shape로 route합니다. selection과 현재 review source만으로 닫히는 질문은 exact checkout session이 direct로 답하고, 외부 precedent·실행 검증·여러 독립 경로 비교·전체 PR 재분석이 실제로 필요하면 같은 question ID를 worker로 승격합니다. worker 결과는 route 시점 source/head pin과 적용 직전 checkout diff가 모두 일치할 때만 답변으로 publish합니다. 공통 상태 전이와 recovery 계약은 [질문 UI와 실행 owner는 분리한다](./question-ui-execution-owner-routing.md)를 따릅니다.

답변은 `쉬운 설명 → 코드에서 확인된 사실 → 아직 모르는 정책/가정 → 리뷰 판단` 순서와 source evidence를 갖고 `questions.jsonl` append-only snapshot으로 보존됩니다. terminal answer/fail/stale는 한 snapshot으로 기록하고 늦은 callback이 다시 열지 못합니다. pending execution이 있는 동안만 live state를 polling하고 모두 끝나면 멈춥니다. Pi에서 `/diff`를 보며 나눈 대화도 같은 checkout/session을 사용하지만, 사용자의 명시적 갱신 요청 전에는 review artifact를 자동 수정하지 않습니다.

Meta Review session의 review truth는 immutable run과 checkout metadata이지만, workflow가 source conversation에서 시작됐다면 전체 transcript와 `parentSession` lineage도 기본 보존합니다. Source context는 정책·의도·이전 판단을 제공하고, run/head metadata는 코드 revision truth를 제공합니다.

## Explicit Refresh and Revisions

코드 리뷰 본문은 자동으로 바뀌지 않습니다. background check는 외부 PR의 head/base 또는 현재 worktree diff hash를 읽기 전용으로 비교해 `새 변경 있음` badge만 표시합니다. 사용자가 `갱신하기` 버튼을 누르거나 Pi에서 명시적으로 갱신을 요청할 때만 새 immutable run을 series의 다음 revision으로 추가합니다.

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
- declaration source를 render 시 mutable checkout에서 다시 읽으면 immutable review run과 다른 코드를 질문하게 됩니다.
- diff freshness hash에 full-source hash를 섞으면 기존 remote/current diff stale 검산과 호환되지 않습니다.
