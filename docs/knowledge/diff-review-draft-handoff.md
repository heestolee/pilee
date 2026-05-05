---
title: Diff review draft는 PR 코멘트 전 단계다
tags:
  - diff-overlay
  - review-draft
  - pr-comments
  - code-review
  - handoff
category: review
status: active
applies_to:
  - extensions/diff-overlay
  - extensions/pr-comments
  - skills/code-review-and-quality
source:
  - session-backfill:2026-05-02#diff-overlay-review-draft
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - change-integration-discipline
  - tool-output-noise-management
---

## Judgment

Diff UI에서 발견한 리뷰 의견은 즉시 PR 코멘트로 나가기 전에 draft로 모을 수 있어야 합니다. 검토 중 생각과 외부 반영을 분리하면, 사용자는 line-scoped 지적을 정리한 뒤 공개 코멘트 여부를 결정할 수 있습니다.

## Draft Rule

Diff overlay는 파일/라인 범위와 함께 review draft를 저장하고, PR comment extension은 사용자가 명시적으로 선택한 draft만 외부로 보냅니다. 내부 검토 메모와 공개 리뷰 코멘트는 다른 책임을 가집니다.

## Failure Mode

검토 UI에서 바로 외부 코멘트를 만들면 오탐이나 미정 판단이 공개됩니다. 반대로 draft를 잃으면 리뷰 맥락이 사라집니다. 중간 저장층이 필요합니다.
