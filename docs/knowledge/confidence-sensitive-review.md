---
title: 낮은 confidence 판단은 정합성 PR로 올린다
tags:
  - confidence
  - review
  - freshness
  - ai-actions
  - user-review
  - 정합성
category: knowledge
status: active
applies_to:
  - docs/knowledge
  - scripts/knowledge.mjs
  - .github/workflows/knowledge-review-sync.yml
  - skills/pilee-knowledge
source:
  - session-backfill:2026-05-05#confidence-review-policy
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-05
reviewed_commit: 70468c2a01aa78453eb5a98cce65e9dc50822f39
related:
  - freshness-diagnosis-report
  - deterministic-vs-ai-actions
  - readme-philosophy-user-gate
---

## Judgment

초기 knowledge 운영에서는 confidence를 예민하게 다룹니다. 공개 가능한 판단이라도 근거가 약하거나 사용자의 취향·철학 확인이 필요한 문서는 확정 doctrine처럼 조용히 묻히지 않고 review queue에 남깁니다.

## Confidence Rule

Knowledge frontmatter는 필요할 때 `confidence: medium` 또는 `confidence: low`를 가질 수 있습니다. `high`가 아니면 freshness report의 AI/human review action이 되고, 자동 정합성 workflow의 검토 큐로 올라갑니다. 검토 큐 PR은 문서를 대신 고치는 PR이 아니라, 로컬 resolver가 실제 확인 작업을 시작하게 하는 공개 알림입니다. 이런 항목은 사용자가 확인해 받아들인 뒤에만 `--confirm <doc-id> --confidence high`로 승격합니다.

## Ask Boundary

작업 중 즉시 막아야 하는 것은 새 정책을 정해야 하는 경우입니다. 이미 나온 판단을 문서화하되 확신이 낮은 경우에는 먼저 물어보지 않고 문서화할 수 있지만, confidence를 낮춰 사후 review를 강제합니다.
