---
title: 반복 워크플로 실패는 guard/flow로 고정한다
tags:
  - workflow
  - guard
  - intent
  - audit
  - hotfix
  - continuation
category: workflow
status: active
confidence: high
applies_to:
  - extensions/workflow-guard
  - extensions/preflight
  - extensions/tui-ask
  - extensions/frame-studio
source:
  - user-direction:2026-05-12-conductor-like-guards
reviewed_at: 2026-05-24
reviewed_commit: 062f9f271759452705f233b16503967c1287d4c7
related:
  - workflow-weight-proportionality
  - validation-baseline-failure-cache
  - ask-user-question-decision-gates
  - tui-ask-decision-overlay
  - frame-studio-interactive-decision-ui
  - change-integration-discipline
title_en: Repeated workflow failures become enforced guard flows
---

## Overview

반복해서 같은 종류의 UX 실패가 발생하면 “다음부터 조심”이라는 문장만으로는 부족합니다. pilee에서는 요청 의도, 작업 무게, 이미 고친 항목과 남은 gap 구분, 선택 후 다음 행동을 turn-level guard/flow로 고정합니다.

이 guard는 모든 규칙을 hard gate로 만들지 않습니다. 모호한 요청은 soft classification으로 시작하고, 비용이 큰 반복 실패만 도구 호출 차단·audit snapshot·결과 주석처럼 실제 실행 경로에 붙입니다.

## Guard Classes

| 축 | 성격 | 강제 방식 |
|---|---|---|
| 요청 의도 분류 | soft default + mutation guard | `before_agent_start`에서 turn intent/weight를 주입하고, answer/investigate turn의 edit/write/commit/push/worktree 생성을 막음 |
| fixed-vs-unfixed audit | hard audit path | “이미 대응/미대응/남은 gap” 요청에는 local history snapshot을 자동 주입하고 `friction → response evidence → current state → remaining gap` 형식을 요구 |
| 작은 hotfix 기본 경로 | hard lightweight default | light turn에서 `verify_report_live start`, subagent fan-out, deep session/context mining을 막고 scope lock → focused change → nearest validation부터 시작 |
| 판단 드리프트 억제 | hard prompt discipline + selective block | 코드 가능 여부와 제품 요구 충족을 분리하고, 사용자 지정 환경·dev 절차·SQL 안전장치를 과확장하지 않게 turn guard에 주입 |
| UI choice continuity | hard result annotation | `tui_ask`/TFT Studio 선택 결과에 `nextActionRequired`를 붙여 선택 요약으로 멈추지 않게 함 |
| 큰 commit 분리 | hard commit guard | staged diff가 크거나 여러 area를 섞으면 direct `git commit`을 차단하고 logical commit split을 요구 |

## Audit Rule

워크플로 마찰을 재분석할 때는 old friction log를 곧바로 “미대응”으로 보지 않습니다.

1. friction: 사용자가 불편하다고 느낀 지점
2. response evidence: 이후 commit, pilee-history, 현재 코드에 이미 들어간 대응
3. current state: 지금 runtime/code에서 실제로 남아 있는 상태
4. remaining gap: 아직 guard/flow가 없는 항목

`workflow_guard(action="audit")`는 이 과정을 돕기 위해 최근 `docs/pilee-history.md` 후보를 보여줍니다. 후보는 판정이 아니라 evidence seed입니다.

## Lightweight Rule

작은 hotfix나 문구 수정은 안전을 버리지 않고 절차를 줄입니다. 기본 경로는 다음 네 단계입니다.

1. scope lock
2. focused change
3. nearest validation
4. atomic commit

검증 축이 새로 늘어나면 standard/full로 승격할 수 있지만, 그 이유가 관찰된 risk여야 합니다. “늘 하던 full report”는 이유가 아닙니다.

Light PR/ship에서는 현재 diff, 최근 커밋, 사용자가 방금 확인한 intent를 우선합니다. PR 템플릿을 채우기 위해 `.context/work/**`, raw session jsonl, Frame Studio transcript를 깊게 훑는 것은 새 risk가 있거나 사용자가 맥락 감사를 명시한 경우에만 허용합니다.

## Judgment Drift Rules

반복 지연 사례에서 확인된 실패는 다음 runtime discipline으로 고정합니다.

- **중간 진행 공유**: 조사/확인이 2–3분 이상 걸리거나 여러 파일·도구를 연쇄로 읽어야 하면, 결과를 기다리지 말고 현재까지 본 것과 다음 확인 축을 짧게 공유합니다.
- **환경 범위 고정**: 사용자가 dev/preview/특정 증상 확인을 요청했으면 그 범위를 넘지 않습니다. production, 외부 서비스, 실제 write 경로로 확장하려면 먼저 묻습니다.
- **제품 판단 분리**: “코드상 계산 가능”과 “제품 요구를 충족”은 다릅니다. 실제 소비 경로(UI, 알림, 지급, 운영자 확인)가 값을 쓰는지 확인하기 전에는 완료 판단을 하지 않습니다.
- **사용자 제안 절차 존중**: 사용자가 dev down/up, 임시 백업 후 복구처럼 구체적 검증 절차를 제안하면 먼저 그 목적을 수행 가능한 dev 검증으로 해석합니다. prod 배포 정석으로 일반화하려면 확인 질문을 둡니다.
- **SQL ceremony 비례**: DB write/runbook에서 backup, rollback, DELETE SQL은 row 수·가역성·side effect에 비례해야 합니다. 작은 reversible 변경에 큰 안전장치를 자동으로 붙이지 않습니다.
- **worker 절제**: standard 작업에서도 worker/subagent는 기본값이 아닙니다. 병렬 소유권, readiness 진단, explicit user request가 있을 때만 사용하고 이유를 남깁니다.

## Continuation Rule

사용자가 TUI/TFT Studio에서 옵션을 선택한 뒤에는 선택 결과 자체가 다음 행동을 요구합니다. agent는 “선택 완료”만 보고 멈추지 않고 선택된 branch를 실행하거나, 실행이 위험하면 바로 짧은 확인 질문으로 전환해야 합니다.

## Boundary

- Guard는 사용자 의도를 대체하지 않습니다. 분류가 틀렸다고 판단되면 mutation 전에 짧게 확인합니다.
- Baseline cache는 validation noise를 분리할 뿐 required check를 pass로 만들지 않습니다.
- Full workflow는 금지된 것이 아니라 opt-in/승격 대상입니다.
- Audit snapshot은 private/local history를 현재 세션에서만 참고하는 실행 맥락입니다. public knowledge에는 raw session text를 복사하지 않습니다.
