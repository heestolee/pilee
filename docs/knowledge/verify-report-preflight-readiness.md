---
title: Verify Report 전에는 readiness를 먼저 잠근다
tags:
  - verify-report
  - preflight
  - readiness
  - capture
  - data
  - account
  - report
category: verification
status: active
confidence: high
applies_to:
  - skills/verify-report-preflight
  - skills/verify-report
source:
  - user-direction:2026-05-12-verify-report-preflight-skill
reviewed_at: 2026-05-12
reviewed_commit: 7a09453bb3b9bb95c36883f55ccdc6210cd59959
related:
  - verify-report-workflow
  - evidence-first-verification-gate
  - private-overlay-package-boundary
  - live-artifact-preview-pattern
title_en: Verify Report starts after readiness is locked
---

## Overview

Verify Report는 증거를 남기는 강한 검증 흐름이지만, URL·계정·데이터·before 기준이 준비되지 않은 상태로 시작하면 캡처 루프가 길어지고 결국 Coverage Gap만 남습니다. `/verify-report-preflight`는 full report에 들어가기 전 readiness와 작업 무게를 먼저 판단하는 얇은 gate입니다.

## Readiness Rule

캡처를 시작하기 전에 최소한 아래를 표로 잠급니다.

| 축 | 확인해야 할 것 |
|---|---|
| Target | local/dev/preview/prod URL과 route |
| Role/Data | 계정 alias, fixture/data 상태, side effect 여부 |
| Before | before/after가 필요한지, 같은 조건으로 비교 가능한지 |
| Evidence | UI_CAPTURE/NETWORK/CONSOLE/BE/CODE_DIFF 중 무엇이 기준을 닫는지 |
| Baseline | 반복 validation 실패가 known baseline인지 |
| Risk | 결제/알림/DB write/external API 같은 위험 action이 있는지 |

준비가 안 된 축이 있으면 report를 시작하지 않고 `blocked`로 남깁니다. Preflight는 PASS 증거가 아니므로, 준비가 끝난 뒤 실제 `/verify-report`나 `/verify` evidence로 최종 판정합니다.

## Weight Rule

- `light`: 단일 copy/style/hotfix면 focused crop/log/test 1~2개나 `/verify-report --no-workers`로 충분할 수 있습니다.
- `standard`: UI/BE/event 축이 몇 개 있으면 일반 `/verify-report`로 진행합니다.
- `full`: role/viewport/before-after/BE/event/정책이 섞이면 coverage plan과 worker fan-out을 명시합니다.
- `blocked`: data/account/side-effect 승인이 없으면 capture-heavy 검증을 시작하지 않습니다.

## Why It Matters

좋은 리포트는 많은 캡처가 아니라 닫힌 coverage입니다. Preflight는 검증을 줄이는 장치가 아니라, 캡처 전에 실패할 조건을 먼저 찾아 검증 시간을 짧게 만들고 report의 신뢰도를 높입니다.
