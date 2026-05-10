---
title: Command shim은 skill source of truth를 지킨다
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
  - skills/frame
  - skills/decide
  - skills/verify
source:
  - pilee-history:2026-05-06#63
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-10
reviewed_commit: db21ec7f73ef8c9ad581bd8610f8203799defb7b
related:
  - skills-as-portable-procedures
  - frame-verify-contract
  - queued-command-prefill-boundary
---

## Judgment

Project-local skills can legitimately override generic workflow names such as `frame`, `decide`, and `verify`. When a personal workflow must keep the same user-facing slash command across projects, the stable surface should be an extension command shim, while the actual procedure remains in `SKILL.md`.

## Pattern

The shim owns only routing and context packaging. It registers the slash command earlier than skill/template expansion, reads the canonical pilee `SKILL.md` files, inlines the target skill plus prerequisites into the agent context, and explicitly tells the agent to ignore project-local skill files for that invocation.

The skill remains the source of truth. Do not duplicate the full workflow as TypeScript unless a specific step needs deterministic execution.

## Identity Rule

When a shim opens an auxiliary UI such as TFT Studio, identity still belongs to the worktree/ticket/session planning context, not to the transient panel label or command invocation. The shim may compute and pass identity hints, but the skill-level contract decides what the identity means and where durable artifacts are stored.

## Review Trigger

Promote more logic from shim to extension only when the behavior must be deterministic, for example writing a known file shape or resolving a command conflict. Judgment-heavy workflow steps should stay in the skill document so they remain reviewable and portable.
