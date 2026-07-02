---
name: to-production
description: 현재 worktree를 최신 production 기반 새 branch로 in-place 전환해야 할 때 사용한다. "/to-production", "production으로 옮겨", "production 바라보게", "hotfix로 다시 쌓아" 요청에 사용한다. 기존 작업 commit은 backup 후 cherry-pick하고, 새 worktree가 필요하면 /wt fork --hotfix가 담당한다.
argument-hint: "[target-branch] [--skip-untracked|--commit-untracked] [--range <rev-range>]"
disable-model-invocation: false
---

# to-production — 현재 worktree를 production 기반 branch로 전환

사용자 관점의 `/to-production`은 **지금 작업 중인 worktree가 production을 바라보는 새 branch로 바뀌는 workflow**다. 새 sibling worktree를 만드는 도구가 아니다. 별도 worktree가 필요하면 `/wt fork --hotfix`가 담당한다.

## 핵심 원칙

- **기본은 in-place**: 현재 worktree 경로에서 `origin/production` 기반 새 branch로 `git switch`한다.
- **새 worktree 생성 금지**: `/to-production`은 `git worktree add`를 실행하지 않는다. 병렬 작업공간은 `/wt fork --hotfix` 책임이다.
- **작업 전 clean 상태도 정상**: commit/diff/untracked가 없어도 중단하지 않고 production 기반 빈 branch를 만든다.
- **commit은 cherry-pick**: 기존 작업 commit이 있으면 backup branch/artifact를 남긴 뒤 새 production 기반 branch 위로 순서대로 `git cherry-pick`한다.
- **미커밋 diff는 자동 처리하지 않음**: tracked/staged dirty diff가 있으면 먼저 commit하라고 중단한다. 자동 stash/reset/clean/dirty commit을 하지 않는다.
- **production base 명시**: 기본 base는 `origin/production`이다. 다른 base가 필요하면 `--base <remote/branch>`로 명시한다.
- **untracked는 선택 게이트**: UI가 있으면 그대로 두기/source commit 후 cherry-pick/중단을 묻는다. headless에서는 `--skip-untracked` 또는 `--commit-untracked`를 명시해야 한다.
- **불명확하면 설명하고 중단**: merge commit, 충돌, 진짜 commit range 불명확성은 조용히 추측하지 않는다. 단, 사용자에게 range 계산을 기본 사용법처럼 떠넘기면 안 된다.

## 기본 사용

```bash
/to-production
```

자연어에서 “`/to-production`으로 해줘”, “production으로 옮겨줘”, “production 바라보게 세팅해줘”, “hotfeature로 다시 쌓아줘”처럼 요청받았고 dedicated tool이 제공되는 런타임이면 `to_production` tool을 호출한다. 사용자가 단독 slash command를 제출한 경우에만 command handler가 직접 실행된다.

기본 동작:

1. 현재 git repo/source branch/HEAD/upstream/status를 읽는다.
2. 현재 workspace의 작업 commit을 자동 추론한다.
   - 먼저 upstream 대비 아직 push되지 않은 commit을 본다.
   - upstream과 `HEAD`가 같으면 `origin/development`/`origin/develop`/`origin/main`/`origin/master`/`origin/HEAD` 같은 source base 대비 branch 고유 commit을 후보로 본다.
3. tracked/staged dirty diff가 있으면 중단한다.
4. untracked 파일이 있으면 UI에서 처리 방식을 묻거나 명시 옵션을 적용한다.
5. `origin/production`을 fetch하고 base ref를 검증한다.
6. 현재 HEAD backup branch와 `~/.pi/agent/to-production/...` artifact를 만든다.
7. 현재 worktree에서 `origin/production` 기반 target branch로 `git switch -c <target> --track origin/production`한다.
8. 기존 작업 commit이 있으면 target branch 위로 `git cherry-pick`한다.
9. 현재 worktree에서 이어서 커밋 정리/검증/push/PR을 진행한다.

## 자주 쓰는 옵션

```bash
/to-production hotfix/COM-1234-something
/to-production --branch hotfix/COM-1234-something
/to-production --skip-untracked --branch hotfix/manual-range
/to-production --commit-untracked --untracked-message "chore: hotfix 누락 파일 보존"
/to-production --range abc123..HEAD --branch hotfix/manual-range
/to-production --dry-run
```

| 옵션 | 의미 |
|---|---|
| `--branch`, `-b` | target branch 이름 |
| `--base` | production base. 기본 `origin/production` |
| `--range` | cherry-pick할 commit range를 명시 |
| `--skip-untracked` | untracked 파일은 현재 worktree에 그대로 두고 전환 |
| `--commit-untracked` | untracked 파일을 source에 먼저 commit하고 그 commit까지 cherry-pick |
| `--untracked-message` | `--commit-untracked` source commit 메시지 |
| `--dry-run` | 실제 branch/artifact 생성 없이 plan만 출력 |
| `--yes`, `-y` | 확인창 생략 |

지원하지 않는 옵션/흐름:

- `--path`: 새 worktree는 만들지 않는다. `/wt fork --hotfix`를 사용한다.
- `--include-untracked`: in-place 전환에는 target 복사 개념이 없다. 먼저 commit하거나 `--commit-untracked`를 사용한다.
- `--message`: 미커밋 diff 자동 commit을 하지 않는다. 먼저 commit한 뒤 실행한다.

## Stop Conditions

아래면 extension이 중단해야 한다.

- 현재 worktree에 conflict/unmerged file이 있다.
- tracked/staged dirty diff가 있다.
- headless/no-UI에서 untracked 파일이 있는데 skip/commit 중 명시 선택이 없다.
- `--commit-untracked`와 explicit `--range`를 함께 쓰면서 range가 `HEAD`를 포함하지 않는다.
- target branch가 이미 존재한다.
- commit range에 merge commit이 포함되어 있다.
- `origin/production` fetch 또는 base ref 검증에 실패한다.
- `git switch` 또는 `git cherry-pick` conflict가 발생한다.

중단 전에 이미 branch switch/cherry-pick이 시작됐다면 현재 worktree가 target branch 또는 conflict 상태일 수 있다. 이때 report는 backup branch와 artifact 경로를 반드시 보여줘야 한다.

## 복구/수동 확인

성공 report 또는 중단 report에는 아래를 남긴다.

- 이전 branch/HEAD
- source backup branch
- artifact directory
- current target branch
- current status/log

수동 복구 예시:

```bash
# artifact 확인
ls ~/.pi/agent/to-production/**/**

# source HEAD 백업 확인
git branch --list 'to-production/source-backup/*'

# cherry-pick 충돌 확인/복구
git status
# 계속 진행하려면 conflict 해결 후
git cherry-pick --continue
# 중단하려면
git cherry-pick --abort
# 필요하면 backup branch에서 다시 시작
git switch <backup-branch>
```

## 검증

성공 후에는 **현재 worktree**에서 해당 repo/domain의 가까운 검증을 실행한다.

- 빠른 diff sanity: `git diff origin/production...HEAD --stat`
- 변경 domain unit/lint/typecheck
- hotfix PR/push는 현재 target branch에서 별도로 진행

## Red Flags

- `/to-production`이 `git worktree add`로 sibling worktree를 만든다.
- clean worktree인데 “옮길 변경 없음”으로 중단한다.
- tracked dirty diff를 자동 stash/reset/clean/commit한다.
- natural-language `/to-production` 요청을 generic `worktree_fork`/`worktree_create`로 처리한다.
- 이미 push되어 `@{upstream}..HEAD`가 비었다는 이유만으로 작업 commit이 없다고 단정한다.
- `origin/production..HEAD` 전체를 workspace commit range로 사용한다. development 기반 branch에서는 unrelated development commit이 섞일 수 있다.
- untracked 파일을 조용히 무시하거나 사용자 선택 없이 source에 commit한다.
- cherry-pick 실패 후 artifact/backup 없이 “다시 해보면 됨”으로 넘긴다.
