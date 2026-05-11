---
title: README 철학 변경은 사용자 판단 게이트를 지난다
tags:
  - readme
  - philosophy
  - user-gate
  - public-facing
  - documentation
  - 판단
category: knowledge
status: active
confidence: high
applies_to:
  - README.md
  - docs/knowledge
  - skills/pilee-knowledge
source:
  - session-backfill:2026-05-05#readme-philosophy-discussion
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-11
reviewed_commit: 55766aa7231850e0c715240fe796224a9dac843c
related:
  - readme-coverage-map
  - ask-user-question-decision-gates
  - deterministic-vs-ai-actions
---

## Judgment

README에는 두 종류의 내용이 있습니다. Knowledge coverage table처럼 CLI가 결정적으로 생성하는 영역은 자동 갱신 대상이지만, 프로젝트의 철학·포지셔닝·사용자-facing 설명은 소유자의 판단이 들어가는 public narrative입니다.

## Gate Rule

README의 generated block과 knowledge map SVG의 숫자/cluster 지표는 `node scripts/knowledge.mjs --graph`로 갱신합니다. 반대로 “pilee가 무엇을 지향하는가”, “왜 이 구조를 택했는가”, “외부 사용자에게 어떤 인상을 줄 것인가”를 바꾸는 문장이나 SVG의 시각 디자인/비유 구조는 사용자에게 물어보거나 명시적 지시가 있을 때만 수정합니다.

세션 중 즉시 결정이 필요한 경우가 아니라면, 선호되는 질문 방식은 대화 interrupt가 아니라 자동 정합성 PR입니다. daily knowledge sync는 generated block을 제외한 README 내용이 바뀐 날 `docs/knowledge-review.md`에 README public narrative review 항목을 올려, 사용자가 PR에서 철학/포지셔닝 문구를 확인하게 합니다.

## PR Review Rule

사용자가 볼 지점은 README 전체 diff가 아니라 public narrative 변경입니다. generated knowledge table, knowledge map SVG의 deterministic metrics, review queue, coverage graph 같은 자동 산출물은 사용자의 철학 검토 대상에서 제외하고, 사람이 쓴 소개·포지셔닝·가치 판단 문장과 시각 은유/디자인 방향만 검토 큐에 올립니다.

local resolver PR도 같은 철학을 따릅니다. PR을 여는 것은 검토 요청이고, merge는 별도 사용자 판단입니다. 특히 초기 운영에서는 사용자가 직접 GitHub diff를 보고 merge할 수 있도록 자동 병합을 하지 않습니다.

## Failure Mode

철학 문구를 자동 정합성 작업처럼 조용히 바꾸면, 문서는 최신이지만 소유자의 목소리를 잃습니다. README는 coverage map이면서 동시에 public front door이므로, deterministic 영역과 판단 영역을 분리해야 합니다.
