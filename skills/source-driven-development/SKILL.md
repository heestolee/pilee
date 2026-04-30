---
name: source-driven-development
description: Ground every framework-specific decision in official documentation. Use when building with any framework or library where correctness depends on the version, when you want source-cited code free from stale training-data patterns, or when verifying that existing code follows current best practices.
---

# Source-Driven Development

## Overview

Do not implement framework-specific code from memory. Training data goes stale, APIs get deprecated, and best practices evolve. This skill ensures that every framework-specific pattern traces back to an official documentation page the user can verify. The process is: detect the stack, fetch the relevant docs, implement following the documented patterns, and cite your sources.

## When to Use

- Building code that depends on a specific framework or library version
- Creating boilerplate or patterns that will be copied across the project
- Implementing features where the framework's recommended approach matters (forms, routing, data fetching, auth)
- Reviewing code that uses framework-specific patterns
- Any time you are about to write framework-specific code from memory

**Skip when:** the change is pure logic that works the same across all versions, or the user explicitly asks for speed over verification.

## Process

### 1. Detect Stack and Versions

Read the project's dependency manifest to identify exact versions:

```
package.json         → Node, React, Vue, Angular
pyproject.toml       → Python, Django, Flask, FastAPI
go.mod               → Go modules
Cargo.toml           → Rust crates
Gemfile              → Ruby, Rails
composer.json        → PHP, Symfony, Laravel
```

State what you found:

```
STACK DETECTED:
- React 19.1.0 (from package.json)
- Next.js 15.2.0 (from package.json)
- TypeScript 5.7 (from package.json)
→ Fetching official docs for relevant patterns.
```

If versions are ambiguous, ask the user. The version determines which patterns are correct.

### 2. Fetch Official Documentation

Fetch the specific documentation page for the feature being implemented. Not the homepage — the relevant page.

**Source hierarchy:**

| Priority | Source |
|---|---|
| 1 | Official documentation (react.dev, docs.djangoproject.com) |
| 2 | Official blog or changelog |
| 3 | Web standards references (MDN, web.dev) |
| 4 | Compatibility tables (caniuse.com, node.green) |

**Not authoritative — never cite as primary:**
- Stack Overflow answers
- Blog posts or tutorials
- AI-generated summaries
- Your own training data

Be precise:

```
Good: fetch react.dev/reference/react/useActionState
Bad:  fetch the React homepage
```

When official sources conflict with each other, surface the discrepancy to the user.

### 3. Implement Following Documentation

- Use API signatures from the docs, not from memory
- If docs show a new pattern, use the new pattern
- If docs deprecate something, do not use the deprecated version
- If docs do not cover a pattern, flag it as unverified

When docs conflict with existing project code:

```
CONFLICT:
Existing code uses useState for form submission state.
React 19 docs recommend useActionState for this pattern.
Source: react.dev/reference/react/useActionState

Options:
A) Modern pattern (useActionState) — matches current docs
B) Existing pattern (useState) — matches codebase consistency
→ Which approach?
```

Surface the conflict. Do not silently choose.

### 4. Cite Sources

Every framework-specific decision gets a citation.

In code:
```
// React 19 server action pattern
// Source: https://react.dev/reference/react/useActionState#usage
```

In conversation:
```
Using useActionState because React 19 replaced manual isPending
state management with this hook.
Source: https://react.dev/blog/2024/12/05/react-19#actions
```

Citation rules:
- Full URLs, not shortened
- Deep links with anchors when available
- Quote the relevant passage for non-obvious decisions
- Include compatibility data when recommending platform features

If you cannot find documentation:

```
UNVERIFIED: could not find official documentation for this pattern.
Based on training data and may be outdated. Verify before production use.
```

Honesty about what you could not verify is more valuable than false confidence.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "I am confident about this API" | Confidence is not evidence. Training data contains outdated patterns that look correct. Verify. |
| "Fetching docs wastes time" | Hallucinating an API wastes more. One fetch prevents hours of debugging stale patterns. |
| "The docs will not have what I need" | If official docs do not cover it, the pattern may not be recommended. That is valuable information. |
| "I will mention it might be outdated" | A disclaimer does not help. Either verify and cite, or flag as unverified. Hedging is the worst option. |
| "This is too simple to check" | Simple tasks with wrong patterns become templates. A deprecated handler copied into ten components multiplies the problem. |

## Red Flags

- Writing framework code without checking docs for the detected version
- Using "I believe" or "I think" about an API instead of citing a source
- Implementing a pattern without knowing which version introduced it
- Citing Stack Overflow or blog posts as primary sources
- Using deprecated APIs because they appear in training data
- Not reading the dependency manifest before implementing
- Delivering code without source citations for framework decisions

## Verification

After implementing with source-driven development:

- [ ] Framework and library versions were identified from the dependency manifest
- [ ] Official documentation was fetched for framework-specific patterns
- [ ] All cited sources are official documentation
- [ ] Code follows patterns from the current version's docs
- [ ] Non-trivial decisions include citations with full URLs
- [ ] No deprecated APIs are used
- [ ] Conflicts between docs and existing code were surfaced
- [ ] Anything unverifiable is explicitly flagged
