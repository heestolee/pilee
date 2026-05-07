---
title: 검증 중 코드 변경은 이전 검증을 무효화한다
tags:
  - verify
  - invalidation
  - code-change
  - freshness
  - gate
  - 검증
  - 무효화
category: verification
status: active
confidence: high
applies_to:
  - skills/verify
  - skills/verify-report
  - skills/code-review-and-quality
source:
  - pilee-history:2026-05-01#4
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-07
reviewed_commit: 50926610bb0901d4cd4dc1d7f13cb4c996ade66e
related:
  - evidence-first-verification-gate
  - frame-verify-contract
---

## Judgment

Verify 단계에서 코드를 수정하면 그 전까지의 검증 결과는 더 이상 최신 상태를 증명하지 않습니다. 검증 중 발견한 문제를 고치는 것은 가능하지만, 수정 후에는 영향을 받는 기준을 다시 검증해야 합니다.

## Operating Rule

검증은 “현재 diff”에 대한 판정입니다. Verify 중 수정이 발생하면 수정 내용을 명시하고, 어떤 증거가 무효화되었는지 표시한 뒤 해당 항목을 재실행합니다. 단순 문구 수정처럼 영향이 제한적이어도 `(명백: 영향 범위)`를 적어 재검증 범위를 좁힙니다.

## Report Rule

Verify Report나 knowledge resolver처럼 검증/검토 산출물을 만드는 동안 코드나 문서가 추가로 바뀌면, 이전 산출물의 기준 커밋을 그대로 신뢰하지 않습니다. 최종 PR body에는 마지막 기준 커밋과 재실행한 검증 명령을 적고, 중간 산출물은 local-only 참고로 둡니다.

## Failure Mode

수정과 검증을 한 덩어리로 섞으면 “고쳤으니 완료”라는 결론이 먼저 나오고 증거가 뒤따릅니다. pilee의 검증 흐름은 반대로, 최신 코드에 대한 증거가 결론을 이끌어야 합니다.
