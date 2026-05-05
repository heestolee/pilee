---
title: Deterministic action과 AI review action은 분리한다
tags:
  - knowledge
  - deterministic
  - ai-actions
  - review
  - automation
  - 정합성
category: knowledge
status: active
applies_to:
  - scripts/knowledge.mjs
  - docs/knowledge
  - .github/workflows/knowledge-sync.yml
source:
  - pilee-history:2026-05-05#50
  - pilee-history:2026-05-05#52
reviewed_at: 2026-05-05
reviewed_commit: 468e619e086b19401a5f2944b35d9c32b24eee63
related:
  - freshness-diagnosis-report
  - readme-coverage-map
---

## Judgment

Knowledge automation에서 기계가 안전하게 할 수 있는 일과 AI/사람이 판단해야 하는 일을 분리해야 합니다. README graph 재생성은 deterministic이지만, missing coverage에 어떤 판단 문서를 만들지는 review action입니다.

## Action Rule

Deterministic action은 CLI가 동일 입력에 항상 같은 출력으로 처리할 수 있어야 합니다. 예: generated README block 재생성, link graph 검증, frontmatter 필수값 검사. AI action은 후보 해석, 문서 분리/병합, private 문맥 sanitization, medium/low confidence 문서 review처럼 판단이 필요한 일입니다.

## Failure Mode

둘을 섞으면 GitHub Actions가 private journal을 읽거나, 반대로 모든 coverage gap을 실패로 처리해 noise를 만듭니다. 자동화는 안전한 동기화만 맡고, 판단은 review loop에 남깁니다.
