---
title: 병렬 workflow 분석은 단일 writer queue로 합류한다
tags:
  - ci-ship
  - pr-ship
  - self-healing
  - subagent
  - steering
  - writer-queue
category: workflow
status: active
confidence: high
applies_to:
  - extensions/ship-commands
  - extensions/subagent
  - extensions/queued-messages
  - skills/ci-ship
  - skills/pr-ship
  - skills/self-healing
source:
  - user-direction:2026-06-17-parallel-analysis-single-writer
reviewed_at: 2026-06-17
reviewed_commit: 7e9ee6f
related:
  - queued-command-prefill-boundary
  - subagent-skill-delegation
  - ship-pr-ship-review-boundary
  - ci-ship-failure-response-boundary
  - self-healing-actionable-loop
---

## Judgment

`/ci-ship`, `/pr-ship`, `/self-healing`은 모두 PR 상태를 더 좋게 만들기 위한 workflow지만, 모든 단계가 부모 세션에서 동기적으로 막혀 있을 필요는 없습니다. 로그 수집, 리뷰 코멘트 분류, stress-interview 같은 **read-only 분석/검토**는 명령이 들어온 시점의 snapshot을 기준으로 병렬 subagent에 위임할 수 있습니다. 반면 코드 수정, commit, push, PR comment, review re-request, CI rerun 같은 **write side effect**는 최신 HEAD를 다시 확인한 뒤 단일 writer queue에서 직렬화합니다.

## Snapshot Rule

병렬 분석 job은 명령 입력 시점의 cwd, session file, leaf id, PR/check/comment URL, head SHA 같은 basis를 기록합니다. 분석 결과는 “현재 writer가 바로 적용할 변경”이 아니라 `Writer Queue Proposal`입니다. writer는 적용 전 최신 HEAD와 PR 상태를 다시 확인해야 하며, stale한 basis에서 나온 제안은 재검증 없이 적용하지 않습니다.

## Steering Rule

사용자가 agent가 작업 중인 상태에서 `/ci-ship`, `/pr-ship`, `/self-healing`을 steering처럼 입력하면, 가능한 경우 해당 입력을 일반 follow-up main prompt로 밀지 않고 병렬 read-only 분석 job으로 바꿉니다. `/ci-ship`/`/pr-ship`은 단일 분석 subagent로 시작할 수 있고, `/self-healing`은 원래 의미에 맞춰 verifier/reviewer/challenger 3축 read-only stress-interview로 시작합니다. 이렇게 하면 사용자는 현재 writer를 중단하지 않고도 CI 분석, 리뷰 검토, self-healing 후보 수집을 먼저 시작할 수 있습니다.

Idle 상태의 slash command는 기존처럼 해당 command/skill workflow를 실행합니다. 명시적 subagent shortcut인 `>> /ci-ship`은 기존 skill prompt delegation 의미를 유지합니다.

## Writer Boundary

병렬 분석 subagent는 다음을 하지 않습니다.

- 파일 수정, write/edit 도구 사용
- commit, amend, rebase, force-push, push
- CI rerun, PR comment, thread resolve/unresolve, review re-request
- self-healing worker 수정 phase 실행

대신 다음을 보고합니다.

- 무엇을 봤는지와 command-time basis
- root cause 또는 review/stress-interview finding
- `Must fix now`, `Ask user`, `Ignore/defer`로 나눈 writer queue 제안
- writer가 적용 후 실행할 검증 명령

## Failure Mode

분석 job까지 직렬화하면 사용자가 CI/리뷰/self-healing 명령을 눌러도 현재 writer가 끝날 때까지 아무 검토가 시작되지 않아 대기 시간이 길어집니다. 반대로 각 workflow가 독립 writer로 동시에 commit/push하면 SHA, PR 상태, CI run, 리뷰 답글 기준이 꼬입니다. 그래서 병렬화 단위는 read-only 분석까지, side effect 단위는 단일 writer까지로 나눕니다.
