---
title: Live artifact는 local preview first다
tags:
  - artifact
  - glimpse
  - preview
  - sse
  - upload
  - local-first
  - live
category: workflow
status: active
applies_to:
  - extensions/web-access
  - extensions/archive-to-html
  - skills/verify-report
  - extensions/frame-studio
  - show-report
source:
  - pilee-history:2026-05-05#43
  - pilee-history:2026-05-05#44
  - pilee-history:2026-05-05#48
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: 5474cf3424f95d56ba2f6ef04f7e7de1dcf9a8e4
related:
  - verify-report-workflow
  - web-search-curator
  - artifact-archive-reopenability
---

## Judgment

검증 리포트와 웹 검색 요약처럼 사용자가 승인해야 하는 산출물은 외부 업로드보다 로컬 preview가 먼저입니다. 산출물을 만들었다는 사실이 곧 publish 동의가 되어서는 안 됩니다.

## Preview Rule

진행 중 상태가 의미 있으면 local server와 SSE로 live preview를 보여주고, 완료 후에는 정적 HTML을 export합니다. 사용자는 Glimpse/브라우저에서 확인한 뒤 approve/upload/recapture/close 같은 명시 행동을 선택합니다.

## Reopen Rule

local preview first는 일회성 창을 뜻하지 않습니다. Verify Report, web search review, Frame Studio transcript처럼 검토·선택·증거가 남는 artifact는 `/show-report`나 identity-bound reopen 흐름으로 다시 열 수 있어야 합니다. live 상태를 보존할 수 없으면 최소한 정적 HTML/JSON transcript를 archive에 남깁니다.

## Boundary

기본 동작은 로컬 report/archive까지입니다. PR 업데이트, 외부 업로드, 최종 답변 채택은 별도 opt-in입니다. 이 경계가 무너지면 artifact workflow는 안전장치가 아니라 자동 배포 장치가 됩니다.
