---
id: test.boundary-responsibility
kind: decision-lens
authority: generic-guideline
status: reviewed
confidence: high
scope: Tests and the code boundaries they verify
applies_to: [**/*.test.ts, **/*.test.tsx, **/*.spec.ts, **/*.spec.tsx]
signals: [mock, fixture, spy, expect, describe, provider, wrapper]
relations: [refines:function.single-action]
---

# Test Boundary Responsibility

## Trigger

- behavior test가 내부 helper/hook 호출이나 상태 변수에 결합된다.
- assertion과 무관한 provider·router·i18n·membership fixture가 커진다.
- 외부 API·DB·OAuth·webview·SDK와 내부 policy의 mock 경계가 섞인다.
- unit/component/contract/integration 중 어느 책임에 테스트를 둘지 불명확하다.

## Decision Questions

1. 이 테스트가 깨졌을 때 어떤 사용자 또는 시스템 contract가 깨지는가?
2. 사용자-facing behavior인가, 내부 순수 로직인가, 외부 boundary인가, 계층 간 contract인가?
3. mock 대상은 내 코드인가 외부 의존성인가?
4. fixture와 provider setup 중 assertion에 실제로 필요한 것은 무엇인가?
5. 같은 contract를 기존 spec이나 더 작은 table-driven test가 이미 닫는가?

## Outcomes

### `BEHAVIOR`

사용자가 보는 행동과 결과만 검증하고 내부 구현 assertion을 제거한다.

### `LOGIC`

계산·분기·mapper·policy를 분리해 입력과 출력으로 직접 검증한다.

### `BOUNDARY`

API·DB·OAuth·router·webview·third-party SDK 같은 외부 의존성만 fake/mock으로 격리한다.

### `CONTRACT`

외부 boundary만 fake로 두고 내 코드 계층 사이 값 전달을 작은 real path로 검증한다.

### `NOISE`

목적과 무관한 mock·fixture·provider·구현 세부 assertion을 제거하거나 통합한다.

## Required Evidence

- 테스트가 보호할 사용자/시스템 contract
- 테스트 대상 source의 책임 경계
- mock/fixture가 격리하는 실제 외부 효과
- 선택한 테스트 레벨과 제외한 상위 레벨의 이유
- 가장 가까운 실행 명령과 예상 fan-out

## Counterexamples

- framework callback이나 외부 SDK wrapper 자체가 제품 contract라면 boundary assertion은 유효하다.
- 실제 DB concurrency·network retry는 mock unit test 수를 늘려 PASS 처리하지 않고 integration gap으로 남긴다.
- 서로 다른 독립 contract가 있으면 테스트가 여러 개인 것이 곧 noise는 아니다.

## Sources

- `skills/test-boundary-refactor/SKILL.md`
- `skills/test-boundary-refactor/references/test-refine-runbook.md`
