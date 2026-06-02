---
title: Command shim은 reviewable workflow source of truth를 지킨다
tags:
  - command-shim
  - skill
  - tft
  - frame
  - slash-command
  - routing
category: workflow
status: active
confidence: high
applies_to:
  - extensions/tft-commands
  - extensions/ember-ship
  - skills/frame
  - skills/decide
  - skills/verify
source:
  - pilee-history:2026-05-06#63
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-06-02
reviewed_commit: 83617e9544615d818e6a7a17fa807f029a7db835
related:
  - skills-as-portable-procedures
  - frame-verify-contract
  - queued-command-prefill-boundary
---

## Judgment

Project-local skills can legitimately override generic workflow names such as `frame`, `decide`, and `verify`. When a personal workflow must keep the same user-facing slash command across projects, the stable surface should be an extension command shim, while the actual procedure remains in reviewable markdown rather than TypeScript. Most reusable procedures stay in `SKILL.md`; command-only workflows that should not expose `/skill:<name>` can keep the same contract in an internal `WORKFLOW.md` outside skill discovery.

## Pattern

The shim owns only routing and context packaging. It registers the slash command earlier than skill/template expansion, reads the canonical pilee markdown contract, inlines the target workflow plus prerequisites into the agent context, and explicitly tells the agent which source to follow for that invocation.

The markdown contract remains the source of truth. Do not duplicate the full workflow as TypeScript unless a specific step needs deterministic execution. If exposing both `/command` and `/skill:<name>` would confuse users, keep the target workflow outside skill discovery and let the command shim inline it directly.

## Identity Rule

When a shim opens an auxiliary UI such as TFT Studio, identity still belongs to the worktree/ticket/session planning context, not to the transient panel label or command invocation. The shim may compute and pass identity hints, but the skill-level contract decides what the identity means and where durable artifacts are stored.

## Review Trigger

Promote more logic from shim to extension only when the behavior must be deterministic, for example writing a known file shape or resolving a command conflict. Judgment-heavy workflow steps should stay in the markdown contract so they remain reviewable and portable.
