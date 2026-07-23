---
title: Diff는 실제 integration target을 기준으로 계산한다
tags:
  - diff-overlay
  - pull-request
  - stacked-pr
  - merge-base
  - review
category: review
status: active
confidence: high
applies_to:
  - extensions/diff-overlay
source:
  - user-feedback:2026-07-23-diff-pr-base
reviewed_at: 2026-07-23
reviewed_commit: d3bb569a98498430e69a0a8eeb2613ac1acdbd74
related:
  - diff-review-draft-handoff
  - change-integration-discipline
  - worktree-execution-boundary
---

## Judgment

Diff review의 비교 기준은 저장소의 기본 branch가 아니라 **현재 변경이 실제로 합쳐질 integration target**이어야 합니다. 열린 PR이 있으면 PR의 `baseRefName`이 source of truth이며, stacked PR에서는 이 기준을 놓치면 앞선 PR의 변경까지 현재 PR diff에 섞입니다.

## Resolution Order

`/diff`는 다음 순서로 base를 결정합니다.

1. 사용자가 명시한 `--base <branch>`
2. 현재 branch의 열린 PR `baseRefName`
3. hotfix/hotfeature 같은 명시적 branch 규칙
4. `origin/HEAD`
5. 일반적인 default branch fallback

명시 override와 열린 PR base는 추론 fallback보다 우선합니다. PR base를 찾았지만 로컬 ref에서 merge-base를 계산할 수 없다면 다른 branch로 조용히 내려가지 않고 오류를 보여야 합니다.

## Visibility Rule

비교 기준은 숨은 내부 상태가 아닙니다. overlay 상단과 headless 출력에 `base...head`와 선택 출처(`PR #N`, `--base`, `origin/HEAD`)를 함께 표시해 사용자가 현재 보고 있는 범위를 즉시 검산할 수 있어야 합니다.

## Failure Mode

stacked PR의 head를 저장소 기본 branch와 비교하면 foundation 변경과 activation 변경이 한 화면에 합쳐집니다. 파일 수와 commit 수가 부풀고, 리뷰어는 현재 PR만의 변경을 분리해 판단할 수 없습니다. 더 위험한 경우는 PR base 해석 실패를 default branch fallback으로 숨겨 잘못된 diff를 정상 결과처럼 보여주는 것입니다.
