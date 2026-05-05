---
title: DB write는 인간 실행 게이트를 가진다
tags:
  - db-write
  - migration
  - sql
  - approval
  - transaction
  - database
category: database
status: active
applies_to:
  - skills/db-write
  - skills/db-write-migration
source:
  - pilee-history:2026-05-01#analysis-db-write
  - session-backfill:2026-05-01#workflow-analysis
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - ask-user-question-decision-gates
  - evidence-first-verification-gate
---

## Judgment

DB write는 AI가 “좋아 보이는 SQL”을 바로 실행하는 작업이 아닙니다. 사전 SELECT, 실행 SQL, 사후 SELECT, 승인 게이트를 분리해 인간이 영향 범위를 판단할 수 있어야 합니다.

## Gate Rule

운영/개발 DB를 직접 수정하는 작업은 작업 설명 → 사전 조회 → 실행 SQL → 사후 검증 순서를 따릅니다. 마이그레이션이 필요한 DDL/대량 백필은 migration 파일로 만들고, set-based SQL, idempotency, down()을 검토합니다. 트레이드오프는 추상적 위험이 아니라 row 수와 영향으로 설명합니다.

## Failure Mode

“위험해 보이니 중단”이나 “괜찮아 보이니 실행” 모두 좋지 않습니다. DB write의 핵심은 사용자가 결정할 수 있도록 구체적 증거와 되돌림 경로를 제시하는 것입니다.
