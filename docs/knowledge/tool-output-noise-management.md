---
title: 도구 출력은 대화 흐름을 침범하지 않는다
tags:
  - tool-output
  - collapse
  - noise
  - ui
  - usage
  - renderer
category: ui
status: active
confidence: high
applies_to:
  - extensions/claude-code-ui
  - extensions/tool-group-renderer
  - extensions/usage-reporter
  - extensions/usage-analytics
  - extensions/mcp-bridge
source:
  - pilee-history:2026-05-01#13
  - pilee-history:2026-05-01#19
  - user-direction:2026-05-09-glimpse-stderr-noise
  - user-direction:2026-05-11-mcp-digest-first-artifacts
  - user-direction:2026-06-02-mcp-human-digest
reviewed_at: 2026-06-02
reviewed_commit: 311264e60e1921c55e9ea5206f65659ac810ddba
related:
  - tui-rendering-sanitization
  - mcp-stderr-isolation
  - ambient-status-surfaces
---

## Judgment

도구 출력은 필요한 증거이지만 대화의 주 텍스트를 덮어서는 안 됩니다. 긴 bash/read/edit 출력, usage 표시, tool group은 사용자가 원할 때 펼쳐야 하는 보조 계층입니다.

## Display Rule

기본은 접힘입니다. 관련 도구 호출은 그룹으로 묶고, 요약/상태를 먼저 보여준 뒤 필요할 때 상세를 펼칩니다. usage나 telemetry도 입력 흐름 위에 직접 끼어들지 않고 footer/status 같은 별도 위치에서만 의미가 있어야 합니다.

외부 host가 stderr에 내는 known-noise도 같은 원칙을 따릅니다. MCP banner나 macOS WebView InputMethod 로그처럼 사용자가 조치할 수 없는 반복 noise는 runtime adapter에서 막고, 실제 실패·경고·open error처럼 조치 가능한 stderr는 숨기지 않습니다.

MCP처럼 후속 action에 필요한 identifier를 포함할 수 있는 tool은 원문을 없애지 않고 layer를 나눕니다. JSON-like 결과는 크기와 무관하게 deterministic human digest + local artifact + lazy retrieval로 전환하고, 짧은 plain text만 그대로 반환합니다. Slack은 대화 스레드, Notion은 페이지/본문, Jira는 이슈 메타데이터처럼 사람이 읽는 형태를 먼저 보여주어 issue id, URL, thread id 같은 정확한 입력값을 보존하면서도 JSON/API dump가 대화 흐름을 덮지 않게 합니다.

## Failure Mode

모든 출력이 펼쳐지면 중요한 assistant 판단과 검증 증거가 도구 로그 사이에 묻힙니다. 반대로 완전히 숨기면 재현성이 사라지므로, 요약과 확장 가능성을 함께 제공합니다.
