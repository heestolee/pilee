<p align="right">
  <a href="./README.md">한글</a> | <strong>English</strong>
</p>

# pilee 🔥

> Charmander + pi + Lee

A personal configuration package for the [pi](https://github.com/badlogic/pi-mono) coding agent.
Built from 1,852 Conductor sessions, without forking or wrapping the product: pilee extends pi directly through extensions, skills, agents, tools, and workflow rules.

## Install

```bash
pi install https://github.com/heestolee/pilee
```

---

## Contents

- [Design philosophy](#design-philosophy)
- [Core workflows](#core-workflows)
- [Knowledge](#knowledge)
- [Extensions](#extensions)
- [Skills](#skills)
- [Agents](#agents)
- [Theme & prompts](#theme--prompts)
- [Token budget](#token-budget)
- [Shortcuts](#shortcuts)
- [Structure](#structure)

---

## Design philosophy

### Why build it directly?

[Conductor](https://www.conductor.build/) was a well-made product. It gave me worktree management, parallel sessions, MCP connections, and system prompts in one app.

After running 1,852 sessions across 185 workspaces, though, I started to feel the limits of a closed product surface.

### Limits I kept hitting

**1. It could not be customized deeply enough**

Custom prompt columns existed, but that was about it. I could not add my own skills, extensions, agent definitions, tool renderers, or workflow contracts unless the product already exposed that surface.

**2. Workspaces scaled disk usage linearly**

Conductor used Git worktrees, but setup copied `node_modules` physically instead of using symlinks.

```text
Average workspace size:  5.4GB (top 10)
35 workspaces total:     123GB
conductor.db:            1.8GB (315K messages, single SQLite)
```

Scaling out workspaces scaled up disk usage.

**3. Workspace cloning was opaque**

The public docs explained the concept and usage of workspaces, but not the internal clone mechanics: which files were copied, which files were linked, why MCP config disappeared, or why extra files were created.

The app also kept a native process resident, spawned Claude Code processes per session, and hid the capsule when something went wrong.

**4. Internal constraints could not be bypassed**

Some constraints were simply locked in:

- global MCP config worked in external terminals but not inside Conductor
- Korean input was split into jamo in the embedded terminal
- externally created Git branches could not be attached to existing workspaces

When the mechanism is closed, even deciding whether something is intentional or a bug becomes hard.

### What pi + pilee gives me

| Conductor limit | pi + pilee response |
|---|---|
| Workspace setup physically copies dependencies | Create only Git worktrees; dependency setup is explicit, profiled, and scriptable |
| Single large SQLite session DB | Per-session JSONL files under `~/.pi/agent/sessions/` |
| No custom skills/extensions/agents | Register commands, tools, shortcuts, custom TUI, skills, and agents directly |
| Internal constraints are fixed | Behavior is TypeScript; change code and run `pi update` |
| Prompt customization is shallow | Redesign the workflow itself: TFT rules, `(obvious)` pattern, frame → decide → verify |
| Workspace clone behavior is opaque | Worktree creation, dashboard state, and session switching live in explicit code |
| Heavy app/process footprint | Terminal-level processes and OS-level isolation |

Conductor is a strong default. pilee is the custom workflow I wanted after learning exactly what I needed and what I kept missing.

---

## Core workflows

### frame → decide → verify

```text
/frame    Build a structured frame
  ↓       - success_criteria that can be verified row by row
  ↓       - verify_plan, risk_register, edge_case_seeds
/decide   Resolve decisions discovered during framing
  ↓       - frame.decision task queue
  ↓
(build)
  ↓
/verify   Mechanical reader for frame.json
          - PASS/FAIL per success criterion
          - blocks ritual questions and imaginary out-of-scope scenarios
          - blocks PR progress when required checks are still unverified
```

### Subagent delegation

```text
>> implement this              → worker runs in the background
>>/ find the relevant files     → finder (read/grep/find only)
>>? research this library       → searcher (web research)
>># make an implementation plan → planner
>>! challenge this plan         → challenger
>>@ run E2E checks              → browser
>>> hidden task                 → result stays out of the main LLM context
```

`>>` is one-way delegation: send work out, get the result back. If I need live intervention, I use fork-panels instead.

### Worktree dashboard

```text
Ctrl+W                       → worktree overlay
/wt new                      → new clean worktree session
/wt new --carry-context      → new worktree with current session context
/wt fork                     → dedicated carry-context UX
/wt resume <name>            → restore a Conductor workspace
/wt bootstrap [status]       → profile-based dependency readiness orchestrator
/wt switch                   → switch worktree, session, and cwd together
```

Safety gates before creating a worktree:

- Investigation prompts do not create worktrees.
- If the current session contains useful investigation or planning context, use `/wt fork` instead of a fresh worktree.
- Hotfix/production work must be created from the hotfix base.
- Child fork-panels hand off protected worktree creation to parent `P0`.
- Profiled worktrees can start an AI bootstrapper subagent that runs a deterministic executor, reads logs, and reports READY/BLOCKED.

Dashboard states: `backlog` / `active` / `done` / `archive`.

### stress-interview → self-healing

```text
/stress-interview   parallel review from multiple agents
                    - verifier: correctness
                    - reviewer: quality and patterns
                    - challenger: holes and edge cases
  ↓
/self-healing       applies only actionable findings, up to 2 cycles
                    - fix_class: AUTO_FIX / ASK / INFO
```

### TFT 4 laws

| # | Law | Core idea |
|---|---|---|
| 1 | Ask at real fork points | If choices lead to different outcomes, ask. If a choice is obvious, mark it with evidence. |
| 2 | Do not make risky decisions alone | Payment, security, PII, schema, concurrency, external services, and production config require user judgment. |
| 3 | No completion without evidence | “Done” must come after verification. |
| 4 | No ritual questions | Do not ask questions whose answer is already decided. |

The `(obvious)` pattern is the third option between “ask everything” and “silently decide”: state the assumption with evidence, proceed, and let the user correct it if needed.

---

## Knowledge

Public, sanitized design knowledge lives in [`docs/knowledge/README.md`](./docs/knowledge/README.md).

**Ember** is the friendly entrypoint for that knowledge layer. `/ember` collects reusable insights from a session, `/ember tend` checks freshness/confidence review queues, and `/ember resolve` turns stale or review-needed docs into local resolver PR work.

Company, account, local path, and private operating context do not belong in public pilee. They live in private overlay packages. To create one safely, start from [`pilee-private-overlay-template`](https://github.com/heestolee/pilee-private-overlay-template), which uses fake ACME examples only.

<p align="center">
  <img src="./tmp/knowledge-map.ko.svg" alt="pilee knowledge map" width="900"/>
</p>

---

## Extensions

37 extensions. Extensions that do not register tools, such as spinner or session-title, add no tool-schema token cost.

### Infrastructure

| Name | Role |
|---|---|
| **subagent** | Background agent delegation through `>>`, retry, escalation, and `/subagents` TUI |
| **supervisor** | Outcome guardrail that watches conversation drift |
| **cc-system-prompt** | Minimal Claude Code system prompt bridge |
| **claude-code-ui** | Custom rendering for Read/Write/Edit/Bash output |
| **claude-hooks-bridge** | Claude hooks event bridge |
| **mcp-bridge** | MCP proxy from existing MCP server config |
| **dynamic-agents-md** | Injects relevant AGENTS.md context |
| **context-loader** | Minimal contextual loading surface |
| **tool-group-renderer** | Groups and collapses related tool output |
| **tft-commands** | Routes `/frame`, `/decide`, `/verify` to pilee skills |
| **frame-studio** | Glimpse-based live `/frame` studio with choices and transcript replay |

### Session management

| Name | Role |
|---|---|
| **worktree** | Git worktree dashboard, tags, filters, bootstrapper, and switching |
| **fork-panel** | Ghostty split panels, `P0/P1/P2` labels, handoff inbox, revive, and repanel |
| **session-title** | Automatic session titles |

### UI / UX

| Name | Role |
|---|---|
| **footer** | Custom footer with branch, model, thinking level, and context bar |
| **custom-style** | Editor styling, delegation mode display, border, ghost text |
| **prompt-suggest-lite** | Lightweight prompt suggestions while typing |
| **notify** | Completion widget and macOS notification |
| **idle-screensaver** | Idle screen with Pokémon sprite and last context |
| **spinner** | Streaming animation |
| **working-text** | Current work status text |
| **queued-messages** | Queue visualization and idle watchdog |
| **diff-overlay** | `/diff` TUI with commit mode, file tree, and syntax highlight |
| **timestamp** | `/timestamp` conversation timeline |
| **archive-to-html** | Verify/Web Search HTML archive, Artifact Browser, and live Verify preview |

### Tools and data

| Name | Role |
|---|---|
| **tasks** | Task CRUD and `Ctrl+Shift+T` |
| **web-access** | Tavily web search, URL extraction, and curator workflow |
| **memory-layer** | Long-term memory save/search |
| **ember** | Friendly entrypoint for knowledge collection and review |
| **backlog** | Persistent backlog TUI |
| **preflight** | Pre-commit lint/type-check hooks |
| **pr-comments** | PR comment workflow helpers |
| **until** | Explicit until-loop progress reporting |
| **usage-analytics** | Agent and skill usage statistics |
| **usage-reporter** | Usage reports |
| **retro** | Daily/weekly/monthly retrospective integration |
| **utils** | Shared internal helpers, not a user-facing contract |

---

## Skills

19 global workflow skills. Project-specific skills belong in project/private overlays.

### Core cycle

| Skill | Role |
|---|---|
| **tft-guidelines** | TFT laws, `(obvious)` pattern, and anti-rationalization rules |
| **ask-user-question-rules** | How to write useful decision questions |
| **frame** | Creates structured frame data before implementation |
| **decide** | Resolves decision tasks from a frame |
| **verify** | Reads frame data mechanically and verifies evidence |

### Review

| Skill | Role |
|---|---|
| **stress-interview** | Multi-agent review across correctness, quality, and edge cases |
| **self-healing** | Turns review findings into actionable fix cycles |
| **code-review-and-quality** | Code review quality checklist |

### Workflow

| Skill | Role |
|---|---|
| **systematic-debugging** | Root-cause-first debugging process |
| **debugging-and-error-recovery** | Error recovery and failed-check triage |
| **git-workflow-and-versioning** | Git discipline, commits, branches, and worktrees |
| **incremental-implementation** | Thin vertical slices with verification between steps |
| **skill-creator** | Skill creation, improvement, and evaluation |
| **pilee-knowledge** | Promote private history into public/sanitized knowledge |
| **db-write** | Human-gated DB write guidance |
| **db-write-migration** | Migration design and verification guidance |
| **jira-issue-management** | Jira issue preparation with preview gate |
| **verify-report** | Capture/evidence-based verification reports |
| **start-local-dev** | Local dev server startup diagnosis |

---

## Agents

9 agents. `scripts/sync-agents.mjs` syncs them into `~/.pi/agent/agents/` after install.

### Subagents (`>>` symbols)

| Agent | Symbol | Model | Role |
|---|---|---|---|
| **worker** | `>>` | openai-codex/gpt-5.5 | General implementation and fixes |
| **finder** | `>>/` | openai-codex/gpt-5.4 | Code/file search with read-only tools |
| **searcher** | `>>?` | openai-codex/gpt-5.4 | Web research and documentation lookup |
| **planner** | `>>#` | openai-codex/gpt-5.5 | Implementation planning |
| **challenger** | `>>!` | openai-codex/gpt-5.5 | Challenge plans, find holes and edge cases |
| **browser** | `>>@` | openai-codex/gpt-5.5 | Playwright E2E and UI checks |
| **bootstrapper** | internal `/wt` | openai-codex/gpt-5.5 | Dependency readiness orchestrator |

### Review agents (`/stress-interview`)

| Agent | Perspective |
|---|---|
| **verifier** | Does the implementation satisfy the requirement? |
| **reviewer** | Is the code maintainable and consistent? |

---

## Theme & prompts

**claude-code-dark** — Charmander orange accent `#d77757` 🔥

**Prompts:**

- `fix-bug` — bug fix template
- `jira-format` — Jira issue format

---

## Token budget

Compared to bare pi, early pilee added about 6K tokens of overhead per turn. The main fixes:

| Source | Cost | Response |
|---|---:|---|
| Duplicate cc-system-prompt + pi system prompt | +2K/turn | Keep cc-system-prompt minimal; move workflow rules into skills |
| 25+ tool schemas sent every turn | +3.4K/turn | Enable heavy tools only when needed through config |
| Unused generic skills | +480/turn | Remove unused skills |

---

## Shortcuts

| Key | Action |
|---|---|
| `Ctrl+W` | Worktree dashboard |
| `Ctrl+Shift+→←↑↓` | Split fork-panel by direction |
| `Ctrl+Shift+N` | New fork-panel tab |
| `Ctrl+Shift+T` | Open tasks |

---

## Structure

```text
pilee/
├── extensions/     # Pi extensions
├── skills/         # workflow skills
├── agents/         # subagent definitions
├── themes/         # claude-code-dark
├── prompts/        # fix-bug, jira-format
├── scripts/        # sync-agents.mjs, knowledge.mjs
└── AGENTS.md       # core agent instructions
```
