---
name: ci-ship
description: 열린 PR의 GitHub Actions/CI 실패를 분석해 원인을 분류하고, 코드·generated artifact·테스트·환경 문제를 근본 대응한 뒤 검증, 커밋, push까지 수행해야 할 때 사용한다. "CI 실패 대응", "체크 실패 봐줘", "Actions 실패 고쳐줘", "pr-checks 실패", "ci-ship" 요청에 사용한다.
argument-hint: "[PR URL | PR number | check/job URL]"
disable-model-invocation: false
---

# ci-ship — PR CI 실패 분석 + fix + verify + push

열린 PR의 CI 실패를 실제로 해소한다. 목표는 “실패 로그를 봤다”가 아니라 **CI가 실패한 원인이 PR 변경과 어떻게 연결되는지 밝히고, 필요한 수정/검증/커밋/push로 다시 통과 가능한 상태를 만드는 것**이다.

## Scope

AI가 기본으로 할 수 있는 것:

- PR status check rollup 조회
- 실패한 GitHub Actions job/step/log 수집
- 실패 원인 분류
- 자동 대응 대상과 의도적 policy/comment gate 제외 대상 분리
- 관련 코드·generated artifact·테스트 수정
- 로컬 재현/검증
- stale base / branch-behind 여부 판단
- 안전 조건을 만족하는 base branch merge update + push
- 커밋 및 push
- 최종 보고로 원인/대응/검증 요약 남기기

AI가 사용자 명시 승인 없이 하면 안 되는 것:

- workflow run rerun/re-run jobs
- review re-request
- PR merge, auto-merge, merge queue
- rebase update, force push, amend, history rewrite
- CI 설정 자체를 우회하거나 required check를 약화
- flaky로 단정하고 무시

CI rerun은 write side effect다. 새 commit push나 안전한 base-merge update push로 자동 재실행되는 CI는 괜찮지만, `gh run rerun`은 사용자가 명시 요청한 경우에만 수행한다.

Base branch update도 write side effect지만, 아래 **Branch Freshness / Update Branch Decision** 조건을 만족하면 `ci-ship`의 CI 복구 행위로 간주하고 별도 확인 없이 수행할 수 있다. 단 rebase/force-push는 금지하며, merge conflict가 나면 즉시 abort하고 사용자에게 차단 사유를 보고한다.

## Input Forms

- `/ci-ship` — 현재 branch의 PR CI 실패 수집 후 대응
- `/ci-ship <PR URL>` — 특정 PR의 실패 check 대응
- `/ci-ship <PR number>` — 현재 repo의 특정 PR 대응
- `/ci-ship <Actions job URL>` — 특정 failed job 우선 대응

## Workflow

### 1. CI Context Collection

먼저 read-only로 실패 표면을 수집한다.

```bash
gh pr view <PR> --json number,title,url,headRefName,headRefOid,baseRefName,mergeStateStatus,reviewDecision,statusCheckRollup
```

실패/취소/timed out check만 우선 보되, **자동 대응 대상(actionable)** 과 **기본 제외 대상(excluded by default)** 을 분리한다. 각 check에 대해:

- workflow name
- check/job name
- conclusion/status
- details URL
- started/completed time
- 자동 대응 대상 여부
- failed step 로그

기본 제외 대상:

- `fixme-alert`
- workflow/check 이름에 `FIXME 코멘트 체크`, `FIXME`, `TODO comment`, `comment policy`처럼 의도적 주석/정책 gate만 나타나는 check

이들은 CI rollup에는 남기지만, 사용자가 “FIXME도 지워서 통과시켜”, “모든 required check를 만족하게 해줘”처럼 명시하지 않는 한 자동 수정·검증·커밋 대상에서 제외한다. 특히 `FIXME:`는 임시 i18n/후속 작업 표식으로 의도적으로 남길 수 있으므로, `ci-ship`이 임의로 주석을 바꾸거나 삭제하지 않는다.

GitHub Actions job이면:

```bash
gh run view <run-id> --job <job-id> --log-failed
```

`--log-failed`가 빈약하면 전체 log를 더 좁혀 읽는다. tail만 보고 단정하지 않는다.

### 2. Failure Classification

각 실패를 아래 중 하나로 분류한다.

| 분류 | 판단 기준 | 대응 |
|---|---|---|
| PR 변경으로 인한 코드 실패 | 타입/테스트/빌드가 변경 파일·새 API·새 behavior와 직접 연결 | 코드 수정 + 로컬 검증 + 커밋 |
| generated artifact stale | schema/codegen/i18n/snapshot/lockfile diff 요구 | 정식 generator 실행 + generated diff 확인 + 커밋 |
| stale base / branch behind | base가 앞서 있고 실패 로그·mergeState·로컬 재현이 base 최신화 필요성을 가리킴 | 안전 조건 확인 후 base merge update + 검증 + push |
| 테스트 기대값 stale | product behavior는 맞고 테스트가 이전 계약을 가정 | 테스트를 새 계약에 맞게 수정, 근거 기록 |
| flaky/timeout | 동일 commit 재시도/known flaky 근거가 있고 코드 원인 없음 | 근거 보고 또는 사용자 승인 후 rerun 제안 |
| infra/external | registry, network, secret, runner, third-party 장애 | 근거 수집 후 사용자/담당자 action 제시 |
| unrelated baseline | base branch에서도 실패하거나 PR 변경과 무관 | 근거를 남기고 현재 PR 영향 범위 분리 |
| intentional policy/comment gate | `fixme-alert`/FIXME 코멘트 체크처럼 의도적 주석·정책 표식을 금지하는 별도 gate이고, 사용자가 해당 표식을 유지하기로 한 맥락이 있음 | 자동 수정 대상에서 제외하고 최종 보고의 “제외/사용자 판단”으로 분리. 명시 요청이 있을 때만 수정 |
| unknown | 로그가 부족하거나 재현 불가 | 추가 로그/로컬 재현부터 수행 |

### 3. Root-Cause Rule

표면 대응 금지:

- 에러 마지막 줄만 보고 수정하지 않는다.
- `exit code 1`만 보고 실패 원인을 단정하지 않는다.
- generated diff를 손으로 편집하지 않는다.
- 테스트를 통과시키려고 의미 없는 expect 변경을 하지 않는다.
- CI 설정/required check를 약화하지 않는다.

항상 실패한 step → 명령 → 실제 에러 → 관련 diff/파일 → 재현 명령 순서로 연결한다.

### 4. Branch Freshness / Update Branch Decision

실패 로그를 보기 전후로 branch freshness를 함께 판단한다. CI 실패가 PR 코드 문제가 아니라 base 최신화 문제일 수 있기 때문이다.

Read-only 확인:

```bash
git fetch origin <baseRefName> <headRefName>
git status --short
git rev-parse HEAD
git rev-list --left-right --count origin/<baseRefName>...HEAD
```

판단 기준:

| 신호 | 의미 | 처리 |
|---|---|---|
| `mergeStateStatus`가 `BEHIND`/out-of-date 계열 | GitHub가 branch update를 요구 | update 후보 |
| base-only commit 수가 1 이상이고 CI 로그가 base 변경 영향(스키마/락파일/테스트/merge ref)을 가리킴 | stale base 가능성 높음 | update 후보 |
| local HEAD에서는 통과하지만 PR merge ref/base 최신 상태에서만 실패 | stale base 가능성 높음 | update 후보 |
| merge conflict 또는 dirty worktree | 자동 update 불가 | abort/report |
| 실패가 변경 파일의 타입/테스트 오류로 명확함 | base update로 덮지 않음 | 코드 수정 우선 |
| check가 아직 `IN_PROGRESS`이고 실패 로그가 없음 | 실패 아님 | 기다림/보고, update하지 않음 |

자동 update 안전 조건을 모두 만족해야 한다.

1. 현재 작업트리가 clean이다.
2. 현재 branch가 PR `headRefName`이거나, push 대상이 명확하다.
3. `git rev-parse HEAD`가 PR `headRefOid`와 일치한다. 다르면 먼저 fetch/상태를 다시 보고 remote divergence를 설명한다.
4. base-only commit 수가 1 이상이다.
5. CI 실패/mergeState가 stale base와 연결된다.
6. rebase/force-push 없이 merge commit으로 해결 가능하다.

수행 방식:

```bash
git merge --no-edit origin/<baseRefName>
# conflict 발생 시:
#   git merge --abort
#   최종 보고에 blocked로 기록
# conflict 없으면 CI 실패와 가장 가까운 로컬 검증 실행
git push origin HEAD:<headRefName>
```

GitHub의 `Update branch` 버튼과 같은 효과가 필요하면 기본은 `/update-branch`를 사용한다. 이 명령은 현재 PR을 식별해 `gh pr update-branch`를 원격에서 트리거하고, remote head 갱신 후 local worktree를 `git pull --ff-only`로 동기화한다. dirty worktree는 명령의 autostash 안전장치에 맡기되, local HEAD와 PR head가 다르거나 conflict로 GitHub update가 실패하면 로컬 merge로 억지 진행하지 말고 blocked로 보고한다. `--rebase`는 사용하지 않는다.

### 5. Decide Whether to Modify

수정이 필요한 경우:

- 현재 PR 변경이 CI 실패를 유발했다.
- generated artifact가 최신이 아니다.
- 테스트가 새 계약을 반영해야 한다.

수정하지 않는 경우:

- infra/external failure
- known flaky 근거가 충분함
- baseline failure
- `fixme-alert`/FIXME 코멘트 체크 같은 intentional policy/comment gate이며 사용자가 의도적으로 유지한 표식일 가능성이 높음
- 사용자 판단이 필요한 product/UX/security/DB 정책 문제

수정하지 않는 경우에도 “왜 코드 변경이 아닌지”를 최종 보고에 근거와 함께 남긴다. PR 코멘트는 사용자가 명시적으로 요청한 경우에만 남긴다.

### 6. Implement Fix

- 관련 파일만 수정한다.
- generated artifact는 프로젝트 generator로 생성한다.
- lockfile/schema/snapshot은 diff를 읽고 의도한 변화인지 확인한다.
- unrelated cleanup은 하지 않는다.

### 7. Local Verification

CI의 실패 명령과 가장 가까운 로컬 명령을 실행한다.

예:

- schema sync 실패 → generator/codegen 명령 + diff 확인
- typecheck 실패 → 해당 package typecheck
- test 실패 → 실패 test 파일 단독 실행 후 영향 범위 test
- lint 실패 → lint 또는 formatter check
- build 실패 → 해당 app/package build

CI와 로컬 환경 차이가 있으면 차이를 명시한다.

`fixme-alert`처럼 기본 제외한 policy/comment gate는 로컬 재현을 필수로 돌리지 않는다. 단, 사용자가 해당 gate까지 해결하라고 명시한 경우에만 원 CI 스크립트와 같은 grep/check를 재현한다.

### 8. Commit + Push

```bash
git status --short
git diff --check
git add <related files>
git commit -m "fix: address CI failure <summary>"
git push
```

커밋 메시지는 실패 원인 중심으로 쓴다.

### 9. PR Comment Exception Policy

`ci-ship`의 기본 완료 조건은 commit + push + 최종 보고다. PR comment는 기본 동작이 아니다.

다음처럼 사용자가 명시한 경우에만 코멘트를 남긴다.

- “코멘트까지 남겨줘”
- “PR에 원인/대응 적어줘”
- “수정할 게 없으면 PR에 근거 남겨줘”

명시 요청이 있을 때의 코멘트 형식:

```markdown
CI 실패 대응 완료 (`<SHORT_SHA>`):

- 실패 check: <workflow/job/step>
- 원인: <root cause>
- 대응: <수정/생성/테스트 변경>
- 검증: `<local command>` ✅
- 비고: <rerun은 새 push로 자동 진행 / 수동 rerun은 하지 않음>
```

명시 요청이 있고 수정하지 않는 경우:

```markdown
CI 실패 확인 결과 코드 변경은 하지 않았습니다.

- 실패 check: <workflow/job/step>
- 판단: <infra/flaky/baseline/외부 요인>
- 근거: <log/run URL/local command>
- 제안: <rerun 요청/담당자 확인/후속 action>
```

## Final Report

```markdown
완료했습니다.
- PR: <url>
- 실패 분류: <code/generated/flaky/infra/baseline>
- 대응: <수정/생성/보류>
- 커밋: `<sha>` <message>
- Push: <branch>
- Base update: <수행/불필요/차단> (<근거>)
- 검증: `<command>` ✅ / ⚠️ <reason>
- 하지 않은 것: rerun/re-request/PR merge는 수행하지 않음
```

## Red Flags

- 실패 로그 tail만 보고 원인 단정
- CI required check 약화
- generated file 수동 편집
- “flaky 같다”만으로 종료
- branch가 뒤처졌는지 확인하지 않고 코드만 수정
- 실패가 PR 코드 원인인데 base update로 덮으려 함
- dirty worktree/remote divergence 상태에서 update branch 수행
- rebase/force-push로 branch update 수행
- 로컬 재현 없이 push
- unrelated failure를 현재 PR 성공처럼 포장
