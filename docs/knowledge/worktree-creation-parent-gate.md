---
title: Worktree 생성은 현재 패널 대화가 source다
tags:
  - worktree
  - fork-panel
  - current-panel
  - hotfix
  - context
  - profile-driven
  - 워크트리
category: workflow
status: active
confidence: high
applies_to:
  - extensions/worktree
  - extensions/fork-panel
  - worktree_create
  - worktree_fork
  - /wt new
  - /wt fork
source:
  - pilee-history:2026-05-06#67
  - user-direction:2026-05-17-full-worktree-fork-default
  - user-direction:2026-08-25-workspace-activation-redesign
  - user-direction:2026-09-02-pr-review-current-panel-or-tab
reviewed_at: 2026-10-07
reviewed_commit: 727572a6f13af5580d91027a24e1a8ffb32c5ee8
related:
  - worktree-execution-boundary
  - worktree-session-continuity
  - workspace-action-panel-activation-contract
---

## Judgment

Worktree 생성은 단순한 파일 시스템 작업이 아니라 실행 경계와 세션 계보를 동시에 만드는 결정입니다. runtime profile이 protected repo로 지정한 업무 레포에서도 사용자가 현재 보고 있는 패널의 대화가 기본 source session입니다. 다만 source가 어디인지와 target을 어느 panel에서 활성화할지는 workflow별로 다릅니다. 사용자가 직접 실행한 slash `/wt new`는 기존 생성 방식대로 현재 panel을 target session으로 전환합니다. Slash `/wt fork`는 먼저 현재 panel·새 탭·오른쪽 panel 중 위치를 고르고, 공통 생성이 성공한 최종 이름의 세션을 그 위치에서 활성화합니다. Agent tool·Frame/TFT처럼 source panel 보존 자체가 목적에 포함된 composed workflow는 별도 placement/READY 계약을 유지합니다. PR review는 read-only head-pinned worktree를 만들지만 source panel 보존을 강제하지 않으며, 사용자가 현재 panel 또는 새 탭을 고릅니다.

## Gate Rule

생성 전에 반드시 세 가지를 판정합니다.

1. **Stage** — “확인해볼래?”처럼 조사 요청이면 worktree를 만들지 않습니다. 원인과 수정 후보를 먼저 좁힙니다.
2. **Context carry** — 조사·계획·파일 경로·의사결정이 이미 대화에 있으면 fresh worktree가 아니라 `/wt fork` / `worktree_fork`를 사용합니다. 이 흐름의 기본 계승 단위는 전체 transcript입니다. 최소 handoff pack은 사용자가 `--minimal-context` / `minimalContext: true`처럼 의식적으로 가벼운 전달을 선택했을 때만 사용합니다.
3. **Base branch** — hotfix/production 단서가 있으면 `--hotfix` / `hotfix: true`를 명시해 production 기반에서 시작합니다.

## Current Panel Source Rule

Fork child panel(`P1`, `P2`, …)도 profile gate가 허용하면 protected/profiled worktree의 source가 될 수 있습니다. 이때 source session은 부모가 아니라 현재 패널 대화입니다. 사용자가 P1에서 조사하고 바로 `/wt fork`를 실행했다면 P1은 그대로 남고, “P1의 조사 맥락을 계승한 새 실행공간이 선택한 sibling panel에서 시작된다”가 직관적인 모델입니다.

부모 `P0` 대화를 기준으로 만들고 싶을 때만 사용자가 부모 패널에서 명시적으로 실행합니다. `/handoff`는 부모에게 결과를 알리는 협업 기능이지, worktree 생성을 위한 필수 의식 절차가 아닙니다. 어떤 repo가 protected인지는 public code가 아니라 profile/overlay config가 결정하지만, profile의 gate flag는 현재 패널 source provenance를 표시하는 데 쓰고 hard block으로 쓰지 않습니다.

## Automatic Name Allocation

자동 이름은 기억하기 쉬운 일반 단어 조합을 사용합니다. 기본 조합을 모두 사용하면 숫자 접미사로 확장하며, 예전 `pokemon` 설정도 새 조합 방식으로 해석합니다. 기존 워크트리·브랜치 이름은 바꾸지 않고 명시적인 `city`·`none` 설정은 유지합니다.

사용 가능 여부의 원천은 현재 루트의 폴더 목록 하나가 아닙니다. 파일·끊어진 심볼릭 링크, 다른 위치 또는 삭제된 경로의 Git worktree 등록, 로컬·확인한 원격 브랜치와 ref 상하위 경로 충돌을 함께 확인합니다. 원격 조회 이후 외부에서 생긴 원격 ref까지 영구 예약하는 것은 아니며, 이후 push 성공을 보장하지 않습니다.

사전 검사는 생성 성공의 보장이 아닙니다. 생성 직전에는 빈 대상 경로를 배타적으로 확보하고, 실제 Git 생성이 이름 충돌로 실패하면 자동 후보만 변경해 재시도합니다. 기존 이름을 많이 사용한 것은 재시도 횟수를 소모하지 않습니다. 실제 경합은 최대 20회로 제한하고, 네트워크·권한·체크아웃 오류는 이름 문제처럼 숨기지 않습니다. 브랜치 접두사 자체가 막혔거나 사용자가 이름·브랜치를 직접 지정한 경우에는 임의 변경하지 않고 원인을 보고합니다.

실패 시에는 이번 시도가 확보한 동일한 빈 디렉터리만 해제합니다. 파일이 생겼거나 소유가 불분명한 경로·브랜치는 삭제하지 않습니다. 재시도 결과는 생성 이후 메타데이터·세션·패널·continuation에 한 번만 반영하며, 위치 선택을 반복하거나 패널을 먼저 열지 않습니다. 새 작업 생성 진입점은 이 공통 정책을 사용하고, 기존 작업의 resume와 head-pinned PR review는 새 임의 이름 생성과 별개의 계약으로 유지합니다.

## Failure Mode

잘못 생성된 worktree는 이름과 브랜치가 남아 이후 대시보드와 세션 선택을 오염시킵니다. development 기반 hotfix, context 없는 full fork, source session을 추적할 수 없는 handoff, READY가 오지 않은 target session은 작업 자체보다 복구 비용이 큽니다. 실패를 알면 source panel은 그대로 두고, cancellation claim과 target terminal close가 모두 확인된 경우에만 이번 실행이 만든 session/worktree/branch를 정리합니다. Child가 continuation을 소유했거나 close가 확인되지 않으면 recovery artifact를 보존합니다. full transcript가 과도하게 큰 예외 상황에서는 사용자가 명시적으로 `--minimal-context`를 선택해야 하며, meta/source reference와 persisted context message가 반드시 남아야 합니다.
