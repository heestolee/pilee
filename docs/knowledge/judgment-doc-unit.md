---
title: Knowledge 문서 단위는 판단 하나다
tags:
  - knowledge
  - judgment
  - granularity
  - documentation
  - coverage
  - 문서
category: knowledge
status: active
confidence: high
applies_to:
  - docs/knowledge
  - skills/pilee-knowledge
  - scripts/knowledge.mjs
source:
  - pilee-history:2026-05-05#52
  - session-backfill:2026-05-05#judgment-unit
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-11
reviewed_commit: 55766aa7231850e0c715240fe796224a9dac843c
related:
  - private-journal-public-doctrine
  - readme-coverage-map
  - freshness-diagnosis-report
---

## Judgment

Knowledge 문서는 기능 하나가 아니라 그 기능을 만든 재사용 가능한 판단 하나를 단위로 삼습니다. 기능은 coverage surface이고, 문서는 그 surface 안에 있는 의사결정의 지층입니다.

## Granularity Rule

한 기능 안에 서로 다른 판단이 있으면 문서를 나눕니다. 예를 들어 web search에는 출처 선택 승인, 한국어 출력, deterministic fallback, artifact archive가 각각 다른 판단으로 존재합니다. 처음에는 가까운 판단을 묶을 수 있지만, 검색될 질문이 달라지면 분리합니다.

## Resolver Insight Rule

로컬 resolver 실행 로그나 plan 자체는 knowledge 문서가 아닙니다. 여러 stale 해소 배치에서 반복 확인된 운영 원칙만 public doctrine으로 승격합니다. 예를 들어 “private evidence는 로컬에 두고 sanitized 결론만 PR에 올린다”는 판단 단위지만, 특정 session path나 실행 로그 원문은 판단 단위가 아닙니다.

skill workflow에 반영한 규칙도 반복 가능한 판단이면 knowledge 문서로 남깁니다. “resolver PR은 열고 멈춘다”처럼 한 번의 실행 절차를 넘어 이후 agent 행동을 제약하는 원칙은 문서 단위가 됩니다.

## Failure Mode

`fork-panel.md` 같은 기능명 문서 하나에 모든 결정을 넣으면 stale해질 때 어느 판단이 바뀌었는지 알기 어렵습니다. 문서가 많아지는 것은 문제가 아니며 README coverage map이 탐색을 담당합니다.
