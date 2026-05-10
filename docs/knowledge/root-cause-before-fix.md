---
title: 수정 전에 근본 원인을 좁힌다
tags:
  - debugging
  - root-cause
  - triage
  - error-recovery
  - systematic
  - 디버깅
category: debugging
status: active
confidence: high
applies_to:
  - skills/systematic-debugging
  - skills/debugging-and-error-recovery
  - extensions/preflight
source:
  - pilee-history:2026-05-03#32
  - session-backfill:2026-05-02#setwidget-notify
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-10
reviewed_commit: 1324a5c86e643b17035d32fbb6f6611594f3ed4a
related:
  - evidence-first-verification-gate
  - verification-invalidation-on-change
---

## Judgment

버그나 예상 밖 동작을 만나면 바로 수정부터 하지 않고, 재현 조건과 근본 원인을 먼저 좁힙니다. 특히 터미널 UI, 알림, tool rendering처럼 증상이 시각적으로 보이는 문제는 표면 수정이 원인을 가리기 쉽습니다.

## Debug Rule

최근 변경, 재현 입력, 실제 출력, 기대 출력, 관련 코드 경계를 먼저 정리합니다. 가설은 명시하고, 하나씩 확인합니다. 원인이 확인되기 전의 수정은 실험으로 표시하고, 성공 여부를 검증 증거로 남깁니다.

## Host Boundary Rule

WebView, terminal host, OS opener처럼 외부 host가 끼는 버그는 브라우저 표준 동작만 보고 고치면 안 됩니다. static `file://` 링크가 브라우저에서는 열려도 Glimpse/WebView에서는 삼켜질 수 있으므로, 실제 host에서 버튼·route·open 요청을 재현하고 host-side boundary가 맞는지 확인합니다.

## Automation Noise Rule

자동화 결과가 기대와 다르면 숫자만 맞추지 말고 원인을 좁힙니다. 예를 들어 stale count가 머지 후 다시 늘면, 문서를 무작정 `--confirm`하기 전에 어떤 commit/file이 후보를 만들었는지 확인합니다. 생성물 변경이 review queue를 증폭한다면 생성물 exclusion처럼 원인 규칙을 고쳐야 합니다.

## Failure Mode

추측으로 고치면 같은 증상이 다른 위치에서 반복됩니다. systematic debugging은 속도를 늦추는 절차가 아니라 잘못된 방향 작업을 줄이는 안전장치입니다.
