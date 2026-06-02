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
| 2 | Risky decisions require user judgment | Payment, security, PII, schema, concurrency, external services, and production config are non-delegable. |
| 3 | No completion without evidence | “Done” must come after verification. |
| 4 | No ritual questions | Questions whose answer is already decided are skipped. |

The `(obvious)` pattern is the third option between “ask everything” and “silently decide”: state the assumption with evidence, proceed, and let the user correct it if needed.

---

## Knowledge

Public, sanitized design knowledge lives in [`docs/knowledge/README.md`](./docs/knowledge/README.md).

**Ember** is the friendly entrypoint for that knowledge layer. `/ember` collects reusable insights from a session and asks whether to add them, `/ember add` enters the public knowledge write/update flow directly, `/ember check` reviews freshness/confidence status and suggests next actions, and `/ember refresh` regenerates and verifies generated surfaces such as README tables, docs/knowledge README, and the SVG map.

Company, account, local path, and private operating context do not belong in public pilee. They live in private overlay packages. To create one safely, start from [`pilee-private-overlay-template`](https://github.com/heestolee/pilee-private-overlay-template), which uses fake ACME examples only.

<p align="center">
  <img src="./tmp/knowledge-map.ko.svg" alt="pilee knowledge map" width="900"/>
</p>

The linked knowledge docs are currently Korean. This English README keeps the same coverage table with English link labels so each extension, skill, agent, script, and concern still points to its related doctrine.

<!-- PILEE_ROOT_KNOWLEDGE_LINKS_START -->
> Source docs drive this generated block; refresh with `node scripts/knowledge.mjs --graph` after changes.

| Type | Surface | Knowledge docs |
|---|---|---|
| extension | `extensions/archive-to-html` | [Artifact Archive Reopenability](./docs/knowledge/artifact-archive-reopenability.md)<br>[Backlog Source Session Provenance](./docs/knowledge/backlog-source-session-provenance.md)<br>[Clean Handoff Session Continuation](./docs/knowledge/clean-handoff-session-continuation.md)<br>[Deterministic Fallbacks Preserve Workflow](./docs/knowledge/deterministic-fallbacks-preserve-workflow.md)<br>[Embedded Webview Script Escape Boundary](./docs/knowledge/embedded-webview-script-escape-boundary.md)<br>[Evidence First Verification Gate](./docs/knowledge/evidence-first-verification-gate.md)<br>[Frame Studio Interactive Decision UI](./docs/knowledge/frame-studio-interactive-decision-ui.md)<br>[Live Artifact Preview Pattern](./docs/knowledge/live-artifact-preview-pattern.md)<br>[Private Overlay Package Boundary](./docs/knowledge/private-overlay-package-boundary.md)<br>[Session Classification Sidecar](./docs/knowledge/session-classification-sidecar.md)<br>[Session Export Source Preservation](./docs/knowledge/session-export-source-preservation.md)<br>[Terminal Host Integration](./docs/knowledge/terminal-host-integration.md)<br>[Verify Report Workflow](./docs/knowledge/verify-report-workflow.md) |
| extension | `extensions/auto-commit` | [Auto-commit executes only explicit plans](./docs/knowledge/auto-commit-explicit-plan-gate.md)<br>[Slice Auto Commit Rhythm](./docs/knowledge/slice-auto-commit-rhythm.md) |
| extension | `extensions/backlog` | [Artifact Archive Reopenability](./docs/knowledge/artifact-archive-reopenability.md)<br>[Backlog Source Session Provenance](./docs/knowledge/backlog-source-session-provenance.md)<br>[Session Export Source Preservation](./docs/knowledge/session-export-source-preservation.md)<br>[Theme Information Hierarchy](./docs/knowledge/theme-information-hierarchy.md)<br>[TUI Rendering Sanitization](./docs/knowledge/tui-rendering-sanitization.md) |
| extension | `extensions/bash-tool-override` | [Bash Tool Title Output Override](./docs/knowledge/bash-tool-title-output-override.md) |
| extension | `extensions/cc-system-prompt` | [Context Loading Minimal Surface](./docs/knowledge/context-loading-minimal-surface.md) |
| extension | `extensions/claude-code-ui` | [Tool Output Noise Management](./docs/knowledge/tool-output-noise-management.md)<br>[TUI Rendering Sanitization](./docs/knowledge/tui-rendering-sanitization.md) |
| extension | `extensions/claude-hooks-bridge` | [Context Loading Minimal Surface](./docs/knowledge/context-loading-minimal-surface.md) |
| extension | `extensions/codex-fast-mode` | [Codex fast mode only reduces output verbosity and priority tier](./docs/knowledge/codex-fast-mode-runtime.md) |
| extension | `extensions/context-loader` | [Context Loading Minimal Surface](./docs/knowledge/context-loading-minimal-surface.md) |
| extension | `extensions/continue-clean` | [Clean Handoff Session Continuation](./docs/knowledge/clean-handoff-session-continuation.md) |
| extension | `extensions/custom-style` | [Codex fast mode only reduces output verbosity and priority tier](./docs/knowledge/codex-fast-mode-runtime.md)<br>[Editor Affordance Not Context](./docs/knowledge/editor-affordance-not-context.md)<br>[Korean First User Facing Output](./docs/knowledge/korean-first-user-facing-output.md)<br>[Terminal Host Integration](./docs/knowledge/terminal-host-integration.md)<br>[Theme Information Hierarchy](./docs/knowledge/theme-information-hierarchy.md) |
| extension | `extensions/diff-overlay` | [Diff Review Draft Handoff](./docs/knowledge/diff-review-draft-handoff.md)<br>[Theme Information Hierarchy](./docs/knowledge/theme-information-hierarchy.md)<br>[TUI Rendering Sanitization](./docs/knowledge/tui-rendering-sanitization.md) |
| extension | `extensions/dynamic-agents-md` | [Context Loading Minimal Surface](./docs/knowledge/context-loading-minimal-surface.md)<br>[Skills As Portable Procedures](./docs/knowledge/skills-as-portable-procedures.md) |
| extension | `extensions/edit-tool-override` | [Read Edit Tool Output Override](./docs/knowledge/read-edit-tool-output-override.md) |
| extension | `extensions/ember` | [Ember Friendly Knowledge Entrypoint](./docs/knowledge/ember-friendly-knowledge-entrypoint.md)<br>[Ember Ship Release Train](./docs/knowledge/ember-ship-release-train.md) |
| extension | `extensions/ember-ship` | [Ember Friendly Knowledge Entrypoint](./docs/knowledge/ember-friendly-knowledge-entrypoint.md)<br>[Ember Ship Release Train](./docs/knowledge/ember-ship-release-train.md)<br>[Knowledge Review Queue PR Body](./docs/knowledge/knowledge-review-queue-pr-body.md)<br>[Skills As Portable Procedures](./docs/knowledge/skills-as-portable-procedures.md) |
| extension | `extensions/footer` | [Editor Affordance Not Context](./docs/knowledge/editor-affordance-not-context.md) |
| extension | `extensions/fork-panel` | [Fork Panel Parent Inbox](./docs/knowledge/fork-panel-parent-inbox.md)<br>[Fork Panel Spatial Continuity](./docs/knowledge/fork-panel-spatial-continuity.md)<br>[MCP Stderr Isolation](./docs/knowledge/mcp-stderr-isolation.md)<br>[Revive Over Transcript Recall](./docs/knowledge/revive-over-transcript-recall.md)<br>[Session Identity Over Filenames](./docs/knowledge/session-identity-over-filenames.md)<br>[Terminal Host Integration](./docs/knowledge/terminal-host-integration.md)<br>[Terminal Workspace Restore](./docs/knowledge/terminal-workspace-restore.md)<br>[Theme Information Hierarchy](./docs/knowledge/theme-information-hierarchy.md)<br>[TUI Rendering Sanitization](./docs/knowledge/tui-rendering-sanitization.md)<br>[Worktree Creation Parent Gate](./docs/knowledge/worktree-creation-parent-gate.md)<br>[Worktree Session Continuity](./docs/knowledge/worktree-session-continuity.md) |
| extension | `extensions/frame-studio` | [Ask User Question Decision Gates](./docs/knowledge/ask-user-question-decision-gates.md)<br>[Ask User Question Option Design](./docs/knowledge/ask-user-question-option-design.md)<br>[Decide Tradeoff Challenge](./docs/knowledge/decide-tradeoff-challenge.md)<br>[Embedded Webview Script Escape Boundary](./docs/knowledge/embedded-webview-script-escape-boundary.md)<br>[Frame Plan Synthesis Continuity](./docs/knowledge/frame-plan-synthesis-continuity.md)<br>[Frame Studio Interactive Decision UI](./docs/knowledge/frame-studio-interactive-decision-ui.md)<br>[Live Artifact Preview Pattern](./docs/knowledge/live-artifact-preview-pattern.md)<br>[Queued Command Prefill Boundary](./docs/knowledge/queued-command-prefill-boundary.md)<br>[Source Grounded Frame Planning](./docs/knowledge/source-grounded-frame-planning.md)<br>[Task Work Map Overlay](./docs/knowledge/task-work-map-overlay.md)<br>[TFT Visual Structure Renderer](./docs/knowledge/tft-visual-structure-renderer.md)<br>[Working Context Card compresses large context into the current slice](./docs/knowledge/work-context-card-task-board.md)<br>[Repeated workflow failures become enforced guard flows](./docs/knowledge/workflow-guard-enforced-flow.md) |
| extension | `extensions/idle-screensaver` | [Ambient Status Surfaces](./docs/knowledge/ambient-status-surfaces.md)<br>[Theme Information Hierarchy](./docs/knowledge/theme-information-hierarchy.md) |
| extension | `extensions/interactive-shell` | [Interactive Shell Overlay Tool](./docs/knowledge/interactive-shell-overlay-tool.md) |
| extension | `extensions/mcp-bridge` | [Artifact Archive Reopenability](./docs/knowledge/artifact-archive-reopenability.md)<br>[Deterministic Fallbacks Preserve Workflow](./docs/knowledge/deterministic-fallbacks-preserve-workflow.md)<br>[MCP Digest First Artifacts](./docs/knowledge/mcp-digest-first-artifacts.md)<br>[MCP Stderr Isolation](./docs/knowledge/mcp-stderr-isolation.md)<br>[Terminal Host Integration](./docs/knowledge/terminal-host-integration.md)<br>[Tool Output Noise Management](./docs/knowledge/tool-output-noise-management.md) |
| extension | `extensions/memory-layer` | [Context Loading Minimal Surface](./docs/knowledge/context-loading-minimal-surface.md) |
| extension | `extensions/notify` | [Terminal Host Integration](./docs/knowledge/terminal-host-integration.md) |
| extension | `extensions/pr-comments` | [Diff Review Draft Handoff](./docs/knowledge/diff-review-draft-handoff.md)<br>[Ship PR Ship Review Boundary](./docs/knowledge/ship-pr-ship-review-boundary.md) |
| extension | `extensions/pr-review-re-request` | [Ship PR Ship Review Boundary](./docs/knowledge/ship-pr-ship-review-boundary.md) |
| extension | `extensions/preflight` | [Private Overlay Package Boundary](./docs/knowledge/private-overlay-package-boundary.md)<br>[Root Cause Before Fix](./docs/knowledge/root-cause-before-fix.md)<br>[Repeated validation failures are separated by a baseline cache](./docs/knowledge/validation-baseline-failure-cache.md)<br>[Repeated workflow failures become enforced guard flows](./docs/knowledge/workflow-guard-enforced-flow.md) |
| extension | `extensions/prompt-suggest-lite` | [Editor Affordance Not Context](./docs/knowledge/editor-affordance-not-context.md) |
| extension | `extensions/queued-messages` | [Queued Command Prefill Boundary](./docs/knowledge/queued-command-prefill-boundary.md) |
| extension | `extensions/read-tool-override` | [Read Edit Tool Output Override](./docs/knowledge/read-edit-tool-output-override.md) |
| extension | `extensions/retro` | [Retro Private Reflection Boundary](./docs/knowledge/retro-private-reflection-boundary.md) |
| extension | `extensions/session-title` | [Backlog Source Session Provenance](./docs/knowledge/backlog-source-session-provenance.md)<br>[Session Identity Over Filenames](./docs/knowledge/session-identity-over-filenames.md) |
| extension | `extensions/ship-commands` | [Ci Ship Failure Response Boundary](./docs/knowledge/ci-ship-failure-response-boundary.md)<br>[Ship PR Ship Review Boundary](./docs/knowledge/ship-pr-ship-review-boundary.md)<br>[Subagent Skill Delegation](./docs/knowledge/subagent-skill-delegation.md) |
| extension | `extensions/shortcut-atlas` | [Shortcut Atlas Conflict Audit](./docs/knowledge/shortcut-atlas-conflict-audit.md) |
| extension | `extensions/spinner` | [Ambient Status Surfaces](./docs/knowledge/ambient-status-surfaces.md) |
| extension | `extensions/subagent` | [AI Worker Readiness Orchestrator](./docs/knowledge/ai-worker-readiness-orchestrator.md)<br>[Final Verification Parallelization](./docs/knowledge/final-verification-parallelization.md)<br>[Queued Command Prefill Boundary](./docs/knowledge/queued-command-prefill-boundary.md)<br>[Self Healing Actionable Loop](./docs/knowledge/self-healing-actionable-loop.md)<br>[Stress Interview Multi Axis Review](./docs/knowledge/stress-interview-multi-axis-review.md)<br>[Subagent Model Policy](./docs/knowledge/subagent-model-policy.md)<br>[Subagent Prompt Specificity](./docs/knowledge/subagent-prompt-specificity.md)<br>[Subagent Skill Delegation](./docs/knowledge/subagent-skill-delegation.md) |
| extension | `extensions/supervisor` | [Supervisor Outcome Guardrail](./docs/knowledge/supervisor-outcome-guardrail.md) |
| extension | `extensions/tasks` | [Ambient Status Surfaces](./docs/knowledge/ambient-status-surfaces.md)<br>[Backlog Source Session Provenance](./docs/knowledge/backlog-source-session-provenance.md)<br>[Queued Command Prefill Boundary](./docs/knowledge/queued-command-prefill-boundary.md)<br>[Source Grounded Frame Planning](./docs/knowledge/source-grounded-frame-planning.md)<br>[Task Work Map Overlay](./docs/knowledge/task-work-map-overlay.md)<br>[Working Context Card compresses large context into the current slice](./docs/knowledge/work-context-card-task-board.md) |
| extension | `extensions/tft-commands` | [Frame Planning Identity](./docs/knowledge/frame-planning-identity.md)<br>[Frame Studio Interactive Decision UI](./docs/knowledge/frame-studio-interactive-decision-ui.md)<br>[Queued Command Prefill Boundary](./docs/knowledge/queued-command-prefill-boundary.md)<br>[TFT Command Shim Skill Routing](./docs/knowledge/tft-command-shim-skill-routing.md) |
| extension | `extensions/timestamp` | [Theme Information Hierarchy](./docs/knowledge/theme-information-hierarchy.md)<br>[TUI Rendering Sanitization](./docs/knowledge/tui-rendering-sanitization.md) |
| extension | `extensions/to-production` | [To Production Source Preserving Hotfix](./docs/knowledge/to-production-source-preserving-hotfix.md) |
| extension | `extensions/tool-group-renderer` | [Tool Output Noise Management](./docs/knowledge/tool-output-noise-management.md) |
| extension | `extensions/tui-ask` | [Theme Information Hierarchy](./docs/knowledge/theme-information-hierarchy.md)<br>[TUI Ask is a lightweight decision gate](./docs/knowledge/tui-ask-decision-overlay.md)<br>[Repeated workflow failures become enforced guard flows](./docs/knowledge/workflow-guard-enforced-flow.md) |
| extension | `extensions/until` | [Until Loop Explicit Reporting](./docs/knowledge/until-loop-explicit-reporting.md) |
| extension | `extensions/update-branch` | [Update Branch Safe Pull Command](./docs/knowledge/update-branch-safe-pull-command.md) |
| extension | `extensions/usage-analytics` | [Tool Output Noise Management](./docs/knowledge/tool-output-noise-management.md) |
| extension | `extensions/usage-reporter` | [Ambient Status Surfaces](./docs/knowledge/ambient-status-surfaces.md)<br>[Tool Output Noise Management](./docs/knowledge/tool-output-noise-management.md) |
| extension | `extensions/user-facing-language` | [Korean First User Facing Output](./docs/knowledge/korean-first-user-facing-output.md) |
| extension | `extensions/utils` | [Frame Studio Interactive Decision UI](./docs/knowledge/frame-studio-interactive-decision-ui.md)<br>[MCP Stderr Isolation](./docs/knowledge/mcp-stderr-isolation.md)<br>[Read Edit Tool Output Override](./docs/knowledge/read-edit-tool-output-override.md)<br>[Session Export Source Preservation](./docs/knowledge/session-export-source-preservation.md)<br>[Terminal Host Integration](./docs/knowledge/terminal-host-integration.md)<br>[Utility Surface Stays Invisible](./docs/knowledge/utility-surface-stays-invisible.md)<br>[Working Context Card compresses large context into the current slice](./docs/knowledge/work-context-card-task-board.md) |
| extension | `extensions/web-access` | [Artifact Archive Reopenability](./docs/knowledge/artifact-archive-reopenability.md)<br>[Curator Approved Source Selection](./docs/knowledge/curator-approved-source-selection.md)<br>[Deterministic Fallbacks Preserve Workflow](./docs/knowledge/deterministic-fallbacks-preserve-workflow.md)<br>[Embedded Webview Script Escape Boundary](./docs/knowledge/embedded-webview-script-escape-boundary.md)<br>[Korean First User Facing Output](./docs/knowledge/korean-first-user-facing-output.md)<br>[Live Artifact Preview Pattern](./docs/knowledge/live-artifact-preview-pattern.md)<br>[Web Search Curator](./docs/knowledge/web-search-curator.md) |
| extension | `extensions/work-context` | [Auto-commit executes only explicit plans](./docs/knowledge/auto-commit-explicit-plan-gate.md)<br>[Slice Auto Commit Rhythm](./docs/knowledge/slice-auto-commit-rhythm.md)<br>[Task Work Map Overlay](./docs/knowledge/task-work-map-overlay.md)<br>[Working Context Card compresses large context into the current slice](./docs/knowledge/work-context-card-task-board.md) |
| extension | `extensions/workflow-guard` | [Long-running sessions are controlled by phases and stop-lines](./docs/knowledge/long-running-session-control.md)<br>[Slice Auto Commit Rhythm](./docs/knowledge/slice-auto-commit-rhythm.md)<br>[Working Context Card compresses large context into the current slice](./docs/knowledge/work-context-card-task-board.md)<br>[Repeated workflow failures become enforced guard flows](./docs/knowledge/workflow-guard-enforced-flow.md) |
| extension | `extensions/working-text` | [Editor Affordance Not Context](./docs/knowledge/editor-affordance-not-context.md) |
| extension | `extensions/workspace` | [Terminal Host Integration](./docs/knowledge/terminal-host-integration.md)<br>[Terminal Workspace Restore](./docs/knowledge/terminal-workspace-restore.md) |
| extension | `extensions/worktree` | [AI Worker Readiness Orchestrator](./docs/knowledge/ai-worker-readiness-orchestrator.md)<br>[Frame Plan Synthesis Continuity](./docs/knowledge/frame-plan-synthesis-continuity.md)<br>[Private Overlay Package Boundary](./docs/knowledge/private-overlay-package-boundary.md)<br>[Queued Command Prefill Boundary](./docs/knowledge/queued-command-prefill-boundary.md)<br>[Revive Over Transcript Recall](./docs/knowledge/revive-over-transcript-recall.md)<br>[Session Identity Over Filenames](./docs/knowledge/session-identity-over-filenames.md)<br>[Worktree Creation Parent Gate](./docs/knowledge/worktree-creation-parent-gate.md)<br>[Worktree Dependency Bootstrap Worker](./docs/knowledge/worktree-dependency-bootstrap-worker.md)<br>[Worktree Execution Boundary](./docs/knowledge/worktree-execution-boundary.md)<br>[Worktree Session Continuity](./docs/knowledge/worktree-session-continuity.md) |
| skill | `skills/ask-user-question-rules` | [Ask User Question Decision Gates](./docs/knowledge/ask-user-question-decision-gates.md)<br>[Ask User Question Option Design](./docs/knowledge/ask-user-question-option-design.md)<br>[TFT Preference Regression Gate](./docs/knowledge/tft-preference-regression-gate.md)<br>[Theme Information Hierarchy](./docs/knowledge/theme-information-hierarchy.md)<br>[TUI Ask is a lightweight decision gate](./docs/knowledge/tui-ask-decision-overlay.md) |
| skill | `skills/ci-ship` | [Ci Ship Failure Response Boundary](./docs/knowledge/ci-ship-failure-response-boundary.md)<br>[Runtime Fanout Diagnosis](./docs/knowledge/runtime-fanout-diagnosis.md)<br>[Subagent Skill Delegation](./docs/knowledge/subagent-skill-delegation.md) |
| skill | `skills/code-review-and-quality` | [Change Integration Discipline](./docs/knowledge/change-integration-discipline.md)<br>[Diff Review Draft Handoff](./docs/knowledge/diff-review-draft-handoff.md)<br>[Request Traceability Surgical Changes](./docs/knowledge/request-traceability-surgical-changes.md)<br>[Verification Invalidation On Change](./docs/knowledge/verification-invalidation-on-change.md) |
| skill | `skills/db-write` | [Database Write Human Execution Gate](./docs/knowledge/database-write-human-execution-gate.md)<br>[Private Overlay Package Boundary](./docs/knowledge/private-overlay-package-boundary.md) |
| skill | `skills/db-write-migration` | [Database Write Human Execution Gate](./docs/knowledge/database-write-human-execution-gate.md)<br>[Private Overlay Package Boundary](./docs/knowledge/private-overlay-package-boundary.md) |
| skill | `skills/debugging-and-error-recovery` | [Root Cause Before Fix](./docs/knowledge/root-cause-before-fix.md) |
| skill | `skills/decide` | [Architecture Friction TFT Lens](./docs/knowledge/architecture-friction-tft-lens.md)<br>[Ask User Question Decision Gates](./docs/knowledge/ask-user-question-decision-gates.md)<br>[Ask User Question Option Design](./docs/knowledge/ask-user-question-option-design.md)<br>[Backend Layer Map Frame Gate](./docs/knowledge/backend-layer-map-frame-gate.md)<br>[Decide Tradeoff Challenge](./docs/knowledge/decide-tradeoff-challenge.md)<br>[Frame Verify Contract](./docs/knowledge/frame-verify-contract.md)<br>[Policy Axis Frame Gate](./docs/knowledge/policy-axis-frame-gate.md)<br>[TFT Command Shim Skill Routing](./docs/knowledge/tft-command-shim-skill-routing.md)<br>[TFT Preference Regression Gate](./docs/knowledge/tft-preference-regression-gate.md) |
| skill | `skills/frame` | [Architecture Friction TFT Lens](./docs/knowledge/architecture-friction-tft-lens.md)<br>[Ask User Question Decision Gates](./docs/knowledge/ask-user-question-decision-gates.md)<br>[Ask User Question Option Design](./docs/knowledge/ask-user-question-option-design.md)<br>[Atomic Evidence Workflow](./docs/knowledge/atomic-evidence-workflow.md)<br>[Backend Layer Map Frame Gate](./docs/knowledge/backend-layer-map-frame-gate.md)<br>[Decide Tradeoff Challenge](./docs/knowledge/decide-tradeoff-challenge.md)<br>[Frame Plan Synthesis Continuity](./docs/knowledge/frame-plan-synthesis-continuity.md)<br>[Frame Planning Identity](./docs/knowledge/frame-planning-identity.md)<br>[Frame Studio Interactive Decision UI](./docs/knowledge/frame-studio-interactive-decision-ui.md)<br>[Frame Verify Contract](./docs/knowledge/frame-verify-contract.md)<br>[Policy Axis Frame Gate](./docs/knowledge/policy-axis-frame-gate.md)<br>[Slice Auto Commit Rhythm](./docs/knowledge/slice-auto-commit-rhythm.md)<br>[Source Grounded Frame Planning](./docs/knowledge/source-grounded-frame-planning.md)<br>[TFT Command Shim Skill Routing](./docs/knowledge/tft-command-shim-skill-routing.md)<br>[TFT Preference Regression Gate](./docs/knowledge/tft-preference-regression-gate.md)<br>[Working Context Card compresses large context into the current slice](./docs/knowledge/work-context-card-task-board.md)<br>[Workflow weight must match change risk](./docs/knowledge/workflow-weight-proportionality.md) |
| skill | `skills/git-workflow-and-versioning` | [Change Integration Discipline](./docs/knowledge/change-integration-discipline.md)<br>[Long-running sessions are controlled by phases and stop-lines](./docs/knowledge/long-running-session-control.md)<br>[Request Traceability Surgical Changes](./docs/knowledge/request-traceability-surgical-changes.md)<br>[Slice Auto Commit Rhythm](./docs/knowledge/slice-auto-commit-rhythm.md)<br>[Repeated validation failures are separated by a baseline cache](./docs/knowledge/validation-baseline-failure-cache.md) |
| skill | `skills/incremental-implementation` | [Atomic Evidence Workflow](./docs/knowledge/atomic-evidence-workflow.md)<br>[Change Integration Discipline](./docs/knowledge/change-integration-discipline.md)<br>[Long-running sessions are controlled by phases and stop-lines](./docs/knowledge/long-running-session-control.md)<br>[Request Traceability Surgical Changes](./docs/knowledge/request-traceability-surgical-changes.md)<br>[Slice Auto Commit Rhythm](./docs/knowledge/slice-auto-commit-rhythm.md)<br>[Workflow weight must match change risk](./docs/knowledge/workflow-weight-proportionality.md) |
| skill | `skills/interactive-shell` | [Interactive Shell Overlay Tool](./docs/knowledge/interactive-shell-overlay-tool.md) |
| skill | `skills/jira-issue-management` | [External Issue Preview Gate](./docs/knowledge/external-issue-preview-gate.md)<br>[Private Overlay Package Boundary](./docs/knowledge/private-overlay-package-boundary.md) |
| skill | `skills/pilee-final-check` | [Atomic Evidence Workflow](./docs/knowledge/atomic-evidence-workflow.md)<br>[Ember Ship Release Train](./docs/knowledge/ember-ship-release-train.md)<br>[Final Verification Parallelization](./docs/knowledge/final-verification-parallelization.md)<br>[Pilee Final Check Gate](./docs/knowledge/pilee-final-check-gate.md)<br>[TFT Preference Regression Gate](./docs/knowledge/tft-preference-regression-gate.md) |
| skill | `skills/pilee-knowledge` | [Confidence Sensitive Review](./docs/knowledge/confidence-sensitive-review.md)<br>[Ember Friendly Knowledge Entrypoint](./docs/knowledge/ember-friendly-knowledge-entrypoint.md)<br>[Ember Ship Release Train](./docs/knowledge/ember-ship-release-train.md)<br>[Freshness Diagnosis Report](./docs/knowledge/freshness-diagnosis-report.md)<br>[Judgment Doc Unit](./docs/knowledge/judgment-doc-unit.md)<br>[Knowledge Review Queue PR Body](./docs/knowledge/knowledge-review-queue-pr-body.md)<br>[Pilee Knowledge System](./docs/knowledge/pilee-knowledge-system.md)<br>[Private Journal Public Doctrine](./docs/knowledge/private-journal-public-doctrine.md)<br>[README Philosophy User Gate](./docs/knowledge/readme-philosophy-user-gate.md)<br>[Reviewed Commit Freshness](./docs/knowledge/reviewed-commit-freshness.md) |
| skill | `skills/pr-ship` | [Ship PR Ship Review Boundary](./docs/knowledge/ship-pr-ship-review-boundary.md)<br>[Subagent Skill Delegation](./docs/knowledge/subagent-skill-delegation.md) |
| skill | `skills/runtime-fanout-triage` | [Runtime Fanout Diagnosis](./docs/knowledge/runtime-fanout-diagnosis.md) |
| skill | `skills/self-healing` | [AI Worker Readiness Orchestrator](./docs/knowledge/ai-worker-readiness-orchestrator.md)<br>[Self Healing Actionable Loop](./docs/knowledge/self-healing-actionable-loop.md)<br>[Subagent Model Policy](./docs/knowledge/subagent-model-policy.md)<br>[Subagent Prompt Specificity](./docs/knowledge/subagent-prompt-specificity.md) |
| skill | `skills/ship` | [Final Verification Parallelization](./docs/knowledge/final-verification-parallelization.md)<br>[Ship PR Ship Review Boundary](./docs/knowledge/ship-pr-ship-review-boundary.md)<br>[Subagent Skill Delegation](./docs/knowledge/subagent-skill-delegation.md) |
| skill | `skills/skill-creator` | [Skills As Portable Procedures](./docs/knowledge/skills-as-portable-procedures.md) |
| skill | `skills/start-local-dev` | [Local Dev Startup Diagnosis](./docs/knowledge/local-dev-startup-diagnosis.md)<br>[Private Overlay Package Boundary](./docs/knowledge/private-overlay-package-boundary.md) |
| skill | `skills/stress-interview` | [AI Worker Readiness Orchestrator](./docs/knowledge/ai-worker-readiness-orchestrator.md)<br>[Self Healing Actionable Loop](./docs/knowledge/self-healing-actionable-loop.md)<br>[Stress Interview Multi Axis Review](./docs/knowledge/stress-interview-multi-axis-review.md)<br>[Subagent Model Policy](./docs/knowledge/subagent-model-policy.md)<br>[Subagent Prompt Specificity](./docs/knowledge/subagent-prompt-specificity.md) |
| skill | `skills/systematic-debugging` | [Root Cause Before Fix](./docs/knowledge/root-cause-before-fix.md)<br>[Runtime Fanout Diagnosis](./docs/knowledge/runtime-fanout-diagnosis.md)<br>[Skills As Portable Procedures](./docs/knowledge/skills-as-portable-procedures.md) |
| skill | `skills/tft-guidelines` | [Ask User Question Decision Gates](./docs/knowledge/ask-user-question-decision-gates.md)<br>[Ask User Question Option Design](./docs/knowledge/ask-user-question-option-design.md)<br>[Backend Layer Map Frame Gate](./docs/knowledge/backend-layer-map-frame-gate.md)<br>[Policy Axis Frame Gate](./docs/knowledge/policy-axis-frame-gate.md)<br>[TFT Preference Regression Gate](./docs/knowledge/tft-preference-regression-gate.md)<br>[TFT Visual Structure Renderer](./docs/knowledge/tft-visual-structure-renderer.md)<br>[TUI Ask is a lightweight decision gate](./docs/knowledge/tui-ask-decision-overlay.md) |
| skill | `skills/to-production` | [To Production Source Preserving Hotfix](./docs/knowledge/to-production-source-preserving-hotfix.md) |
| skill | `skills/verify` | [Architecture Friction TFT Lens](./docs/knowledge/architecture-friction-tft-lens.md)<br>[Ask User Question Decision Gates](./docs/knowledge/ask-user-question-decision-gates.md)<br>[Ask User Question Option Design](./docs/knowledge/ask-user-question-option-design.md)<br>[Atomic Evidence Workflow](./docs/knowledge/atomic-evidence-workflow.md)<br>[Backend Layer Map Frame Gate](./docs/knowledge/backend-layer-map-frame-gate.md)<br>[Decide Tradeoff Challenge](./docs/knowledge/decide-tradeoff-challenge.md)<br>[Evidence First Verification Gate](./docs/knowledge/evidence-first-verification-gate.md)<br>[Frame Verify Contract](./docs/knowledge/frame-verify-contract.md)<br>[Policy Axis Frame Gate](./docs/knowledge/policy-axis-frame-gate.md)<br>[Request Traceability Surgical Changes](./docs/knowledge/request-traceability-surgical-changes.md)<br>[TFT Command Shim Skill Routing](./docs/knowledge/tft-command-shim-skill-routing.md)<br>[TFT Preference Regression Gate](./docs/knowledge/tft-preference-regression-gate.md)<br>[Repeated validation failures are separated by a baseline cache](./docs/knowledge/validation-baseline-failure-cache.md)<br>[Verification Invalidation On Change](./docs/knowledge/verification-invalidation-on-change.md)<br>[Verify Risk Lens Overlay](./docs/knowledge/verify-risk-lens-overlay.md) |
| skill | `skills/verify-report` | [Atomic Evidence Workflow](./docs/knowledge/atomic-evidence-workflow.md)<br>[Backend Layer Map Frame Gate](./docs/knowledge/backend-layer-map-frame-gate.md)<br>[Deterministic Fallbacks Preserve Workflow](./docs/knowledge/deterministic-fallbacks-preserve-workflow.md)<br>[Evidence First Verification Gate](./docs/knowledge/evidence-first-verification-gate.md)<br>[Korean First User Facing Output](./docs/knowledge/korean-first-user-facing-output.md)<br>[Live Artifact Preview Pattern](./docs/knowledge/live-artifact-preview-pattern.md)<br>[Policy Axis Frame Gate](./docs/knowledge/policy-axis-frame-gate.md)<br>[Private Overlay Package Boundary](./docs/knowledge/private-overlay-package-boundary.md)<br>[Verification Invalidation On Change](./docs/knowledge/verification-invalidation-on-change.md)<br>[Verify Report starts after PM-facing contract and readiness are locked](./docs/knowledge/verify-report-preflight-readiness.md)<br>[Verify Report Workflow](./docs/knowledge/verify-report-workflow.md) |
| skill | `skills/verify-report-preflight` | [Verify Report starts after PM-facing contract and readiness are locked](./docs/knowledge/verify-report-preflight-readiness.md)<br>[Workflow weight must match change risk](./docs/knowledge/workflow-weight-proportionality.md) |
| agent | `agents` | [AI Worker Readiness Orchestrator](./docs/knowledge/ai-worker-readiness-orchestrator.md)<br>[Atomic Evidence Workflow](./docs/knowledge/atomic-evidence-workflow.md)<br>[Self Healing Actionable Loop](./docs/knowledge/self-healing-actionable-loop.md)<br>[Stress Interview Multi Axis Review](./docs/knowledge/stress-interview-multi-axis-review.md)<br>[Subagent Model Policy](./docs/knowledge/subagent-model-policy.md)<br>[Subagent Prompt Specificity](./docs/knowledge/subagent-prompt-specificity.md)<br>[Worktree Dependency Bootstrap Worker](./docs/knowledge/worktree-dependency-bootstrap-worker.md) |
| script | `scripts/check-pilee-final-check.mjs` | [Pilee Final Check Gate](./docs/knowledge/pilee-final-check-gate.md) |
| script | `scripts/knowledge.mjs` | [Confidence Sensitive Review](./docs/knowledge/confidence-sensitive-review.md)<br>[Deterministic Vs AI Actions](./docs/knowledge/deterministic-vs-ai-actions.md)<br>[Ember Friendly Knowledge Entrypoint](./docs/knowledge/ember-friendly-knowledge-entrypoint.md)<br>[Ember Ship Release Train](./docs/knowledge/ember-ship-release-train.md)<br>[Freshness Diagnosis Report](./docs/knowledge/freshness-diagnosis-report.md)<br>[Judgment Doc Unit](./docs/knowledge/judgment-doc-unit.md)<br>[Knowledge Review Queue PR Body](./docs/knowledge/knowledge-review-queue-pr-body.md)<br>[Pilee Final Check Gate](./docs/knowledge/pilee-final-check-gate.md)<br>[Pilee Knowledge System](./docs/knowledge/pilee-knowledge-system.md)<br>[Private Journal Public Doctrine](./docs/knowledge/private-journal-public-doctrine.md)<br>[README Coverage Map](./docs/knowledge/readme-coverage-map.md)<br>[Reviewed Commit Freshness](./docs/knowledge/reviewed-commit-freshness.md)<br>[Shortcut Atlas Conflict Audit](./docs/knowledge/shortcut-atlas-conflict-audit.md) |
| script | `scripts/tft-regression-audit.mjs` | [TFT Preference Regression Gate](./docs/knowledge/tft-preference-regression-gate.md) |
| docs | `docs/knowledge` | [Confidence Sensitive Review](./docs/knowledge/confidence-sensitive-review.md)<br>[Deterministic Vs AI Actions](./docs/knowledge/deterministic-vs-ai-actions.md)<br>[Ember Friendly Knowledge Entrypoint](./docs/knowledge/ember-friendly-knowledge-entrypoint.md)<br>[Freshness Diagnosis Report](./docs/knowledge/freshness-diagnosis-report.md)<br>[Judgment Doc Unit](./docs/knowledge/judgment-doc-unit.md)<br>[Pilee Knowledge System](./docs/knowledge/pilee-knowledge-system.md)<br>[Private Journal Public Doctrine](./docs/knowledge/private-journal-public-doctrine.md)<br>[README Coverage Map](./docs/knowledge/readme-coverage-map.md)<br>[README Philosophy User Gate](./docs/knowledge/readme-philosophy-user-gate.md)<br>[Reviewed Commit Freshness](./docs/knowledge/reviewed-commit-freshness.md)<br>[Session Export Source Preservation](./docs/knowledge/session-export-source-preservation.md) |
| concern | `show-report` | [Artifact Archive Reopenability](./docs/knowledge/artifact-archive-reopenability.md)<br>[Live Artifact Preview Pattern](./docs/knowledge/live-artifact-preview-pattern.md)<br>[Verify Report Workflow](./docs/knowledge/verify-report-workflow.md) |
| concern | `web_search` | [Curator Approved Source Selection](./docs/knowledge/curator-approved-source-selection.md)<br>[Korean First User Facing Output](./docs/knowledge/korean-first-user-facing-output.md)<br>[Web Search Curator](./docs/knowledge/web-search-curator.md) |
<!-- PILEE_ROOT_KNOWLEDGE_LINKS_END -->

---

## Extensions

<!-- PILEE_README_EXTENSIONS_START -->
55 extensions. Extensions that do not register tools, such as spinner or session-title, add no tool-schema token cost.

> Generated from `extensions/*` plus inventory metadata in `scripts/knowledge.mjs`; refresh with `node scripts/knowledge.mjs --graph`.

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
| **ship-commands** | Routes `/ship`, `/pr-ship`, and `/ci-ship` to pilee skills and collects PR review/CI context |
| **frame-studio** | Glimpse-based TFT Studio shell with Frame/Decide/Verify/Verify Report tabs, choices, transcript replay, and one companion WebView (`/companion`, `Ctrl+Shift+G`) |
| **user-facing-language** | System prompt guard that keeps user-visible progress, summaries, and answers short and Korean-first |
| **codex-fast-mode** | `/codex-fast` applies low verbosity and optional priority tier for openai-codex gpt-5.4/gpt-5.5 |
| **workflow-guard** | Turn-level guard for request intent, workflow weight, audits, and post-choice continuation |

### Session management

| Name | Role |
|---|---|
| **worktree** | Git worktree dashboard, tags, filters, bootstrapper, and switching |
| **fork-panel** | Ghostty split panels, `P0/P1/P2` labels, handoff inbox, revive, and repanel |
| **workspace** | Ghostty window/tab/split workspace snapshots and append restore |
| **continue-clean** | Continue in a clean new session with only a minimal handoff |
| **to-production** | Moves current worktree changes to a fresh production-based target worktree/branch without mutating the source |
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
| **archive-to-html** | Verify/Web Search HTML archive and `/archive` Artifact Browser (`/show-report` alias) using the shared companion WebView |
| **shortcut-atlas** | `/shortcuts` atlas for terminal/Pi/pilee custom shortcuts and conflict checks |

### Tools and data

| Name | Role |
|---|---|
| **bash-tool-override** | Bash tool title and output rendering override focused on command intent |
| **read-tool-override** | Read tool compact preview and range rendering override |
| **edit-tool-override** | Edit tool preflight diff preview and side-by-side result rendering override |
| **interactive-shell** | Runs interactive or long-running shells in overlay, hands-free, or dispatch modes |
| **tasks** | Area-grouped work-map overlay, task CRUD, and `Ctrl+Shift+T`/`Ctrl+Shift+O` |
| **auto-commit** | Executes commit/push from an explicit JSON plan |
| **tui-ask** | Terminal overlay question tool for single/multi/text decision gates |
| **web-access** | Tavily web search, URL extraction, and curator workflow |
| **memory-layer** | Long-term memory save/search |
| **ember** | Friendly entrypoint for knowledge collect/add/check/refresh |
| **ember-ship** | Knowledge maintenance release train from stale resolution to generated/history sync and merge |
| **backlog** | Persistent backlog TUI |
| **preflight** | Validation failure observer plus known-baseline separation tool |
| **pr-comments** | PR unresolved review comment collection helper |
| **pr-review-re-request** | Re-request review from non-approved PR reviewers/teams |
| **update-branch** | `/update-branch` safely pulls the current git branch from upstream |
| **until** | Explicit until-loop progress reporting |
| **usage-analytics** | Agent and skill usage statistics |
| **usage-reporter** | Usage reports |
| **retro** | Daily/weekly/monthly retrospective integration |
| **utils** | Shared internal helpers, not a user-facing contract |

### Unclassified

| Name | Role |
|---|---|
| **work-context** | TODO: inventory role needed |
<!-- PILEE_README_EXTENSIONS_END -->

---

## Skills

<!-- PILEE_README_SKILLS_START -->
27 global workflow skills. Project-specific skills belong in project/private overlays.

> Generated from `skills/*/SKILL.md` plus inventory metadata in `scripts/knowledge.mjs`; refresh with `node scripts/knowledge.mjs --graph`.

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
| **interactive-shell** | Usage guide for dev servers, TUIs, REPLs, and log viewers via `interactive_shell` |
| **systematic-debugging** | Root-cause-first debugging process |
| **debugging-and-error-recovery** | Error recovery and failed-check triage |
| **git-workflow-and-versioning** | Git discipline, commits, branches, and worktrees |
| **incremental-implementation** | Thin vertical slices with verification between steps |
| **skill-creator** | Skill creation, improvement, and evaluation |
| **pilee-knowledge** | Promote private history into public/sanitized knowledge |
| **pilee-final-check** | Final gate for pilee changes: gap review, re-verification, history, and push status |
| **db-write** | Human-gated DB write guidance |
| **db-write-migration** | Migration design and verification guidance |
| **jira-issue-management** | Jira issue preparation with preview gate |
| **ship** | Pre-PR commit, verification, and push workflow |
| **to-production** | Source-preserving migration of current worktree changes to a production-based hotfix target |
| **pr-ship** | Post-PR review response with commit, push, thread reply, review re-request, and `--push-only` mode |
| **ci-ship** | Post-PR CI failure analysis, fix, verification, and push workflow |
| **runtime-fanout-triage** | Diagnoses healthcheck, preview, and deploy failures with fan-out maps and contract reproduction |
| **verify-report** | Capture/evidence-based verification reports |
| **verify-report-preflight** | Readiness, workflow weight, and blocker check before Verify Report |
| **start-local-dev** | Local dev server startup diagnosis |
<!-- PILEE_README_SKILLS_END -->

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
| `Ctrl+Shift+O` | Show/hide top-right tasks overlay |

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
