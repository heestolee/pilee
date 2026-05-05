---
title: Freshness는 진단서다
tags:
  - knowledge
  - freshness
  - diagnosis
  - review
  - candidate
  - 정합성
category: knowledge
status: active
applies_to:
  - scripts/knowledge.mjs
  - docs/knowledge
  - skills/pilee-knowledge
source:
  - pilee-history:2026-05-05#50
  - pilee-history:2026-05-05#52
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - judgment-doc-unit
  - readme-coverage-map
  - deterministic-vs-ai-actions
---

## Judgment

Knowledge freshness는 단순히 “문서가 낡았다”는 경고가 아니라 자동화, AI rewrite, human review가 공유하는 진단서입니다. 같은 report가 README 재생성, 문서 검토, coverage backfill의 입력이 되어야 합니다.

## Report Shape

진단서는 base, summary, doctrine, readme, reasons, severity, deterministic_actions, ai_actions, candidates를 분리합니다. 문서 자체의 stale, README generated block stale, missing coverage는 서로 다른 문제이므로 같은 실패로 취급하지 않습니다.

## Review Rule

freshness가 제안한 후보는 자동 수정 명령이 아닙니다. 문서를 실제로 읽고 현재 판단이 맞는지 확인한 뒤 수정하거나 `--confirm`으로 reviewed 기준을 갱신합니다.
