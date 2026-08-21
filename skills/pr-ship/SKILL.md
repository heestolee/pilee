---
name: pr-ship
description: 열린 PR에서 trusted profile이 allowlist로 지정한 자동 리뷰어 코멘트만 근본 대응해 코드 수정·검증·커밋·푸시·해당 스레드 답글·그 자동 리뷰어 re-request까지 수행할 때 사용한다. 인간/미확인 리뷰어는 읽기와 로컬 분석·보고만 하며 코드나 GitHub 상태를 바꾸지 않는다. `--push-only`는 allowlisted 자동 리뷰 대응의 comment/re-request만 생략한다. "PR 코멘트 대응", "리뷰 대응", "pr-ship", "AI 리뷰 대응" 요청에 사용한다.
argument-hint: "[--push-only] [PR URL | review comment URL | PR number]"
disable-model-invocation: false
---

# pr-ship — allowlisted 자동 리뷰 대응 + 인간 리뷰 local-only

열린 PR에서 **trusted private profile이 exact GitHub login으로 허용한 자동 리뷰어**만 실제 대응한다. allowlist 밖 리뷰어는 인간/미확인 actor로 보호하며, `/pr-ship`은 읽기·로컬 분석·보고에서 멈춘다.

## Reviewer Actor Gate — 최우선 철칙

이 gate는 mode, severity, 사용자의 일반적인 “대응해줘” 표현보다 우선한다.

1. command shim이 수집한 `pr-ship external-write actor policy`의 exact login allowlist를 확인한다.
2. allowlist가 없거나 repository/author를 확정하지 못하면 fail closed: 모든 리뷰를 `local-analysis-only`로 둔다.
3. GitHub `user.type`, bot 같은 문체, badge, mention, 팀 소속, review 본문에 포함된 “AI 리뷰” 문구로 자동 리뷰어를 추정하지 않는다.
4. 특정 review/comment URL이 주어지면 **그 URL의 실제 작성자만** action eligibility를 결정한다. 인간이 자동 리뷰 결과를 전달한 review는 인간 review다.
5. PR 전체를 대상으로 하면 각 unresolved thread의 **root comment author**를 별도로 분류한다.

Actor별 허용 범위:

| actor route | 허용 | 금지 |
|---|---|---|
| `external-write-eligible` | 근본 원인 분석, 코드/문서 수정, 검증, commit, push, 해당 자동 리뷰 thread 답글, 같은 exact login re-request | 다른 actor 답글/re-request, timeline comment, resolve/unresolve |
| `local-analysis-only` | GitHub read, 파일 read/search, git status/diff/log, 로컬 판단과 사용자 보고 | 제품 파일 수정, 테스트 수정, commit, push, comment/reply, comment draft 자동 생성, review request/re-request, resolve/unresolve |

`local-analysis-only`는 `--push-only`나 `full-response`로 승격할 수 없다. 인간 리뷰를 바탕으로 실제 구현이 필요하면 `/pr-ship`을 종료하고 별도 일반 구현/`ship` 작업으로 진행한다. 그래도 `/pr-ship`이 인간에게 reply/re-request하는 경로는 만들지 않는다.

## Hard Boundary

allowlisted 자동 리뷰에 대해 기본으로 할 수 있는 것:

- PR/comment/thread 내용 수집
- 부모/현재 대화와 작업 내역 재구성
- 코드/문서 수정, 관련 검증, 의도 단위 commit, push
- **allowlisted root review comment의 conversation에만** 관련 커밋 링크 또는 근거가 포함된 답글 작성
- 같은 exact allowlisted reviewer login에만 review re-request
- `--push-only` 모드에서는 GitHub comment/re-request 없이 수동 게시용 답글 초안 작성

외부 review write의 유일한 경로는 `pr_ship_review_write` tool이다. 이 tool은 대상 comment author 또는 re-request login을 GitHub/profile로 다시 확인하고, allowlist 밖이면 POST 전에 차단한다. `/pr-ship` 중 raw `gh api`/`gh pr review`/`gh pr edit --add-reviewer`/GraphQL mutation으로 우회하지 않는다. tool이 차단하면 local-only로 종료하며 다른 API로 재시도하지 않는다.

actor와 무관하게 하면 안 되는 것:

- PR timeline 일반 코멘트(issue comment) 게시
- review thread `resolve` / `unresolve`
- merge, auto-merge, merge queue
- reviewer가 이미 바꾼 상태 되돌리기
- 사용자 선택, frame/decision, 의도적 revert/refactor/code-refine, 이미 수용한 review response를 근거 없이 되돌리거나 되살리기
- force push, amend, history rewrite
- 잘못된 위치의 코멘트를 delete/repost/PATCH로 옮기기

`--push-only`에서는 allowlisted 자동 리뷰에 대한 GitHub comment와 review re-request도 수행하지 않는다.

## Input Forms

- `/pr-ship` — 현재 branch의 PR unresolved review comments 수집 후 대응
- `/pr-ship <PR URL>` — 특정 PR의 unresolved review comments 대응
- `/pr-ship <review comment URL>` — 특정 comment/thread 우선 대응
- `/pr-ship --push-only [PR URL | review comment URL | PR number]` — 코드 수정·검증·커밋·푸시까지만 수행하고, 코멘트는 수동 게시용 초안만 작성
- 자연어: “이거 대응작업-커밋-푸시-코멘트까지 해줘”

## Workflow

### 0. Mode Selection

actor gate를 먼저 적용한 뒤 mode를 정한다.

- `external-write-eligible + full-response`: 수정/검증 → commit → push → allowlisted thread 답글 → 같은 allowlisted login re-request
- `external-write-eligible + push-only`: 수정/검증 → commit → push → 세션에 수동 게시용 답글 초안
- `local-analysis-only`: 읽기/분석/보고 후 종료. 플래그와 무관하게 수정·commit·push·draft·GitHub write 없음

`--push-only`, `--no-comment`, `--draft-only`, `--manual-comment` 플래그는 **allowlisted 자동 리뷰에만** 적용한다. `push-only`에서는 GitHub review comment/reply, `requested_reviewers`, resolve/unresolve를 실행하지 않고 polished draft를 최종 응답에 포함한다.

특정 review/comment URL의 actor가 local-only면 다른 unresolved 자동 리뷰 thread를 대신 처리하지 않는다. PR URL이나 인자 없는 PR-wide 실행에서만 thread별 routing을 적용한다.

### 1. Context Reconstruction

먼저 작업 맥락을 복원한다. 특히 fork/child panel에서 시작한 경우 부모 세션을 확인한다.

확인 대상:

- 현재 session file과, 있으면 parent session file (`PI_FORK_PARENT` 또는 command shim이 준 경로)
- `.context/work/**/context.md`, `.pi/worktree-meta.json`, frame/verify/archive transcript
- `git status --short --branch`
- 대응 시작 시점의 `pre-response HEAD`
- `git log --oneline --decorate origin/<base>..HEAD` 또는 PR commit list
- PR body, changed files, 기존 agent 답글, unresolved review comments
- 명시적인 사용자/TUI 선택, frame decisions, work context의 must-keep/must-not, 의도적 revert/refactor/code-refine commit과 그 근거
- 각 thread의 root comment author와 command shim의 actor route
- 특정 review/comment URL이 주어졌다면 해당 target의 실제 author, body, state/diff hunk, path/line, reply chain

actor 조회 실패는 local-only다. 부모 대화 전문을 읽을 수 없더라도 분석은 계속할 수 있지만, PR diff/commit/local context로 재구성하고 “부모 session 확인 불가”를 최종 보고에 남긴다.

### 1.1 Decision Preservation Gate — 기존 결정 회귀 방지

리뷰 코멘트는 새 입력이지만, 이미 확정된 사용자 선택이나 검증된 대응보다 자동으로 우선하지 않는다. 수정 전에 아래 절차로 **protected decision ledger**를 만든다.

1. `pre-response HEAD`를 기록한다.
2. 현재/부모 대화, frame/decision/work context, 최근 의도적 revert·refactor·code-refine commit, 같은 PR의 기존 답글·대응 commit에서 명시적인 결정만 수집한다.
3. 각 항목에 `결정`, `근거 locator`, `보호할 동작·타입·구조`, `허용되는 확장 범위`를 적는다.
4. 오래된 transcript의 추정, status note, 현재 코드와 충돌하는 요약은 결정으로 승격하지 않는다.

각 allowlisted 리뷰를 다음 중 하나로 분류한다.

| 결정 관계 | 의미 | 대응 |
|---|---|---|
| `compatible` | 기존 결정을 보존한 채 수정 가능 | 가장 작은 호환 수정 진행 |
| `stale/reintroduction` | 리뷰가 의도적으로 제거·원복·다이어트한 상태를 다시 요구 | 코드 변경 없이 현재 근거로 답글 |
| `conflict` | 유효한 수정이 기존 결정을 뒤집거나 이미 해결한 대응을 원복 | 편집 전에 충돌과 tradeoff를 사용자에게 질문 |
| `superseding evidence` | 새로 검증된 사실이 기존 결정의 전제를 깨뜨림 | 보존 가능한 대안을 먼저 찾고, 없으면 새 근거와 함께 재결정 요청 |

리뷰 severity와 자동 리뷰어 신뢰도는 기존 결정을 뒤집는 승인으로 취급하지 않는다. 보존 가능한 대안이 있으면 그 대안을 사용한다. 모든 유효한 해법이 보호 결정을 바꿔야 한다면 사용자 확인 전에는 edit/commit/push/reply를 진행하지 않는다. 반대로 더 최신의 명시적 사용자 선택이나 검증된 사실이 있으면 오래된 결정을 무조건 고정하지 않고 ledger의 supersession 근거를 갱신한다.

부모 session이나 decision artifact를 읽을 수 없으면 현재 tree, 최근 commit, 기존 review reply에서 복원한 범위만 보호하고 그 coverage gap을 최종 보고에 남긴다. 보호 결정을 추측해서 만들지 않는다.

### 2. Comment Triage

먼저 actor별 queue를 분리한다.

- `action queue`: allowlisted root author의 review/thread만 포함
- `local analysis queue`: 인간/미확인 review/thread. 분석 결과만 보고하고 이후 Implement/Commit/Reply/Re-request 단계로 넘기지 않음

그다음 action queue의 각 리뷰를 분류한다.

| 분류 | 의미 | 대응 |
|---|---|---|
| 코드 수정 필요 | 실제 결함/회귀/누락 | 근본 원인 파악 → 코드 수정 → 커밋 |
| 테스트/검증 부족 | 구현은 맞지만 증거 부족 | 테스트/검증 추가 또는 evidence 코멘트 |
| 설명 필요 | 코드 변경보다 설계 근거 필요 | 근거를 확인해 스레드 답글 |
| 부정확/이미 해결 | 리뷰가 stale이거나 잘못된 지적 | 파일/커밋/검증 근거로 코멘트 |
| 기존 결정과 충돌 | 수정 시 protected decision 또는 기존 대응을 되돌림 | Decision Preservation Gate로 보내 사용자 재결정 전 정지 |
| 사용자 판단 필요 | product/UX/security/PII/비즈니스 정책 결정 | 선택지와 tradeoff를 짧게 묻고 멈춤 |

Severity badge가 있어도 맹목적으로 따르지 않는다. `Must_Fix`/`Should_Fix`도 실제 코드와 요구사항을 읽고 판단한다.

가정 리스크(`SSR 가능성`, `미래에 깨질 수 있음`, `이론상 안전하지 않음`, `프리렌더/테스트 환경에서 문제 가능`)를 지적하는 리뷰는 hard gate로 막지 않는다. 다만 방어 코드를 바로 추가하기 전에 현재 앱의 실제 consumer path, runtime/build mode, 요구사항에 그 리스크가 존재하는지 좁게 확인한다. 현재 경로와 요구사항에 없는 리스크라면 “수정 없음 + 근거 코멘트”를 우선 후보로 두고, 이미 취약한 shared boundary이거나 변경 비용 대비 안전성이 명확할 때만 작은 보강을 선택한다.

### 3. Root-cause Response Rule

표면 대응 금지:

- 단순히 리뷰 문구에 맞춰 class/조건만 바꾸지 않는다.
- 해당 코드가 왜 그런 상태가 됐는지, 같은 패턴이 주변에도 있는지 확인한다.
- 변경이 실제 사용자 행동/데이터/권한/viewport/상태 전이에 미치는 영향을 확인한다.
- “답글만 달기”도 근거 파일, 커밋, 테스트, API/문서 링크 같은 evidence가 있어야 한다.

수정할 게 없으면 변경하지 않는다. allowlisted 자동 리뷰의 기본 모드에서만 해당 thread에 근거를 남기고, allowlisted `push-only`에서만 수동 게시용 초안을 남긴다. 인간/미확인 리뷰는 근거를 사용자에게 로컬 보고할 뿐 답글/초안을 만들지 않는다.

### 4. Plan Gate

사용자가 **allowlisted 자동 리뷰** 코멘트에 대해 “대응해줘/해줘”라고 명시했다면 일반적인 코드 수정·검증·답글까지 승인된 것으로 본다. 단, `--push-only`가 있으면 답글 게시 승인은 포함하지 않고 초안 작성까지만 승인된 것으로 본다.

인간/미확인 코멘트에 대한 동일 표현은 local analysis 승인일 뿐이다. `/pr-ship` 안에서 코드 수정·commit·push·reply/re-request 승인으로 해석하지 않는다.

다만 아래는 반드시 사용자 확인 후 진행한다.

- 리뷰 대응 방향이 여러 개이고 product/UX 판단이 갈린다.
- 보안/결제/PII/DB write/외부 side effect가 있다.
- 리뷰어 의견을 반박해야 하는데 조직적/정책적 판단이 필요하다.
- 여러 thread를 하나의 큰 리팩터로 묶어야 한다.
- 리뷰 대응이 protected decision, 사용자 선택, 의도적 revert/refactor/code-refine, 기존 review response를 되돌려야 한다.

### 5. Implement

이 단계에는 action queue의 allowlisted 자동 리뷰만 들어올 수 있다. local analysis queue만 있으면 이 단계와 이후 write 단계를 전부 건너뛴다.

- allowlisted review와 직접 연결된 관련 파일만 읽고 최소 변경으로 수정한다.
- 편집 전에 protected decision ledger에서 이번 변경이 보존해야 할 항목을 짧게 고정한다. subagent/worker를 쓰면 같은 목록을 task brief에 전달한다.
- 제거한 코드·타입 ceremony·helper·optional/nullable·fixture assertion·구조를 리뷰 문구만 근거로 되살리지 않는다. 필요하면 `conflict` 또는 `superseding evidence`로 다시 분류한다.
- 인간 리뷰에서만 발견된 항목은 같은 PR에 있더라도 수정 근거로 사용하지 않는다. 사용자에게 local finding으로만 보고한다.
- 가능하면 allowlisted 리뷰 코멘트/thread 단위로 커밋을 쪼갠다. 답글만 봐도 어떤 작업인지 알 수 있도록 commit message가 해결 내용을 드러내야 한다.
- 같은 원인의 여러 **allowlisted** thread만 하나의 coherent commit으로 묶을 수 있다.
- unrelated cleanup은 하지 않는다.
- generated file이 필요하면 프로젝트 규칙에 맞는 codegen/schema 명령을 사용한다.

### 6. Verify

변경 범위에 맞는 검증을 실행한다.

- typecheck/lint/test/build 중 관련 명령
- UI/viewport/event라면 캡처 또는 명확한 local evidence
- API/BE라면 테스트, 쿼리 결과, schema/typecheck, 또는 요청/응답 evidence

#### Decision Regression Audit

commit/push 전에 review-response 범위의 `pre-response HEAD` 대비 diff를 읽고 다음을 확인한다.

- protected decision ledger의 각 항목이 그대로 보존됐는가?
- 이미 제거·원복·다이어트한 코드나 테스트가 다시 들어오지 않았는가?
- 같은 PR의 이전 review response를 새 대응이 무효화하지 않았는가?
- 의도적인 결정 변경이 있다면 새 근거와 사용자 승인이 기록됐는가?

하나라도 닫히지 않으면 commit으로 넘기지 않는다. 검증 결과는 최종 보고의 `기존 결정 보존`과 `의도적 결정 변경`에 요약한다.

실패하면 전체 에러를 읽고 근본 원인을 분류한다.

- 현재 변경이 만든 실패면 수정 후 재검증
- unrelated baseline 실패면 근거와 영향을 보고하고, 현재 변경 검증 가능 범위를 따로 제시

### 7. Commit + Push

action queue에 실제 수정이 있을 때만 리뷰 대응 단위로 커밋한다. 기본은 “allowlisted 코멘트 1개 = 커밋 1개”이며, 같은 원인의 allowlisted thread만 묶는다. local analysis queue 때문에 commit/push하지 않는다.

```bash
git status --short
git diff --check
git add <related files>
git commit -m "fix: address PR review <summary>"
git push
```

답글에 넣을 commit URL과 commit message를 기록한다. 답글에서는 raw SHA만 쓰지 말고 `[커밋메시지](https://github.com/<owner>/<repo>/commit/<sha>)` 형태로 링크한다.

### 8. Reply to Review Conversation or Draft

#### 8.1 Comment Placement + Actor Gate

외부 게시가 허용되는 surface는 `review_thread_reply` 하나뿐이다. 다음 조건을 모두 만족해야 한다.

1. action queue의 allowlisted 자동 리뷰 thread다.
2. target comment 자체의 author가 exact allowlist에 있다.
3. 이번 대응이 그 conversation을 직접 닫는다.
4. `pr_ship_review_write action=reply`가 게시 직전 author를 다시 확인해 허용한다.

그 외는 모두 GitHub 게시 금지다.

| Surface | 처리 |
|---|---|
| allowlisted `review_thread_reply` | guarded tool로만 게시 |
| allowlisted `draft_only` (`--push-only` 또는 thread 없음) | 세션에 수동 초안만 제공 |
| 인간/미확인 review/comment | local analysis report만 제공. 답글·초안 없음 |
| `pr_timeline_comment` | `/pr-ship`에서는 항상 금지. 필요하면 별도 workflow로 명시 요청 |

특정 review summary URL은 inline comment가 아니므로 thread reply surface가 없다. author가 allowlisted여도 분석/수정 후 게시 위치를 임의로 만들지 않고 `draft_only`로 둔다. 특정 URL의 author가 local-only면 전체 invocation을 local-only로 끝낸다.

#### 8.2 Guarded One-shot Publication Rule

POST 전에 다음을 완료한다.

1. target comment URL/id와 root author를 기록한다.
2. 답글 본문에 commit link, 근본 원인, 대응, 검증이 있는지 로컬에서 확인한다.
3. `pr_ship_review_write`에 `action=reply`, `repository`, `pullNumber`, `commentId`, 실제 본문 문자열을 전달한다.
4. tool이 author를 재조회하거나 response body를 검증하지 못하면 게시 실패로 처리한다.
5. tool이 인간/미확인 actor로 차단하면 raw `gh`, REST, GraphQL, 다른 comment surface로 우회하지 않는다.

임시 파일 경로를 body로 넘기지 않는다. `@/tmp/...`, `body=@...`, `/tmp/...` literal이 본문에 들어가지 않도록 tool에는 파일 경로가 아니라 실제 본문 문자열을 전달한다. 게시 후 tool result의 URL/body 검증이 끝난 뒤에만 성공으로 보고한다. 잘못 게시했으면 위치를 옮기기 위한 delete/repost/PATCH를 하지 않고 즉시 사용자에게 보고한다.

allowlisted `push-only`/`draft_only`에서만 아래 수동 초안을 사용할 수 있다.

코드 수정 답글:

```markdown
반영했습니다: [<커밋메시지>](<COMMIT_URL>)

- 근본 원인: <왜 문제가 생겼는지>
- 대응: <무엇을 바꿨는지>
- 검증: 관련 unit test / lint / build 통과
```

검증은 기본적으로 요약한다. 긴 명령어 나열은 피하고 재현 명령 자체가 중요한 경우에만 짧게 적는다.

수정할 게 없는 답글:

```markdown
확인 결과 코드 변경은 하지 않았습니다.

- 근거: <파일/라인/커밋/테스트/문서>
- 판단: <왜 현재 동작이 맞는지 또는 이미 해결됐는지>
```

### 9. Re-request Review

allowlisted 자동 리뷰에 대한 `full-response`에서만, push와 허용된 thread 답글이 끝난 뒤 **그 same exact login 하나만** re-request한다.

1. 대상 login이 command shim policy allowlist에 있는지 확인한다.
2. team reviewer와 allowlist 밖 user reviewer는 후보에서 제외한다.
3. `pr_ship_review_write action=rerequest`로 exact login 하나만 요청한다.
4. tool이 차단하면 다른 API나 `/github:pr-review-re-request`로 우회하지 않는다.
5. `push-only`, local-only, 이미 approved, 또는 대상 없음이면 skip 사유를 보고한다.

인간 reviewer의 review state가 `CHANGES_REQUESTED`여도 re-request하지 않는다. 인간 review request를 추가·제거·복구하지 않는다.

### 10. Frame v2 learning companion — 조건부 review checkpoint

현재 worktree의 `.pi/learning-companion.json`이 있을 때만 리뷰 대응 묶음이 끝난 뒤 학습 기록을 추가한다.

- 대응이 필요했던 리뷰: `review_applied` event에 review URL, 대응 commit, 검증 evidence를 기록한다.
- 코드 변경이 불필요했던 리뷰: `review_received` event에 왜 변경하지 않았는지 판단만 기록한다.
- 한 번의 대응 묶음마다 `review-round` checkpoint는 최대 하나만 만든다.
- 리뷰에서 더 나은 방향을 발견했지만 현재 대응에 바로 넣지 않으면 `learning_companion action=propose`로 남긴다. 제안만으로 task/frame/code를 바꾸지 않는다.
- companion 기록 실패·누락은 이미 성공한 수정, push, thread reply, re-request를 실패로 바꾸거나 되돌리지 않는다.
- 이 로컬 학습 기록을 PR timeline 일반 코멘트로 자동 게시하지 않는다.

## GitHub Tool Guidance

읽기에는 `gh`를 사용할 수 있다.

- comment author/body 조회: `gh api repos/<owner>/<repo>/pulls/comments/<comment_id>`
- review summary author/body 조회: `gh api repos/<owner>/<repo>/pulls/<pr>/reviews/<review_id>`
- thread 목록: GraphQL `pullRequest.reviewThreads`

쓰기에는 raw `gh`/REST/GraphQL을 사용하지 않는다.

- allowlisted thread 답글: `pr_ship_review_write action=reply`
- same allowlisted login re-request: `pr_ship_review_write action=rerequest`
- 인간/미확인 comment/reviewer, team reviewer, timeline comment, resolve/unresolve: 지원하지 않으며 항상 차단/skip

## Final Report

최종 응답은 짧게 쓰되, 결과 나열에서 끝내지 말고 반드시 `리뷰 대응 평가`를 함께 포함한다. 사용자가 궁금해하는 핵심은 “무엇을 했는가”뿐 아니라 “그 리뷰가 대응할 만했는가, 대응이 과하지 않았는가”다.

```markdown
완료했습니다.
- PR/comment: <url>
- Actor routing: <author → external-write-eligible | local-analysis-only>
- 대응: <allowlisted 수정/근거 코멘트/근거 초안 | 인간 local analysis>
- 기존 결정 보존: <보존한 결정과 근거>
- 의도적 결정 변경: <없음 | 변경한 결정, 새 근거, 사용자 승인>
- 커밋: <allowlisted 변경 commit link | 없음 (local-only)>
- Push: <branch | 없음 (local-only)>
- 모드: <full-response | push-only | local-analysis-only>
- 답글: <allowlisted thread reply url | skipped reason>
- 코멘트 초안: <allowlisted push-only일 때만 markdown | 없음>
- Re-request: <allowlisted exact login | skipped reason | failed reason>
- 검증: <요약> ✅ / ⚠️ <reason>
- 인간 리뷰에 하지 않은 것: edit/commit/push/comment/re-request/resolve 전부 수행하지 않음

## 리뷰 대응 평가

판정: <대응이 필요한 리뷰였는지 + 전체 대응이 과하지 않았는지 한 문장>
<있다면> 다만 <실행상 아쉬움/남은 리스크 1~2개>는 남았습니다.

| 리뷰 | Actor route | 대응 필요성 | 평가 |
|---|---|---|---|
| <리뷰 요약> | <external-write-eligible/local-analysis-only> | <높음/중간/낮음> | <왜 대응/분석-only가 적절했는지> |

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
- 실행 중 실수도 숨기지 않는다. 특히 actor 오분류나 guarded tool 차단이 있었다면 아쉬운 점에 기록한다.
- 후속 후보는 현재 PR을 막는 잔여 결함과 구분한다. 지금 막지 않는 이유가 있으면 함께 쓴다.

## Red Flags

- allowlist 밖 인간/미확인 리뷰를 보고 코드 수정, test 수정, commit 또는 push
- 인간 review/comment에 답글·초안·review re-request
- 인간이 전달한 AI finding을 본문 내용만 보고 자동 리뷰어 review로 승격
- stale review를 따라 의도적으로 제거·원복·다이어트한 코드나 테스트를 되살림
- 리뷰 severity만 근거로 사용자 선택, frame decision, 기존 review response를 되돌림
- protected decision ledger나 `pre-response HEAD` diff audit 없이 수정·commit·push
- specific human review URL을 받은 뒤 PR의 다른 자동 리뷰 thread를 대신 처리
- raw `gh api`, `gh pr review`, `gh pr edit --add-reviewer`, GraphQL mutation으로 guarded tool 우회
- team reviewer 또는 “승인되지 않은 모든 reviewer”를 일괄 re-request
- 리뷰 문구만 맞추고 실제 원인을 확인하지 않음
- comment URL이 있는데 전체 PR comment로만 답변
- PR timeline 일반 코멘트 게시
- 잘못된 위치에 게시한 뒤 삭제/PATCH/재게시로 옮기려고 함
- 자동 리뷰가 다시 돌기 시작한 뒤 코멘트 위치를 보정하려고 GitHub 액션을 추가 수행
- commit message 링크 없는 raw SHA만 있는 “반영했습니다” 답글
- `@/tmp/reply.md`, `body=@...`, `/tmp/...` 같은 파일 경로 literal이 GitHub 답글 본문에 남았는데 성공으로 보고
- 백틱이 있는 본문을 unquoted heredoc/command substitution으로 만들어 예시 토큰이 사라진 상태로 게시
- 검증 없이 push/comment
- 사용자가 요청하지 않은 thread resolve/unresolve
- `--push-only`인데 GitHub comment/re-request 실행
- reviewer가 처리한 상태를 되돌림
- 기존 결정을 바꾸고도 최종 보고의 `의도적 결정 변경`에 새 근거와 사용자 승인을 남기지 않음
