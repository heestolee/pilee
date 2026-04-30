---
name: deprecation-and-migration
description: Remove old systems and migrate consumers safely. Use when sunsetting features, replacing libraries, consolidating duplicate implementations, or planning the retirement lifecycle of existing code.
---

# Deprecation and Migration

## Overview

Every line of code has ongoing cost: testing, patching, documentation, onboarding. When a system no longer earns its maintenance burden, it should be removed. Deprecation is the discipline of deciding what to remove, and migration is the process of moving consumers safely to the replacement. Most teams are good at building things — few are good at removing them.

## When to Use

- Replacing an old system, API, or library with a new one
- Sunsetting a feature that no longer serves users
- Consolidating two implementations that do the same thing
- Removing dead code that nobody owns but something still references
- Planning the future removal of something being built today

## Core Principles

### Code Is Liability

The value of code is the functionality it provides, not the code itself. When the same capability can be delivered with less complexity, the old code should go.

### Removal Requires Active Migration

Announcing deprecation is not enough. Users depend on undocumented behaviors, implicit contracts, and side effects. They cannot "just switch" without support. If you own the infrastructure being retired, you are responsible for moving your consumers — or providing a backward-compatible bridge.

### Plan Removal at Design Time

When building something new, ask: "How would we retire this in three years?" Systems with clean interfaces, feature flags, and small surface areas are cheaper to deprecate than systems that leak internals everywhere.

## The Deprecation Decision

Before deprecating, answer:

```
1. Does this still provide unique value?
   → yes: maintain it. no: proceed.

2. How many consumers depend on it?
   → quantify the migration scope.

3. Does a working replacement exist?
   → no: build the replacement first. never deprecate without an alternative.

4. What is the migration cost per consumer?
   → trivially automated: do it. high manual effort: weigh against maintenance cost.

5. What is the ongoing cost of NOT deprecating?
   → security exposure, engineer time, opportunity cost of complexity.
```

## Advisory vs Compulsory

| Type | When | Mechanism |
|---|---|---|
| Advisory | Migration is optional, old system is stable | Warnings, documentation, encouragement. Consumers migrate on their own schedule. |
| Compulsory | Security risk, blocks progress, or maintenance is unsustainable | Hard deadline. Old system removed by a specific date. Migration tooling required. |

Default to advisory. Use compulsory only when cost or risk justifies it — and always provide tooling, documentation, and support.

## Migration Process

### 1. Build the Replacement

The replacement must:
- Cover all critical use cases of the old system
- Have documentation and a migration guide
- Be proven in production, not just theoretically better

### 2. Announce and Document

```markdown
## Deprecation Notice: [OldSystem]

**Status:** Deprecated as of [date]
**Replacement:** [NewSystem] (see migration guide)
**Removal date:** [date or "advisory — no hard deadline"]
**Reason:** [why the old system is being retired]

### Migration Steps
1. [specific step with code example]
2. [specific step with code example]
3. [verification step]
```

### 3. Migrate Incrementally

Migrate consumers one at a time:

```
for each consumer:
  1. identify all touchpoints with the deprecated system
  2. update to use the replacement
  3. verify behavior matches (tests, integration checks)
  4. remove references to the old system
  5. confirm no regressions
```

### 4. Remove the Old System

Only after all consumers have migrated and usage metrics confirm zero traffic:

```
1. verify zero active usage
2. remove the code
3. remove associated tests, docs, and config
4. remove the deprecation notices themselves
```

## Migration Patterns

### Strangler

Run old and new in parallel. Route traffic incrementally from old to new. Remove old when it handles zero percent.

### Adapter

Create a bridge that translates calls from the old interface to the new implementation. Consumers keep using the old interface while the backend changes underneath.

### Feature Flag

Use flags to switch consumers from old to new individually or in groups. Enables gradual rollout and instant rollback.

## Zombie Code

Code that nobody owns but something still depends on. Signs:
- No commits in 6+ months with active consumers
- No assigned maintainer
- Failing tests nobody fixes
- Dependencies with unpatched vulnerabilities

Response: assign an owner and invest in it, or deprecate it with a concrete migration plan. Zombie code cannot remain in limbo.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "It still works" | Working code without maintenance accumulates security debt and complexity silently. |
| "Someone might need it later" | If needed, it can be rebuilt. Keeping unused code is more expensive than rebuilding. |
| "Migration is too expensive" | Compare one-time migration cost to ongoing maintenance over two to three years. Migration usually wins. |
| "Users will migrate on their own" | They will not. Provide tooling and do the migration yourself. |
| "We can maintain both indefinitely" | Two systems for one job means double the maintenance, testing, and onboarding. |

## Red Flags

- Deprecated systems with no replacement available
- Deprecation announcements with no migration guide or tooling
- Advisory deprecation that has not progressed in over a year
- Zombie code with no owner and active consumers
- New features added to a deprecated system
- Removing code without verifying zero active usage

## Verification

After completing a deprecation:

- [ ] Replacement is production-proven and covers critical use cases
- [ ] Migration guide exists with concrete steps and examples
- [ ] All active consumers have been migrated (verified by metrics)
- [ ] Old code, tests, documentation, and config are fully removed
- [ ] No references to the deprecated system remain in the codebase
- [ ] Deprecation notices are removed
