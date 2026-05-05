---
title: README는 knowledge coverage map이다
tags:
  - knowledge
  - readme
  - coverage
  - graph
  - surface
  - todo
category: knowledge
status: active
applies_to:
  - README.md
  - docs/knowledge
  - scripts/knowledge.mjs
source:
  - pilee-history:2026-05-05#50
  - pilee-history:2026-05-05#52
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - freshness-diagnosis-report
  - judgment-doc-unit
---

## Judgment

Root README의 knowledge table은 문서 색인이 아니라 coverage map입니다. extension/skill surface에서 어떤 doctrine으로 이어지는지 보여주고, 연결이 없으면 `TODO: knowledge 문서 필요`를 드러내야 합니다.

## Coverage Rule

README generated block은 CLI가 재생성합니다. 수동으로 표를 편집하지 않습니다. 새 문서가 어떤 surface에 적용되는지 `applies_to`를 정확히 쓰면 README가 자동으로 링크를 늘립니다. missing coverage는 deterministic failure가 아니라 backfill/review 후보입니다.

## Failure Mode

README가 예쁜 소개문만 담으면 실제로 어떤 판단이 문서화되지 않았는지 보이지 않습니다. pilee에서는 부족한 coverage를 숨기지 않는 것이 지식 시스템의 일부입니다.
