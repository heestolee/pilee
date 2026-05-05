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
applies_to:
  - docs/knowledge
  - skills/pilee-knowledge
  - scripts/knowledge.mjs
source:
  - pilee-history:2026-05-05#52
  - session-backfill:2026-05-05#judgment-unit
reviewed_at: 2026-05-05
reviewed_commit: d5829047aef2c107923607d377fae7e225a2f3cd
related:
  - private-journal-public-doctrine
  - readme-coverage-map
  - freshness-diagnosis-report
---

## Judgment

Knowledge 문서는 기능 하나가 아니라 그 기능을 만든 재사용 가능한 판단 하나를 단위로 삼습니다. 기능은 coverage surface이고, 문서는 그 surface 안에 있는 의사결정의 지층입니다.

## Granularity Rule

한 기능 안에 서로 다른 판단이 있으면 문서를 나눕니다. 예를 들어 web search에는 출처 선택 승인, 한국어 출력, deterministic fallback, artifact archive가 각각 다른 판단으로 존재합니다. 처음에는 가까운 판단을 묶을 수 있지만, 검색될 질문이 달라지면 분리합니다.

## Failure Mode

`fork-panel.md` 같은 기능명 문서 하나에 모든 결정을 넣으면 stale해질 때 어느 판단이 바뀌었는지 알기 어렵습니다. 문서가 많아지는 것은 문제가 아니며 README coverage map이 탐색을 담당합니다.
