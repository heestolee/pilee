---
name: spec-driven-development
description: Write a structured specification before writing any code. Use when starting a new project, feature, or significant change where requirements are unclear, ambiguous, or only exist as a vague idea.
---

# Spec-Driven Development

## Overview

A spec is the shared source of truth between you and the person requesting the work. It defines what is being built, why, and how completion will be judged. Code without a spec is guessing — even when the developer is confident, the requester's expectations may differ. Writing a spec forces clarity before implementation begins, when the cost of changing direction is lowest.

## When to Use

- Starting a new project or feature
- Requirements are ambiguous or incomplete
- The change touches multiple files or modules
- An architectural decision needs to be made
- The task would take significant effort to implement

**Skip when:** single-line fixes, typo corrections, or changes where requirements are obvious and self-contained.

## The Gated Workflow

Four phases. Do not advance until the current phase is validated.

```
SPECIFY → PLAN → TASKS → IMPLEMENT
```

Each gate requires human review and approval before proceeding.

### Phase 1: Specify

Start with the high-level vision. Ask clarifying questions until requirements are concrete.

**Surface assumptions immediately:**

```
ASSUMPTIONS:
1. This targets [platform/runtime]
2. The project's test command is [command]
3. Existing architecture constraints apply
4. Success means [specific criteria]
→ Correct me now or I proceed with these.
```

Do not silently fill in gaps. The spec's entire value is surfacing misunderstandings before code gets written.

**Write a spec covering these areas:**

```markdown
# Spec: [Project/Feature Name]

## Objective
[What we are building and why. Who is the user. What success looks like.]

## Technology
[Languages, frameworks, services, platforms.]

## Commands
- Install: [command]
- Test: [command]
- Lint: [command]
- Build: [command]
- Dev: [command]

## Project Structure
[Directory layout with descriptions.]

## Code Style
[One real code snippet showing the preferred style. Key conventions.]

## Testing Strategy
[Framework, test location, coverage expectations, test levels.]

## Boundaries
- Always: [run tests, follow conventions, validate input]
- Ask first: [schema changes, new dependencies, CI changes]
- Never: [commit secrets, disable tests, edit third-party code]

## Success Criteria
[Specific, testable conditions for "done."]

## Open Questions
[Unresolved items needing human input.]
```

**Reframe vague requirements as testable criteria:**

```
Vague: "make the system faster"

Reframed:
- Identify the slow path with a baseline measurement
- Improve the agreed metric by a specific amount
- No correctness regressions
→ Are these the right targets?
```

### Phase 2: Plan

With the validated spec, generate an implementation plan:

1. Identify major components and their dependencies
2. Determine implementation order
3. Note risks and mitigations
4. Identify what can be parallelized vs. what must be sequential
5. Define verification checkpoints

The plan must be reviewable — the reader should be able to say "yes, this is the right approach" or "change X."

### Phase 3: Tasks

Break the plan into discrete tasks:
- Each completable in a single focused session
- Each with explicit acceptance criteria
- Each with a verification step
- Ordered by dependency
- No task changes more than ~5 files

```markdown
- [ ] Task: [description]
  - Acceptance: [what must be true when done]
  - Verify: [test command, build check, manual verification]
  - Files: [which files will be touched]
```

### Phase 4: Implement

Execute tasks one at a time following the incremental implementation and test-driven development skills. Load relevant spec sections per task rather than the entire document.

## Keeping the Spec Alive

- **Update when decisions change** — if a foundational assumption shifts, update the spec first
- **Update when scope changes** — features added or cut should be reflected
- **Commit the spec** — it belongs in version control alongside the code
- **Reference in reviews** — link back to the spec section each change covers

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "This is simple, no spec needed" | Simple tasks still need acceptance criteria. A two-line spec is fine. |
| "I will write the spec after coding" | That is documentation, not specification. The spec's value is clarity before code. |
| "The spec will slow us down" | A fifteen-minute spec prevents hours of rework. |
| "Requirements will change anyway" | That is why the spec is a living document. Outdated specs are still better than no spec. |
| "The user knows what they want" | Even clear requests have implicit assumptions. The spec surfaces them. |

## Red Flags

- Starting code without any written requirements
- Asking "should I just start building?" before defining "done"
- Implementing features not in any spec or task list
- Making architectural decisions without documenting them
- Skipping the spec because "it is obvious"

## Verification

Before proceeding to implementation:

- [ ] The spec covers objective, technology, commands, structure, style, testing, and boundaries
- [ ] The human has reviewed and approved the spec
- [ ] Success criteria are specific and testable
- [ ] Boundaries (always / ask first / never) are defined
- [ ] The spec is saved to a file in the repository
