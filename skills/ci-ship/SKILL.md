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
- 관련 코드·generated artifact·테스트 수정
- 로컬 재현/검증
- 커밋 및 push
- 최종 보고로 원인/대응/검증 요약 남기기

AI가 사용자 명시 승인 없이 하면 안 되는 것:

- workflow run rerun/re-run jobs
- review re-request
- merge, auto-merge, merge queue
- force push, amend, history rewrite
- CI 설정 자체를 우회하거나 required check를 약화
- flaky로 단정하고 무시

CI rerun은 write side effect다. 새 commit push로 자동 재실행되는 CI는 괜찮지만, `gh run rerun`은 사용자가 명시 요청한 경우에만 수행한다.

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

실패/취소/timed out check만 우선 본다. 각 check에 대해:

- workflow name
- check/job name
- conclusion/status
- details URL
- started/completed time
- failed step 로그

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
| 테스트 기대값 stale | product behavior는 맞고 테스트가 이전 계약을 가정 | 테스트를 새 계약에 맞게 수정, 근거 기록 |
| flaky/timeout | 동일 commit 재시도/known flaky 근거가 있고 코드 원인 없음 | 근거 보고 또는 사용자 승인 후 rerun 제안 |
| infra/external | registry, network, secret, runner, third-party 장애 | 근거 수집 후 사용자/담당자 action 제시 |
| unrelated baseline | base branch에서도 실패하거나 PR 변경과 무관 | 근거를 남기고 현재 PR 영향 범위 분리 |
| unknown | 로그가 부족하거나 재현 불가 | 추가 로그/로컬 재현부터 수행 |

### 3. Root-Cause Rule

표면 대응 금지:

- 에러 마지막 줄만 보고 수정하지 않는다.
- `exit code 1`만 보고 실패 원인을 단정하지 않는다.
- generated diff를 손으로 편집하지 않는다.
- 테스트를 통과시키려고 의미 없는 expect 변경을 하지 않는다.
- CI 설정/required check를 약화하지 않는다.

항상 실패한 step → 명령 → 실제 에러 → 관련 diff/파일 → 재현 명령 순서로 연결한다.

### 4. Decide Whether to Modify

수정이 필요한 경우:

- 현재 PR 변경이 CI 실패를 유발했다.
- generated artifact가 최신이 아니다.
- 테스트가 새 계약을 반영해야 한다.

수정하지 않는 경우:

- infra/external failure
- known flaky 근거가 충분함
- baseline failure
- 사용자 판단이 필요한 product/UX/security/DB 정책 문제

수정하지 않는 경우에도 “왜 코드 변경이 아닌지”를 최종 보고에 근거와 함께 남긴다. PR 코멘트는 사용자가 명시적으로 요청한 경우에만 남긴다.

### 5. Implement Fix

- 관련 파일만 수정한다.
- generated artifact는 프로젝트 generator로 생성한다.
- lockfile/schema/snapshot은 diff를 읽고 의도한 변화인지 확인한다.
- unrelated cleanup은 하지 않는다.

### 6. Local Verification

CI의 실패 명령과 가장 가까운 로컬 명령을 실행한다.

예:

- schema sync 실패 → generator/codegen 명령 + diff 확인
- typecheck 실패 → 해당 package typecheck
- test 실패 → 실패 test 파일 단독 실행 후 영향 범위 test
- lint 실패 → lint 또는 formatter check
- build 실패 → 해당 app/package build

CI와 로컬 환경 차이가 있으면 차이를 명시한다.

### 7. Commit + Push

```bash
git status --short
git diff --check
git add <related files>
git commit -m "fix: address CI failure <summary>"
git push
```

커밋 메시지는 실패 원인 중심으로 쓴다.

### 8. PR Comment Exception Policy

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
- 검증: `<command>` ✅ / ⚠️ <reason>
- 하지 않은 것: rerun/re-request/merge는 수행하지 않음
```

## Red Flags

- 실패 로그 tail만 보고 원인 단정
- CI required check 약화
- generated file 수동 편집
- “flaky 같다”만으로 종료
- 로컬 재현 없이 push
- unrelated failure를 현재 PR 성공처럼 포장
