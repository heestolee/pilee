---
name: git-workflow-and-versioning
description: Structure disciplined git practices for commits, branches, and history. Use when making any code change — committing, branching, resolving conflicts, or organizing work across parallel streams.
---

# Git Workflow and Versioning

## Overview

Git is your safety net and your documentation. Treat commits as save points, branches as isolated sandboxes, and history as a narrative that future readers will depend on. With agents generating code at high velocity, disciplined version control is what keeps changes manageable, reviewable, and reversible.

## When to Use

Always. Every code change flows through git.

## Branching Model

### Trunk-Based Development

Keep the default branch always deployable. Work in short-lived feature branches that merge back within one to three days.

```
main ──●──●──●──●──●──●──●──  (always deployable)
        ╲      ╱  ╲    ╱
         ●──●─╱    ●──╱       (short-lived branches, 1-3 days)
```

Long-lived branches diverge, create merge conflicts, and delay integration. Prefer feature flags over long branches for incomplete features.

### Branch Naming

```
feature/[short-description]   → feature/task-sharing
fix/[short-description]       → fix/duplicate-creation
chore/[short-description]     → chore/upgrade-deps
refactor/[short-description]  → refactor/auth-module
```

## Commit Discipline

### Atomic Commits

Each commit does one logical thing. Do not mix concerns.

```
Good:
  a1b2c3d feat: add task creation endpoint with validation
  d4e5f6g feat: add task creation form component
  h7i8j9k feat: connect form to API with loading state

Bad:
  x1y2z3a add task feature, fix sidebar, update deps
```

### Commit Messages

First line: short imperative sentence explaining the intent.
Body (optional): why, not what. Include context not visible in the diff.

```
feat: add boundary validation to signup flow

Prevents malformed input from reaching the user service.
Uses the existing ValidationError pattern from src/lib/errors.ts.
```

### Type Prefixes

- `feat` — new feature
- `fix` — bug fix
- `refactor` — restructuring without behavior change
- `test` — adding or updating tests
- `docs` — documentation only
- `chore` — tooling, dependencies, config

### Separate Concerns

Do not combine formatting with behavior. Do not combine refactors with features. Each type of change is a separate commit — ideally a separate PR.

### Size Targets

```
~100 lines → easy to review, easy to revert
~300 lines → acceptable for one logical change
~500+ lines → split before submitting
```

## The Save Point Pattern

```
Agent makes a change
  test passes? → commit → continue to next change
  test fails?  → revert to last commit → investigate

Repeat until feature complete.
```

You never lose more than one increment of work. If something goes wrong, `git reset --hard HEAD` returns to the last verified state.

### Frame slice commit rhythm

`/frame`이 만든 `implementation_plan.slices[]`가 있으면 각 slice는 커밋 후보 단위다. 하드하게 다음 작업을 막기보다, slice closure 시점마다 아래를 기본값으로 수행한다.

1. currentSlice의 claim/scope/evidence를 확인한다.
2. 가까운 검증이 통과하면 `work_context action=commit_plan`으로 explicit `auto_commit` plan을 생성한다.
3. plan을 검토할 때 한 commit entry의 primary path가 3개 이상이면 파일 수만 보지 말고 diff 양, layer mix, cluster/surface fan-out을 확인한다. 작은 동일 cluster 변경은 warning allow가 가능하지만, 큰 diff나 layer-mixed 변경은 logical atom 단위로 쪼갠다. test/generated/schema/package metadata는 companion으로만 붙인다.
4. plan을 검토한 뒤 `auto_commit action=apply`로 커밋한다.
5. 커밋을 미루면 이유를 `work_context checkpoint`에 남긴다.

이 리듬은 my-pi `/ship`의 “commit + verify + push가 기본” 원칙을 구현 중 slice 단위로 앞당긴 것이다. 마지막 ship/final-check에서 한꺼번에 커밋을 발견하는 흐름을 정상 경로로 보지 않는다.

### Commit-complete stop-line

커밋은 다음 작업을 계속하기 위한 중간 implementation detail이 아니라 사용자-visible save point다.

- commit이 만들어지면 먼저 보고한다. UI 검증, PR, push, broad status 확인은 다음 phase로 분리한다.
- 사용자가 이미 “커밋+푸시”, “PR까지”, “검증 리포트까지”를 명시했다면 이어갈 수 있지만, phase가 바뀌었다는 사실은 짧게 표시한다.
- 커밋 후 `git status`, `git log`, `gh pr view` 같은 안심 확인은 기본 실행하지 않는다. 필요한 SHA/message는 commit tool result나 직전 HEAD에서 가져온다.
- push가 포함된 light path에서는 push 성공이 terminal condition이다. 추가 확인 대신 짧은 완료 보고를 우선한다.
- 커밋은 됐지만 UI 검증/환경 검증이 남았으면 “코드 save point 완료, 남은 검증은 별도 phase”로 분리해 caveat를 남긴다.

## Pre-Commit Checks

Before every commit:

```
1. Review what you are committing: git diff --staged
2. Check for secrets: scan for password, secret, api_key, token
3. Run the project's verification:
   - test command
   - lint / format command
   - type check command
```

If the same validation failure has already been proven unrelated to the current branch, record it as a short-lived known baseline instead of re-debugging it in every worktree. This should happen through automatic preflight handling while the agent works: bash validation failures are checked against the cache, and after root-cause review the agent can call `preflight_baseline` with `action="add_last"` to record unrelated baseline noise.

There is no normal user-facing `/preflight` command. If the user wants to inspect or clean cache state, they can ask in natural language and the agent should use `preflight_baseline` with `list`, `clear`, or `prune`.

A baseline cache entry only separates noise from actionable failures. It does not make a required check pass and must not hide a failure that changed with the current diff.

## Change Summaries

After finishing a set of changes, provide a structured summary:

```
CHANGES MADE:
- src/routes/signup.ts: added input validation
- src/lib/validation.ts: added email format rule
- tests/routes/signup.test.ts: added validation error test

NOT TOUCHED (intentionally):
- src/routes/login.ts: similar issue but out of scope

CONCERNS:
- New validation may reject previously accepted input. Confirm this is desired.
```

The "NOT TOUCHED" section shows scope discipline and helps reviewers.

## Worktrees for Parallel Work

### Pi profiled worktree gate

For repos that a runtime profile marks as protected, do not jump from “this might need a fix” to creating a worktree. Before any worktree creation, classify three things:

1. **Stage** — investigation vs implementation. “확인해볼래?” means investigate first; do not create a worktree yet.
2. **Context carry** — if this session already contains investigation, code paths, decisions, or a plan, use `/wt fork` / `worktree_fork`, not `/wt new` / `worktree_create`. These fork flows carry the full transcript by default so the new worktree continues the actual source conversation. Use the lightweight handoff only when the user explicitly asks for `--minimal-context` / `minimalContext: true` or when copying the transcript would be clearly harmful.
3. **Base branch** — hotfix/production work must be created with `--hotfix` / `hotfix: true`; do not create a development-based hotfix branch.

Fork-panel rule: child panels (`P1`, `P2`, …) must not create protected/profiled worktrees. Hand off findings to the parent panel (`/handoff`), then the parent (`P0`) runs `/wt fork` so the parent conversation becomes the source session. This keeps worktree history, base branch, and session continuity clean.

If a wrong worktree is created, remove it before continuing and create the correct parent-owned fork.

### Generic git worktrees

When multiple agents or tasks need separate branches simultaneously outside the managed/profiled flow:

```
git worktree add ../project-feature-a feature/task-sharing
git worktree add ../project-feature-b feature/user-settings
```

Each worktree is a separate directory on its own branch. No branch switching needed. Changes are isolated until explicitly merged.

## Git for Debugging

```
git bisect start / bad / good → binary-search for the commit that introduced a bug
git log --oneline -20          → see recent history
git diff HEAD~5..HEAD -- path  → see what changed recently in a specific area
git blame path                 → find who last changed a line
git log --grep="keyword"       → search commit messages
```

## Handling Generated Files

- Commit lockfiles, checked-in migrations, and generated schemas the project expects
- Do not commit build output, local environment files, or editor config
- Maintain a `.gitignore` that covers generated artifacts, secrets, and local-only files

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I will commit when the feature is done" | One giant commit is impossible to review or revert safely. Commit each verified slice. |
| "The message does not matter" | Messages are documentation. Future readers need to know what changed and why. |
| "I will squash it later" | Squashing destroys the development narrative. Make clean commits from the start. |
| "Branches add overhead" | Short-lived branches are free. Long-lived ones are the problem — merge within days. |
| "I will split the change later" | Large changes are harder to review, riskier to deploy, and harder to revert. Split before submitting. |

## Red Flags

- Large uncommitted changes accumulating
- Commit messages like "fix", "update", "misc"
- Formatting changes mixed with behavior changes
- No `.gitignore` in the project
- Secrets in committed files
- Long-lived branches diverging from main
- Force-pushing to shared branches

## Verification

For every commit:

- [ ] Commit does one logical thing
- [ ] Message is imperative, descriptive, and follows type conventions
- [ ] Tests pass before committing
- [ ] No secrets in the diff
- [ ] No formatting changes mixed with behavior changes
- [ ] `.gitignore` covers local-only artifacts
