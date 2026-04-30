---
name: planning-and-task-breakdown
description: Decompose work into small, ordered, verifiable tasks with explicit acceptance criteria. Use when a spec exists and needs to become implementable units, when a task feels too large to start, or when parallel work is possible.
---

# Planning and Task Breakdown

## Overview

Good task breakdown is the difference between reliable completion and a tangled mess. Every task should be small enough to implement, test, and verify in a single focused session. This skill takes a spec or set of requirements and produces an ordered list of tasks with acceptance criteria, verification steps, and dependency relationships.

## When to Use

- A spec or clear requirements exist and need to become implementable work
- A task feels too large or vague to begin
- Work needs to be distributed across multiple agents or sessions
- You need to communicate scope to a stakeholder
- The implementation order is not obvious

**Skip when:** the task is a single-file change with obvious scope, or the spec already contains well-defined tasks.

## Process

### 1. Enter Read-Only Mode

Before writing any code, read:
- The spec or requirements
- Relevant areas of the codebase
- Existing patterns and conventions
- Dependencies between components

The output of this phase is a plan, not implementation.

### 2. Map the Dependency Graph

Identify what depends on what:

```
Data model / schema
    │
    ├── shared types and interfaces
    │       │
    │       ├── service or boundary logic
    │       │       │
    │       │       └── user-facing UI or operator tooling
    │       │
    │       └── validation and policy rules
    │
    └── fixtures, migrations, supporting assets
```

Build foundations first, then dependent layers.

### 3. Slice Vertically

Build one complete feature path at a time rather than all layers of one kind.

```
Bad (horizontal):
  Task 1: all database changes
  Task 2: all API endpoints
  Task 3: all UI components
  Task 4: connect everything

Good (vertical):
  Task 1: create task (schema + API + minimal UI) — working end-to-end
  Task 2: list tasks (query + API + UI) — working end-to-end
  Task 3: edit task (update + API + UI) — working end-to-end
```

Each vertical slice delivers testable functionality.

### 4. Write Tasks

Each task follows this structure:

```markdown
## Task N: [Descriptive title]

**Description:** one paragraph explaining what this task delivers.

**Acceptance criteria:**
- [ ] [specific, testable condition]
- [ ] [specific, testable condition]

**Verification:**
- [ ] Tests pass: [specific test command]
- [ ] Build succeeds: [build command]
- [ ] Manual check: [what to verify]

**Dependencies:** [task numbers, or "none"]

**Files likely touched:**
- [path]
- [path]

**Size:** Small (1-2 files) | Medium (3-5 files) | Large (5+ files, consider splitting)
```

### 5. Order and Add Checkpoints

Arrange tasks so that:
- Dependencies are satisfied (foundations first)
- Each task leaves the system working
- High-risk tasks are early (fail fast)
- Verification checkpoints appear after every two to three tasks

```markdown
## Checkpoint: After Tasks 1-3
- [ ] All tests pass
- [ ] Application builds cleanly
- [ ] Core user flow works end-to-end
- [ ] Review before proceeding
```

## Task Sizing

| Size | Files | Example |
|------|-------|---------|
| XS | 1 | Add a validation rule |
| S | 1-2 | Add a new API endpoint |
| M | 3-5 | User registration flow |
| L | 5-8 | Search with filtering and pagination |
| XL | 8+ | Too large — break it down further |

Agents perform best on S and M tasks.

**Break a task down further when:**
- You cannot describe acceptance criteria in three or fewer bullet points
- It touches two or more independent subsystems
- The task title contains "and" (a sign it is two tasks)

## Plan Template

```markdown
# Implementation Plan: [Feature Name]

## Overview
[One paragraph summary]

## Architecture Decisions
- [Decision 1 and rationale]
- [Decision 2 and rationale]

## Tasks

### Phase 1: Foundation
- [ ] Task 1: ...
- [ ] Task 2: ...

### Checkpoint
- [ ] Tests pass, build clean, foundation verified

### Phase 2: Core Features
- [ ] Task 3: ...
- [ ] Task 4: ...

### Checkpoint
- [ ] End-to-end flow works

### Phase 3: Polish
- [ ] Task 5: ...
- [ ] Task 6: ...

### Final Checkpoint
- [ ] All acceptance criteria met, ready for review

## Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| [risk] | [high/med/low] | [strategy] |

## Open Questions
- [question needing human input]
```

## Parallelization

- **Safe to parallelize:** independent feature slices, tests for existing code, documentation
- **Must be sequential:** shared schema changes, foundational contract changes
- **Needs coordination:** features sharing a boundary (define the contract first, then parallelize)

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I will figure it out as I go" | That produces tangled code and rework. Ten minutes of planning saves hours. |
| "The tasks are obvious" | Write them down anyway. Explicit tasks surface hidden dependencies and edge cases. |
| "Planning is overhead" | Planning is the task. Implementation without a plan is just typing. |
| "I can hold it in my head" | Context windows are finite. Written plans survive session boundaries. |

## Red Flags

- Starting implementation without a written task list
- Tasks that say "implement the feature" with no acceptance criteria
- No verification steps in the plan
- All tasks are XL-sized
- No checkpoints between phases
- Dependency order not considered

## Verification

Before starting implementation:

- [ ] Every task has acceptance criteria
- [ ] Every task has a verification step
- [ ] Dependencies are identified and ordered
- [ ] No task touches more than five files
- [ ] Checkpoints exist between major phases
- [ ] The plan has been reviewed and approved
