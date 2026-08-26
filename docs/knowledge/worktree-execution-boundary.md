---
title: Worktree는 실행 경계다
tags:
  - worktree
  - workspace
  - repo
  - branch
  - execution-boundary
  - cwd-binding
  - 워크트리
category: workflow
status: active
confidence: high
applies_to:
  - extensions/worktree
  - worktree_create
  - worktree_switch
  - worktree_fork
  - frame_worktree_fork
source:
  - pilee-history:2026-05-01#8
  - pilee-history:2026-05-03#25
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-05-11-worktree-cwd-binding
reviewed_at: 2026-08-26
reviewed_commit: 5307b4167c74dfe256ae00fcb2a2a03e65fe42a3
related:
  - worktree-session-continuity
  - session-identity-over-filenames
  - workspace-action-panel-activation-contract
---

## Judgment

Worktree는 단순한 디렉터리 편의 기능이 아니라 작업 실행 경계입니다. 레포, 브랜치, 세션, 로컬 서버, 검증 산출물이 섞이지 않게 분리하는 단위이기 때문에 AI가 임의로 현재 cwd에서 회사 레포 파일을 수정하면 안 됩니다.

## Boundary Rule

홈 세션은 범용 조사와 계획에 쓰고, profile이 protected로 지정한 업무 레포 코드를 수정할 때는 사용자가 명시적으로 허용한 worktree 세션을 사용합니다. 새 branch 요청만으로 worktree를 만들지 않으며, branch는 현재 workspace에서 in-place로 생성·전환합니다. worktree 생성은 최신 base, hotfix 여부, repo registry, setup 명령까지 함께 다뤄야 하며, 수동 `git worktree add`보다 pilee의 worktree workflow를 우선합니다. 구체 repo 이름·root·base branch는 public doctrine이 아니라 runtime profile이 제공합니다.

## Runtime Binding Rule

worktree session이 활성화됐다면 session header의 cwd, exact session file, activation metadata가 실행 경계의 source of truth입니다. `/wt new`·`/wt fork`·create/fork tools는 source panel을 유지하고 target READY가 확인된 새 panel에서 이 경계를 만듭니다. `/wt switch`·`worktree_switch`만 current panel을 기존 worktree session으로 전환합니다. 어떤 경로든 activation이 실패했다면 절대경로만 들고 구현을 계속하지 않습니다. `/frame`과 Frame Studio 같은 identity 계산도 `ctx.cwd`만 믿지 말고 현재 session file의 header cwd를 먼저 읽어 worktree-bound artifact로 승격해야 합니다.

planning frame에서 `fork해서 시작`을 선택한 경우 실행 경계는 “worktree가 생겼다”가 아니라 “새 작업 panel의 exact session이 READY이고 첫 implementation slice continuation이 전달됐다”가 기준입니다. `frame_worktree_fork`는 저장된 `/frame` command context로 실제 `/wt fork` handler를 호출하고, source panel을 보존한 채 planning frame/task를 승격합니다. command context나 READY가 없으면 worktree를 만들지 않거나 생성 artifact를 정리하고 BLOCKED로 멈춥니다.

## Artifact Boundary

worktree 안에서 만든 검증 리포트, frame, local context는 해당 worktree의 실행 결과입니다. `/archive`가 여러 workspace artifact를 다시 열 수 있더라도, 수정·검증·커밋의 기준 브랜치는 현재 worktree 경계를 따라야 합니다. 다른 workspace의 artifact는 참고 자료이지 현재 diff의 증거로 자동 승격되지 않습니다.

Capture media는 workspace별로 group화될 수 있고, label은 worktree metadata, session title, Frame identity에서 보강될 수 있습니다. 이 label은 탐색 affordance일 뿐이며, 어떤 branch/diff를 검증했는지의 실행 경계는 여전히 worktree와 report 기준 커밋이 결정합니다.

## Failure Mode

실행 경계 없이 cwd만 바꿔 작업하면 세션 맥락, 브랜치, 검증 산출물이 서로 섞입니다. 새 panel open이나 READY가 실패했는데 current-panel `switchSession`으로 몰래 대체하면 사용자가 보존하려던 source conversation을 빼앗습니다. 반대로 current-panel switch가 명시됐는데 sibling panel을 만들면 사용자가 고른 위치를 어깁니다. 두 경우 모두 `BLOCKED`로 멈춥니다. 다만 target terminal close가 확인되지 않았거나 child가 continuation을 이미 소유했다면 살아 있는 실행 경계를 삭제하지 말고 descriptor·panel record·session·worktree를 recovery artifact로 보존해야 합니다.
