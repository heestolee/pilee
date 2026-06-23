---
title: Repo status polling은 index.lock을 만들지 않도록 조율한다
tags:
  - repo-status
  - git
  - index-lock
  - polling
  - auto-commit
  - workflow
category: workflow
status: active
confidence: high
applies_to:
  - extensions/utils/repo-status
  - extensions/utils/repo-status-coordination
  - extensions/auto-commit
source:
  - user-direction:2026-06-23-index-lock-polling
reviewed_at: 2026-06-23
reviewed_commit: 458a2c4119d037c16fb420b8d1bde1ab187c08ab
related:
  - update-branch-safe-pull-command
  - auto-commit-explicit-plan-gate
  - workflow-weight-proportionality
---

## Judgment

Footer나 상태 표시를 위해 반복 실행되는 `git status`는 사용자 작업을 방해하면 안 됩니다. 특히 여러 Pi 패널이 같은 대형 worktree를 열고 있으면, 각 프로세스가 짧은 주기로 `git status --porcelain=v2 --branch --untracked-files=normal`을 실행하며 `index.lock` 경합을 만들 수 있습니다.

따라서 repo status polling은 “실시간 표시”보다 “git mutation을 방해하지 않는 것”을 우선합니다.

## Polling Rule

상태 표시용 `git status`는 optional index refresh lock을 만들지 않도록 실행합니다.

```bash
git --no-optional-locks status --porcelain=v2 --branch --untracked-files=normal
```

짧은 3초 polling은 대형 repo/worktree에서 과격합니다. 기본 polling은 15초 이상으로 두고, PR/check 상태처럼 원격 I/O가 있는 정보는 더 긴 주기를 사용합니다.

## Cross-process Coordination Rule

같은 worktree를 여러 Pi 프로세스가 동시에 열 수 있으므로 in-memory singleton만으로는 부족합니다.

Repo status polling은 worktree canonical path 기반 cache/lease를 사용합니다.

- lease owner만 실제 `git status`를 실행합니다.
- follower는 최근 cache를 읽거나, 짧게 기다린 뒤 cache가 없으면 현재 snapshot을 유지합니다.
- stale lease는 TTL 이후 다른 프로세스가 takeover할 수 있습니다.
- old lease owner의 release는 새 owner token을 삭제하지 않습니다.

이 구조는 여러 Pi 패널이 열려 있어도 같은 worktree에 대해 실제 status 실행을 하나로 수렴시킵니다.

## Mutation Pause Rule

`git add`, `git commit`, `git reset`, `git push`처럼 index나 refs를 바꾸는 구간에서는 repo status polling을 pause합니다.

- mutation 시작 전 worktree-scoped pause marker를 남깁니다.
- repo-status tracker는 pause marker가 있으면 새 `git status`를 실행하지 않습니다.
- mutation이 끝나면 marker를 제거합니다.
- 비정상 종료 대비 TTL을 둬서 영구 pause가 되지 않게 합니다.

## Stale Lock Recovery Rule

`index.lock` 오류를 만나면 자동 삭제 전에 owner를 확인합니다.

- owner가 없고 lock age가 충분하면 stale lock으로 보고 제거 후 한 번만 재시도합니다.
- owner가 repo-status용 `git status --porcelain=v2 --branch --untracked-files=normal`이면 짧게 기다리고, 계속 남으면 해당 status process만 중단한 뒤 재시도합니다.
- owner가 `git commit`, `git add`, `git reset` 등 실제 mutation이면 제거하거나 kill하지 않습니다.
- `lsof` 자체 실패를 owner 없음으로 오인하지 않습니다.

## Reporting Rule

Commit/push 도구가 lock을 복구했다면 결과나 error detail에 recovery note를 남깁니다. 사용자가 보는 결론은 짧게 유지하되, “stale lock 제거”, “repo-status git status owner 종료”, “owner 있음으로 중단” 중 어떤 경로였는지는 구분합니다.
