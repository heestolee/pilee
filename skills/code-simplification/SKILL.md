---
name: code-simplification
description: Reduce complexity while preserving exact behavior. Use when working code is harder to read, maintain, or extend than it should be. Use during refactoring, post-implementation cleanup, or when reviewing code that accumulated unnecessary weight.
---

# Code Simplification

## Overview

Simplification means making code easier to understand without changing what it does. The goal is not fewer lines — it is faster comprehension. Every simplification must pass one test: "Would a new team member read this faster than the original?" If not, revert.

## When to Use

- After a feature is working and tests pass, but the code feels heavier than necessary
- During code review when complexity or readability concerns surface
- When encountering deeply nested logic, long functions, or vague names
- When consolidating scattered related logic after a merge
- When refactoring code written under deadline pressure

**Do not use when:**
- The code is already clean and readable
- You do not yet understand what the code does
- The module is scheduled for a full rewrite
- The "simpler" version would be measurably slower in a proven hot path

## Ground Rules

### Preserve Behavior Exactly

Every input, output, side effect, error path, and timing guarantee must remain identical. If you are unsure a simplification preserves behavior, do not make it.

```
Before every change, verify:
  same output for every input?
  same error behavior?
  same side effects and ordering?
  all existing tests pass unmodified?
```

### Follow Project Conventions

Simplification aligns code with the codebase, not with external preferences. Before simplifying:

1. Read the project's conventions (README, docs, style guides)
2. Study how neighboring files handle similar patterns
3. Match the project's style for imports, naming, error handling, and type depth

A simplification that breaks consistency is churn, not improvement.

### Scope to the Current Task

Default to simplifying code you just changed or are reviewing. Avoid drive-by refactors of unrelated areas — they pollute diffs and risk unintended regressions.

## Identifying Opportunities

### Structural Complexity

| Signal | Simplification |
|--------|----------------|
| 3+ levels of nesting | Extract early returns or guard clauses |
| Functions over 40 lines | Split into focused helpers with descriptive names |
| Nested ternary chains | Replace with if/else or a lookup |
| Boolean flag parameters | Use separate functions or an options object |
| Repeated conditional checks | Extract a named predicate |

### Naming Problems

| Signal | Simplification |
|--------|----------------|
| Generic names (`data`, `val`, `tmp`) | Rename to describe the content (`userProfile`, `pendingCount`) |
| Abbreviations (`cfg`, `evt`, `btn`) | Spell out unless universally understood (`id`, `url`) |
| Misleading names (a `get` that mutates) | Rename to match actual behavior |
| Comments explaining "what" | Delete the comment — the code is clear enough |
| Comments explaining "why" | Keep — they carry intent the code cannot express |

### Redundancy

| Signal | Simplification |
|--------|----------------|
| Same 5+ lines duplicated in multiple places | Extract to a shared function |
| Dead code (unreachable branches, unused variables) | Remove after confirming it is truly dead |
| Wrappers that add no logic | Inline the wrapper, call the real thing directly |
| Factory-for-a-factory patterns | Replace with the direct approach |
| Type assertions on already-inferred types | Remove the assertion |

## Process

### 1. Understand Before Touching

Before removing or restructuring anything, understand why it exists. This is Chesterton's Fence: do not tear down a fence you do not understand. Check version history for the original context.

```
Answer before simplifying:
  what is this code's responsibility?
  what calls it and what does it call?
  what are the edge cases?
  why might it have been written this way?
```

### 2. One Change at a Time

Make a single simplification. Run the test suite. If tests pass, continue. If tests fail, revert and reconsider.

```
for each simplification:
  make the change
  run tests
  pass → commit or continue
  fail → revert and investigate
```

Do not batch multiple simplifications into one untested change.

### 3. Evaluate the Result

After all simplifications, compare before and after:

- Is the result genuinely easier to understand?
- Does it follow the project's conventions?
- Is the diff clean and reviewable?
- Would a reviewer approve it as a net improvement?

If the "simplified" version is harder to read, revert. Not every attempt succeeds.

## Balance

Watch for over-simplification:

- **Inlining too aggressively** — removing a helper that gave a concept a name makes call sites harder to read
- **Combining unrelated logic** — two simple functions merged into one complex function is not simpler
- **Removing useful abstraction** — some indirection exists for testability or extensibility, not complexity
- **Optimizing for line count** — fewer lines is not the goal; faster comprehension is

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It works, no need to touch it" | Working code that is hard to read will be hard to fix when it breaks. |
| "Fewer lines is always better" | A dense one-liner is not simpler than a clear five-line block. Simplicity is comprehension speed. |
| "I will refactor while adding this feature" | Separate refactoring from feature work. Mixed changes are harder to review and revert. |
| "The types make it self-documenting" | Types document structure, not intent. Named functions explain why better than signatures explain what. |
| "The original author must have had a reason" | Maybe. Check history. But accumulated complexity often has no reason — it is residue of iteration under pressure. |

## Red Flags

- Simplification that requires changing tests (you probably changed behavior)
- "Simplified" code that is longer or harder to follow than the original
- Renaming to match personal preferences rather than project conventions
- Removing error handling because "it is cleaner without it"
- Simplifying code you do not fully understand
- Large batches of simplifications in a single unreviewed commit

## Verification

After a simplification pass:

- [ ] All existing tests pass without modification
- [ ] Build and lint succeed with no new warnings
- [ ] Each simplification is a separate reviewable change
- [ ] The diff contains no unrelated modifications
- [ ] Simplified code follows project conventions
- [ ] No error handling was removed or weakened
- [ ] No dead code remains (unused imports, unreachable branches)
