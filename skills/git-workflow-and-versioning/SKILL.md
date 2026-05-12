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
2. **Context carry** — if this session already contains investigation, code paths, decisions, or a plan, use `/wt fork` / `worktree_fork`, not `/wt new` / `worktree_create`. Carry a concise handoff summary by default; copy the full transcript only when the user explicitly asks for `--full-context` / `fullContext: true` or exact “continue the whole previous session” continuity.
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
