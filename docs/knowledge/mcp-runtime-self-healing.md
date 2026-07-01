---
title: MCP runtime은 장시간 세션에서 self-healing해야 한다
tags:
  - mcp
  - runtime
  - self-healing
  - reconnect
  - retry
category: runtime
status: active
confidence: high
applies_to:
  - extensions/mcp-bridge
source:
  - user-direction:2026-07-01-mcp-runtime-self-healing
reviewed_at: 2026-07-01
reviewed_commit: 0f1e690
related:
  - mcp-digest-first-artifacts
  - mcp-stderr-isolation
  - tool-output-noise-management
---

## Judgment

장시간 켜진 Pi 세션에서 MCP 서버가 종료되는 것은 사용자가 `/reload`나 새 세션으로 수동 복구해야 할 문제가 아니라, MCP bridge가 소유해야 하는 runtime lifecycle 문제입니다.

특히 Notion/Slack/Jira 같은 읽기 중심 MCP는 사용자가 “문서를 읽고 싶다”는 작업 흐름 안에 들어오므로, 서버 프로세스 종료·transport close·stdio pipe 오류를 사용자-facing 실패로 바로 노출하기보다 자동 재연결과 안전한 read retry를 먼저 시도해야 합니다.

## Self-Healing Rule

`extensions/mcp-bridge`는 서버별 runtime state를 유지합니다.

- transport `onclose`를 감지하면 해당 connection을 `disconnected`로 전환하고 실패/마지막 끊김 정보를 기록합니다.
- MCP 호출 전 connection이 `disconnected`/`error`/`restarting` 상태면 server config로 single-flight 재연결합니다.
- 호출 중 `transport closed`, `Not connected`, `EPIPE`, `ECONNRESET`, `EOF`, `stdin/stdout` 계열 오류가 발생하면 stale transport로 보고 서버를 강제 재연결합니다.
- read-like tool name(`read`, `get`, `list`, `search`, `query`, `fetch`, `lookup`, `describe` 등)만 재연결 후 1회 자동 replay합니다.
- write/side-effect 가능성이 있는 tool name(`create`, `update`, `delete`, `send`, `post`, `comment`, `reply`, `upload`, `run`, `execute`, `set` 등)은 서버만 복구하고 호출 replay는 하지 않습니다.

이 정책은 “사용자가 요청한 읽기 작업을 계속 진행”하는 것과 “외부 시스템에 중복 side effect를 만들지 않기”를 동시에 지키기 위한 경계입니다.

## Status Rule

`/mcp` status와 MCP status tool은 서버별 실패 수뿐 아니라 자동복구 상태도 보여야 합니다.

- 재연결 횟수
- read retry 횟수
- 마지막 재연결 시각/이유
- 마지막 disconnect 시각/이유

이 정보는 MCP가 조용히 복구된 경우에도 나중에 원인을 추적할 수 있게 하는 최소 운영 표면입니다. 다만 성공한 read retry를 매번 대화 본문에 길게 노출하지 않아야 하며, 기본 흐름은 사용자가 원래 요청한 결과를 받는 것입니다.

## Failure Mode

읽기 MCP가 오래 켜진 세션에서 죽었는데 Pi가 복구하지 않으면, 사용자는 Notion/Slack/Jira 근거 확인을 위해 세션 reload나 새 패널을 의식해야 합니다. 이는 작업 흐름이 외부 runtime 상태에 끌려가는 형태입니다.

반대로 모든 MCP 호출을 무조건 replay하면 Slack/Jira/Notion write나 comment/send 계열 tool에서 중복 side effect가 생길 수 있습니다. 따라서 자동 replay는 read-only로 판단 가능한 호출에만 제한하고, ambiguous/write 호출은 재연결까지만 수행한 뒤 명시적 재호출을 요구합니다.
