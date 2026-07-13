---
title: 외부 Issue와 PR은 기여 규칙 확인과 최종 승인 뒤에 게시한다
tags:
  - jira
  - github
  - issue
  - pull-request
  - contributing
  - preview
  - wiki-markup
  - external-update
  - approval
category: workflow
status: active
confidence: high
applies_to:
  - extensions/workflow-guard
  - skills/jira-issue-management
  - skills/ship
source:
  - session-backfill:2026-05-05#skill-surface-review
reviewed_at: 2026-07-11
reviewed_commit: cb42256
related:
  - live-artifact-preview-pattern
  - ask-user-question-decision-gates
  - private-overlay-package-boundary
---

## Judgment

GitHub Issue/PR이나 Jira 같은 외부 시스템에 쓰는 내용은 로컬 답변과 다릅니다. 한번 전송되면 작성자 계정의 공개 기록이 되고 다른 사람이 보거나 자동화가 반응하므로, agent가 조용히 생성·수정하면 안 됩니다.

## Contribution Fit Rule

외부 저장소에 Issue나 PR을 준비할 때는 대상 저장소의 `CONTRIBUTING.md`와 연결된 기여 지침을 먼저 읽습니다. 구현 가능성과 upstream contribution 적합성은 별도 판단입니다. issue-first, 신규 contributor approval, 허용 scope, PR 순서를 확인하기 전에는 구현 완료나 기술적 타당성을 게시 적합성으로 해석하지 않습니다.

## Preview Rule

Issue/PR 생성·수정 전에는 repo, 게시 계정, 제목, 본문, base/head, 기여 규칙 준수 결과를 사용자에게 preview합니다. 최초 요청의 “만들어줘/PR까지”는 final approval이 아닙니다. Preview 이후 사용자가 별도로 명시적 승인한 뒤에만 외부 API를 호출합니다. 포맷 정리와 실제 전송은 별도 단계입니다.

GitHub CLI 생성 명령은 guard가 요구하는 CONTRIBUTING 확인/최종 승인 표식을 모두 가져야 합니다. REST/MCP 경로도 같은 계약을 따릅니다. 조직별 Jira URL, project key 추론, MCP 우선순위, issue type convention은 public skill에 박지 않고 private/project overlay가 담당합니다.

## Failure Mode

“문구만 조금 정리” 또는 “PR까지 해줘”라는 이유로 바로 게시하면 의도하지 않은 공개 커뮤니케이션이 됩니다. 특히 CONTRIBUTING 적합성을 확인하지 않은 구현은 작성자를 규칙 미준수 contributor처럼 보이게 할 수 있습니다. 외부 반영은 항상 contribution-fit-first, preview-first, separate-final-approval입니다.
