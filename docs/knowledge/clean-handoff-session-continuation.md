---
title: Clean handoff는 compact와 새 세션 사이의 전환 계약이다
tags:
  - session
  - handoff
  - compact
  - context
  - archive
  - continue-clean
  - 세션
category: workflow
status: active
confidence: high
applies_to:
  - extensions/continue-clean
  - /continue-clean
  - extensions/archive-to-html
  - session handoff
source:
  - user-direction:2026-05-14-continue-clean
reviewed_at: 2026-05-14
reviewed_commit: 08724ed1a80213d2eb5a10918512c07f1d63c0e9
related:
  - worktree-session-continuity
  - session-identity-over-filenames
  - artifact-archive-reopenability
---

## Judgment

`compact`는 같은 세션을 압축해 이어가는 안전망이고, clean handoff는 작업 계약서만 새 세션으로 옮기는 전환 흐름입니다. 긴 탐색, phase 전환, 여러 패널 합류, 맥락 오염이 생긴 경우에는 전체 transcript를 계속 끌고 가기보다 새 세션에 현재 truth만 주입하는 편이 더 안정적입니다.

## Handoff Rule

`/continue-clean`은 원본 세션 전문을 복사하지 않습니다. 새 세션에는 다음 최소 handoff만 남깁니다.

- source session path와 `/archive <session>` reopen command
- 현재 cwd, session title, 생성 시각
- 감지 가능한 git status와 `.pi/frame.json` 요약
- 최근 user 요청과 최근 assistant state hint의 짧은 목록
- “원본은 필요할 때만 열고, handoff를 현재 truth로 삼는다”는 continuation contract

이 handoff는 새 세션의 context에 들어가는 작업 계약서이며, 원본 transcript는 durable artifact reference로만 남습니다.

## Continuation Rule

기본 `/continue-clean`은 handoff를 만든 뒤 같은 cwd의 새 Pi 세션으로 전환하고 continuation prompt를 follow-up으로 전송합니다. 새 세션은 먼저 목표·남은 작업·검증 초점을 짧게 재정리한 뒤 바로 실행 가능한 다음 행동으로 이어갑니다. 사용자가 새 세션을 직접 보고 시작하고 싶다면 `--no-start`로 prompt를 입력창에만 채웁니다.

## Boundary

Clean handoff는 full-context fork가 아닙니다. 전체 transcript 복사가 필요한 경우는 예외이며, 기본은 요약과 source reference입니다. 원본 맥락이 필요해지면 `/archive`로 열람하고 필요한 사실만 현재 작업 계약에 반영합니다.

## Failure Mode

새 세션에 최근 메시지만 무작정 많이 붙이면 사실상 compact와 같은 오염을 반복합니다. 반대로 source reference 없이 너무 짧은 요약만 넘기면 중요한 결정을 회수할 수 없습니다. 따라서 clean handoff는 “짧은 현재 truth + 원본 reopen path”를 함께 보존해야 합니다.
