---
title: Update branch는 안전한 pull command다
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
reviewed_at: 2026-06-02
reviewed_commit: d8f8c4c56f23dcfda08b089b6d8ff5be4885e37c
related:
  - worktree-execution-boundary
  - change-integration-discipline
  - workflow-weight-proportionality
---

## Judgment

반복적으로 “update branch 해서 git pull”을 요청하는 흐름은 agent에게 매번 해석시키는 작업이 아니라, 현재 repo 실행 경계에서 안전하게 최신 upstream을 반영하는 deterministic slash command가 맞습니다.

이 command는 구현·검증 작업으로 확대하지 않습니다. 목적은 현재 브랜치를 remote 상태와 맞추는 것뿐입니다.

## Safety Rule

`/update-branch`는 먼저 현재 위치가 git repo인지 확인합니다. worktree가 dirty이면 기본적으로 중단하지 않고, 사용자의 미커밋 변경을 `git stash push --include-untracked`로 보존한 뒤 pull을 시도합니다. pull 후에는 `git stash apply --index`로 변경을 복원하고, 복원이 성공한 경우에만 stash를 drop합니다. 복원 충돌이나 실패가 있으면 stash를 삭제하지 않고 어떤 stash를 수동 확인해야 하는지 출력합니다.

기존처럼 dirty worktree에서 바로 중단하고 싶을 때만 `/update-branch --no-autostash`를 사용합니다. 이 옵션은 “보존 가능한 변경도 막기”가 아니라, 자동 stash를 원하지 않는 사용자의 escape hatch입니다.

기본 pull은 `git pull --ff-only`입니다. GitHub의 Update branch 버튼처럼 remote branch가 이미 갱신된 뒤 local branch를 fast-forward하는 일상 흐름을 안전하게 닫기 위해서입니다. merge pull이 필요하면 사용자가 명시적으로 `/update-branch --merge`를 선택합니다.

## Lock Recovery Rule

`index.lock` 때문에 `git status`나 `git pull`이 실패하면, command는 `lsof`로 점유 프로세스를 먼저 확인합니다.

- 점유 프로세스가 있으면 자동 제거하지 않고 중단합니다.
- 점유 프로세스가 없고 lock 파일만 남았으면 고아 lock으로 보고 제거한 뒤 같은 git command를 한 번만 재시도합니다.

이 흐름은 반복되는 수동 `lsof → rm index.lock → git pull`을 자동화하되, 실제로 git 작업 중인 프로세스를 방해하지 않는 경계입니다.

## Output Rule

성공 보고는 짧게 유지합니다.

- 현재 repo root
- 사용한 mode (`git pull --ff-only` 또는 `git pull`)
- lock recovery 여부
- dirty 변경 보존/복원 여부와 stash ref
- 현재 HEAD
- `git status --short --branch`

실패/중단 시에는 dirty status, 점유 프로세스, pull 실패 메시지, 보존 stash 상태를 보여줍니다. 충돌 해결을 자동으로 계속 진행하지는 않지만, pull 때문에 사용자 변경이 사라진 것처럼 보이지 않도록 stash 보존 여부를 명확히 출력합니다.
