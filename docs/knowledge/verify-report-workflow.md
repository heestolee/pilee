---
title: Verify Report와 coverage-aware 증거 검증 흐름
tags:
  - verify-report
  - verification
  - evidence
  - coverage
  - capture
  - crop
  - before-after
  - glimpse
  - live-preview
  - report
  - show-report
  - 검증
  - 리포트
  - 증거
category: verification
status: active
confidence: high
applies_to:
  - skills/verify-report
  - extensions/archive-to-html
  - extensions/archive-to-html/verify-report-live.ts
  - show-report
source:
  - pilee-history:2026-05-05#43
  - pilee-history:2026-05-05#47
  - pilee-history:2026-05-05#48
  - pilee-history:2026-05-06#68
  - pilee-history:2026-05-06#69
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: d601ac0041243e78871b352c51f38b50f22be4bb
related:
  - pilee-knowledge-system
  - web-search-curator
  - evidence-first-verification-gate
  - live-artifact-preview-pattern
  - artifact-archive-reopenability
supersedes:
  - make-report-confirm-only-upload-flow
---

## Overview

Verify Report는 “완료했다고 말하기 전에 증거를 남긴다”는 원칙을 UI/로그/코드 diff까지 확장한 검증 리포트 흐름입니다. 현재 기준은 단순히 캡처 파일을 모으는 것이 아니라, 변경 리스크를 coverage axis로 쪼갠 뒤 각 축을 증거로 닫는 것입니다.

기본 동작은 로컬 확인용 report를 먼저 만들고 Glimpse에서 확인한 뒤, 명시적으로 요청된 경우에만 외부 업로드나 PR 갱신으로 넘어갑니다.

## Current Shape

검증은 `UI_CAPTURE`, `NETWORK`, `CONSOLE`, `CODE_DIFF`, `BE`, `SKIP` 같은 증거 타입으로 나뉩니다. 화면 변화가 핵심인 작업은 PNG/GIF 캡처가 강한 증거이고, GA 이벤트·API·백엔드 동작처럼 화면에 드러나지 않는 작업은 네트워크 로그, 콘솔 출력, 코드 diff, 서버 검증 결과를 evidence로 남깁니다.

live preview는 [web-search-curator](./web-search-curator.md)의 “작업 중 Glimpse 창이 상태를 실시간으로 보여준다”는 UX를 검증 리포트에 적용한 것입니다. 검증 계획을 세운 뒤 `start → update → finish`로 항목 상태가 변하고, finish 시 정적 HTML report가 남아 나중에도 다시 열 수 있습니다.

## Coverage Rule

캡처는 coverage 계획 뒤에 옵니다. responsive/layout 변경이면 mobile, breakpoint boundary, desktop을 각각 확인하고, nav 변경이면 expanded/collapsed와 role 차이를 봅니다. typography 변경은 screenshot만으로 닫지 않고 DOM class/token과 computed style을 함께 확인합니다.

기존 UI/동작을 바꾸는 작업은 before/after도 coverage 후보입니다. 같은 route, viewport, role, 데이터 상태로 작업 전 기준과 작업 후 결과를 나란히 보여주면 리뷰어가 “무엇이 바뀌었고 무엇은 유지됐는지”를 더 빨리 판단할 수 있습니다.

계획한 축이 빠졌다면 캡처가 있더라도 PASS가 아닙니다. 해당 항목은 `unverified`, `blocked`, 또는 Coverage Gap으로 남겨야 합니다.

## Capture Quality Rule

Primary evidence는 검증 포인트가 바로 보이는 viewport/section/element crop이어야 합니다. Before/after가 필요한 항목은 `Before — ...`, `After — ...` label로 같은 item에 넣어 비교되게 합니다. Full-page나 세로로 긴 스크롤 캡처는 supporting context로만 사용하고, 리포트에서는 토글/details/appendix/link 뒤에 둡니다.

긴 캡처를 그대로 본문에 펼치면 리뷰어가 실제 검증 지점을 찾기 어렵습니다. 따라서 Verify Report는 “전체 페이지를 찍었다”보다 “어떤 영역에서 무엇을 확인했는가”를 우선합니다.

## Reopen Rule

완료된 report는 `/show-report`의 검증 리포트 축에서 다시 열 수 있어야 합니다. Frame transcript나 원본 media와 섞지 말고, 판정이 있는 report 자체를 재검토 가능한 artifact로 남깁니다. 원본 evidence를 열어야 할 때는 browser/WebView의 static link 동작에 기대지 않고 artifact browser의 host-side open 흐름을 사용합니다.

report preview는 artifact browser 안에서 `/preview` route로 열리고, top bar의 `이전`, `브라우저에서 열기`, `닫기`로 탐색 경계를 유지해야 합니다. 검증 report는 생성 시점뿐 아니라 리뷰어가 나중에 열어 보는 시점에도 조작 가능한 증거여야 합니다.

원본 capture가 별도 media tab에 남는 경우에는 workspace/Jira/session/frame label로 group drill-down할 수 있어야 합니다. 다만 Verify Report의 PASS 판정은 여전히 report item evidence와 coverage gap에 있고, capture group은 원자료 탐색 보조입니다.

## Decision Rules

- report 작성은 검증의 일부이지 PR 업로드의 동의가 아닙니다.
- 사용자가 upload를 명시하지 않으면 로컬 report와 archive까지만 처리합니다.
- “화면이 바뀌지 않는다”는 이유로 검증을 생략하지 않고, 더 적절한 evidence type을 선택합니다.
- UI evidence는 crop/section image를 primary로 두고, 긴 full-page image는 supporting으로 둡니다.
- 기존 대비 변화가 검증 포인트이면 before/after를 포함합니다.
- before가 없거나 위험하면 생략 사유를 detail 또는 Coverage Gap에 남깁니다.
- live preview는 사용자의 중간 확인을 돕기 위한 것이며, 최종 판단은 export된 report와 검증 결과에 근거합니다.

## Why It Matters

pilee의 TFT 원칙은 근거 없는 완료 선언을 금지합니다. Verify Report는 그 원칙을 사람이 읽을 수 있는 artifact로 바꾸는 장치입니다. 작업자가 바뀌거나 세션이 끊겨도 report HTML과 archive가 남기 때문에, “무엇을 확인했는지”, “어떤 축이 빠졌는지”, “어떤 항목은 왜 skip/blocked인지”를 재검토할 수 있습니다.

## Gotchas

업로드/PR 업데이트 기능은 편리하지만 가장 조심해야 하는 경계입니다. 로컬 확인 전 자동 업로드가 기본값이 되면 report는 검증 도구가 아니라 의례적 산출물이 됩니다. 따라서 기본값은 항상 preview-first이고, 외부 반영은 opt-in으로 유지합니다.

또한 full-page screenshot 하나만 있는 리포트는 증거가 있어 보이지만 coverage가 부족할 수 있습니다. PASS는 캡처 존재가 아니라 coverage axis가 닫혔는지로 판단합니다.
