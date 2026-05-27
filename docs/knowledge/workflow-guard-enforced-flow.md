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
reviewed_at: 2026-05-26
reviewed_commit: b434c00680fd02e076f7b0a6a68b483fea7ef074
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
| fast response pace | hard prompt + result annotation | tool result 이후 none/light는 30초, standard는 60초, full은 120초 판단 예산 안에 다음 좁은 tool call·중간 결론·scope-gate 질문·최종 보고 중 하나로 전환하게 함 |
| light push 종료 | hard terminal rule | PR/status 작업을 명시하지 않은 light 작업은 push 성공을 종료 조건으로 보고, 추가 status/log/PR/work_context 도구 호출을 막아 한 줄 완료 보고로 끝냄 |
| 판단 드리프트 억제 | hard prompt discipline + selective block | 코드 가능 여부와 제품 요구 충족을 분리하고, 사용자 지정 환경·dev 절차·SQL 안전장치를 과확장하지 않게 turn guard에 주입 |
| UI choice continuity | hard result annotation | `tui_ask`/TFT Studio 선택 결과에 `nextActionRequired`를 붙여 선택 요약으로 멈추지 않게 함 |
| 큰 commit 분리 | hard commit guard | staged diff가 크거나 여러 area를 섞으면 direct `git commit`을 차단하고 logical commit split을 요구 |
| 상태 노트 오인 방지 | hard status-note path | dependency bootstrap READY, worktree cwd binding, workflow guard 같은 환경/상태 메시지는 사용자 task 지시가 아니므로 old work 재개와 tool call을 차단 |

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
4. atomic commit/push

문구·라벨 같은 micro-hotfix에서 commit plan 파일을 만드는 절차가 작업보다 커지면, `auto_commit action=quick`으로 message와 paths를 명시해 commit+safe upstream push를 한 번에 닫는다. 이때 결과가 `committed_not_pushed`이면 guard는 완료 보고 전에 push 해결을 요구한다.

문제의 핵심은 사용자가 폭발한 뒤 말하는 “걍 커밋푸시해”가 아니라, 그 전에 light 작업이 이미 커밋/푸시로 닫혔는데도 agent가 추가 확인을 이어가는 지점이다. 따라서 PR/status 작업을 명시하지 않은 light turn에서는 `git push` 또는 pushed `auto_commit` 성공을 terminal condition으로 본다. 이후 추가 `git status`, `git log`, `gh pr view`, `work_context`, PR/branch 확인을 막고 `완료: <sha> <message>` 같은 짧은 최종 보고만 남긴다. `push 상태 확인해줘`처럼 읽기 의도가 명시된 요청은 이 종료 규칙이 아니라 investigate path로 남긴다.

검증 축이 새로 늘어나면 standard/full로 승격할 수 있지만, 그 이유가 관찰된 risk여야 합니다. “늘 하던 full report”는 이유가 아닙니다.

Light PR/ship에서는 현재 diff, 최근 커밋, 사용자가 방금 확인한 intent를 우선합니다. PR 템플릿을 채우기 위해 `.context/work/**`, raw session jsonl, Frame Studio transcript를 깊게 훑는 것은 새 risk가 있거나 사용자가 맥락 감사를 명시한 경우에만 허용합니다.

## Judgment Drift Rules

반복 지연 사례에서 확인된 실패는 다음 runtime discipline으로 고정합니다.

- **조사 범위 잠금**: 조사/원인 확인 요청에서는 먼저 사용자가 발화에 직접 포함한 범위만 봅니다. crash/log 확인을 작업물 상태, diff, commit, worktree 진행률, 복구/구현 상태 추적으로 바꾸지 않습니다.
- **범위 확장 확인**: 다음 확인이 crash/log → worktree 진행률, 증상 확인 → 수정, dev/preview → production, 직접 증거 → unrelated session history처럼 많이 넓어지는 순간에는 멈추고 사용자에게 먼저 묻습니다.
- **못 찾음 handoff**: 현재 범위에서 답을 못 찾으면 어디까지 봤고 무엇을 못 찾았는지 먼저 보고한 뒤, 다음으로 더 찾아볼 수 있는 방향 1–3개를 제시하고 어느 쪽을 볼지 묻습니다.
- **중간 진행 공유**: 조사/확인이 3분 이상 걸리거나 여러 파일·도구를 연쇄로 읽어야 하면, 결과를 기다리지 말고 지금 무엇을 확인 중인지와 왜 시간이 걸리는지 짧게 공유합니다.
- **tool result 판단 예산**: 운영 triage·light investigation·answer/audit처럼 빠른 판별이 중요한 none/light 경로는 tool result 이후 30초 안에 다음 좁은 tool call, 중간 결론, scope-gate 질문, 최종 보고 중 하나를 선택합니다. standard는 60초, full은 120초를 기본 예산으로 둡니다. 이 예산은 “정확도 포기”가 아니라 조용히 몇 분씩 내부 판단에 머무르지 않기 위한 실행 리듬입니다.
- **tool 탐색 절제**: 스킬이나 프롬프트가 사용할 도구를 이미 가리키면 `mcp list`, broad `describe`, digest 원문 전체 조회, raw transcript/context mining을 먼저 열지 않습니다. 직접 호출이 schema 불확실성으로 실패했거나 사용자가 도구/스키마 자체를 묻거나 현재 evidence로 필요한 도구를 식별하지 못할 때만 tool 탐색으로 승격합니다.
- **환경 범위 고정**: 사용자가 dev/preview/특정 증상 확인을 요청했으면 그 범위를 넘지 않습니다. production, 외부 서비스, 실제 write 경로로 확장하려면 먼저 묻습니다.
- **제품 판단 분리**: “코드상 계산 가능”과 “제품 요구를 충족”은 다릅니다. 실제 소비 경로(UI, 알림, 지급, 운영자 확인)가 값을 쓰는지 확인하기 전에는 완료 판단을 하지 않습니다.
- **사용자 제안 절차 존중**: 사용자가 dev down/up, 임시 백업 후 복구처럼 구체적 검증 절차를 제안하면 먼저 그 목적을 수행 가능한 dev 검증으로 해석합니다. prod 배포 정석으로 일반화하려면 확인 질문을 둡니다.
- **SQL ceremony 비례**: DB write/runbook에서 backup, rollback, DELETE SQL은 row 수·가역성·side effect에 비례해야 합니다. 작은 reversible 변경에 큰 안전장치를 자동으로 붙이지 않습니다.
- **worker 절제**: standard 작업에서도 worker/subagent는 기본값이 아닙니다. 병렬 소유권, readiness 진단, explicit user request가 있을 때만 사용하고 이유를 남깁니다.

## Status Note Rule

`[dependency-bootstrap] READY`, `## Worktree cwd binding`, `Workflow guard for this turn`, `WORKTREE DEPENDENCY BOOTSTRAP` 같은 메시지는 실행 상태 또는 context binding을 설명하는 노트입니다. 이 노트는 최신 사용자 의도를 대체하지 않습니다.

압축 직후나 follow-up 메시지 이후에도 agent는 상태 노트만 보고 이전 구현·검증·PR 작업을 재개하면 안 됩니다. 최신 prompt가 status note로 분류되면 guard는 tool call을 차단하고, 필요하면 짧게 상태만 확인합니다. 실제 작업 재개는 사용자가 새 요청을 명시했을 때만 합니다.

## Continuation Rule

사용자가 TUI/TFT Studio에서 옵션을 선택한 뒤에는 선택 결과 자체가 다음 행동을 요구합니다. agent는 “선택 완료”만 보고 멈추지 않고 선택된 branch를 실행하거나, 실행이 위험하면 바로 짧은 확인 질문으로 전환해야 합니다.

## Boundary

- Guard는 사용자 의도를 대체하지 않습니다. 분류가 틀렸다고 판단되면 mutation 전에 짧게 확인합니다.
- Baseline cache는 validation noise를 분리할 뿐 required check를 pass로 만들지 않습니다.
- Full workflow는 금지된 것이 아니라 opt-in/승격 대상입니다.
- Audit snapshot은 private/local history를 현재 세션에서만 참고하는 실행 맥락입니다. public knowledge에는 raw session text를 복사하지 않습니다.
