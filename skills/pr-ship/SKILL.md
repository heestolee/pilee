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
- 기본 모드: 해당 review conversation에 관련 커밋 링크 또는 근거가 포함된 답글 작성
- 기본 모드: 답글 후 승인되지 않은 리뷰어에게 review re-request
- `--push-only` 모드: GitHub 코멘트/re-request 없이 수동 게시용 답글 초안을 세션에 작성

AI가 사용자 명시 승인 없이 하면 안 되는 것:

- review thread `resolve` / `unresolve`
- merge, auto-merge, merge queue
- reviewer가 이미 바꾼 상태 되돌리기
- force push, amend, history rewrite

`resolve`/`unresolve`는 “사용자가 지금 이 동작을 해달라”고 명시한 경우에만 별도 단계로 수행한다. 답글에는 `resolve`를 하지 않았다는 당연한 문구를 반복하지 않는다. 반대로 review re-request는 `pr-ship` 기본 모드의 마무리 동작이다. 단, 승인되지 않은 리뷰어/팀이 없으면 skip하고, API 실패 시 실패 사유를 보고한다. `--push-only` 모드에서는 GitHub 코멘트와 review re-request를 모두 수행하지 않는다.

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

가정 리스크(`SSR 가능성`, `미래에 깨질 수 있음`, `이론상 안전하지 않음`, `프리렌더/테스트 환경에서 문제 가능`)를 지적하는 리뷰는 hard gate로 막지 않는다. 다만 방어 코드를 바로 추가하기 전에 현재 앱의 실제 consumer path, runtime/build mode, 요구사항에 그 리스크가 존재하는지 좁게 확인한다. 현재 경로와 요구사항에 없는 리스크라면 “수정 없음 + 근거 코멘트”를 우선 후보로 두고, 이미 취약한 shared boundary이거나 변경 비용 대비 안전성이 명확할 때만 작은 보강을 선택한다.

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
- 가능하면 리뷰 코멘트/thread 단위로 커밋을 쪼갠다. 답글만 봐도 어떤 작업인지 알 수 있도록 commit message가 코멘트의 해결 내용을 드러내야 한다.
- 같은 원인의 여러 thread만 하나의 coherent commit으로 묶을 수 있다. 이 경우 답글에서 해당 커밋이 어떤 thread들을 함께 닫는지 짧게 설명한다.
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

리뷰 대응 단위로 커밋한다. 기본은 “코멘트 1개 = 커밋 1개”이며, 같은 원인의 thread만 묶는다.

```bash
git status --short
git diff --check
git add <related files>
git commit -m "fix: address PR review <summary>"
git push
```

답글에 넣을 commit URL과 commit message를 기록한다. 답글에서는 raw SHA만 쓰지 말고 `[커밋메시지](https://github.com/<owner>/<repo>/commit/<sha>)` 형태로 링크한다.

### 8. Reply to Review Conversation or Draft

기본 모드에서는 각 thread의 **해당 conversation**에 답글을 단다. 전체 PR comment 하나로 여러 line thread를 대체하지 않는다.

답글 payload는 파일 경로 literal이 GitHub에 올라가지 않도록 안전하게 전송한다.

- `gh api ... -f body=@/tmp/reply.md`처럼 `@file`을 `body` 값으로 넘기지 않는다. 이 경로는 환경/버전에 따라 파일 확장이 아니라 문자열 `@/tmp/reply.md` 그대로 게시될 수 있다.
- 임시 파일을 쓰더라도 전송 전에는 반드시 실제 문자열로 읽거나 JSON stdin으로 보낸다.
- 권장 방식:

```bash
body="$(cat /tmp/reply.md)"
jq -n --arg body "$body" '{body: $body}' \
  | gh api repos/<owner>/<repo>/pulls/<pr>/comments/<comment_id>/replies \
      --method POST \
      --input - \
      --jq '{html_url, body}'
```

- 게시/수정 직후 응답의 `.body`를 확인한다. `@/tmp/`, `/tmp/`, `reply.md`, `body=@` 같은 전송 아티팩트가 보이면 성공으로 보고하지 말고 즉시 `PATCH repos/<owner>/<repo>/pulls/comments/<reply_id>`로 실제 본문을 덮어쓴 뒤 다시 확인한다.
- 최종 보고의 답글 URL은 body 검증이 끝난 뒤에만 적는다.

`push-only` 모드에서는 GitHub에 답글을 달지 않는다. 대신 아래 형식을 바탕으로 수동 게시용 초안을 최종 응답에 포함한다. 초안에는 commit 링크, 근본 원인, 대응, 검증을 포함하되 “반영 완료”처럼 게시 사실을 암시하는 표현은 사용자가 실제 게시하기 전까지 조심한다.

코드 수정 답글:

```markdown
반영했습니다: [<커밋메시지>](<COMMIT_URL>)

- 근본 원인: <왜 문제가 생겼는지>
- 대응: <무엇을 바꿨는지>
- 검증: 관련 unit test / lint / build 통과
```

검증은 기본적으로 요약한다. 긴 명령어 나열은 코멘트 노이즈가 되므로 피하고, reviewer가 재현 명령을 요청했거나 실패 원인 구분에 명령 자체가 중요한 경우에만 접힌 세부 목록이나 짧은 명령 1~2개로 제한한다. 답글에 “스레드 resolve는 리뷰어/작성자 판단” 같은 당연한 문구를 넣지 않는다.

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
- 답글 작성: `jq -n --arg body "$body" '{body: $body}' | gh api repos/<owner>/<repo>/pulls/<pr>/comments/<comment_id>/replies --method POST --input - --jq '{id, html_url, body}'`
- 답글 수정: `jq -n --arg body "$body" '{body: $body}' | gh api repos/<owner>/<repo>/pulls/comments/<reply_id> --method PATCH --input - --jq '{html_url, body}'`
- review re-request: `gh api --method POST repos/<owner>/<repo>/pulls/<pr>/requested_reviewers -f reviewers[]=<login>` 또는 `team_reviewers[]=<slug>`
- `resolveReviewThread`, `unresolveReviewThread` mutation은 사용자 명시 승인 없이는 사용하지 않는다.

## Final Report

최종 응답은 짧게 쓰되, 결과 나열에서 끝내지 말고 반드시 `리뷰 대응 평가`를 함께 포함한다. 사용자가 궁금해하는 핵심은 “무엇을 했는가”뿐 아니라 “그 리뷰가 대응할 만했는가, 대응이 과하지 않았는가”다.

```markdown
완료했습니다.
- PR/comment: <url>
- 대응: <수정/근거 코멘트/근거 초안/보류>
- 커밋: `[<message>](<commit-url>)`
- Push: <branch>
- 모드: <full-response | push-only>
- 답글: <thread reply url | skipped (--push-only)>
- 코멘트 초안: <push-only일 때 수동 게시용 markdown>
- Re-request: <targets | skipped reason | failed reason>
- 검증: <요약> ✅ / ⚠️ <reason>
- 하지 않은 것: <merge/force-push | push-only면 comment/re-request/merge>는 수행하지 않음

## 리뷰 대응 평가

판정: <대응이 필요한 리뷰였는지 + 전체 대응이 과하지 않았는지 한 문장>
<있다면> 다만 <실행상 아쉬움/남은 리스크 1~2개>는 남았습니다.

| 리뷰 | 대응 필요성 | 평가 |
|---|---|---|
| <리뷰 요약> | <높음/중간/낮음> | <왜 대응/비대응이 적절했는지> |

### 과하지 않았나?
- 변경량: <파일 수/diff 규모/표면 fan-out>
- 커밋 분리: <코멘트별 분리 또는 같은 원인으로 묶은 근거>
- 범위 판단: <리뷰 요구보다 넓어진 부분이 있다면 이유와 적절성>

### 아쉬운 점
1. <실행 중 실수, 검증 누락, 답글 게시 실수, 과하게 넓은 변경 등>
2. <없으면 “특별한 아쉬움 없음”>

### 남은 후속 후보
- <선택적 개선 후보. 지금 PR을 막지 않는 이유도 함께>
```

평가 작성 규칙:

- 각 리뷰를 `높음/중간/낮음` 같은 대응 필요성으로 분류한다.
- `Should_Fix`/`Nice_To_Have` 배지를 그대로 반복하지 말고, 실제 코드·제품 요구·운영 리스크 기준으로 판단한다.
- “과하지 않았나?”에는 파일 수, 레이어/표면 fan-out, 커밋 분리 기준, 변경이 리뷰 요구보다 넓어진 이유를 포함한다.
- 실행 중 실수도 숨기지 않는다. 예: 잘못 게시한 답글을 PATCH로 고친 경우, 최종 상태가 정상이어도 아쉬운 점에 기록한다.
- 후속 후보는 현재 PR을 막는 잔여 결함과 구분한다. 지금 막지 않는 이유가 있으면 함께 쓴다.

## Red Flags

- 리뷰 문구만 맞추고 실제 원인을 확인하지 않음
- comment URL이 있는데 전체 PR comment로만 답변
- commit message 링크 없는 raw SHA만 있는 “반영했습니다” 답글
- `@/tmp/reply.md`, `body=@...`, `/tmp/...` 같은 파일 경로 literal이 GitHub 답글 본문에 남았는데 성공으로 보고
- 검증 없이 push/comment
- 사용자가 요청하지 않은 thread resolve/unresolve
- `--push-only`인데 GitHub comment/re-request 실행
- reviewer가 처리한 상태를 되돌림
