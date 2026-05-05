---
title: 검토 산출물은 다시 열 수 있어야 한다
tags:
  - artifact
  - archive
  - show-report
  - history
  - html
  - reopen
category: workflow
status: active
applies_to:
  - extensions/archive-to-html
  - show-report
  - extensions/backlog
  - extensions/web-access
source:
  - pilee-history:2026-05-01#17
  - pilee-history:2026-05-05#47
  - pilee-history:2026-05-05#48
  - pilee-history:2026-05-05#51
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - live-artifact-preview-pattern
  - backlog-source-session-provenance
  - verify-report-workflow
---

## Judgment

검토 산출물은 세션이 끝난 뒤에도 다시 열 수 있어야 합니다. 스크린샷 리포트, 웹 검색 승인 결과, backlog 원 세션 전문은 “그 순간 봤다”로 끝나지 않고 나중에 재검토 가능한 artifact로 남아야 합니다.

## Archive Rule

완료된 HTML report와 web search review는 workspace capture와 사용자 history archive에 저장합니다. `/show-report`는 최근 workspace 산출물과 archive를 함께 탐색할 수 있어야 하며, native viewer가 안 되면 browser fallback을 제공합니다.

## Failure Mode

artifact가 임시 파일에만 남으면 검증과 의사결정의 근거가 사라집니다. reopenability는 보고서 기능이 아니라 accountability 기능입니다.
