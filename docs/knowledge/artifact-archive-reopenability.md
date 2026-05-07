---
title: 검토 산출물은 다시 열 수 있어야 한다
tags:
  - artifact
  - archive
  - show-report
  - history
  - html
  - reopen
  - captures
  - frame-studio
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
  - pilee-history:2026-05-07#74
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: 74e15fcd9f1709efc1b06a1dbb0a1976216ad8c3
related:
  - live-artifact-preview-pattern
  - backlog-source-session-provenance
  - verify-report-workflow
  - frame-studio-interactive-decision-ui
---

## Judgment

검토 산출물은 세션이 끝난 뒤에도 다시 열 수 있어야 합니다. 스크린샷 리포트, 웹 검색 승인 결과, backlog 원 세션 전문은 “그 순간 봤다”로 끝나지 않고 나중에 재검토 가능한 artifact로 남아야 합니다.

## Archive Rule

완료된 HTML report와 web search review는 workspace capture와 사용자 history archive에 저장합니다. `/show-report`는 최근 workspace 산출물과 archive를 함께 탐색할 수 있어야 하며, native viewer가 안 되면 browser fallback을 제공합니다.

## Open Original Rule

artifact browser에서 “원본 열기”는 static `file://` 링크에 기대지 않고 extension host가 허용한 realpath를 system opener로 여는 방식이 안전합니다. Glimpse/WebView가 외부 링크를 삼킬 수 있으므로, 열기 요청은 allowlisted local path와 host-side open 동작으로 처리합니다.

## Artifact Browser Rule

artifact 종류가 늘어나면 한 목록에 섞지 않습니다. `/show-report`는 최소 세 축을 분리해서 보여줘야 합니다.

1. 검증 리포트 — verify report와 web-search review 같은 HTML 판정/검토 산출물
2. 기획 / Frame — Frame Studio transcript처럼 질문·선택·markdown 흐름이 남는 co-thinking 전문
3. 캡처 / 미디어 — 아직 리포트로 묶이지 않았거나 원본 확인이 필요한 PNG/JPEG/GIF/WebP/SVG evidence

이 구분은 “판정이 있는 리포트”, “생각 과정 전문”, “해석 전 원자료”를 섞지 않기 위한 정보 구조입니다.

## Failure Mode

artifact가 임시 파일에만 남으면 검증과 의사결정의 근거가 사라집니다. reopenability는 보고서 기능이 아니라 accountability 기능입니다.
