---
title: Update branch는 remote-first sync command다
tags:
  - update-branch
  - slash-command
  - git
  - pull
  - index-lock
  - workflow
category: workflow
status: active
confidence: high
applies_to:
  - extensions/update-branch
  - slash-command:/update-branch
source:
  - user-direction:2026-05-27-update-branch-command
reviewed_at: 2026-06-25
reviewed_commit: 98d7502b5b6a46e2b3cfacddd9695a99bbf8e047
related:
  - worktree-execution-boundary
  - change-integration-discipline
  - workflow-weight-proportionality
---

## Judgment

반복적으로 “PR의 Update branch를 누르고 local worktree를 맞추는” 흐름은 agent에게 매번 해석시키는 작업이 아니라, 현재 repo 실행 경계에서 안전하게 remote branch와 local worktree를 맞추는 deterministic slash command가 맞습니다.

이 command는 구현·검증 작업으로 확대하지 않습니다. 목적은 현재 PR 브랜치를 최신 base 반영 상태로 만들고, 현재 Pi worktree도 같은 head로 따라가게 하는 것입니다.

## Remote-first Rule

`/update-branch`의 기본 동작은 remote-first입니다.

1. 현재 위치가 git repo인지 확인합니다.
2. `gh pr view`로 현재 브랜치의 PR number, head branch, head SHA, base branch를 확인합니다.
3. local `HEAD`가 PR `headRefOid`와 다르면 중단합니다. 원격 update를 먼저 걸면 사용자가 가진 local commit/remote divergence를 덮어 해석할 수 있기 때문입니다.
4. `gh pr update-branch <PR>`로 GitHub의 Update branch를 원격에서 트리거합니다.
5. PR head SHA가 바뀌는지 짧게 polling합니다. 이미 최신이면 head가 그대로여도 정상입니다.
6. 기존 safe pull 경로로 local worktree를 `git pull --ff-only` 동기화합니다.

기존처럼 local pull만 하고 싶을 때는 `/update-branch --local`을 사용합니다. remote trigger 없이 local sync만 필요하면 `/update-branch --sync-only`를 사용합니다. remote trigger만 걸고 기다리지 않으려면 `/update-branch --no-wait`를 사용합니다. merge pull이 필요하면 명시적으로 `/update-branch --merge`를 선택합니다. `--rebase`는 제공하지 않습니다.

## Dirty Worktree Preservation Rule

local sync가 필요한 경로에서 worktree가 dirty이면 기본적으로 중단하지 않고, 사용자의 미커밋 변경을 `git stash push --include-untracked`로 보존한 뒤 pull을 시도합니다. pull 후에는 `git stash apply --index`로 변경을 복원하고, 복원이 성공한 경우에만 stash를 drop합니다. 복원 충돌이나 실패가 있으면 stash를 삭제하지 않고 어떤 stash를 수동 확인해야 하는지 출력합니다.

기존처럼 dirty worktree에서 바로 중단하고 싶을 때만 `/update-branch --no-autostash`를 사용합니다. 이 옵션은 “보존 가능한 변경도 막기”가 아니라, 자동 stash를 원하지 않는 사용자의 escape hatch입니다.

## Lock Recovery Rule

`index.lock` 때문에 `git status`, `git stash`, `git pull`, `git stash apply`가 실패하면, command는 `lsof`로 점유 프로세스를 먼저 확인합니다.

- dirty 보존 stash / pull / stash apply 구간에서는 worktree-scoped repo-status pause marker를 남겨 새 polling이 들어오지 않게 합니다.
- 점유 프로세스가 repo-status용 `git status --porcelain=v2 --branch --untracked-files=normal`이면 짧게 기다립니다. 계속 lock을 잡고 있으면 해당 status process만 중단한 뒤 같은 git command를 한 번 재시도합니다.
- 점유 프로세스가 `git add`, `git commit`, `git reset`, `git merge`처럼 실제 mutation이면 자동 제거하거나 kill하지 않고 중단합니다.
- 점유 프로세스가 없고 lock 파일만 남았으면 고아 lock으로 보고 제거한 뒤 같은 git command를 한 번만 재시도합니다.

이 흐름은 반복되는 수동 `lsof → rm index.lock → git pull`을 자동화하되, 실제로 git 작업 중인 프로세스를 방해하지 않는 경계입니다.

## Output Rule

성공 보고는 짧게 유지합니다.

- 현재 repo root
- 사용한 mode (`GitHub Update branch → git pull --ff-only`, `sync-only`, `git pull --ff-only`, `git pull`)
- PR number / branch / base branch
- remote head before / after
- remote update output
- lock recovery 여부
- dirty 변경 보존/복원 여부와 stash ref
- 현재 HEAD
- `git status --short --branch`
- 새 check rollup URL 일부

실패/중단 시에는 local/remote head mismatch, GitHub update 실패 메시지, dirty status, 점유 프로세스, pull 실패 메시지, 보존 stash 상태를 보여줍니다. 충돌 해결을 자동으로 계속 진행하지는 않지만, 원격 update와 local sync 중 어느 단계가 막혔는지 명확히 출력합니다.
