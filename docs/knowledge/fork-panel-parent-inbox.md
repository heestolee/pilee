---
title: Fork-panel handoff는 parent inbox로 들어간다
tags:
  - fork-panel
  - handoff
  - inbox
  - inject
  - parent
  - panel
  - 맥락
category: workflow
status: active
applies_to:
  - extensions/fork-panel
  - panels inbox
  - handoff done workflow
source:
  - pilee-history:2026-05-05#39
  - pilee-history:2026-05-05#40
  - pilee-history:2026-05-05#41
reviewed_at: 2026-05-10
reviewed_commit: 3d5b2f2c2fc1554d9f34628af27c70d38b511182
related:
  - revive-over-transcript-recall
  - session-identity-over-filenames
  - subagent-prompt-specificity
supersedes:
  - auto-followup-on-panel-close
---

## Judgment

자식 패널의 handoff는 부모 대화에 자동 주입되지 않고 parent inbox에 먼저 저장되어야 합니다. 자식이 닫혀야만 맥락이 전달되거나, 닫히는 순간 부모를 interrupt하는 구조는 사용자의 흐름을 깨뜨립니다.

## Ingestion Rule

기본 `/handoff`와 비정상 종료 fallback은 unread inbox item을 만듭니다. 부모는 `/panels`에서 읽고, 입력창에 삽입하거나 follow-up으로 전송할지 선택합니다. `/handoff --inject`와 `/done --inject`는 즉시 interrupt를 허용하는 강한 옵션입니다.

## Identity Rule

최초/부모 패널은 `P0`로 표시하고, 자식 패널은 `P1`, `P2`처럼 부모 기준 주소를 갖습니다. 이 label은 입력창 메타에 표시해 현재 패널의 위치를 즉시 식별하게 하고, inbox item도 panel label, parent session, title, summary를 함께 보존합니다.
