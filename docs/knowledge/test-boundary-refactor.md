---
title: 테스트는 책임 경계에 맞춰 다듬는다
tags:
  - testing
  - mock
  - refactor
  - boundary
  - unit-test
  - contract-test
  - test-refine
category: workflow
status: active
confidence: high
applies_to:
  - extensions/test-refine
  - skills/test-boundary-refactor
source:
  - conversation:2026-06-16-test-refine-design
reviewed_at: 2026-06-16
reviewed_commit: 8e02ae52aad416a1d2d22412e22e7c55a86ce73d
related:
  - skills-as-portable-procedures
  - request-traceability-surgical-changes
  - workflow-weight-proportionality
---

## Judgment

테스트 리팩터링은 더 많은 mock과 fixture를 쌓는 작업이 아니라, 테스트가 맡는 책임을 경계에 맞게 줄이는 작업입니다. 사용자-facing 기능 테스트는 사용자가 보는 행동과 결과만 검증하고, 내부 로직은 분리해서 직접 테스트하며, 외부 의존성만 mock/stub/fake로 격리합니다.

## Boundary Rule

| 범주 | 기준 |
|---|---|
| 기능 단위 테스트 | 드롭다운이 펼쳐진다, 버튼 클릭 후 문구가 바뀐다, 링크가 올바르다처럼 사용자 관찰 결과를 검증한다. 내부 함수 호출 여부는 보지 않는다. |
| 내부 로직 테스트 | 계산, 분기, mapper, helper, hook/service 정책은 mock하지 않고 순수하게 호출해 입력과 출력을 검증한다. |
| 외부 의존성 boundary | API, DB, OAuth, router, webview, third-party SDK처럼 내 코드 밖의 효과만 mock으로 격리한다. |
| contract test | unit만으로 계층 간 값 전달 누락이 생길 수 있으면, 외부 boundary만 fake로 두고 내 코드 경로를 작게 통과시킨다. |

## Command/Skill Split

사용자-facing entrypoint는 `/test-refine` 하나로 둡니다. 같은 이름의 skill을 만들면 `/test-refine`과 `/skill:test-refine`이 동시에 보여 혼란스러우므로, slash command는 `extensions/test-refine`, 판단 본체는 `skills/test-boundary-refactor`로 나눕니다.

## Practical Refactor Pattern

1. 현재 diff나 지정 path에서 test/spec 파일과 대상 source를 찾습니다.
2. 각 테스트를 `behavior`, `logic`, `boundary`, `contract`, `noise`로 분류합니다.
3. behavior test에 섞인 내부 구현 assertion, 과한 provider/mock, 목적보다 큰 fixture를 제거합니다.
4. 중요한 내부 로직은 helper/hook/service로 분리하고 직접 테스트합니다.
5. 외부 API/DB/OAuth/router/webview/third-party boundary만 mock으로 남깁니다.
6. 가까운 테스트만 실행하고, wrapper가 broad suite로 fan-out되면 baseline과 분리합니다.

## Failure Mode

이 규칙을 전역 지침으로만 두면 모든 테스트 작업에 기계적으로 적용되어 필요한 integration test까지 줄일 수 있습니다. 그래서 `/test-refine`처럼 명시적으로 호출되는 command와 자연어 트리거용 skill로 좁혀 적용합니다.
