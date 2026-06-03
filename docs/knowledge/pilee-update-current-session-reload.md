---
title: pilee update는 현재 세션 reload까지 닫아야 한다
tags:
  - pilee
  - reload
  - update
  - runtime-e2e
  - command
category: workflow
status: active
confidence: high
applies_to:
  - extensions/pilee-update
  - skills/pilee-final-check
  - pilee change workflow
source:
  - user-direction:2026-06-03-runtime-e2e-after-update-reload
reviewed_at: 2026-06-03
reviewed_commit: "333e303"
related:
  - pilee-final-check-gate
  - evidence-first-verification-gate
  - live-artifact-preview-pattern
---

## Overview

pilee package를 수정하고 `pi update`를 실행해도 이미 떠 있는 Pi 세션이 새 extension/skill/prompt/theme module을 자동으로 쓰는 것은 아닙니다. package clone과 dependency는 최신화되지만, 현재 runtime에 로드된 extension instance는 reload 전까지 오래된 코드일 수 있습니다.

## Rule

현재 세션에서 방금 배포한 pilee 변경을 검증해야 한다면 update와 reload를 같은 적용 단계로 취급합니다.

- `/pilee-update`는 `pi update`를 실행한 뒤 command-context `ctx.reload()`를 호출해 현재 세션의 extensions/skills/prompts/themes를 다시 로드합니다.
- update 실패 시 reload하지 않습니다.
- `--no-reload`는 package만 업데이트하고 runtime 적용은 일부러 미루는 escape hatch입니다.
- slash command가 아니라 assistant가 bash로 직접 `pi update`만 실행한 경우에는 current session reload가 자동으로 보장되지 않으므로 `/reload` 또는 `/pilee-update`가 별도로 필요합니다.

## Runtime E2E implication

Extension/tool renderer/slash command/WebView UI 변경은 unit test가 통과해도 runtime 적용 전에는 E2E PASS가 아닙니다. Final-check는 다음 순서로 닫아야 합니다.

1. 변경 계약을 고정하는 syntax/unit/deterministic test를 실행합니다.
2. push 후 적용이 필요하면 `pi update`와 reload를 수행합니다.
3. 실제 사용자-visible consumer path를 다시 호출합니다.
4. 실패하면 수정 → push/update/reload → E2E를 반복합니다.

Slack/Notion/Jira MCP 카드화처럼 외부 consumer path가 있는 기능은 describe/schema/mock만으로 성공을 선언하지 않습니다. 최소 안전 데이터로 실제 호출 결과가 카드/확장/model-readable context 계약을 만족하는지 확인합니다.

## Failure mode

`pi update` 후 reload 없이 E2E를 돌리면 이전 extension code가 그대로 실행되어 잘못된 실패나 거짓 성공이 나올 수 있습니다. 반대로 reload를 자동화해도 update 자체가 실패했거나 command가 아닌 tool/bash 경로에서 실행되면 현재 세션 reload 액션을 안전하게 호출할 수 없습니다. 그래서 `/pilee-update`는 interactive command-context에서만 current session reload를 수행합니다.
