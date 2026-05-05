---
title: Verify Report와 증거 기반 검증 흐름
tags: [verify-report, verification, evidence, glimpse, live-preview, report, show-report, 검증, 리포트, 증거]
category: verification
status: active
applies_to:
  - skills/verify-report
  - extensions/archive-to-html
  - extensions/archive-to-html/verify-report-live.ts
  - show-report
source:
  - pilee-history:2026-05-05#43
  - pilee-history:2026-05-05#47
  - pilee-history:2026-05-05#48
reviewed_at: 2026-05-05
related:
  - pilee-knowledge-system
  - web-search-curator
supersedes:
  - make-report-confirm-only-upload-flow
---

## Overview

Verify Report는 “완료했다고 말하기 전에 증거를 남긴다”는 원칙을 UI/로그/코드 diff까지 확장한 검증 리포트 흐름입니다. 기존 report 흐름이 업로드와 PR 반영까지 섞어버리기 쉬웠다면, 현재 구조는 로컬 확인용 report를 먼저 만들고 Glimpse에서 확인한 뒤, 명시적으로 요청된 경우에만 외부 업로드나 PR 갱신으로 넘어갑니다.

## Current Shape

검증은 `UI_CAPTURE`, `NETWORK`, `CONSOLE`, `CODE_DIFF`, `BE`, `SKIP` 같은 증거 타입으로 나뉩니다. 화면 변화가 핵심인 작업은 PNG/GIF 캡처가 가장 강한 증거이고, GA 이벤트·API·백엔드 동작처럼 화면에 드러나지 않는 작업은 네트워크 로그, 콘솔 출력, 코드 diff, 서버 검증 결과를 evidence로 남깁니다.

live preview는 [web-search-curator](./web-search-curator.md)의 “작업 중 Glimpse 창이 상태를 실시간으로 보여준다”는 UX를 검증 리포트에 적용한 것입니다. 검증 계획을 세운 뒤 `start → update → finish`로 항목 상태가 변하고, finish 시 정적 HTML report가 남아 나중에도 다시 열 수 있습니다.

## Decision Rules

- report 작성은 검증의 일부이지 PR 업로드의 동의가 아닙니다.
- 사용자가 upload를 명시하지 않으면 로컬 report와 archive까지만 처리합니다.
- “화면이 바뀌지 않는다”는 이유로 검증을 생략하지 않고, 더 적절한 evidence type을 선택합니다.
- live preview는 사용자의 중간 확인을 돕기 위한 것이며, 최종 판단은 export된 report와 검증 결과에 근거합니다.

## Why It Matters

pilee의 TFT 원칙은 근거 없는 완료 선언을 금지합니다. Verify Report는 그 원칙을 사람이 읽을 수 있는 artifact로 바꾸는 장치입니다. 작업자가 바뀌거나 세션이 끊겨도 report HTML과 archive가 남기 때문에, “무엇을 확인했는지”와 “어떤 항목은 왜 skip/blocked인지”를 재검토할 수 있습니다.

## Gotchas

업로드/PR 업데이트 기능은 편리하지만 가장 조심해야 하는 경계입니다. 로컬 확인 전 자동 업로드가 기본값이 되면 report는 검증 도구가 아니라 의례적 산출물이 됩니다. 따라서 기본값은 항상 preview-first이고, 외부 반영은 opt-in으로 유지합니다.
