---
name: test-driven-development
description: Drive development with tests as evidence of correctness. Use when implementing new behavior, fixing bugs, changing existing logic, or protecting contracts from regression. Write a failing test before the code that makes it pass.
---

# Test-Driven Development

## Overview

Write a failing test before writing the code that makes it pass. For bug fixes, reproduce the failure with a test before attempting the fix. Tests are proof — "it seems to work" is not done. The TDD cycle (red → green → refactor) keeps implementation focused, prevents over-engineering, and builds a regression safety net as a side effect of normal development.

## When to Use

- Implementing new behavior or features
- Fixing a reported bug
- Changing existing behavior
- Adding edge-case handling
- Protecting a boundary or contract from future regression

**Skip when:** the change is documentation-only or has no behavioral effect.

## The TDD Cycle

```
RED     → write a test that fails for the expected reason
GREEN   → write the minimum code to make the test pass
REFACTOR → improve the code while all tests stay green
```

### RED: Write the Failing Test

Write the smallest test that proves the behavior is missing.

```
arrange: set up the input or state
act: execute the behavior being tested
assert: check the expected observable outcome
```

Run the test. Confirm it fails. A test that passes immediately does not prove you added the missing behavior.

### GREEN: Make It Pass

Implement the minimum code needed to satisfy the test.

Rules:
- Do not generalize early
- Do not add behavior beyond what the test requires
- Keep the change narrow enough that you know exactly why the test turned green

### REFACTOR: Improve the Code

Once tests are green, improve structure and clarity without changing behavior:
- Rename unclear concepts
- Remove duplication
- Extract helpers when they earn their weight
- Simplify control flow

Run the test suite after each meaningful refactor step.

## Bug Fix Pattern

When a bug is reported:

```
1. Write a test that reproduces the bug
2. Confirm the test fails for the right reason
3. Implement the fix
4. Confirm the test passes
5. Run the broader test suite for regressions
```

Do not start by guessing at a fix. Start by proving the failure exists in an automated test.

## Test Levels

Choose the smallest test that gives confidence:

| Level | Best For |
|---|---|
| Unit | Pure logic, calculations, transformations |
| Integration | Boundaries between components, services, or data stores |
| End-to-end | Critical user workflows in the real runtime |

Most tests should be small and fast. Use larger tests for critical paths and boundary confidence, not for every scenario.

## Writing Good Tests

### Test Outcomes, Not Internals

Prefer asserting on:
- Returned values
- Persistent state changes
- Emitted events or messages
- Externally visible side effects

Avoid over-testing internal method calls or private state unless the interaction itself is the contract.

### Keep Tests Readable

A test tells a story: what was set up, what happened, and what mattered about the result. Some duplication in tests is acceptable if it makes each scenario self-contained and easy to follow.

### Use Real Code Where Practical

Preference order:
1. Real implementation (most confidence)
2. Fake implementation (lightweight substitute)
3. Stub (returns predetermined data)
4. Mock (verifies interaction)

Mock at boundaries where real dependencies are slow, non-deterministic, expensive, or unsafe. Do not mock the thing you are testing.

### One Behavior Per Test

```
Good: separate tests for each behavior
  - rejects empty required fields
  - trims whitespace from input
  - preserves sort order

Bad: one test covering multiple unrelated behaviors
  - validates, trims, and sorts in a single test
```

When a multi-behavior test fails, you cannot tell which behavior broke without reading the entire test.

## When Tests Are Not Enough

For behavior that depends on a real runtime environment (browser rendering, platform-specific APIs, hardware interaction), automated tests may not be sufficient. Combine tests with runtime verification:

- Browser inspection for visual and interaction behavior
- Manual smoke testing for platform-specific edge cases
- Integration tests against real services for critical paths

## Test Organization

- Place tests near the code they test (colocated) or in a parallel directory structure
- Name test files consistently (e.g., `*.test.ts`, `*_test.go`, `test_*.py`)
- Group test cases by behavior or scenario, not by method name
- Keep test fixtures minimal and close to the tests that use them

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I will write tests after the code works" | Tests written after the fact validate the implementation, not the intended behavior. |
| "This is too simple to test" | Simple code becomes complex the moment requirements change. The test protects against that. |
| "Manual testing is enough" | Manual testing is not durable and does not guard against future regressions. |
| "Tests slow me down" | They slow guessing down and speed safe changes up. |
| "Mocking everything is fine" | Over-mocking tests implementation details, not behavior. The test passes but proves nothing. |

## Red Flags

- Behavior changes with no corresponding test
- Bug fixes with no reproduction test
- Tests that only verify internal method call sequences
- Flaky tests that nobody trusts or investigates
- Large tests that hide which behavior failed
- Skipped or weakened tests used as a release strategy
- Mocking the system under test instead of its boundaries

## Verification

After completing any implementation:

- [ ] New or changed behavior has test coverage at the appropriate level
- [ ] Bug fixes include a reproduction test
- [ ] Tests fail before the fix and pass after it
- [ ] The broader regression suite passes
- [ ] No tests were skipped or weakened to make the change pass
- [ ] Test names clearly describe the behavior being verified
