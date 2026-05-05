---
title: Until loop는 종료 조건을 명시 보고한다
tags:
  - until
  - loop
  - report
  - condition
  - automation
category: workflow
status: active
applies_to:
  - extensions/until
  - until_report
source:
  - session-backfill:2026-05-05#tool-contract
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - evidence-first-verification-gate
  - deterministic-vs-ai-actions
---

## Judgment

반복 작업은 “계속 해봤다”가 아니라 종료 조건을 충족했는지 명시적으로 보고해야 합니다. until workflow에서는 매 반복의 현재 상태와 done 여부가 다음 판단의 입력입니다.

## Reporting Rule

작업 후에는 `until_report`로 `done` boolean과 한 줄 summary를 남깁니다. 조건이 충족되지 않았으면 무엇이 남았는지, 충족되었으면 어떤 증거로 완료 판단했는지 적습니다.

## Failure Mode

반복 루프가 명시 보고 없이 이어지면 사용자는 현재 시도 횟수와 종료 이유를 알 수 없습니다. until은 자동 반복이 아니라 조건 기반 상태 보고 프로토콜입니다.
