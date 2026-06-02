---
title: To-production은 source-preserving hotfix 이식이다
tags:
  - to-production
  - hotfix
  - production
  - git
  - worktree
  - source-preserving
  - patch
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
  - hotfix branch migration
source:
  - user-direction:2026-05-18-to-production-mvp
reviewed_at: 2026-06-02
reviewed_commit: d8f8c4c56f23dcfda08b089b6d8ff5be4885e37c
related:
  - worktree-execution-boundary
  - worktree-creation-parent-gate
type: doctrine
---

## Judgment

`/to-production`은 “현재 작업을 production base로 다시 옮긴다”가 아니라 **source worktree를 건드리지 않은 채 production 기반 target을 새로 만드는 작업**입니다. hotfix 전환 작업은 대개 이미 development 기반 worktree에 쌓인 diff/commit을 다루므로, source에서 checkout/stash/reset/clean을 실행하는 순간 사용자가 보존하려던 작업 상태가 사라질 수 있습니다.

## Source-preserving Rule

자동화는 source repo에서 읽기와 보존용 ref/artifact 생성을 기본으로 합니다.

- 허용: `git status`, `git diff`, `git format-patch`, `git rev-list`, `git branch <backup> HEAD`, artifact write
- 명시 선택 시 허용: untracked 파일만 source에 `git add`/`git commit`해 보존 commit을 만든 뒤 그 commit까지 이식
- 금지: source `git checkout`, `git switch`, `git stash`, `git reset`, `git clean`, source worktree 삭제

실제 변경 적용은 새 target worktree에서만 수행합니다. 단, 사용자가 untracked commit option을 선택한 경우 source에는 새 보존 commit이 생깁니다. target이 conflict 상태가 되어도 source checkout/reset/clean 없이 남아야 하므로, 실패 복구는 target과 artifact 기준으로 안내합니다.

## Commit Range Rule

production hotfix로 옮길 때 `origin/production..HEAD`를 이식 range로 쓰면 안 됩니다. development 기반 branch에서는 production에 없는 unrelated development commit이 대량으로 섞일 수 있습니다. 기본 range는 현재 branch의 upstream과 `HEAD`의 merge-base부터 `HEAD`까지로 잡고, upstream이 없거나 판단이 애매하면 사용자가 `--range`로 명시해야 합니다.

Merge commit은 MVP 자동화에서 중단합니다. `git format-patch`/`git am` 흐름은 선형 commit 이식에 맞춰져 있으므로, merge commit을 조용히 flatten하거나 cherry-pick하는 것은 hotfix diff를 오염시킬 수 있습니다.

## Artifact Rule

이식 전에는 항상 local artifact와 backup branch를 남깁니다.

- `~/.pi/agent/to-production/<repo>-<hash>/<timestamp>/metadata.json`
- `commits.patch` — local commit range가 있는 경우
- `dirty.patch` — tracked/staged/unstaged diff가 있는 경우
- `untracked/` — `--include-untracked`가 명시된 경우에도 먼저 복사 보존
- `to-production/source-backup/<source>-<timestamp>` — source HEAD backup branch

Artifact는 “성공 로그”가 아니라 복구 계약입니다. target 적용이 실패해도 사용자는 artifact와 source backup branch를 기준으로 수동 적용을 이어갈 수 있어야 합니다.

## Untracked Decision Rule

Untracked 파일은 조용히 무시하거나 자동 포함하지 않습니다. untracked에는 임시 파일, secret, local report, 빌드 산출물이 섞일 수 있기 때문입니다. 하지만 UI가 있는 `/to-production`에서는 hard stop보다 decision gate가 맞습니다.

- `include`: artifact에 복사한 뒤 target에 복사/commit합니다.
- `skip`: source에는 그대로 두고 이번 production 이식에서는 제외합니다. metadata/report에 skipped list를 남깁니다.
- `commit`: untracked 파일만 source에 명시 commit으로 보존한 뒤, 새 source HEAD까지 commit range를 다시 읽어 target에 이식합니다.
- `block`: 사용자가 직접 정리하도록 중단합니다.

Headless/no-UI에서는 선택할 수 없으므로 `--include-untracked`, `--skip-untracked`, `--commit-untracked` 중 하나를 명시해야 합니다. `--commit-untracked`는 source에 새 commit을 만들기 때문에 사용자의 명시 선택이 필요하고, explicit `--range`를 함께 쓸 때는 새 commit이 포함되도록 `...HEAD` 형태여야 합니다.

## Dedicated Execution Boundary

Pi slash command는 입력 첫 토큰이 `/to-production`일 때만 command handler로 들어갑니다. 사용자가 자연어로 “`/to-production`으로 해줘”, “production으로 옮겨줘”, “hotfeature로 다시 쌓아줘”라고 말하면 skill trigger는 걸릴 수 있지만 slash command가 실행된 것은 아닙니다. 이 경우 agent는 같은 내부 실행 경로를 공유하는 `to_production` tool을 사용해야 합니다.

전용 command/tool이 없는 런타임에서는 generic `worktree_fork`, `worktree_create`, 수동 `git worktree add`, source `checkout/stash/reset/clean`으로 흉내 내지 않습니다. 사용자가 기대한 source-preserving artifact/backup/target 적용 계약이 깨질 수 있으므로 standalone `/to-production ...` 입력을 요청해야 합니다.

## Relation to Worktree Gate

`/wt fork`는 새 작업공간을 만드는 planning/context continuity 도구이고, `/to-production`은 이미 존재하는 source 작업을 production base target으로 이식하는 recovery/migration 도구입니다. 둘 다 worktree를 만들 수 있지만 판단 기준은 다릅니다.

- `/wt fork`: 앞으로 작업할 실행 경계를 만든다.
- `/to-production`/`to_production`: 이미 생긴 작업 상태를 source-preserving 방식으로 production base에 재현한다.

따라서 `/to-production`은 원본 worktree를 정리하지 않고, target 생성·이식까지만 책임집니다. push, PR, 원본 삭제는 별도 검증과 사용자 확인 이후 단계입니다.
