---
title: Self-healing은 actionable item만 수정한다
tags:
  - self-healing
  - actionable
  - worker
  - fix-class
  - subagent
  - 자동수정
category: agent
status: active
confidence: high
applies_to:
  - skills/self-healing
  - skills/stress-interview
  - extensions/subagent
  - agents
source:
  - pilee-history:2026-05-01#7
  - pilee-history:2026-05-05#42
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-08-03
reviewed_commit: 9bc5850de17b
related:
  - stress-interview-multi-axis-review
  - test-boundary-refactor
  - subagent-model-policy
  - verification-invalidation-on-change
---

## Judgment

Self-healing은 “리뷰를 받았으니 알아서 고친다”가 아니라, 검토 결과에서 실행 가능한 항목만 골라 좁은 수정을 반복하는 루프입니다. 위험하거나 의사결정이 필요한 지적은 자동 수정 대상이 아닙니다.

## Loop Rule

각 사이클은 stress-interview → 지적 분류 → worker 수정 → 검증으로 이어집니다. 항목은 AUTO_FIX, ASK, INFO처럼 분류하고, worker에게는 대상 파일, 문제 설명, 기대 결과, 검증 명령을 포함한 프롬프트를 전달합니다.

## Test Change Gate Rule

Actionable finding은 회귀 테스트 하나와 1:1 대응하지 않습니다. Worker가 신규 spec을 만들거나 한 사이클에 테스트를 여러 개 추가하거나 테스트 churn이 제품 코드보다 커지면, main agent가 Cycle 안에서 test boundary를 다시 분류합니다. 기존 spec 재사용, shared policy의 대표 contract, 순수 로직 테스트를 우선하고, 구현 세부 mock assertion과 이전에 noise로 삭제한 spec의 재도입을 제거합니다. 이 다이어트는 사용자에게 넘기는 사후 작업이 아닙니다.

실제 DB 동시성이나 runtime race는 mock 호출 순서 테스트를 여러 개 추가해도 증명되지 않습니다. 대표 boundary contract와 integration GAP을 분리합니다.

## Verification Handoff Rule

Self-healing은 수정 루프이지 검증 리포트 생성기가 아닙니다. UI/responsive/nav/typography 변경처럼 화면 증거가 필요한 경우 worker가 캡처를 직접 수행하기보다 `/verify-report` 권장 여부와 coverage axis를 남깁니다. 자동 수정 루프와 증거 수집 리포트는 서로 다른 책임입니다.

## Failure Mode

`무언가 해봐` 같은 빈 요청은 worker를 위험하게 만듭니다. worker가 작업 범위와 완료 조건을 모르면 형식적 응답, 과잉 수정, 사용자 의도 오해가 발생합니다. Test Change Gate 없이 reviewer finding별 테스트를 추가하면 제품 수정 비용보다 테스트 제거 비용이 더 커지고, 사용자가 반복해서 수동 다이어트를 해야 합니다.
