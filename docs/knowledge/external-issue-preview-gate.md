---
title: 외부 이슈 업데이트는 preview gate를 지난다
tags:
  - jira
  - issue
  - preview
  - wiki-markup
  - external-update
  - approval
category: workflow
status: active
confidence: high
applies_to:
  - skills/jira-issue-management
source:
  - session-backfill:2026-05-05#skill-surface-review
reviewed_at: 2026-05-08
reviewed_commit: 9b7ea36d62a7eb3ada47dff7915bf30e9ec6ac16
related:
  - live-artifact-preview-pattern
  - ask-user-question-decision-gates
  - private-overlay-package-boundary
---

## Judgment

Jira 같은 외부 시스템에 쓰는 내용은 로컬 답변과 다릅니다. 한번 전송되면 다른 사람이 보거나 자동화가 반응할 수 있으므로, agent가 조용히 description/update를 보내면 안 됩니다.

## Preview Rule

이슈 생성/수정 전에는 대상 이슈 트래커 형식으로 포맷한 내용을 사용자에게 preview합니다. 사용자가 확인한 뒤에만 외부 API를 호출합니다. 포맷 정리와 실제 전송은 별도 단계입니다.

조직별 Jira URL, project key 추론, MCP 우선순위, issue type convention은 public skill에 박지 않고 private/project overlay가 담당합니다.

## Failure Mode

“문구만 조금 정리”라는 이유로 바로 업데이트하면 의도하지 않은 공개 커뮤니케이션이 됩니다. 외부 반영은 항상 preview-first, send opt-in입니다.
