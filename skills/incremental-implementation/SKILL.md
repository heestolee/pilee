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
| light | 파일 1~2개, route/role/data 1개, side effect 없음 | 짧은 scope lock → focused 수정 → 가장 가까운 검증 1개 → 커밋 |
| standard | UI/BE/event 중 2~5개 축 | frame/verify 또는 verify-report를 축 수만큼 사용 |
| full | 다중 role/viewport/before-after/DB/정책 판단 | TFT + worker fan-out + report를 명시 계획 뒤에 사용 |

큰 절차를 쓰는 이유를 한 문장으로 설명할 수 없으면 절차를 줄인다. 반대로 light로 시작했는데 검증 축이 늘어나면 그때 standard/full로 승격한다.

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
