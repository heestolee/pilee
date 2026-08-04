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
  - skills/self-healing
  - skills/stress-interview
source:
  - conversation:2026-06-16-test-refine-design
reviewed_at: 2026-08-03
reviewed_commit: 9bc5850de17b
related:
  - skills-as-portable-procedures
  - self-healing-actionable-loop
  - stress-interview-multi-axis-review
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

## Runbook Boundary

실제 수정 단계에서는 `skills/test-boundary-refactor/references/test-refine-runbook.md`를 실행 체크리스트로 사용합니다. Knowledge 문서는 판단 단위를 보존하고, runbook은 diff audit → 테스트 경계 분류 → 수정 순서 → 가까운 검증을 반복 가능한 절차로 분리합니다.

## Practical Refactor Pattern

1. 현재 diff나 지정 path에서 test/spec 파일과 대상 source를 찾습니다.
2. 각 테스트를 `behavior`, `logic`, `boundary`, `contract`, `noise`로 분류합니다.
3. behavior test에 섞인 내부 구현 assertion, 과한 provider/mock, 목적보다 큰 fixture를 제거합니다.
4. 중요한 내부 로직은 helper/hook/service로 분리하고 직접 테스트합니다.
5. 외부 API/DB/OAuth/router/webview/third-party boundary만 mock으로 남깁니다.
6. 가까운 테스트만 실행하고, wrapper가 broad suite로 fan-out되면 baseline과 분리합니다.

## Preventive Gate Rule

명시적 `/test-refine`뿐 아니라 자동 수정 루프가 테스트를 생성·확장하는 순간에도 이 경계를 적용합니다. 특히 self-healing worker가 신규 spec, 한 사이클 3개 이상의 test case, 제품 코드보다 큰 test diff, 반복 mock 순서 assertion을 만들면 사후 요청을 기다리지 않고 main agent가 즉시 경계를 재분류합니다. 테스트를 줄일지 말지를 사용자에게 매번 심사시키지 않습니다.

정량 기준은 삭제 명령이 아니라 audit trigger입니다. 결제·권한·데이터 무결성처럼 서로 다른 contract가 실제로 여러 개면 큰 테스트 diff도 허용할 수 있지만, 각 테스트가 다른 contract를 닫는다는 근거가 있어야 합니다.

## Failure Mode

이 규칙을 모든 테스트 작업에 기계적으로 적용하면 필요한 integration test까지 줄일 수 있습니다. 반대로 명시적 `/test-refine`에만 적용하면 자동 worker가 과잉 테스트를 만든 뒤 사용자에게 다이어트 비용을 넘깁니다. 따라서 일반 테스트 작성에는 책임 경계로 적용하고, self-healing처럼 자동 fan-out이 있는 흐름에는 Test Change Gate로 예방 적용합니다.
