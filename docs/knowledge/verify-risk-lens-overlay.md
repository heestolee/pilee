---
title: Verify risk lens는 generic core와 private overlay로 나눈다
tags:
  - verify
  - risk-lens
  - overlay
  - private-overlay
  - verification
  - domain-check
  - evidence
  - 검증
category: verification
status: active
confidence: high
applies_to:
  - skills/verify
  - skills/verify/references/risk-lenses.md
  - private/project verify overlay skills
source:
  - user-direction:2026-05-10-verify-risk-lens-overlay
reviewed_at: 2026-05-12
reviewed_commit: fc6ffa9aaa2a87275a50c2888d6ca4bbe0255cf6
related:
  - frame-verify-contract
  - evidence-first-verification-gate
  - private-overlay-package-boundary
  - verify-report-workflow
  - verification-invalidation-on-change
---

## Judgment

Verify should not depend only on a frame success-criteria checklist or test command list. It also needs a reusable way to ask “what kind of failure mode did this diff create?” The generic answer belongs in public pilee as risk lenses. Concrete repository commands, ORM conventions, account aliases, service names, and organization runbooks belong in project/private overlay skills.

This separation keeps `/verify` useful outside a single company while still allowing company-specific checks to be strict. Public pilee owns the lens shape; overlays own the concrete evidence recipe.

## Core / Overlay Split

Public verify defines stable lens categories such as DB schema, rollback/data preservation, ORM association, cache/DataLoader, API contract, UI data flow, i18n, notification, runbook, security, money/entitlement, architecture friction, and visual/responsive evidence. These categories are framework-agnostic: any stack can ask whether a migration preserves data, whether cache lifetime matches mutable data, or whether an API contract remains compatible.

A project/private overlay may then say which commands and conventions close those questions in a specific repo. For example, a particular ORM may need explicit alternate-key association metadata, a particular GraphQL service may require service schema generation plus frontend codegen, or a particular DB-write policy may require a human-executed runbook with pre/post SELECTs. Those details should not be hardcoded into public pilee unless they are genuinely reusable.

## Verification Grade Rule

`달성(코드만)` is not a safe default when a high-risk lens is triggered. If a success criterion involves schema, association, cache, API contract, operations, money, or external notification, code-location mapping alone is insufficient. Verify must either collect stronger evidence or mark the criterion as partial/unverified with a lens gap.

This rule prevents a common false positive: the code appears to follow the requirement, but a framework default, stale cache, missing generated artifact, rollback gap, or locale/value mismatch breaks the actual behavior.

## AskUserQuestion Boundary

Risk lens findings are usually facts or defects, not user decisions. If a lens finds a missing association key, stale cache risk, or rollback bug, the agent should report/fix it rather than ask whether it matters.

AskUserQuestion is needed when the lens exposes a real policy fork: for example, whether a rollback should preserve previous overrides or intentionally delete newly-added operational data, whether a UI should show stored mapping or effective value, or whether a known manual evidence gap should block PR. In those cases the question should include `(명백: ...)` when the recommended path is obvious, because the user still needs to choose a different next action.

## Overlay Loading Rule

During `/verify`, after reading the diff and frame, the agent should load `skills/verify/references/risk-lenses.md` and then scan available skills for matching project/private overlays such as `*-verify-lenses`, `*-verify-context`, or domain-specific DB/local-dev skills. If no overlay exists, generic lenses still apply. If an overlay exists, it augments the generic lens rather than replacing it.

The overlay should be namespaced and versioned in the private/project package. It should not contain secrets or raw data; it should contain reusable operating rules, command names, path conventions, and evidence requirements.

## Why It Matters

A generic verify checklist catches “did we run the command?” but often misses “did this stack’s default behavior match the invariant?” Risk lenses turn the latter into an explicit step. Overlay separation keeps that strictness portable: public pilee becomes better at verification without accumulating company-specific assumptions.

## Review Triggers

Revisit this doctrine when:

- `/verify` repeatedly misses the same class of defect,
- an overlay rule proves broadly reusable across stacks,
- public pilee starts containing private repo names or commands,
- a project overlay duplicates too much generic verification logic,
- `달성(코드만)` is used for high-risk schema/cache/API/money/ops changes without stronger evidence.
