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
reviewed_at: 2026-05-07
reviewed_commit: 858d8a21fb045c561b35a90172f37eb149d89b92
related:
  - judgment-doc-unit
  - readme-coverage-map
  - deterministic-vs-ai-actions
---

## Judgment

Knowledge freshness는 단순히 “문서가 낡았다”는 경고가 아니라 자동화, AI rewrite, human review가 공유하는 진단서입니다. 같은 report가 README 재생성, 문서 검토, coverage backfill의 입력이 되어야 합니다.

## Report Shape

진단서는 base, summary, doctrine, readme, reasons, severity, deterministic_actions, ai_actions, candidates를 분리합니다. 문서 자체의 stale, README generated block stale, missing coverage, medium/low confidence review는 서로 다른 문제이므로 같은 실패로 취급하지 않습니다.

## Review Rule

freshness가 제안한 후보는 자동 수정 명령이 아닙니다. 문서를 실제로 읽고 현재 판단이 맞는지 확인한 뒤 수정하거나 `--confirm`으로 reviewed 기준을 갱신합니다. confidence review 후보를 받아들이는 경우에는 `--confirm <doc-id> --confidence high`로 승격합니다.

## Local Resolver Shape

`--resolve-stale`은 freshness 진단서를 실제 로컬 작업 단위로 바꾸는 보조 명령입니다. 이 명령은 `.context/knowledge-resolver/<timestamp>/` 아래에 `freshness.json`, `resolve-plan.md`, `prompt.md`, `pr-body.md`를 생성합니다. plan에는 stale/review_needed 문서, 관련 커밋 근거, 가능한 로컬 Pi session path hint, 판정 체크리스트가 들어갑니다. 실제 수정과 confirm은 agent/human이 plan을 읽고 private 맥락을 확인한 뒤 수행합니다.
