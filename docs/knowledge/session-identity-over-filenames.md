---
title: 세션 식별자는 파일명이 아니라 사람이 본 이름이다
tags:
  - session
  - title
  - identity
  - session_info
  - worktree
  - revive
  - 세션
category: workflow
status: active
confidence: high
applies_to:
  - extensions/worktree
  - extensions/fork-panel
  - extensions/session-title
  - session_info.name
source:
  - pilee-history:2026-05-04#38
  - pilee-history:2026-05-05#40
  - pilee-history:2026-05-05#41
  - pilee-history:2026-05-05#42
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-08
reviewed_commit: fdf91a44f626b47846fb59501575357657fd8ef3
related:
  - worktree-session-continuity
  - revive-over-transcript-recall
  - backlog-source-session-provenance
---

## Judgment

세션 목록에서 가장 중요한 식별자는 JSONL 파일명이나 fork 방향 label이 아니라 사용자가 실제로 본 세션 제목입니다. 파일명 hash는 시스템 식별자일 뿐, 나중에 “어떤 대화였는가”를 회수하는 데 약합니다.

## Identification Rule

`session_info.name`을 우선 표시하고, 없거나 의미 없는 제목이면 마지막 의미 있는 user/assistant 메시지로 fallback합니다. Conductor 등 외부 세션을 변환할 때도 원본 title을 보존해 Pi 세션의 이름으로 기록합니다.

## Display Rule

목록에는 workspace, 제목, 마지막 의미 있는 요청, turn 수, short id처럼 사람이 빠르게 구분할 수 있는 정보를 함께 둡니다. 중복 스냅샷은 최신/가장 긴 대화를 우선해 숨깁니다.

## Artifact Identity Rule

Frame Studio transcript, resolver run, backlog source 같은 durable artifact도 사람이 본 작업 이름으로 묶여야 합니다. 파일명 hash는 저장소 내부 식별자로만 쓰고, 사용자에게는 worktree/ticket/session title과 최근 의미 있는 요청을 함께 보여줍니다. 그래야 나중에 revive, `/show-report`, resolver log가 같은 작업을 가리킨다는 것을 이해할 수 있습니다.
