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
  - skills/human-pr-review
source:
  - conversation:2026-08-11-human-meta-review-corpus
  - conversation:2026-08-18-easy-review-harness
reviewed_at: 2026-08-18
reviewed_commit: 0eafe7e
related:
  - evidence-first-verification-gate
  - live-artifact-preview-pattern
  - private-overlay-package-boundary
  - stress-interview-multi-axis-review
  - skills-as-portable-procedures
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
