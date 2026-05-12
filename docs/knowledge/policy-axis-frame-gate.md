---
title: 정책축 스캔은 Frame의 초기 게이트다
tags:
  - frame
  - tft
  - policy-axis
  - campaign
  - benefits
  - time-basis
  - default-fallback
  - channel-matrix
  - migration
  - cache-identity
category: frame
status: active
confidence: high
applies_to:
  - skills/frame
  - skills/tft-guidelines
  - .pi/frame.json
  - frame-studio
source:
  - user-direction:2026-05-12-com-2421-retro
reviewed_at: 2026-05-12
reviewed_commit: 4d4482f77093251abcf68e206a96ffbc3e6c991d
related:
  - frame-verify-contract
  - architecture-friction-tft-lens
  - tft-visual-structure-renderer
---

## Judgment

정책형 작업은 개별 룰을 많이 정해도 실패할 수 있습니다. 실패 원인은 대개 룰 자체가 아니라, 그 룰이 걸리는 축을 늦게 발견하는 데 있습니다. 혜택·쿠폰·캠페인·멤버십·포인트·가격·정산·예약·영수증처럼 사용자 결과가 정책에 의해 달라지는 작업은 `/frame` 초반에 정책축 스캔을 먼저 수행해야 합니다.

정책축 스캔은 사용자에게 긴 체크리스트를 던지는 절차가 아닙니다. AI가 시간 기준, 적용 수, DEFAULT/fallback, 소비 채널, 데이터/마이그레이션, API/cache identity를 먼저 훑고, 코드·문서·티켓으로 확인 가능한 축은 직접 채웁니다. 남은 축 중 frame 계약을 바꾸는 가장 큰 불확실성 하나만 AskUserQuestion으로 승격합니다.

## Frame Rule

`/frame`은 다음 트리거가 보이면 Step 2 카드에 `정책축 스캔` 섹션을 포함합니다.

- 혜택, 쿠폰, 캠페인, 멤버십, 포인트, 환급률, 가격, 정산, 예약, 영수증
- 현재 시점과 예약/구매/생성 시점이 달라질 수 있음
- DEFAULT, fallback, override, multi-mapping, priority, merge, sum, block 같은 정책어가 등장함
- Web/Admin/Slack/알림/예약 후 화면/API처럼 같은 정책을 여러 채널이 소비함
- migration, seed, rollback, idempotent re-run, GraphQL id/cache key가 정책 재현성에 영향 줌

필수 축은 다음 여섯 가지입니다.

1. 시간 기준 — 현재 기준인지 이벤트/예약/구매/생성 시점 기준인지
2. 적용 대상 수 — 단일 정책인지, 여러 정책이 동시에 붙을 수 있는지
3. DEFAULT/fallback — fallback-only인지, non-default와 병합되는지, 숨기는지
4. 소비 채널 — 채널별 기준 시간과 표시 규칙이 같은지
5. 데이터/마이그레이션 — seed, 운영 이력 보존, idempotent re-run, rollback/restore 조건
6. API/cache identity — 정책 조합과 기간이 object id, loader key, cache key에 드러나는지

## Ask Rule

정책축 스캔 결과를 모두 질문으로 만들면 TFT가 의례적 체크리스트가 됩니다. 질문은 아래 조건을 모두 만족하는 축 하나만 고릅니다.

- 선택에 따라 DB 제약, migration, API shape, cache key, 검증 범위가 달라진다.
- 코드/문서/티켓으로 확정할 수 없다.
- 후반 PR review에서 나오면 구현 모델이 뒤집힐 가능성이 있다.

질문은 `현재 이해 / 막힌 결정 / 추천 답안 / 질문` 카드로 작성합니다. 예를 들어 “한 spot에 여러 campaign이 붙을 수 있는가?”는 단순 선호가 아니라 DB unique constraint, guide merge, refund rate calculation, cache identity를 바꾸므로 AskUserQuestion 대상입니다.

## Canonical Rule

스캔 결과는 canonical에 남아야 합니다. 가장 좋은 형태는 `frame.json.policy_axis_scan`이며, 최소한 다음 필드 중 하나에는 반영되어야 합니다.

- `review_lenses`
- `risk_register`
- `success_criteria`
- `verify_plan.manual_checks`
- `decision_queue`

채널별 규칙이 다르면 `channel_matrix` 형태로 남깁니다. 이 매트릭스는 구현 계획이 아니라, 검증과 리뷰가 “어느 채널에서 어떤 기준 시간을 보아야 하는가”를 놓치지 않게 하는 계약입니다.

## Boundary

정책축 스캔은 모든 작업을 설계 회의로 키우는 장치가 아닙니다. 트리거가 없으면 Step 2에 `트리거 없음`이라고 짧게 남기고 넘어갑니다. 트리거가 있어도 코드/문서/티켓으로 축이 모두 닫히면 질문하지 않고 frame draft에 결론만 남깁니다.

반대로 결제·보안·PII·스키마·외부 연동·동시성·운영 환경처럼 기존 Non-delegable 영역과 겹치면 정책축 스캔은 질문 생략 근거가 아닙니다. 해당 축은 `ask_first` 또는 `decision_queue`로 승격해야 합니다.

## Review Trigger

다음 변화가 생기면 다시 검토합니다.

- `/frame`이 정책축 스캔을 너무 자주 켜 사용자를 방해할 때
- 정책형 작업에서 여전히 시간 기준/DEFAULT/다중 적용/채널 차이가 PR 후반에 발견될 때
- `frame.json` schema에 더 엄격한 policy axis validation을 extension 수준에서 넣을지 결정할 때
