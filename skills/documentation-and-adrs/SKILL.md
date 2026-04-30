---
name: documentation-and-adrs
description: Record architectural decisions and maintain living documentation. Use when making significant technical choices, changing public APIs, shipping features, or when future engineers and agents need to understand why the codebase looks the way it does.
---

# Documentation and ADRs

## Overview

The most valuable documentation captures the *why* — the constraints, trade-offs, and rejected alternatives that led to a decision. Code shows what was built; documentation explains why it was built this way and what happens if someone changes it. Architecture Decision Records (ADRs) are the highest-value documentation artifact because they prevent future teams from relitigating settled decisions.

## When to Use

- Making a significant architectural or technology choice
- Choosing between competing approaches
- Adding or changing a public API contract
- Shipping a feature that alters user-visible behavior
- When the same question keeps being asked by new team members or agents

**Skip when:** documenting would only restate what the code already says. Do not write documentation for throwaway prototypes.

## Architecture Decision Records

### When to Write One

- Selecting a framework, database, or major dependency
- Designing a data model or schema
- Choosing an authentication or authorization strategy
- Picking an API style (REST vs GraphQL vs RPC)
- Any decision that would be expensive to reverse

### Template

Store in `docs/decisions/` with sequential numbering:

```markdown
# ADR-NNN: [Decision Title]

## Status
Accepted | Superseded by ADR-XXX | Deprecated

## Date
[YYYY-MM-DD]

## Context
[What situation or requirement prompted this decision. Include relevant constraints.]

## Decision
[What was decided and the key reasoning.]

## Alternatives Considered

### [Alternative A]
- Advantages: [...]
- Disadvantages: [...]
- Why rejected: [...]

### [Alternative B]
- Advantages: [...]
- Disadvantages: [...]
- Why rejected: [...]

## Consequences
- [What the team must now understand or maintain]
- [What becomes easier]
- [What becomes harder or is ruled out]
```

### Lifecycle

```
PROPOSED → ACCEPTED → (SUPERSEDED or DEPRECATED)
```

Never delete old ADRs. They are historical context. When a decision changes, write a new ADR that references the old one.

## Inline Code Documentation

### Comment the Why, Not the What

```
Bad: restates the code
  // add one to counter
  counter += 1;

Good: explains non-obvious intent
  // use a sliding window reset to prevent burst attacks at window edges
  if (elapsed > WINDOW_MS) {
    counter = 0;
    windowStart = now;
  }
```

### Document Known Traps

When code has non-obvious constraints that would cause bugs if violated:

```
IMPORTANT: this function must run before the first render.
Calling it after hydration causes a flash of unstyled content
because the theme context is not available during SSR.
See ADR-003 for the design rationale.
```

### What to Delete

- Comments that restate the code
- TODO comments for work you should just do now
- Commented-out code (version control has history)

## README Structure

Every project needs a README covering:

```markdown
# Project Name

[One-paragraph description.]

## Quick Start
1. Clone the repository
2. Install: [command]
3. Configure: [steps]
4. Run: [command]

## Commands
| Command | Description |
|---------|-------------|
| [dev command] | Start local development |
| [test command] | Run tests |
| [build command] | Build for production |
| [lint command] | Check formatting and style |

## Architecture
[Brief overview of the structure and key decisions. Link to ADRs for details.]

## Contributing
[How to contribute, coding standards, PR process.]
```

## API Documentation

For public interfaces, document parameters, return types, errors, and one usage example:

```
createTask(input):
  input: { title: string (required), description: string (optional) }
  returns: Task with server-generated id and timestamps
  errors: ValidationError if title is empty or exceeds 200 characters
  example: createTask({ title: "Buy groceries" }) → { id: "task_abc", ... }
```

## Changelog

For released features:

```markdown
## [1.2.0] - 2025-01-20
### Added
- Task sharing with team members (#123)
### Fixed
- Duplicate creation on rapid button clicks (#125)
### Changed
- List page size increased from 20 to 50 (#126)
```

## Documentation for Agents

Special considerations when agents consume the codebase:

- **Project rules files** teach agents the conventions they must follow
- **Spec files** tell agents what to build
- **ADRs** prevent agents from re-deciding settled questions
- **Inline traps** prevent agents from falling into known pitfalls

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The code is self-documenting" | Code shows what. It does not show why, what was rejected, or what constraints apply. |
| "We will write docs when the API stabilizes" | Writing the doc is the first test of the design. It forces clarity. |
| "Nobody reads docs" | Agents do. Future engineers do. Your future self does. |
| "ADRs are overhead" | A ten-minute ADR prevents a two-hour debate about the same decision six months later. |
| "Comments get outdated" | Comments on why are stable. Comments on what get outdated — so only write the former. |

## Red Flags

- Architectural decisions with no written rationale
- Public APIs with no documentation or types
- README that does not explain how to run the project
- Commented-out code instead of deletion
- Stale TODO comments older than a sprint
- No ADRs in a project with significant architectural choices
- Documentation that restates code instead of explaining intent

## Verification

After documenting:

- [ ] ADRs exist for all significant architectural decisions
- [ ] README covers quick start, commands, and architecture overview
- [ ] API functions have documented parameters, return types, and errors
- [ ] Known traps are documented inline where they matter
- [ ] No commented-out code remains
- [ ] Project rules files are current and accurate
