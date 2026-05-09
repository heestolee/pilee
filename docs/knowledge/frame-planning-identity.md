---
title: Frame identity는 cwd보다 작업 의도를 우선한다
tags:
  - frame
  - planning
  - identity
  - home-directory
  - ticket
  - session-title
category: workflow
status: active
confidence: high
applies_to:
  - skills/frame
  - extensions/tft-commands
source:
  - pilee-history:2026-05-06#66
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-09
reviewed_commit: 7db03075d3bba01eb0b6823ef03c8a2cdee8035d
related:
  - frame-verify-contract
  - session-identity-over-filenames
  - worktree-session-continuity
---

## Judgment

Frame identity should follow the user's work unit, not the current directory alone. Home directory planning sessions often start before a worktree exists, so `~/` cannot be the owner of a frame. It is shared by many planning tabs and would collide immediately.

## Identity Order

1. If a worktree is present, use a worktree-bound frame.
2. If no worktree exists but a ticket is visible, use a ticket-bound planning frame.
3. If neither exists, use a session-bound planning frame: the bottom/session title is the display label, while the internal key is derived from the session file.

## Boundary Rule

Session title is human identity, not a stable key. It can change and collide, so it should be shown in Glimpse/report titles but backed by a session file hash. When a worktree is later created, the planning frame should be promotable into that worktree's `.pi/frame.json`.

## Transcript Rule

TFT Studio transcript는 planning identity에 묶입니다. 같은 ticket/session planning identity로 다시 열면 이전 질문·선택·markdown 전문을 복원할 수 있어야 하지만, 새 답변을 받을 수 있는 것은 현재 active run의 pending question뿐입니다. 저장된 transcript는 provenance이고, 현재 frame 계약은 최신 frame artifact가 담당합니다.
