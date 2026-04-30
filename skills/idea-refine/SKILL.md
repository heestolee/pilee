---
name: idea-refine
description: Refine raw ideas into sharp, actionable concepts through structured divergent and convergent thinking. Use when an idea needs sharpening, when exploring product or feature directions, or when stress-testing a plan before committing resources.
---

# Idea Refine

## Overview

Transform vague ideas into concrete, buildable concepts. This skill guides a structured conversation through three phases: expanding possibilities (divergent), evaluating and narrowing (convergent), and producing a concrete artifact (one-pager). The output is a markdown document with a clear problem statement, recommended direction, key assumptions, MVP scope, and an explicit "Not Doing" list.

## When to Use

- An idea exists but needs sharpening before building
- Exploring product or feature directions
- Stress-testing a plan before investing engineering effort
- The user says "help me think through this" or "ideate on X"

## How It Works

This is an interactive dialogue skill. The agent guides the user through three phases, adapting based on their reactions.

## Phase 1: Understand and Expand (Divergent)

**Goal:** take the raw idea and open it up.

### Restate the Idea

Frame it as a "How Might We" problem statement. This forces clarity on what is actually being solved.

### Ask Sharpening Questions

Three to five questions, no more:
- Who is this for, specifically?
- What does success look like?
- What are the real constraints (time, technology, resources)?
- What has been tried before?
- Why now?

Do not proceed until you understand the target user and success criteria.

### Generate Variations

Produce five to eight idea variations using these lenses:
- **Inversion:** what if we did the opposite?
- **Constraint removal:** what if budget and time were unlimited?
- **Audience shift:** what if this were for a different user?
- **Combination:** what if we merged this with an adjacent idea?
- **Simplification:** what is the version that is ten times simpler?
- **Scale:** what would this look like at massive scale?
- **Expert lens:** what would domain experts find obvious that outsiders would miss?

Push beyond what the user initially asked for.

**If running inside a codebase:** inspect the repository for existing architecture, patterns, and constraints. Ground variations in what actually exists. Reference specific files when relevant.

## Phase 2: Evaluate and Converge

After the user reacts to Phase 1:

### Cluster Directions

Group the ideas that resonated into two to three distinct directions. Each should feel meaningfully different.

### Stress-Test

Evaluate each direction against:
- **User value:** who benefits and how much? Painkiller or vitamin?
- **Feasibility:** technical and resource cost? What is the hardest part?
- **Differentiation:** what makes this genuinely different? Would someone switch?

### Surface Hidden Assumptions

For each direction, name explicitly:
- What you are betting is true but have not validated
- What could kill this idea
- What you are choosing to ignore and why that is acceptable for now

This is where most ideation fails. Do not skip it.

**Be honest, not supportive.** If an idea is weak, say so with specificity and kindness. A good ideation partner pushes back on complexity, questions real value, and identifies when the concept lacks substance.

## Phase 3: Sharpen and Ship

Produce a concrete markdown one-pager:

```markdown
# [Idea Name]

## Problem Statement
[One-sentence "How Might We" framing]

## Recommended Direction
[The chosen direction and reasoning, two to three paragraphs maximum]

## Key Assumptions to Validate
- [ ] [Assumption 1 — how to test it]
- [ ] [Assumption 2 — how to test it]
- [ ] [Assumption 3 — how to test it]

## MVP Scope
[The minimum version that tests the core assumption. What is in, what is out.]

## Not Doing (and Why)
- [Thing 1] — [reason]
- [Thing 2] — [reason]
- [Thing 3] — [reason]

## Open Questions
- [Question that needs answering before building]
```

The "Not Doing" list is the most valuable section. Focus means saying no to good ideas. Make the trade-offs visible.

Ask the user if they want to save the output (e.g., `docs/ideas/[name].md`). Only save on confirmation.

## Anti-Patterns

- Generating twenty shallow variations instead of eight considered ones
- Being a yes-machine instead of pushing back on weak ideas
- Skipping "who is this for"
- No assumptions surfaced before committing to a direction
- Producing output without running all three phases
- Ignoring codebase constraints when ideating inside a project
- Listing ideas without explaining why each variation exists

## Tone

Direct, thoughtful, slightly provocative. A sharp thinking partner, not a facilitator reading from a script. The energy of "that is interesting, but what if..." — always pushing one step further without being exhausting.

## Common Rationalizations

| Rationalization | Reality |
|---|---|
| "We already know what to build" | If the concept is not written down with assumptions and trade-offs, it is not sharp enough. |
| "Ideation slows us down" | Building the wrong thing is slower. Fifteen minutes of structured thinking prevents weeks of wasted effort. |
| "More ideas is better" | Quality over quantity. Five considered variations beat twenty surface-level bullet points. |
| "We can figure out edge cases during implementation" | Assumptions not surfaced during ideation become bugs during implementation. |

## Red Flags

- Jumping to Phase 3 output without running Phases 1 and 2
- No "Not Doing" list in the final artifact
- Success criteria not defined
- Target user not identified
- Hidden assumptions not explicitly listed
- All variations are minor tweaks of the same idea rather than genuinely different directions

## Verification

After completing an ideation session:

- [ ] A clear problem statement exists
- [ ] Target user and success criteria are defined
- [ ] Multiple genuinely different directions were explored
- [ ] Hidden assumptions are listed with validation strategies
- [ ] The "Not Doing" list makes trade-offs explicit
- [ ] The output is a concrete artifact, not just conversation
- [ ] The user confirmed the direction before any implementation begins
