---
title: Deterministic action과 AI review action은 분리한다
tags:
  - knowledge
  - deterministic
  - ai-actions
  - review
  - automation
  - 정합성
category: knowledge
status: active
applies_to:
  - scripts/knowledge.mjs
  - docs/knowledge
  - .github/workflows/knowledge-review-sync.yml
source:
  - pilee-history:2026-05-05#50
  - pilee-history:2026-05-05#52
reviewed_at: 2026-05-07
reviewed_commit: 858d8a21fb045c561b35a90172f37eb149d89b92
related:
  - freshness-diagnosis-report
  - readme-coverage-map
---

## Judgment

Knowledge automation에서 기계가 안전하게 할 수 있는 일과 AI/사람이 판단해야 하는 일을 분리해야 합니다. README graph 재생성은 deterministic이지만, missing coverage에 어떤 판단 문서를 만들지는 review action입니다.

## Action Rule

Deterministic action은 CLI가 동일 입력에 항상 같은 출력으로 처리할 수 있어야 합니다. 예: generated README block 재생성, link graph 검증, frontmatter 필수값 검사. AI action은 후보 해석, 문서 분리/병합, private 문맥 sanitization, medium/low confidence 문서 review처럼 판단이 필요한 일입니다. 자동 정합성 workflow는 커밋 유무로 skip하지 않고 매번 freshness까지 계산하되, AI/human review action이나 README narrative review가 없는 generated-only PR만 자동 병합 대상이 됩니다.

## Local Resolver Rule

GitHub Actions가 만드는 AI/human review PR은 “업데이트 PR”이 아니라 “검토 큐 PR”입니다. stale doctrine의 실제 업데이트 PR은 로컬 resolver가 만듭니다. 로컬 resolver는 public repo의 freshness evidence에 더해 로컬 Pi session/private history 전문을 확인할 수 있으므로, 문서를 수정할지 `--confirm`만 할지 판단할 수 있습니다. 이때 private 원문은 공개 문서에 복사하지 않고, PR에는 수정/confirm-only/보류 항목만 구분해 남깁니다.

## Failure Mode

둘을 섞으면 GitHub Actions가 private journal을 읽거나, 반대로 모든 coverage gap을 실패로 처리해 noise를 만듭니다. 자동화는 안전한 동기화만 맡고, 판단은 review loop에 남깁니다.
