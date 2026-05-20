---
name: to-production
description: 현재 worktree의 작업 내용이나 local commits를 최신 production 기반 hotfix branch/worktree로 안전하게 옮겨야 할 때 사용한다. "/to-production", "production으로 옮겨", "hotfix로 다시 쌓아", "development 기반 작업을 production base로 이식" 요청에 사용한다. source worktree 변경 유실 방지가 핵심이다.
argument-hint: "[target-branch] [--include-untracked] [--message <commit-message>]"
disable-model-invocation: false
---

# to-production — source-preserving production 이식

현재 worktree의 변경사항을 **source worktree에 손대지 않고** 최신 production 기반 새 branch/worktree로 옮기는 workflow다. 실제 자동화는 `/to-production` extension command 또는 같은 실행 경로를 쓰는 `to_production` tool이 담당하고, 이 skill은 언제 실행하고 어떻게 검증/복구할지의 판단 기준이다.

## 핵심 원칙

- **원본 유실 금지**: source worktree에서 `checkout`, `stash`, `reset`, `clean`을 실행하지 않는다.
- **먼저 보존, 나중에 적용**: patch artifact와 source backup branch를 만든 뒤 target worktree에만 적용한다.
- **production base 명시**: 기본 base는 `origin/production`이다. 다른 base가 필요하면 `--base <remote/branch>`로 명시한다.
- **자동 삭제 금지**: 성공해도 원본 worktree/branch를 자동 삭제하지 않는다. 정리는 사용자가 확인한 뒤 별도 수행한다.
- **전용 실행 경계**: 자연어 요청에 `/to-production`이 포함되어도 slash command가 자동 실행되는 것은 아니다. 이때는 `to_production` tool을 사용한다.
- **대체 금지**: `/to-production` 이식은 `worktree_fork`, `worktree_create`, 수동 `git worktree add`, source `checkout/stash/reset/clean`으로 흉내 내지 않는다. 전용 command/tool이 없으면 standalone `/to-production ...` 입력을 요청한다.
- **불명확하면 중단**: untracked, merge commit, 충돌, commit range 불명확성은 조용히 추측하지 않는다.

## 기본 사용

```bash
/to-production
```

자연어에서 “`/to-production`으로 해줘”, “production으로 옮겨줘”, “hotfeature로 다시 쌓아줘”처럼 요청받았고 dedicated tool이 제공되는 런타임이면 `to_production` tool을 호출한다. 사용자가 이미 단독 slash command를 제출한 경우에만 command handler가 직접 실행된다.

기본 동작:

1. 현재 git repo/source branch/HEAD/upstream/status를 읽는다.
2. local commits는 `@{upstream}`과의 merge-base부터 `HEAD`까지를 이식 대상으로 본다.
3. tracked/staged/unstaged diff는 `git diff --binary HEAD` patch로 보존한다.
4. `origin/production`을 fetch한다.
5. source HEAD backup branch와 `~/.pi/agent/to-production/...` artifact를 만든다.
6. 새 sibling worktree를 `origin/production` 기반 target branch로 만든다.
7. commit patch는 `git am --3way`, dirty patch는 `git apply --3way --index` 후 새 commit으로 적용한다.

## 자주 쓰는 옵션

```bash
/to-production hotfix/COM-1234-something
/to-production --branch hotfix/COM-1234-something --message "fix: 앱쿠폰 결제통화 예외"
/to-production --include-untracked --message "fix: production hotfix"
/to-production --range abc123..HEAD --branch hotfix/manual-range
/to-production --dry-run
```

| 옵션 | 의미 |
|---|---|
| `--branch`, `-b` | target branch 이름 |
| `--base` | production base. 기본 `origin/production` |
| `--path` | target worktree path |
| `--range` | 이식할 commit range를 명시 |
| `--message`, `-m` | 미커밋 diff를 commit할 메시지 |
| `--include-untracked` | untracked 파일까지 artifact 백업 후 target에 복사/commit |
| `--dry-run` | 실제 branch/worktree/artifact 생성 없이 plan만 출력 |
| `--yes`, `-y` | 확인창 생략 |

## Stop Conditions

아래면 extension이 중단해야 한다.

- source worktree에 conflict/unmerged file이 있다.
- 옮길 local commit/diff/untracked가 없다.
- untracked 파일이 있는데 `--include-untracked`가 없다.
- target branch 또는 target worktree path가 이미 존재한다.
- commit range에 merge commit이 포함되어 있다.
- `origin/production` fetch 또는 base ref 검증에 실패한다.
- target 적용 중 `git am`/`git apply` conflict가 발생한다.

중단해도 source worktree는 그대로여야 한다. target worktree가 생성된 뒤 충돌이 난 경우에는 target에 conflict 상태를 남기고, artifact 경로를 보고해 수동 복구할 수 있게 한다.

## 복구/수동 확인

성공 report 또는 artifact 생성 이후의 중단 report에는 아래를 남긴다. preflight 단계에서 중단한 경우에는 source 미변경 사유를 우선 보고한다.

- source repo/branch/HEAD
- source backup branch
- artifact directory
- target branch/worktree
- target status/log

수동 복구 예시:

```bash
# artifact 확인
ls ~/.pi/agent/to-production/**/**

# source HEAD 백업 확인
git branch --list 'to-production/source-backup/*'

# target에서 충돌 이어서 처리
cd <target-worktree>
git status
# conflict 해결 후
git am --continue        # commit patch 단계에서 멈춘 경우
# 또는
git add <files>
git commit -m "fix: ..." # dirty patch 단계에서 멈춘 경우
```

## 검증

성공 후에는 target worktree에서 해당 repo/domain의 가까운 검증을 실행한다.

- 빠른 diff sanity: `git diff origin/production...HEAD --stat`
- 변경 domain unit/lint/typecheck
- hotfix PR/push는 target branch에서 별도로 진행

## Red Flags

- source worktree에서 `git stash`, `git reset`, `git clean`을 먼저 실행한다.
- 자연어 `/to-production` 요청을 generic `worktree_fork`/`worktree_create`로 처리한다.
- dedicated command/tool 대신 사용자에게 commit range를 다시 계산해 입력하라고 떠넘긴다.
- `origin/production..HEAD` 전체를 local commit range로 사용한다. development 기반 branch에서는 unrelated development commit이 섞일 수 있다.
- untracked 파일을 조용히 무시한다.
- target 적용 실패 후 artifact/backup 없이 “다시 해보면 됨”으로 넘긴다.
- 성공 직후 원본 worktree를 자동 삭제한다.
