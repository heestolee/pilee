---
title: 인간 PR 리뷰는 독립 판단 뒤에 precedent를 붙인다
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
  - skills/human-pr-review
source:
  - conversation:2026-08-11-human-meta-review-corpus
  - conversation:2026-08-18-easy-review-harness
  - user-direction:2026-08-25-workspace-activation-redesign
reviewed_at: 2026-08-26
reviewed_commit: 7bab5e6bc52b2bc5c634653403faef2b904be028
related:
  - evidence-first-verification-gate
  - live-artifact-preview-pattern
  - private-overlay-package-boundary
  - stress-interview-multi-axis-review
  - skills-as-portable-procedures
  - workspace-action-panel-activation-contract
---

## Judgment

인간 리뷰 corpus는 현재 PR을 대신 판단하는 정답지가 아니라, 현재 diff만으로 먼저 만든 review finding을 검증하고 더 잘 설명하기 위한 precedent memory입니다. 과거 사례를 먼저 보여주면 현재 PR에서 그 사례와 닮은 문제만 찾는 anchoring이 생기므로, `/pr-review`는 immutable diff inspection과 blind review를 선행하고 나서만 corpus search를 허용합니다.

## Evidence Bundle

PR source는 원본 diff, 파싱된 line, stable `D...` evidence id, chunk inspection 상태, source hash를 분리해 저장합니다. ReviewCard의 code block은 agent가 다시 쓰지 않고 evidence id가 가리키는 원본 줄에서 extension이 파생합니다. 모든 chunk를 읽지 않았다면 submit을 막고, no finding은 승인이나 안전 보장으로 표현하지 않습니다.

## ReviewCard Contract

각 리뷰 포인트는 네 개의 사용자-facing 섹션을 가집니다.

1. exact code block
2. GitHub에 바로 쓸 수 있는 review draft
3. 발생 조건과 영향을 설명하는 rationale
4. 같은 패턴을 LLM이 다시 만들지 않게 하는 meta perspective

메타 관점은 기존 skill/guide가 적용 가능한지, 타입·API·도메인 구조로 잘못 만들기 어렵게 할 수 있는지, lint·test·CI로 정확히 잡을 수 있는지, 현재 PR과 follow-up 중 어디에서 닫을지를 다룹니다. 반복 근거나 정확한 대체 행동이 없으면 `scope: none`이 올바른 결과입니다.

## Document-First Render Rule

Review Studio의 기본 표면은 카드 대시보드가 아니라 Easy Review처럼 순서대로 읽히는 리뷰 문서입니다. `Overview → 먼저 볼 점 → 파일별 접이식 diff → 해당 코드 바로 아래 inline review → 검증 범위` 순서를 유지합니다. 코드·리뷰 초안·설명은 기본으로 읽히게 두고, 메타 관점·인간 precedent·문구 편집은 접습니다. 결정 버튼은 리뷰 본문을 지배하지 않는 작은 inline action으로 둡니다.

서로 멀리 떨어진 evidence를 하나의 `min..max` 코드 블록으로 합치지 않습니다. evidence별 주변 문맥을 분리하고 사이 범위는 fold 또는 omitted marker로 표현합니다. 전체 파일 coverage는 file section과 minimap으로 보존하되, finding이 없는 파일은 기본 접힘 상태로 둡니다.

## Checkout Execution Boundary

`/pr-review <URL>`은 홈 cwd에서 diff만 수집하고 끝나지 않습니다. GitHub PR head SHA에서 전용 `review/pr-<number>-<head>` worktree를 만들고, `.pi/pr-review.json`에 base/head/run/source-target session/activation provenance를 저장합니다. 매 실행 placement를 받은 뒤 source panel을 보존한 채 exact checkout session을 새 panel에서 열고, READY 이후 Review Studio와 `/diff` continuation을 시작합니다. Review Studio 오른쪽 질문은 이 checkout session으로 들어가므로 agent가 실제 source·callsite·schema·test를 조사할 수 있습니다.

Review worktree는 read-only 실행 경계입니다. dependency bootstrap을 자동 실행하지 않고 사용자가 수정 요청을 별도로 주기 전에는 repository를 변경하지 않습니다. `/diff`는 explicit `--base`가 없을 때 `.pi/pr-review.json`을 먼저 읽고 captured head와 현재 HEAD가 같을 때만 base SHA와의 merge-base를 사용합니다. Head가 drift하면 기존 finding을 유효한 것처럼 보여주지 않고 stale 오류를 냅니다.

## Guided Review Conversation

오른쪽 대화 패널은 선택한 card/file/evidence를 질문 context로 저장합니다. 질문은 같은 Pi session transcript에 전달되고, 답변 전 agent가 checkout source를 직접 조사해야 합니다. 답변은 `쉬운 설명 → 코드에서 확인된 사실 → 아직 모르는 정책/가정 → 리뷰 판단` 순서와 source evidence를 갖고 `questions.jsonl` append-only snapshot으로 보존됩니다.

PR review session의 review truth는 immutable run과 checkout metadata이지만, workflow가 source conversation에서 시작됐다면 전체 transcript와 `parentSession` lineage도 기본 보존합니다. Source context는 정책·의도·이전 판단을 제공하고, PR run/head metadata는 코드 revision truth를 제공합니다. 둘 중 하나를 버리는 대신 `.pi/pr-review.json`과 session provenance로 역할을 분리합니다.

## Corpus Boundary

Canonical corpus는 Git에 넣지 않고 local state의 `events.jsonl`, `cases.jsonl`, `manifest.json`으로 둡니다. `index.sqlite`는 언제든 재생성할 수 있는 FTS5 파생물입니다. Public pilee에는 schema·index/search engine만 두고, 회사 repository와 corpus 위치는 private profile에 둡니다.

Human-authored review event와 case annotation도 구분합니다. 원문 코멘트는 human source지만 `strong`, `partial`, `counterexample` 같은 해석은 별도 human review가 끝나기 전까지 `machine-draft`입니다. 검색 결과는 닮은 점뿐 아니라 현재 PR과 다른 점을 기록하며, supporting과 contrasting lane을 함께 제공합니다.

## Human Decision Gate

Review Studio는 GitHub write 도구가 아닙니다. `review-only`, `review-with-meta`, `edit`, `follow-up`, `hold`, `dismiss` 결정을 local sidecar로 저장합니다. 사람이 편집한 문장은 `editedReviewDraft`에 남기고 원래 agent draft를 덮어쓰지 않습니다. 댓글 게시, Issue 생성, lint·skill 수정은 별도의 명시적 외부 write 또는 구현 workflow로 넘깁니다.

## Failure Modes

- 과거 사례를 먼저 검색하면 review가 사례 편향적으로 변합니다.
- 인간 코멘트 문장만 복사하면 당시 code context와 outcome을 잃습니다.
- machine-draft annotation을 팀 합의처럼 쓰면 잘못된 규칙을 증폭합니다.
- 모든 review point에 lint·skill 후속을 강제하면 `no-meta-action`을 표현하지 못합니다.
- local working tree를 PR head로 가정하면 diff와 주변 코드의 revision이 달라질 수 있습니다.
- Review Studio가 열렸다는 사실만으로 finding 품질이나 사용자 채택을 증명할 수 없습니다.
