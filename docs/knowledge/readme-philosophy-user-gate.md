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
reviewed_commit: f11f8c9b1e8e4664502eb3331507dc37bb7d8392
related:
  - readme-coverage-map
  - ask-user-question-decision-gates
  - deterministic-vs-ai-actions
---

## Judgment

README에는 두 종류의 내용이 있습니다. Knowledge coverage table처럼 CLI가 결정적으로 생성하는 영역은 자동 갱신 대상이지만, 프로젝트의 철학·포지셔닝·사용자-facing 설명은 소유자의 판단이 들어가는 public narrative입니다.

## Gate Rule

README의 generated block은 `node scripts/knowledge.mjs --graph`로 갱신합니다. 반대로 “pilee가 무엇을 지향하는가”, “왜 이 구조를 택했는가”, “외부 사용자에게 어떤 인상을 줄 것인가”를 바꾸는 문장은 사용자에게 물어보거나 명시적 지시가 있을 때만 수정합니다.

## Failure Mode

철학 문구를 자동 정합성 작업처럼 조용히 바꾸면, 문서는 최신이지만 소유자의 목소리를 잃습니다. README는 coverage map이면서 동시에 public front door이므로, deterministic 영역과 판단 영역을 분리해야 합니다.
