---
title: Worktree는 실행 경계다
tags:
  - worktree
  - workspace
  - repo
  - branch
  - execution-boundary
  - 워크트리
category: workflow
status: active
applies_to:
  - extensions/worktree
  - worktree_create
  - worktree_switch
  - worktree_fork
source:
  - pilee-history:2026-05-01#8
  - pilee-history:2026-05-03#25
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: f97db772c09fd46cee4db42c40de13d82220fec1
related:
  - worktree-session-continuity
  - session-identity-over-filenames
---

## Judgment

Worktree는 단순한 디렉터리 편의 기능이 아니라 작업 실행 경계입니다. 레포, 브랜치, 세션, 로컬 서버, 검증 산출물이 섞이지 않게 분리하는 단위이기 때문에 AI가 임의로 현재 cwd에서 회사 레포 파일을 수정하면 안 됩니다.

## Boundary Rule

홈 세션은 범용 조사와 계획에 쓰고, 제품/람다 같은 업무 레포 코드를 수정할 때는 명시적인 worktree 세션으로 전환합니다. worktree 생성은 최신 base, hotfix 여부, repo registry, setup 명령까지 함께 다뤄야 하며, 수동 `git worktree add`보다 pilee의 worktree workflow를 우선합니다.

## Artifact Boundary

worktree 안에서 만든 검증 리포트, frame, local context는 해당 worktree의 실행 결과입니다. `/show-report`가 여러 workspace artifact를 다시 열 수 있더라도, 수정·검증·커밋의 기준 브랜치는 현재 worktree 경계를 따라야 합니다. 다른 workspace의 artifact는 참고 자료이지 현재 diff의 증거로 자동 승격되지 않습니다.

## Failure Mode

실행 경계 없이 cwd만 바꿔 작업하면 세션 맥락, 브랜치, 검증 산출물이 서로 섞입니다. 특히 병렬 패널과 subagent가 늘어날수록 worktree boundary가 안전장치가 됩니다.
