---
title: Private overlay package는 회사·개인 실행 맥락을 담는다
tags:
  - privacy
  - package
  - overlay
  - skill
  - company-context
category: workflow
status: active
confidence: high
applies_to:
  - package boundaries
  - skills/db-write
  - skills/db-write-migration
  - skills/start-local-dev
  - skills/jira-issue-management
  - skills/verify-report
  - extensions/worktree
  - extensions/archive-to-html
  - extensions/preflight
source:
  - user-direction:2026-05-07-heestolee-private
  - user-direction:2026-05-08-public-private-boundary-reminder
reviewed_at: 2026-05-09
reviewed_commit: 8050064c8c98da577174208778fc7d9f8d6025f5
related:
  - private-journal-public-doctrine
  - skills-as-portable-procedures
  - database-write-human-execution-gate
---

## Judgment

pilee public package should keep reusable Pi infrastructure and generic operating doctrine. Company-specific commands, repo profiles, project paths, account aliases, Notion sync maps, and local machine conventions belong in a private overlay package loaded alongside pilee.

## Boundary Rule

Public skills may define the safety protocol: ask before external writes, collect evidence before PASS, use pre/post SELECTs for DB writes, keep local dev startup diagnosable. Public extensions may define generic engines: worktree lifecycle, dependency worker orchestration, artifact browser grouping, and preflight execution. They should not embed company repo service names, internal URLs, account aliases, private Notion schemas, organization-specific artifact storage paths, or repo-specific install/check commands.

Private overlay skills carry concrete procedures with namespaced skill names such as `<org>-db-read`, `<org>-db-write`, and `<org>-db-migration`. Private overlay profiles carry concrete extension config such as protected repo names, match rules, bootstrap markers/commands, workspace roots, Conductor path mappings, and preflight checks. Public code discovers these profiles through package/project/local profile directories and should degrade to generic fallback behavior when no profile is present. Name collisions are avoided rather than relying on package load order overrides.

## Quick Check

Before adding a path, command, URL, account alias, repo name, project key, database/tool name, or automation script path, ask: **Would this still be true for another public pilee user?**

- Yes → it may stay in public pilee as generic engine/doctrine.
- No → move the concrete value to private overlay profile, private skill, or local config; keep only the interface/fallback in public.

## Migration Rule

When a public skill or extension contains both generic doctrine/engine behavior and private execution context, split it into:

1. a generic public skill/extension that preserves the doctrine or engine lifecycle and points to project/private overlays,
2. a private skill/profile that keeps the concrete tools, paths, examples, commands, and logs, and
3. a generic fallback that is useful for non-profiled users without silently reintroducing company/local assumptions.

## Failure Mode

Keeping private execution context in public pilee makes the public package stale, noisy, and potentially leaky. Keeping everything only in local unversioned files loses history and reproducibility. A private git package gives versioning without publishing private context.
