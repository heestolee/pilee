---
title: 반복 워크플로 실패는 guard/flow로 고정한다
tags:
  - workflow
  - guard
  - intent
  - audit
  - hotfix
  - continuation
  - validation
  - fan-out
  - mixed-intent
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
reviewed_at: 2026-06-24
reviewed_commit: fae9aa375e31fdb76544f256fcae6f692565c991
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
| search/history fan-out 예산 | soft prompt + result annotation | 첫 조사 명령 전에 ref/path/history/output fan-out을 가볍게 추정하고, symbol/file/URL/PR/commit/branch anchor가 있으면 narrow lookup을 기본값으로 삼음. broad search는 fallback으로 허용하되 이유와 범위를 먼저 드러냄 |
| light push 종료 | hard terminal rule | PR/status 작업을 명시하지 않은 light 작업은 push 성공을 종료 조건으로 보고, 추가 status/log/PR/work_context 도구 호출을 막아 한 줄 완료 보고로 끝냄 |
| 판단 드리프트 억제 | hard prompt discipline + selective block | 코드 가능 여부와 제품 요구 충족을 분리하고, 사용자 지정 환경·dev 절차·SQL 안전장치를 과확장하지 않게 turn guard에 주입 |
| UI choice continuity | hard result annotation | `tui_ask`/TFT Studio 선택 결과에 `nextActionRequired`를 붙여 선택 요약으로 멈추지 않게 함 |
| 큰 commit 분리 | hard commit guard | staged diff가 크거나 여러 area를 섞으면 direct `git commit`을 차단하고 logical commit split을 요구 |
| 상태 노트 오인 방지 | hard status-note path | dependency bootstrap READY, worktree cwd binding, workflow guard 같은 환경/상태 메시지는 사용자 task 지시가 아니므로 old work 재개와 tool call을 차단 |
| 혼합 요청 분해 | hard prompt discipline | 작은 구현 지시와 독립 조사 질문이 한 턴에 섞이면 `mixed=implement+investigate`로 표기하고, main은 구현을 진행하며 조사 축은 subagent 병렬 위임을 기본 리듬으로 삼음 |
| 검증 명령 fan-out 체크 | soft prompt + known-risk hard guard | `pnpm <script> -- <path>` wrapper가 실제로 path를 좁힌다고 가정하지 않도록 예상 fan-out 체크리스트와 direct executable 추천을 주입한다. 알려진 fan-out 위험 패턴은 bash 실행 직전 hard guard로 차단하고, 필요한 broad validation은 명시 bypass와 이유를 요구한다. |

## Audit Rule

워크플로 마찰을 재분석할 때는 old friction log를 곧바로 “미대응”으로 보지 않습니다.

1. friction: 사용자가 불편하다고 느낀 지점
2. response evidence: 이후 commit, pilee-history, 현재 코드에 이미 들어간 대응
3. current state: 지금 runtime/code에서 실제로 남아 있는 상태
4. remaining gap: 아직 guard/flow가 없는 항목

`workflow_guard(action="audit")`는 이 과정을 돕기 위해 최근 `docs/pilee-history.md` 후보를 보여줍니다. 후보는 판정이 아니라 evidence seed입니다.

다만 사용자가 “사례를 뒤져보고”, “로그를 확인해서”, “추상화해서” 같은 조사 동사 뒤에 “개선해”, “반영해”, “작업해봐”, “고쳐” 같은 실행 동사를 붙이면 read-only audit가 아닙니다. 이 경우 evidence collection은 구현 전 단계일 뿐이며 guard는 `implement`로 승격해야 합니다. `audit=required` 신호는 유지해도 되지만, `HARD AUDIT PATH`나 mutation block이 명시 구현 지시를 다시 확인 질문으로 돌리면 안 됩니다.

반대로 `커밋 diff`, `어제 커밋`, `반영 여부`, `반영 상태`처럼 `커밋`/`반영`이 분석 대상이나 상태 명사로 쓰이면 ship/implement 신호가 아닙니다. Guard classifier는 bare keyword 포함이 아니라 실행형 동사 맥락(`커밋해`, `푸시해`, `반영해`, `개선해`)을 mutation으로 보고, 명사+확인/분석/비교/여부 맥락은 read-only investigation으로 유지해야 합니다.

진행 중 구현 결과에 대한 QA 피드백은 별도 correction axis로 봅니다. 사용자가 `와이어프레임에는 여기인데`, `니가 구현한 건 위에 있잖아`, `아래쪽에 있게는 못해?`처럼 방금 구현한 결과와 요구사항의 불일치를 지적하면, 표면 동사가 `확인해봐`/`못해?`여도 read-only investigation이 아니라 follow-up fix입니다. Guard가 이미 read-only로 시작된 뒤 agent가 근거 있게 오분류를 확인한 경우에는 `workflow_guard(action="adopt")`로 새 분류를 현재 세션 state에 반영해 같은 edit/write 차단을 반복하지 않습니다. adopt는 우회권이 아니라 “현재 guard state가 틀렸다는 이유를 남기는 재분류”입니다.

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

## Validation Fan-out Rule

검증은 필요하지만, 검증 명령 자체가 작업 범위를 과하게 넓히면 workflow 실패가 됩니다. pilee는 validation을 “실행해야 할 의무”와 “실제 fan-out을 예측해야 할 의무”로 나눕니다.

1. lint/test/type-check/build/bootstrap을 실행하기 전에는 해당 명령이 실제로 몇 개 파일·패키지·앱을 건드리는지 한 문장으로 예측합니다.
2. `pnpm <script> -- <path>`는 자동으로 targeted validation으로 믿지 않습니다. wrapper script가 고정 glob을 갖거나 인자를 무시할 수 있으므로, package.json을 확인했거나 직접 실행 파일을 호출할 때만 확실한 targeted evidence로 봅니다.
3. 파일 단위가 필요하면 wrapper보다 `pnpm exec eslint <file>`, `pnpm vitest run <file>`, 앱 cwd의 direct executable처럼 fan-out이 명시적인 명령을 우선합니다.
4. Wrapper 불확실성은 처음에는 soft nudge였지만, 실제 실패가 확인된 known-risk pattern은 hard guard 대상입니다.
   - package validation script 뒤 `-- <path>`를 붙인 명령은 차단합니다. 예: `pnpm test -- src/foo.test.ts`, `pnpm -F app test -- src/foo.test.ts`.
   - path/filter 없는 `test`/`lint`/`type-check`/`build` script는 broad validation으로 간주하고 기본 차단합니다.
   - filter 없는 `turbo run <validation>` 또는 wildcard filter는 workspace fan-out 가능성이 크므로 차단합니다.
5. 파일 단위 검증은 package cwd에서 direct executable로 실행합니다. 예: `pnpm exec vitest run src/foo.test.ts`, `pnpm exec jest src/foo.test.ts`, `pnpm exec eslint src/foo.ts`.
6. package/module resolve 실패는 dependency readiness 문제일 수 있지만, 곧바로 wildcard workspace build로 승격하지 않습니다. 첫 실패 후에는 해당 package 수준의 좁은 recovery만 허용하고, 두 번째 package/module resolve 실패부터는 broad bootstrap/build 전에 BLOCKED 보고 또는 사용자 확인이 필요합니다.
7. `turbo build --filter='@scope*'` 같은 wildcard workspace build는 dependency recovery 목적이면 broad action입니다. 명시적으로 필요한 경우에는 이유를 밝히고 `ALLOW_BROAD_VALIDATION=1` 같은 guard bypass marker를 남겨야 합니다.

이 규칙은 validation을 덜 하라는 뜻이 아닙니다. 현재 diff를 닫는 가장 가까운 증거를 먼저 만들고, 더 넓은 검증은 실제 risk가 관찰되거나 사용자가 요청할 때 승격합니다.

## Search / History Fan-out Rule

질질 끌리는 조사는 보통 “도구가 느림”보다 “첫 탐색 범위를 너무 크게 잡음”에서 시작합니다. 그래서 workflow guard는 validation뿐 아니라 검색·히스토리 조회에도 fan-out 예산을 적용합니다.

1. 첫 `git log -S`, `git grep`, `rg`, `find`, `gh search`, `vcc_recall` 전에 ref/path/history/output 범위를 가볍게 추정합니다.
2. 사용자가 symbol, file, URL, PR, commit, branch 같은 anchor를 준 경우에는 해당 anchor로 좁은 lookup을 먼저 실행합니다.
3. repo 전체, 모든 branch, 넓은 directory, raw transcript 전체 검색은 첫 수가 아니라 fallback입니다.
4. broad search가 필요하면 hard block하지 않고, “무엇을 못 찾았고 어디까지 넓히는지”를 한 줄로 드러낸 뒤 실행합니다.
5. 명령이 abort/timeout/no-result이면 같은 broad path를 반복하지 않고 strategy reset을 알립니다. 예: `범위가 넓어 끊겼습니다. 먼저 symbol 위치를 target branch에서 좁혀 다시 찾겠습니다.`

이 규칙은 질문을 늘리라는 뜻이 아닙니다. 사용자가 이미 anchor를 줬다면 되묻기보다 narrow lookup으로 바로 답을 찾아야 합니다. anchor가 없고 다음 search가 범위를 크게 넓힐 때만 scope-gate 질문을 사용합니다.

## Judgment Drift Rules

반복 지연 사례에서 확인된 실패는 다음 runtime discipline으로 고정합니다.

- **조사 범위 잠금**: 조사/원인 확인 요청에서는 먼저 사용자가 발화에 직접 포함한 범위만 봅니다. crash/log 확인을 작업물 상태, diff, commit, worktree 진행률, 복구/구현 상태 추적으로 바꾸지 않습니다.
- **범위 확장 확인**: 다음 확인이 crash/log → worktree 진행률, 증상 확인 → 수정, dev/preview → production, 직접 증거 → unrelated session history처럼 많이 넓어지는 순간에는 멈추고 사용자에게 먼저 묻습니다.
- **못 찾음 handoff**: 현재 범위에서 답을 못 찾으면 어디까지 봤고 무엇을 못 찾았는지 먼저 보고한 뒤, 다음으로 더 찾아볼 수 있는 방향 1–3개를 제시하고 어느 쪽을 볼지 묻습니다.
- **중간 진행 공유**: 빠른 lookup/triage에서 첫 경로가 30초 이상 막히거나 abort/timeout/no-result가 나오면 즉시 무엇을 확인했고 어떤 전략으로 좁히거나 넓히는지 짧게 공유합니다. 장시간 조사는 최소 3분마다 진행 상태와 지연 이유를 공유합니다.
- **tool result 판단 예산**: 운영 triage·light investigation·answer/audit처럼 빠른 판별이 중요한 none/light 경로는 tool result 이후 30초 안에 다음 좁은 tool call, 중간 결론, scope-gate 질문, 최종 보고 중 하나를 선택합니다. standard는 60초, full은 120초를 기본 예산으로 둡니다. 이 예산은 “정확도 포기”가 아니라 조용히 몇 분씩 내부 판단에 머무르지 않기 위한 실행 리듬입니다. 다음 step이 broad/long이거나 직전 명령이 결과 없이 끝났다면 다음 tool call 전에 strategy reset을 사용자에게 보입니다.
- **tool 탐색 절제**: 스킬이나 프롬프트가 사용할 도구를 이미 가리키면 `mcp list`, broad `describe`, digest 원문 전체 조회, raw transcript/context mining을 먼저 열지 않습니다. 직접 호출이 schema 불확실성으로 실패했거나 사용자가 도구/스키마 자체를 묻거나 현재 evidence로 필요한 도구를 식별하지 못할 때만 tool 탐색으로 승격합니다.
- **환경 범위 고정**: 사용자가 dev/preview/특정 증상 확인을 요청했으면 그 범위를 넘지 않습니다. production, 외부 서비스, 실제 write 경로로 확장하려면 먼저 묻습니다.
- **제품 판단 분리**: “코드상 계산 가능”과 “제품 요구를 충족”은 다릅니다. 실제 소비 경로(UI, 알림, 지급, 운영자 확인)가 값을 쓰는지 확인하기 전에는 완료 판단을 하지 않습니다.
- **사용자 제안 절차 존중**: 사용자가 dev down/up, 임시 백업 후 복구처럼 구체적 검증 절차를 제안하면 먼저 그 목적을 수행 가능한 dev 검증으로 해석합니다. prod 배포 정석으로 일반화하려면 확인 질문을 둡니다.
- **SQL ceremony 비례**: DB write/runbook에서 backup, rollback, DELETE SQL은 row 수·가역성·side effect에 비례해야 합니다. 작은 reversible 변경에 큰 안전장치를 자동으로 붙이지 않습니다.
- **worker 절제**: standard 작업에서도 worker/subagent는 기본값이 아닙니다. 병렬 소유권, readiness 진단, explicit user request가 있을 때만 사용하고 이유를 남깁니다.
- **혼합 요청 병렬화**: `width 100으로 줄이자. 상태 칸 뱃지는 뭐가 있어?`처럼 작은 구현 지시와 독립 질문이 한 턴에 섞이면 answer/read-only로 낮추지 않습니다. Guard는 `intent=implement · mixed=implement+investigate · parallel=investigation-subagent`를 주입하고, main agent는 구현을 먼저 진행합니다. 독립 조사 질문은 subagent에 위임하되, 조사 답이 구현 방향을 결정하는 blocker이면 한 문장 scope-gate 질문으로 좁힙니다.

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
