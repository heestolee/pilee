---
title: Frame은 마지막에 Plan을 합성한다
tags:
  - frame
  - implementation-plan
  - tft-studio
  - worktree
  - continuity
  - planning
category: workflow
status: active
confidence: high
applies_to:
  - skills/frame
  - extensions/frame-studio
  - extensions/worktree
  - .pi/frame.json
source:
  - user-direction:2026-05-11-frame-plan-synthesis
reviewed_at: 2026-05-12
reviewed_commit: 4d1ff268e27626a227ef1f2e25f2871278918e25
related:
  - frame-verify-contract
  - frame-planning-identity
  - frame-studio-interactive-decision-ui
  - worktree-session-continuity
---

## Judgment

Plan은 Frame과 별개의 세계가 아니라 Frame이 수렴한 마지막 산출물입니다. 사용자는 홈 디렉토리에서 아이데이션하고 `/frame`으로 목표·범위·성공 기준을 정리한 뒤, 필요하면 `/decide`로 남은 결정을 닫고, 그 결과로 바로 실행 가능한 계획이 나오기를 기대합니다.

따라서 `/frame` 초반에는 구현 계획을 만들지 않지만, frame contract와 필요한 decisions가 정리된 뒤에는 같은 Frame 안에서 `implementation_plan`을 합성해야 합니다. 별도 Plan 탭/모드로 사용자를 밀어내면 “Frame 끝 → Plan 따로 → fork 따로”처럼 작업 단위가 끊겨 보입니다.

## Contract Rule

`frame.json`에는 성공 기준과 검증 계획만이 아니라, 그 계약에서 파생된 `implementation_plan`도 저장할 수 있습니다. 이 plan은 canonical contract를 대체하지 않습니다.

- `status="blocked_by_decision"`: 남은 decision queue 때문에 실행 계획을 ready로 볼 수 없음
- `status="draft"`: 방향은 있지만 검수/추가 탐색이 남음
- `status="ready"`: frame + decisions에서 실행 slice와 첫 안전 단계가 도출됨

`implementation_plan.derivedFrom`에는 frame hash와 decision id 목록을 남겨, plan이 즉흥 할 일 목록이 아니라 계약에서 파생됐음을 보여야 합니다.

## UI Rule

TFT Studio에서 Plan은 별도 탭보다 Frame 탭의 마지막 섹션인 `Implementation plan synthesis`로 보이는 편이 자연스럽습니다. Frame 탭은 “목표·범위·성공 기준”만이 아니라 “계약·계획 합성” surface입니다.

Fork/readiness 이벤트도 같은 work unit 안에서 보입니다. 예를 들어 dependency bootstrapper가 READY를 보고하면 긴 채팅 알림으로 흐름을 끊기보다, Frame의 plan synthesis/readiness 섹션에 `dependencies=ready`처럼 붙어야 합니다.

## Worktree Continuity Rule

홈/planning frame에서 worktree를 만들면, planning frame은 새 worktree의 `.pi/frame.json`으로 자동 승격되어야 합니다. 사용자가 “승격/복사”를 의식하면 이미 흐름이 끊긴 것입니다.

승격 시에는:

1. planning identity를 worktree identity로 바꿉니다.
2. `identity.promotedToWorktree`와 provenance note에 source planning frame을 남깁니다.
3. canonical hash를 다시 계산합니다.
4. `.pi/frame.md` mirror와 `.pi/worktree-meta.json.frame`을 갱신합니다.

이렇게 해야 사용자는 “새 작업을 시작했다”가 아니라 “같은 작업이 worktree라는 실행 공간을 얻었다”고 느낍니다.
