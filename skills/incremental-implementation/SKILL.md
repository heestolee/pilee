---
name: incremental-implementation
description: Build in thin vertical slices — implement one piece, test it, commit, then expand. Use when any change touches more than one file, when a task feels too large to land in one step, or when you are tempted to write more than 100 lines before running tests.
---

# Incremental Implementation

## Overview

Build one complete slice at a time. Each slice is implemented, tested, verified, and committed before the next begins. This keeps the system in a working state at every step, makes bugs easy to localize, and ensures you never lose more than one increment of work.

## When to Use

- Implementing any multi-file change
- Building a new feature from a task breakdown
- Refactoring existing code across files
- Any time you are about to write more than ~100 lines before testing

**Skip when:** the change is a single function in a single file with obvious scope.

## The Increment Cycle

```
Implement → Test → Verify → Commit → Next slice
    ▲                                    │
    └────────────────────────────────────┘
```

For each slice:
1. **Implement** the smallest complete piece of functionality
2. **Test** — run the test suite or write a test if none exists
3. **Verify** — confirm it works (tests pass, build succeeds, visual check)
4. **Commit** — save progress with a descriptive message
5. **Continue** to the next slice

### Soft slice auto-commit rhythm

이 단계는 하드 블록이 아니라 기본 리듬이다. slice가 완료되고 가장 가까운 검증이 통과하면, 다음 slice로 넘어가기 전에 현재 slice diff를 커밋 후보로 다룬다.

1. `GIT_OPTIONAL_LOCKS=0 git status --short --branch`와 `git diff --stat`으로 현재 slice 변경만 있는지 확인한다.
2. `work_context action=commit_plan`으로 currentSlice scope 기반 `auto_commit` JSON plan을 만든다.
3. plan의 `message`, `paths`, `push` 대상을 읽어 관련 없는 파일이 섞이지 않았는지 확인한다.
4. 한 commit entry의 primary path가 3개 이상이면 `auto_commit` diff-aware logical atom gate가 diff 양, layer mix, cluster/surface fan-out을 평가한다. warning allow가 아닌 block이면 source/test/generated/schema companion 관계가 닫히는 더 작은 commit으로 쪼갠다.
5. 적절하면 `auto_commit action=apply planPath=<planPath>`를 호출한다. plan에 `push`가 있으면 commit+push까지 완료된다.
6. `auto_commit` 결과가 `push: skipped`이고 사용자가 push 보류를 지시하지 않았다면, 즉시 `git push`까지 끝낸 뒤 보고한다.
7. 아직 slice가 불완전하거나 검증 전이면 커밋을 미루되, `work_context action=checkpoint`에 이유를 남긴다.

사용자가 명시적으로 “커밋하지 마”라고 했거나, 현재 slice가 아직 검증되지 않았거나, 관련 파일을 분리하면 빌드가 깨지는 경우에는 커밋을 보류할 수 있다. 하지만 마지막에 “구현은 끝났는데 커밋 안 됨”으로 놀라게 하지 않는다.

### Long-running checkpoint rhythm

긴 작업은 구현 자체보다 보고 stop-line이 무너질 때 사용자-visible 실패가 된다. 다음 checkpoint를 기본 리듬으로 둔다.

- **30분 경과**: 현재 phase, 완료한 것, 남은 것, 차단 가능성을 짧게 보고한다.
- **60분 경과**: 계속 진행할지, 부분 커밋/부분 handoff로 끊을지 확인한다.
- **같은 검증 계열 2회 실패**: lint/test/type-check/codegen 루프를 계속 돌기 전에 원인, 수정한 것, 남은 선택지를 보고한다.
- **phase 전환**: 구조 파악 → 구현 → 기계 검증 → 커밋 → UI/수동 검증 → PR/push로 넘어갈 때 최소 한 줄 checkpoint를 남긴다.
- **환경 검증 차단**: 로컬 서버, 로그인, 권한, 데이터 세팅 문제는 5~10분 이상 main flow를 붙잡지 말고 `BLOCKED` 또는 선택지로 보고한다.

`continue`/compaction 이후에는 current context card와 current slice를 우선 신뢰한다. 이미 discovery/frame이 있으면 broad rediscovery로 시간을 쓰지 말고, 현재 claim/evidence를 닫는 파일만 좁게 확인한다.

### Context hoarding보다 slice closure

큰 transcript를 오래 들고 가는 것보다, 현재 slice를 작게 닫는 것이 우선이다.

각 slice는 다음을 가져야 한다.

- **Claim**: 무엇이 true여야 하는가
- **Scope**: 어떤 파일/경로만 건드리는가
- **Evidence**: 어떤 명령/캡처/로그/artifact로 닫는가
- **Gap**: 지금 닫지 못한 것은 무엇인가

이 네 가지가 없으면 다음 slice로 넘어가지 않는다. 오래된 맥락은 참고자료일 뿐이고, 현재 slice의 claim/evidence가 현재 truth다.

## Slicing Strategies

### Vertical Slices (Preferred)

Build one complete path through the stack at a time:

```
Slice 1: Create task (schema + API + minimal UI) → tests pass, user can create
Slice 2: List tasks (query + API + UI)           → tests pass, user can see tasks
Slice 3: Edit task (update + API + UI)           → tests pass, user can modify
Slice 4: Delete task (delete + API + confirmation) → tests pass, full CRUD done
```

Each slice delivers working end-to-end functionality.

### Contract-First Slicing

When backend and frontend develop in parallel:

```
Slice 0: Define the API contract (types, interfaces)
Slice 1a: Backend implements against the contract + API tests
Slice 1b: Frontend implements against mock data matching the contract
Slice 2: Integrate and test end-to-end
```

### Risk-First Slicing

Tackle the most uncertain piece first:

```
Slice 1: Prove the WebSocket connection works (highest risk)
Slice 2: Build real-time updates on the proven connection
Slice 3: Add offline support and reconnection
```

If slice 1 fails, you discover it before investing in slices 2 and 3.

## Rules

### Workflow Weight Calibration

작업 절차도 구현처럼 작은 단위여야 한다. 단일 copy/hotfix/리뷰 반영처럼 영향 축이 좁은 작업에 full TFT cycle, 대형 worker fan-out, capture-heavy report를 기본값으로 얹지 않는다.

먼저 작업 무게를 정한다.

| 무게 | 신호 | 절차 |
|---|---|---|
| light | 파일 1~2개, route/role/data 1개, side effect 없음 | `GIT_OPTIONAL_LOCKS=0 git status` → focused 수정 → 가장 가까운 검증 1개 → 커밋 → push. PR/branch 확인은 사용자가 명시했거나 push 실패·rejected 때만 |
| standard | UI/BE/event 중 2~5개 축 | frame/verify 또는 verify-report를 축 수만큼 사용 |
| full | 다중 role/viewport/before-after/DB/정책 판단 | TFT + worker fan-out + report를 명시 계획 뒤에 사용 |

큰 절차를 쓰는 이유를 한 문장으로 설명할 수 없으면 절차를 줄인다. 반대로 light로 시작했는데 검증 축이 늘어나면 그때 standard/full로 승격한다. 단일 문구/CTA/작은 리뷰 반영에서는 self-healing, stress-interview, subagent fan-out, capture-heavy verify-report를 기본 실행하지 않는다.

Tool result 이후의 판단 시간도 무게에 맞춘다. none/light 판별·운영 triage는 30초 안에 다음 좁은 tool call, 중간 결론, scope-gate 질문, 최종 보고 중 하나로 전환한다. standard는 60초, full은 120초를 기본 예산으로 삼고, 그 이상 조용히 고민해야 하면 현재 결론과 남은 gap을 먼저 보고한다.

### Simplicity First

Before writing code, ask: "What is the simplest thing that could work?"

```
Not this: generic EventBus with middleware for one notification
This:     a direct function call

Not this: abstract factory for two similar components
This:     two straightforward components with shared utilities

Not this: config-driven form builder for three forms
This:     three form components
```

Three similar lines of code are better than a premature abstraction. Implement the naive, correct version first. Generalize only when the third use case demands it.

### Scope Discipline

Touch only what the task requires.

Do not:
- clean up adjacent code
- refactor imports in files you are not modifying
- add features not in the spec
- modernize syntax in files you are only reading

If you notice something worth improving outside scope, note it but do not fix it:

```
NOTICED (not touching):
- src/utils/format.ts has an unused import (unrelated to this task)
- The auth middleware could use better error messages (separate task)
```

### One Thing at a Time

Each increment changes one logical thing. Do not combine a new component, a refactor of an existing one, and a build config update in one commit.

### Keep It Compilable

After each increment, the project must build and all existing tests must pass. Never leave the codebase broken between slices.

### Feature Flags for Incomplete Work

If a feature is not ready for users but you need to merge increments to the default branch:

```
if (flags.taskSharing) {
  // new sharing UI
}
```

This lets you merge small increments without exposing incomplete functionality.

### Rollback-Friendly

Each increment should be independently revertable:
- Additive changes (new files, new functions) are easy to revert
- Modifications to existing code should be minimal and focused
- Database migrations should have corresponding rollbacks

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I will test everything at the end" | Bugs compound. A bug in slice 1 makes slices 2 through 5 wrong. Test each slice. |
| "It is faster to do it all at once" | It feels faster until something breaks and you cannot find which of 500 lines caused it. |
| "These changes are too small to commit separately" | Small commits are free. Large commits hide bugs and make rollbacks painful. |
| "I will add the feature flag later" | If the feature is not complete, it should not be visible. Add the flag now. |
| "This refactor is small enough to include" | Refactors mixed with features make both harder to review and debug. Separate them. |

## Red Flags

- More than 100 lines written without running tests
- Multiple unrelated changes in a single increment
- Scope expansion ("let me just quickly add this too")
- Skipping test/verify to move faster
- Build or tests broken between increments
- Large uncommitted changes accumulating
- Building abstractions before the third use case
- Touching files outside the task scope

## Verification

After completing all increments for a task:

- [ ] Each increment was individually tested and committed
- [ ] The full test suite passes
- [ ] The build is clean
- [ ] The feature works end-to-end as specified
- [ ] No uncommitted changes remain
- [ ] No unrelated modifications were introduced
