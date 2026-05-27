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
reviewed_at: 2026-05-27
reviewed_commit: fdd1a982d09c94edb243e59eb6753747ab2a5341
related:
  - worktree-execution-boundary
  - change-integration-discipline
  - workflow-weight-proportionality
---

## Judgment

반복적으로 “update branch 해서 git pull”을 요청하는 흐름은 agent에게 매번 해석시키는 작업이 아니라, 현재 repo 실행 경계에서 안전하게 최신 upstream을 반영하는 deterministic slash command가 맞습니다.

이 command는 구현·검증 작업으로 확대하지 않습니다. 목적은 현재 브랜치를 remote 상태와 맞추는 것뿐입니다.

## Safety Rule

`/update-branch`는 먼저 현재 위치가 git repo인지 확인하고, worktree가 dirty이면 pull을 중단합니다. 사용자의 미커밋 변경을 stash/commit/reset하지 않습니다.

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
- 현재 HEAD
- `git status --short --branch`

실패/중단 시에는 dirty status, 점유 프로세스, pull 실패 메시지만 보여주고 충돌 해결이나 stash 같은 후속 작업을 자동 수행하지 않습니다.
