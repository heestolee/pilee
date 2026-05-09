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
confidence: high
applies_to:
  - docs/knowledge
  - scripts/knowledge.mjs
  - .github/workflows/knowledge-review-sync.yml
  - skills/pilee-knowledge
source:
  - session-backfill:2026-05-05#confidence-review-policy
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-05-07-resolver-merge-gate
reviewed_at: 2026-05-09
reviewed_commit: a3707cc4e16876381f979b5e197e66fc8b5bc984
related:
  - freshness-diagnosis-report
  - deterministic-vs-ai-actions
  - readme-philosophy-user-gate
---

## Judgment

초기 knowledge 운영에서는 confidence를 예민하게 다룹니다. 공개 가능한 판단이라도 근거가 약하거나 사용자의 취향·철학 확인이 필요한 문서는 확정 doctrine처럼 조용히 묻히지 않고 review queue에 남깁니다.

## Confidence Rule

Knowledge frontmatter는 필요할 때 `confidence: medium` 또는 `confidence: low`를 가질 수 있습니다. `high`가 아니면 freshness report의 AI/human review action이 되고, 자동 정합성 workflow의 검토 큐로 올라갑니다. 검토 큐 PR은 문서를 대신 고치는 PR이 아니라, 로컬 resolver가 실제 확인 작업을 시작하게 하는 공개 알림입니다. 이런 항목은 사용자가 확인해 받아들인 뒤에만 `--confirm <doc-id> --confidence high`로 승격합니다.

## Merge Review Rule

초기 운영에서 confidence나 stale 해소 PR은 생성 자체가 review 요청입니다. agent가 검증을 통과시켰더라도 사용자 review 없이 바로 병합하지 않습니다. 자동 병합을 허용하려면 PR의 성격이 generated-only인지, merge actor가 자동화로 표시되는지, 사용자가 그 정책을 받아들였는지까지 확인해야 합니다.

## Ask Boundary

작업 중 즉시 막아야 하는 것은 새 정책을 정해야 하는 경우입니다. 이미 나온 판단을 문서화하되 확신이 낮은 경우에는 먼저 물어보지 않고 문서화할 수 있지만, confidence를 낮춰 사후 review를 강제합니다.
