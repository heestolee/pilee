---
name: code-review-and-quality
description: Evaluate code changes across correctness, readability, architecture, security, and performance before integration. Use before merging any change — whether written by a human, an agent, or yourself.
---

# Code Review and Quality

## Overview

Every change is reviewed before it enters the main branch. Review is not a gate to slow people down — it is the last structured opportunity to catch bugs, design flaws, security holes, and unnecessary complexity before they become everyone's problem. A good review evaluates five axes and gives clear, actionable, severity-labeled feedback.

## When to Use

- Before merging any change into the default branch
- After completing a feature, bug fix, or refactor
- When evaluating code produced by another model or agent
- When refactoring existing code and want a quality check
- After a bug fix, to review both the fix and its regression test

## The Five Axes

### 1. Correctness

Does the code do what it claims?

- Does it satisfy the spec or task requirements?
- Are boundary conditions handled (null, empty, zero, overflow)?
- Are error paths covered, not just the happy path?
- Are tests present and do they test the right behavior?
- Are there off-by-one errors, race conditions, or stale-state bugs?

### 2. Readability

Can someone unfamiliar with this change understand it without help?

- Are names specific and descriptive? (`remainingRetries` not `n`)
- Is control flow linear where possible (guard clauses over deep nesting)?
- Are abstractions earning their complexity or just adding indirection?
- Could the same result be achieved in fewer, clearer lines?
- Is there dead code: unused imports, commented-out blocks, no-op variables?

### 3. Architecture

Does the change fit the existing system design?

- Does it follow established patterns or introduce a new one? If new, is there justification?
- Are module boundaries respected (no circular dependencies, no reaching across layers)?
- Is duplication kept to a minimum without over-abstracting?
- Is the dependency direction correct (high-level modules do not import from low-level details)?

### 4. Security

Does the change introduce risk?

- Is untrusted input validated at the boundary?
- Are secrets absent from code, logs, and committed config?
- Are queries parameterized (no string concatenation for SQL or command execution)?
- Are outputs encoded for their destination context (HTML, URL, JSON)?
- Is external data (API responses, user content, config files) treated as untrusted?

### 5. Performance

Does the change introduce observable slowdowns or resource waste?

- Any N+1 data-fetching patterns?
- Any unbounded loops, unconstrained queries, or full-table scans?
- Any synchronous blocking where async is expected?
- Any unnecessary re-computation or re-rendering in hot paths?
- Are list responses paginated?

## Change Sizing

```
~100 lines → easy to review thoroughly
~300 lines → acceptable for one logical change
~500+ lines → split it before requesting review
```

A single change addresses one concern: a feature slice, a bug fix, or a refactor — not all three.

Splitting strategies:
- **Stack:** submit a base change, then follow-ups that build on it
- **Horizontal:** shared foundation first, then consumers
- **Vertical:** one complete end-to-end slice per change

Separate refactoring from behavioral changes. A change that restructures code AND adds a feature is two changes.

## Severity Labels

Every review comment carries a label so the author knows what is required:

| Label | Meaning | Author action |
|---|---|---|
| *(no label)* | Required change | Must address before merge |
| **Critical:** | Blocks merge | Security vulnerability, data loss, broken behavior |
| **Nit:** | Minor preference | Author may skip |
| **Optional:** | Worth considering | Not required |
| **FYI** | Informational | No action needed |

Without labels, authors treat every comment as blocking — or ignore them all.

## Review Process

### 1. Understand the Context

Before reading code, understand what the change is trying to accomplish. Read the description, linked spec, or task requirements.

### 2. Read the Tests First

Tests reveal intent and coverage gaps. Check:
- Do tests exist for the changed behavior?
- Do they test outcomes, not implementation details?
- Are edge cases covered?
- Would these tests catch a regression if the code changed again?

### 3. Walk the Implementation

Read each changed file through the five-axis lens. Note findings with severity labels.

### 4. Check the Commit Story

- Is the commit history clean (one logical thing per commit)?
- Do commit messages explain the why?
- Are refactoring and feature commits separated?

### 5. Verify the Verification

- What evidence exists that this works? (test output, screenshots, build log)
- Was manual verification done for UI changes?

## Multi-Agent Review

Different models have different blind spots. Use them:

```
Agent A writes the code
    → Agent B reviews for correctness and security
    → Agent A addresses feedback
    → Human makes the final decision
```

## Dependency Review

Before accepting a new dependency:

1. Does the existing stack already solve this?
2. What is the size impact?
3. Is it actively maintained?
4. Does it have known vulnerabilities?
5. Is the license compatible?

Every dependency is ongoing liability. Prefer standard library solutions.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It works, ship it" | Working code that is unreadable or insecure creates compounding debt. |
| "I wrote it, I know it is correct" | Authors are blind to their own assumptions. Another perspective catches what you miss. |
| "LGTM" | Rubber-stamp approval helps nobody. Evidence of actual review is required. |
| "The tests pass" | Tests are necessary but not sufficient. They do not catch architecture, readability, or security problems. |
| "AI code is probably fine" | AI code needs more scrutiny. It is confident and plausible even when wrong. |
| "We will clean it up later" | Later never comes. The review is the quality gate — use it now. |

## Red Flags

- Changes merged without any review
- Reviews that only check "tests pass" and ignore other axes
- Large changes that are "too big to review properly" (split them)
- No regression test accompanying a bug fix
- Review comments without severity labels
- Accepting "I will fix it in a follow-up" with no filed task
- Security-sensitive changes reviewed without security focus

## Verification

After completing a review:

- [ ] All Critical findings are resolved
- [ ] All unlabeled (required) findings are resolved
- [ ] Tests pass and build succeeds
- [ ] The verification story is documented (what was checked, how)
- [ ] Commit history is clean and messages are descriptive
