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
applies_to:
  - README.md
  - docs/knowledge
  - skills/pilee-knowledge
source:
  - session-backfill:2026-05-05#readme-philosophy-discussion
reviewed_at: 2026-05-05
reviewed_commit: d5829047aef2c107923607d377fae7e225a2f3cd
related:
  - readme-coverage-map
  - ask-user-question-decision-gates
  - deterministic-vs-ai-actions
---

## Judgment

README에는 두 종류의 내용이 있습니다. Knowledge coverage table처럼 CLI가 결정적으로 생성하는 영역은 자동 갱신 대상이지만, 프로젝트의 철학·포지셔닝·사용자-facing 설명은 소유자의 판단이 들어가는 public narrative입니다.

## Gate Rule

README의 generated block은 `node scripts/knowledge.mjs --graph`로 갱신합니다. 반대로 “pilee가 무엇을 지향하는가”, “왜 이 구조를 택했는가”, “외부 사용자에게 어떤 인상을 줄 것인가”를 바꾸는 문장은 사용자에게 물어보거나 명시적 지시가 있을 때만 수정합니다.

세션 중 즉시 결정이 필요한 경우가 아니라면, 선호되는 질문 방식은 대화 interrupt가 아니라 자동 정합성 PR입니다. daily knowledge sync는 generated block을 제외한 README 내용이 바뀐 날 `docs/knowledge-review.md`에 README public narrative review 항목을 올려, 사용자가 PR에서 철학/포지셔닝 문구를 확인하게 합니다.

## Failure Mode

철학 문구를 자동 정합성 작업처럼 조용히 바꾸면, 문서는 최신이지만 소유자의 목소리를 잃습니다. README는 coverage map이면서 동시에 public front door이므로, deterministic 영역과 판단 영역을 분리해야 합니다.
