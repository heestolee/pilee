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
applies_to:
  - extensions/tft-commands
  - skills/frame
  - skills/decide
  - skills/verify
source:
  - pilee-history:2026-05-06#63
reviewed_at: 2026-05-06
reviewed_commit: 7160f8025c2ea89a0fcbd2789036776d4d17a546
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

## Review Trigger

Promote more logic from shim to extension only when the behavior must be deterministic, for example writing a known file shape or resolving a command conflict. Judgment-heavy workflow steps should stay in the skill document so they remain reviewable and portable.
