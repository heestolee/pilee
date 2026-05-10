---
name: pr-ship
description: 열린 PR의 리뷰 코멘트나 changes requested에 대해 부모/현재 대화와 작업 내역을 확인한 뒤, 표면적 답변이 아니라 근본 원인을 판단해 코드 수정·커밋·푸시·스레드 답글·review re-request까지 수행해야 할 때 사용한다. `--push-only` 모드에서는 코멘트/re-request 없이 커밋·푸시 후 수동 게시용 답글 초안을 세션에서 다듬는다. "PR 코멘트 대응", "리뷰 대응", "이거 대응작업-커밋-푸시-코멘트까지", "근본적으로 대응", "대응할 게 없으면 근거 코멘트" 요청에 사용한다.
argument-hint: "[--push-only] [PR URL | review comment URL | PR number]"
disable-model-invocation: false
---

# pr-ship — PR 후 리뷰 대응 + commit + push + comment + re-request

열린 PR에 달린 리뷰 코멘트를 실제로 해결한다. 목표는 “답글을 달았다”가 아니라 **리뷰가 지적한 근본 문제가 코드/문서/검증 근거로 닫혔는가**다.

## Hard Boundary

AI가 기본으로 할 수 있는 것:

- PR/comment/thread 내용 수집
- 부모/현재 대화와 작업 내역 재구성
- 코드/문서 수정
- 의도 단위 커밋
- 관련 검증 실행
- push
- 기본 모드: 해당 review conversation에 커밋 SHA 또는 근거가 포함된 답글 작성
- 기본 모드: 답글 후 승인되지 않은 리뷰어에게 review re-request
- `--push-only` 모드: GitHub 코멘트/re-request 없이 수동 게시용 답글 초안을 세션에 작성

AI가 사용자 명시 승인 없이 하면 안 되는 것:

- review thread `resolve` / `unresolve`
- merge, auto-merge, merge queue
- reviewer가 이미 바꾼 상태 되돌리기
- force push, amend, history rewrite

`resolve`/`unresolve`는 “사용자가 지금 이 동작을 해달라”고 명시한 경우에만 별도 단계로 수행한다. 리뷰 대응 완료 보고에 “thread resolve는 리뷰어/작성자 판단”이라고 남긴다. 반대로 review re-request는 `pr-ship` 기본 모드의 마무리 동작이다. 단, 승인되지 않은 리뷰어/팀이 없으면 skip하고, API 실패 시 실패 사유를 보고한다. `--push-only` 모드에서는 GitHub 코멘트와 review re-request를 모두 수행하지 않는다.

## Input Forms

- `/pr-ship` — 현재 branch의 PR unresolved review comments 수집 후 대응
- `/pr-ship <PR URL>` — 특정 PR의 unresolved review comments 대응
- `/pr-ship <review comment URL>` — 특정 comment/thread 우선 대응
- `/pr-ship --push-only [PR URL | review comment URL | PR number]` — 코드 수정·검증·커밋·푸시까지만 수행하고, 코멘트는 수동 게시용 초안만 작성
- 자연어: “이거 대응작업-커밋-푸시-코멘트까지 해줘”

## Workflow

### 0. Mode Selection

기본 모드는 `full-response`다.

- `full-response`: 수정/검증 → commit → push → 해당 thread 답글 작성 → review re-request
- `push-only`: 수정/검증 → commit → push → 세션에 수동 게시용 답글 초안 작성

`--push-only`, `--no-comment`, `--draft-only`, `--manual-comment` 플래그가 있으면 `push-only`로 처리한다. 이 모드에서는 다음을 실행하지 않는다.

- GitHub review comment/reply 작성
- `requested_reviewers` API 호출 또는 review re-request
- thread resolve/unresolve

대신 최종 응답에 사용자가 복사해 붙일 수 있는 polished comment draft를 포함하고, 사용자가 원하면 그 자리에서 문구를 함께 다듬는다.

### 1. Context Reconstruction

먼저 작업 맥락을 복원한다. 특히 fork/child panel에서 시작한 경우 부모 세션을 확인한다.

확인 대상:

- 현재 session file과, 있으면 parent session file (`PI_FORK_PARENT` 또는 command shim이 준 경로)
- `.context/work/**/context.md`, `.pi/worktree-meta.json`, frame/verify/archive transcript
- `git status --short --branch`
- `git log --oneline --decorate origin/<base>..HEAD` 또는 PR commit list
- PR body, changed files, 기존 agent 답글, unresolved review comments
- 특정 comment URL이 주어졌다면 해당 comment body, diff hunk, path/line, reply chain

부모 대화 전문을 읽을 수 없더라도 멈추지 않는다. 대신 PR diff, commit history, local context 파일로 작업 내역을 재구성하고 “부모 session 확인 불가”를 최종 보고에 남긴다.

### 2. Comment Triage

각 리뷰를 분류한다.

| 분류 | 의미 | 대응 |
|---|---|---|
| 코드 수정 필요 | 실제 결함/회귀/누락 | 근본 원인 파악 → 코드 수정 → 커밋 |
| 테스트/검증 부족 | 구현은 맞지만 증거 부족 | 테스트/검증 추가 또는 evidence 코멘트 |
| 설명 필요 | 코드 변경보다 설계 근거 필요 | 근거를 확인해 스레드 답글 |
| 부정확/이미 해결 | 리뷰가 stale이거나 잘못된 지적 | 파일/커밋/검증 근거로 코멘트 |
| 사용자 판단 필요 | product/UX/security/PII/비즈니스 정책 결정 | 선택지와 tradeoff를 짧게 묻고 멈춤 |

Severity badge가 있어도 맹목적으로 따르지 않는다. `Must_Fix`/`Should_Fix`도 실제 코드와 요구사항을 읽고 판단한다.

### 3. Root-cause Response Rule

표면 대응 금지:

- 단순히 리뷰 문구에 맞춰 class/조건만 바꾸지 않는다.
- 해당 코드가 왜 그런 상태가 됐는지, 같은 패턴이 주변에도 있는지 확인한다.
- 변경이 실제 사용자 행동/데이터/권한/viewport/상태 전이에 미치는 영향을 확인한다.
- “답글만 달기”도 근거 파일, 커밋, 테스트, API/문서 링크 같은 evidence가 있어야 한다.

수정할 게 없으면 변경하지 않는다. 기본 모드에서는 해당 thread에 근거를 코멘트로 남기고, `push-only` 모드에서는 같은 내용을 수동 게시용 초안으로 남긴다.

### 4. Plan Gate

사용자가 특정 코멘트에 대해 “대응해줘/해줘”라고 명시했다면 일반적인 코드 수정·검증·답글까지 승인된 것으로 본다. 단, `--push-only`가 있으면 답글 게시 승인은 포함하지 않고 초안 작성까지만 승인된 것으로 본다.

다만 아래는 반드시 사용자 확인 후 진행한다.

- 리뷰 대응 방향이 여러 개이고 product/UX 판단이 갈린다.
- 보안/결제/PII/DB write/외부 side effect가 있다.
- 리뷰어 의견을 반박해야 하는데 조직적/정책적 판단이 필요하다.
- 여러 thread를 하나의 큰 리팩터로 묶어야 한다.

### 5. Implement

- 관련 파일을 읽고 최소 변경으로 수정한다.
- 같은 원인의 여러 thread는 하나의 coherent commit으로 묶을 수 있다.
- unrelated cleanup은 하지 않는다.
- generated file이 필요하면 프로젝트 규칙에 맞는 codegen/schema 명령을 사용한다.

### 6. Verify

변경 범위에 맞는 검증을 실행한다.

- typecheck/lint/test/build 중 관련 명령
- UI/viewport/event라면 캡처 또는 명확한 local evidence
- API/BE라면 테스트, 쿼리 결과, schema/typecheck, 또는 요청/응답 evidence

실패하면 전체 에러를 읽고 근본 원인을 분류한다.

- 현재 변경이 만든 실패면 수정 후 재검증
- unrelated baseline 실패면 근거와 영향을 보고하고, 현재 변경 검증 가능 범위를 따로 제시

### 7. Commit + Push

리뷰 대응 단위로 커밋한다.

```bash
git status --short
git diff --check
git add <related files>
git commit -m "fix: address PR review <summary>"
git push
```

답글에 넣을 short SHA를 기록한다.

### 8. Reply to Review Conversation or Draft

기본 모드에서는 각 thread의 **해당 conversation**에 답글을 단다. 전체 PR comment 하나로 여러 line thread를 대체하지 않는다.

`push-only` 모드에서는 GitHub에 답글을 달지 않는다. 대신 아래 형식을 바탕으로 수동 게시용 초안을 최종 응답에 포함한다. 초안에는 commit SHA, 근본 원인, 대응, 검증을 포함하되 “반영 완료”처럼 게시 사실을 암시하는 표현은 사용자가 실제 게시하기 전까지 조심한다.

코드 수정 답글:

```markdown
반영 완료 (`<SHORT_SHA>`):

- 근본 원인: <왜 문제가 생겼는지>
- 대응: <무엇을 바꿨는지>
- 검증: `<command>` / <evidence>

스레드 resolve는 리뷰어/작성자 판단에 맡기겠습니다.
```

수정할 게 없는 답글:

```markdown
확인 결과 코드 변경은 하지 않았습니다.

- 근거: <파일/라인/커밋/테스트/문서>
- 판단: <왜 현재 동작이 맞는지 또는 이미 해결됐는지>

필요하면 대안 방향을 다시 맞추겠습니다.
```

질문/설명 답글:

```markdown
확인했습니다.

- 배경: <작업 맥락>
- 판단: <왜 이 설계/구현인지>
- 추가 대응 여부: <없음 또는 후속 제안>
```

### 9. Re-request Review

기본 모드에서는 push와 thread 답글이 끝나면 승인되지 않은 리뷰어/팀에게 review를 재요청한다.

`push-only` 모드에서는 이 단계를 건너뛴다. 최종 보고에 `Re-request: skipped (--push-only)`라고 남긴다.

권장 흐름:

1. `latestReviews`와 `reviewRequests`를 조회한다.
2. `APPROVED` 상태가 아닌 user reviewer와 team reviewer를 target으로 삼는다.
3. target이 없으면 “재요청 대상 없음”으로 skip한다.
4. target이 있으면 GitHub requested reviewers API로 re-request한다.
5. 실패하면 실패 사유를 보고하되, 이미 수행한 코드 수정/답글을 되돌리지 않는다.

수동 명령이 필요하면 `/github:pr-review-re-request`를 사용할 수 있다.

## GitHub API Guidance

- 댓글 조회: `gh api repos/<owner>/<repo>/pulls/comments/<comment_id>`
- thread 목록: GraphQL `pullRequest.reviewThreads`
- 답글 작성: `gh api repos/<owner>/<repo>/pulls/<pr>/comments/<comment_id>/replies --method POST -f body=...`
- review re-request: `gh api --method POST repos/<owner>/<repo>/pulls/<pr>/requested_reviewers -f reviewers[]=<login>` 또는 `team_reviewers[]=<slug>`
- `resolveReviewThread`, `unresolveReviewThread` mutation은 사용자 명시 승인 없이는 사용하지 않는다.

## Final Report

최종 응답은 짧게:

```markdown
완료했습니다.
- PR/comment: <url>
- 대응: <수정/근거 코멘트/근거 초안/보류>
- 커밋: `<sha>` <message>
- Push: <branch>
- 모드: <full-response | push-only>
- 답글: <thread reply url | skipped (--push-only)>
- 코멘트 초안: <push-only일 때 수동 게시용 markdown>
- Re-request: <targets | skipped reason | failed reason>
- 검증: <command> ✅ / ⚠️ <reason>
- 하지 않은 것: <resolve/merge | push-only면 comment/re-request/resolve/merge>는 수행하지 않음
```

## Red Flags

- 리뷰 문구만 맞추고 실제 원인을 확인하지 않음
- comment URL이 있는데 전체 PR comment로만 답변
- commit SHA 없는 “반영했습니다” 답글
- 검증 없이 push/comment
- 사용자가 요청하지 않은 thread resolve/unresolve
- `--push-only`인데 GitHub comment/re-request 실행
- reviewer가 처리한 상태를 되돌림
