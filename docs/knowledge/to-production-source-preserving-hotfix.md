---
title: To-production은 현재 worktree의 production 기반 branch 전환이다
tags:
  - to-production
  - hotfix
  - production
  - git
  - in-place
  - branch-switch
  - cherry-pick
  - 안전
category: workflow
status: active
confidence: high
applies_to:
  - extensions/to-production
  - skills/to-production
  - /to-production
  - to_production tool
  - hotfix branch setup
source:
  - user-direction:2026-05-18-to-production-mvp
  - user-direction:2026-07-02-to-production-in-place
reviewed_at: 2026-07-02
reviewed_commit: 5e6348ad32a505cfa6186e1a2b34f2d84df21ce1
related:
  - worktree-execution-boundary
  - worktree-creation-parent-gate
type: doctrine
---

## Judgment

사용자 관점에서 `/to-production`은 **“지금 작업하는 worktree를 production을 바라보는 새 branch로 바꾸기”**입니다. 새 sibling worktree를 만들어 patch를 이식하는 도구가 아닙니다.

따라서 기본 UX는 현재 worktree에서 `origin/production` 기반 target branch로 `git switch`하고, 이미 쌓인 작업 commit이 있으면 backup 후 `cherry-pick`하는 것입니다. 별도 worktree가 필요한 병렬 작업/비교/격리 케이스는 `/wt fork --hotfix`가 담당합니다.

## In-place Branch Switch Rule

자동화는 현재 worktree 경로를 그대로 사용합니다.

- 허용: `git status`, `git diff`, `git rev-list`, `git branch <backup> HEAD`, artifact write, `git fetch`, `git switch -c <target> --track origin/production`, `git cherry-pick <commit>`
- 명시 선택 시 허용: untracked 파일만 source에 `git add`/`git commit`해 보존 commit을 만든 뒤 그 commit까지 cherry-pick
- 금지: `git worktree add`, 자동 `git stash`, 자동 `git reset`, 자동 `git clean`, tracked dirty diff 자동 commit

Clean worktree에서 이식할 commit/diff/untracked가 없는 것은 실패가 아닙니다. “작업 전 production 바라보게 세팅”은 `/to-production`의 정상 경로이며, production 기반 빈 target branch를 현재 worktree에 checkout하면 됩니다.

## Workspace Work Detection Rule

production hotfix로 옮길 때 `origin/production..HEAD`를 작업 range로 쓰면 안 됩니다. development 기반 branch에서는 production에 없는 unrelated development commit이 대량으로 섞일 수 있습니다. 하지만 기본 UX가 `@{upstream}..HEAD`에만 묶여서도 안 됩니다. 사용자가 이미 feature branch를 push했더라도 현재 workspace가 source base 대비 가진 작업 commit은 여전히 `/to-production`의 cherry-pick 후보입니다.

기본 탐지는 다음 순서로 “현재 workspace 작업”을 찾습니다.

1. 사용자가 `--range`를 명시했으면 그 range를 사용합니다.
2. upstream 대비 아직 push되지 않은 commit이 있으면 그 commit을 사용합니다.
3. upstream과 `HEAD`가 같아도 `origin/development`/`origin/develop`/`origin/main`/`origin/master`/`origin/HEAD` 같은 source base 대비 branch 고유 commit이 있으면 그 commit을 사용합니다.
4. 그래도 후보가 없으면 clean setup으로 보고 production 기반 target branch만 만듭니다.
5. merge commit/충돌처럼 진짜로 애매하면 설명하고 중단합니다.

`--range`는 escape hatch일 뿐 기본 사용법이 아닙니다. dedicated command/tool 대신 사용자에게 commit range를 다시 계산해 입력하라고 떠넘기는 것은 Red Flag입니다.

Merge commit은 자동 cherry-pick하지 않습니다. merge commit을 조용히 flatten하거나 임의 parent 기준으로 cherry-pick하면 hotfix diff를 오염시킬 수 있습니다.

## Artifact Rule

전환 전에는 항상 local artifact와 backup branch를 남깁니다.

- `~/.pi/agent/to-production/<repo>-<hash>/<timestamp>/metadata.json`
- `cherry-pick-commits.txt` — workspace 작업 commit range가 있는 경우
- `skipped-untracked-files.txt` — untracked를 현재 worktree에 그대로 두기로 한 경우
- `to-production/source-backup/<source>-<timestamp>` — 전환 전 HEAD backup branch

Artifact는 “성공 로그”가 아니라 복구 계약입니다. `git switch` 또는 `git cherry-pick`이 실패해 현재 worktree가 target branch/conflict 상태가 되어도, 사용자는 artifact와 backup branch를 기준으로 복구할 수 있어야 합니다.

## Dirty / Untracked Rule

Tracked/staged dirty diff는 자동 처리하지 않습니다. `/to-production`은 commit 단위 cherry-pick 도구이므로, 미커밋 변경은 먼저 commit하거나 별도 작업공간이 필요한 경우 `/wt fork --hotfix`로 분리합니다.

Untracked 파일은 조용히 무시하거나 자동 포함하지 않습니다. untracked에는 임시 파일, secret, local report, 빌드 산출물이 섞일 수 있기 때문입니다. UI가 있는 `/to-production`에서는 hard stop보다 decision gate가 맞습니다.

- `skip`: untracked를 현재 worktree에 그대로 둔 채 branch 전환을 시도합니다. Git이 overwrite 위험을 감지하면 switch가 실패합니다.
- `commit`: untracked 파일만 source에 명시 commit으로 보존한 뒤, 새 source HEAD까지 commit range를 다시 읽어 target branch에 cherry-pick합니다.
- `block`: 사용자가 직접 정리하도록 중단합니다.

Headless/no-UI에서는 선택할 수 없으므로 `--skip-untracked` 또는 `--commit-untracked` 중 하나를 명시해야 합니다. `--include-untracked`는 더 이상 의미가 없습니다. 새 target worktree에 복사하는 구조가 아니기 때문입니다.

## Dedicated Execution Boundary

Pi slash command는 입력 첫 토큰이 `/to-production`일 때만 command handler로 들어갑니다. 사용자가 자연어로 “`/to-production`으로 해줘”, “production으로 옮겨줘”, “production 바라보게 해줘”, “hotfeature로 다시 쌓아줘”라고 말하면 skill trigger는 걸릴 수 있지만 slash command가 실행된 것은 아닙니다. 이 경우 agent는 같은 내부 실행 경로를 공유하는 `to_production` tool을 사용해야 합니다.

전용 command/tool이 없는 런타임에서는 generic `worktree_fork`, `worktree_create`, 수동 `git worktree add`, checkout/reset/stash/clean 조합으로 흉내 내지 않습니다. standalone `/to-production ...` 입력을 요청합니다.

## Relation to Worktree Gate

`/wt fork`와 `/to-production`의 책임은 분리됩니다.

- `/wt fork --hotfix`: 새 production 기반 worktree/session을 만들어 병렬 실행 경계를 만든다.
- `/to-production`/`to_production`: 현재 worktree 자체를 production 기반 target branch로 전환하고 기존 작업 commit을 cherry-pick한다.

따라서 `/to-production`은 원본 worktree를 별도 target으로 복제하지 않습니다. push, PR, 원본 branch 삭제는 별도 검증과 사용자 확인 이후 단계입니다.
