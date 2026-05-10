---
name: ship
description: PR을 만들기 전 또는 remote에 올리기 전, 변경사항을 의도 단위로 커밋하고 lint/typecheck/test/build 같은 사전 검증을 통과시킨 뒤 push해야 할 때 사용한다. "ship 해줘", "커밋해서 푸시", "올리기 전에 검증", "push 준비" 요청에 사용한다.
argument-hint: "[branch-name]"
disable-model-invocation: false
---

# ship — PR 전 commit + verify + push

변경사항을 remote에 올리기 전에 **의도 단위 커밋**, **사전 검증**, **push**를 끝내는 workflow다. 핵심은 PR 생성이 아니라 “현재 변경이 안전하게 올라갈 수 있는 상태인가”를 증명하는 것이다.

## Scope

- 기본 동작: commit → verify → push
- PR 생성은 기본 범위가 아니다. 사용자가 PR 생성까지 명시하면 프로젝트의 PR 생성 스킬/규칙을 따른다.
- PR 리뷰 코멘트 대응은 `pr-ship`을 사용한다. `ship`은 PR 전 또는 일반 push 전 정리용이다.

## Stop Conditions

아래면 멈추고 이유를 보고한다.

- 변경사항이 없거나 push 대상 remote/branch가 불명확하다.
- unrelated dirty state가 있어 현재 요청과 섞일 위험이 있다.
- 의도 단위로 분리해도 독립적으로 이해 가능한 커밋을 만들 수 없다.
- 필수 검증이 실패하고 근본 원인을 즉시 해결할 수 없다.
- 인증/권한 문제로 push할 수 없다.
- 보안/결제/PII/데이터 삭제처럼 사용자 판단이 필요한 위험한 선택이 남아 있다.

## Workflow

### 1. Pre-flight

```bash
git status --short --branch
git diff --stat
git diff --cached --stat
git remote -v
git log --oneline --decorate -5
```

- branch 인자가 있으면 해당 branch로 전환하거나 새로 만든다.
- base/main/development 브랜치에서 직접 push하려는 상황이면 프로젝트 규칙을 확인한다. 위험하면 멈춘다.
- unrelated dirty file은 건드리지 않는다. stage는 요청과 직접 관련된 파일만 한다.

### 2. 의도 단위 커밋 계획

파일 단위가 아니라 **의도 단위**로 나눈다.

예:

- 기능 구현
- 버그 수정
- 테스트 보강
- 문서/knowledge 갱신
- generated artifact 갱신
- 포맷/기계적 정리

원칙:

- 각 커밋은 독립적으로 이해 가능해야 한다.
- 코드와 관련 테스트/문서는 가능하면 같은 커밋에 둔다.
- 리팩터링과 behavior 변경은 가능하면 분리한다.
- 단일 의도이고 분리하면 맥락이 깨지는 작은 변경은 단일 커밋을 허용한다.

### 3. 검증 계획

프로젝트 규칙과 변경 범위에 맞춰 최소 하나 이상의 관련 검증을 실행한다. 가능한 경우 아래 순서를 따른다.

1. typecheck
2. lint
3. test
4. build
5. domain-specific validation

자동 감지 우선순위:

- `package.json` scripts: `typecheck`, `check`, `lint`, `test`, `build`
- `Makefile`: `check`, `lint`, `test`, `build`
- TypeScript: `tsc --noEmit`
- Go: `go test ./...`
- Rust: `cargo check`, `cargo test`, `cargo clippy -- -D warnings`
- Python: `pytest` 또는 프로젝트 문서의 검증 명령

검증이 noop처럼 보이면 통과로 취급하지 않는다. “0 tests”, “no files matched”, “command not found” 같은 출력은 원인을 확인한다.

### 4. 구현/정리와 검증

- 필요한 자동 수정은 현재 의도와 직접 관련된 것만 허용한다.
- 자동 포맷/기계적 lint fix가 생기면 diff를 다시 확인한다.
- 검증 실패 시 에러 전체와 exit code를 읽고 근본 원인을 확인한다.
- 검증 실패를 숨기거나 unrelated failure를 현재 작업 성공처럼 포장하지 않는다.

### 5. 커밋

커밋 메시지:

```text
<type>: <한 줄 요약>
```

권장 type:

- `feat`
- `fix`
- `docs`
- `test`
- `refactor`
- `chore`

커밋 전 확인:

```bash
git status --short
git diff --cached --stat
git diff --cached --check
```

금지:

- 명시 요청 없는 `git commit --amend`
- 명시 요청 없는 force push
- unrelated file staging
- 검증 실패 상태를 성공처럼 보고

### 6. Push

```bash
git push -u origin "$(git branch --show-current)"
```

이미 upstream이 있으면 일반 `git push`도 가능하다.

### 7. Final Report

최종 응답에는 아래를 짧게 포함한다.

```markdown
완료했습니다.
- 커밋: `<sha>` <message>
- Push: `<branch>` → `origin/<branch>`
- 검증: `<command>` ✅ / `<command>` ⚠️ reason
- 남은 리스크: 없음 또는 구체적 항목
```

## Red Flags

- “일단 한 커밋으로 밀고 나중에 정리”
- “CI가 잡아줄 테니 로컬 검증 생략”
- “리뷰가 볼 테니 근거 없이 push”
- “unrelated dirty도 같이 정리”
- “실패했지만 아마 괜찮음”
