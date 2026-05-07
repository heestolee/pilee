---
title: 변경 통합은 작은 단위와 검증을 요구한다
tags:
  - git
  - incremental
  - code-review
  - commit
  - quality
  - 통합
category: workflow
status: active
applies_to:
  - skills/git-workflow-and-versioning
  - skills/incremental-implementation
  - skills/code-review-and-quality
source:
  - pilee-history:2026-05-01#7
  - pilee-history:2026-05-02#24
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: b6da702c75ff0dec4d54a46fa24e77fdd224754f
related:
  - evidence-first-verification-gate
  - stress-interview-multi-axis-review
---

## Judgment

AI가 빠르게 많은 파일을 바꿀수록 변경 통합은 더 작은 단위와 명확한 검증을 요구합니다. 큰 diff를 한 번에 완성했다고 해서 review 가능하거나 되돌리기 쉬운 것은 아닙니다.

## Integration Rule

한 commit은 하나의 논리적 변경을 담고, formatting/behavior/doc 변경은 가능하면 분리합니다. 100줄 이상을 쓰기 전에 테스트나 타입체크처럼 빠른 검증을 실행합니다. 리뷰는 correctness뿐 아니라 readability, architecture, security, performance를 함께 봅니다.

## Dirty State Rule

작업 시작과 커밋 직전에는 `git status`를 확인합니다. 현재 작업과 무관한 dirty file은 보존하고, stage에는 관련 파일만 올립니다. local-only 산출물은 `.context/`처럼 명시적으로 ignore된 경로에 두고, PR에는 재현 가능한 코드/문서 변경과 sanitized 요약만 포함합니다.

## Failure Mode

구현 속도에 맞춰 commit discipline을 느슨하게 하면 나중에 어떤 판단이 어떤 변경을 만들었는지 추적할 수 없습니다. 작은 slice와 증거가 AI 변경의 안전한 통합 단위입니다.
