---
name: context-engineering
description: Curate the right information for agents at the right time. Use when starting a session, when agent output quality degrades, when switching tasks, or when configuring project rules and conventions files.
---

# Context Engineering

## Overview

Context is the single largest lever for agent output quality. Too little and the agent hallucinates APIs, invents conventions, and ignores constraints. Too much and it loses focus, forgets instructions, and produces generic output. Context engineering is the deliberate practice of controlling what the agent sees, when it sees it, and how it is structured.

## When to Use

- Starting a new coding session or switching between major features
- Agent output drifts from project conventions or invents nonexistent APIs
- Setting up a new project for agent-assisted development
- The agent is re-implementing utilities that already exist in the codebase
- Quality degrades as conversation length grows

## Context Layers

Structure information from most persistent to most transient:

```
Layer 1: Project Rules        → always loaded, project-wide conventions
Layer 2: Specs / Architecture → loaded per feature or session
Layer 3: Relevant Source Code → loaded per task
Layer 4: Error / Test Output  → loaded per iteration
Layer 5: Conversation History → accumulates, needs management
```

### Layer 1: Project Rules

A small, durable document that persists across sessions. Place it wherever the project keeps its canonical documentation.

```markdown
# Project: [Name]

## Stack
[languages, frameworks, services]

## Commands
- Install: [command]
- Test: [command]
- Lint: [command]
- Build: [command]
- Dev server: [command]

## Conventions
- [naming rules]
- [file placement rules]
- [error handling patterns]
- [test organization rules]

## Boundaries
- Never commit secrets
- Ask before changing schemas or infrastructure
- Run verification commands before finishing any task

## Example
[One short snippet showing the project's preferred implementation style]
```

### Layer 2: Specs and Architecture

Load the section relevant to the current task, not the entire document.

Effective: "Here is the authentication section of the spec: [content]"
Wasteful: "Here is the full 200-section spec: [everything]"

### Layer 3: Source Files

Before editing, read the file. Before implementing a pattern, find an existing example in the codebase.

Pre-task loading:
1. The file(s) to modify
2. Related test files
3. One example of a similar pattern already in the project
4. Relevant type definitions or interfaces

### Layer 4: Error Output

Feed specific errors, not entire log dumps.

Effective: "Test failed with: TypeError: Cannot read property 'id' of undefined at UserService.ts:42"
Wasteful: pasting 500 lines of test runner output when one test failed

### Layer 5: Conversation Management

Long conversations accumulate stale context. Manage this:
- Start fresh sessions when switching major features
- Summarize progress when context gets long
- Compact deliberately before critical work if the tool supports it

## Context Loading Patterns

### Focused Task Context

```
TASK: Add email validation to the signup endpoint

RELEVANT FILES:
- src/routes/signup.ts (endpoint to modify)
- src/validation/rules.ts (existing validators)
- tests/routes/signup.test.ts (tests to extend)

PATTERN: see how phone validation works in src/validation/rules.ts:30-45

CONSTRAINT: must use the existing ValidationError class
```

### Project Map

For large codebases, maintain a summary index:

```markdown
## Authentication (src/auth/)
Handles login, registration, password reset.
Key files: routes.ts, service.ts, middleware.ts

## Tasks (src/tasks/)
CRUD operations with real-time sync.
Key files: routes.ts, service.ts, socket.ts

## Shared (src/lib/)
Validation, error handling, database utilities.
Key files: validate.ts, errors.ts, db.ts
```

Load only the relevant section when working on a specific area.

## Handling Ambiguity

### Conflicting Information

When the spec says one thing and the existing code does another:

```
CONFLICT:
The spec requires REST endpoints, but src/graphql/user.ts uses GraphQL.

Options:
A) Follow the spec — add REST, deprecate GraphQL later
B) Follow existing code — use GraphQL, update the spec
C) Ask — this looks like an intentional decision I should not override

Which approach?
```

Do not silently pick one interpretation. Surface the conflict.

### Missing Requirements

When the spec does not cover a case you need to implement:

1. Check existing code for precedent
2. If no precedent, stop and ask
3. Do not invent requirements

```
MISSING:
The spec defines task creation but not duplicate title behavior.

Options:
A) Allow duplicates (simplest)
B) Reject with validation error (strictest)
C) Append a suffix like "Task (2)" (most user-friendly)

Which behavior?
```

### Lightweight Planning

For multi-step tasks, emit a quick plan before executing:

```
PLAN:
1. Add validation schema for task input
2. Wire schema into POST /tasks handler
3. Add test for validation rejection
→ Proceeding unless redirected.
```

## Anti-Patterns

| Anti-Pattern | Consequence | Fix |
|---|---|---|
| Context starvation | Agent invents APIs and ignores conventions | Load project rules + relevant source before each task |
| Context flooding | Agent loses focus with 5000+ lines of unrelated context | Include only what is relevant, aim for under 2000 lines |
| Stale context | Agent uses outdated patterns or deleted code | Start fresh sessions when context drifts |
| No examples | Agent invents a new style | Include one example of the pattern to follow |
| Implicit knowledge | Agent does not know unwritten rules | Write them down — if it is not documented, it does not exist |
| Silent confusion | Agent guesses when it should ask | Surface ambiguity explicitly |

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "The agent should figure out conventions" | It cannot read your mind. Write down conventions in ten minutes and save hours. |
| "More context is always better" | Performance degrades with too many instructions. Focused context beats large context. |
| "The context window is huge, fill it all" | Window size is not attention budget. Relevant beats voluminous. |
| "I will correct mistakes as they happen" | Prevention is cheaper than correction. Upfront context prevents drift. |

## Red Flags

- Agent output ignores project conventions
- Agent invents APIs or imports that do not exist
- Agent re-implements utilities already present in the codebase
- Quality declines as conversation length grows
- No project rules document exists
- External data treated as trusted instructions without verification

## Verification

After setting up context:

- [ ] A project rules document exists covering stack, commands, conventions, and boundaries
- [ ] Agent output follows the patterns documented in project rules
- [ ] Agent references actual project files and APIs, not hallucinated ones
- [ ] Context is refreshed when switching between major tasks
