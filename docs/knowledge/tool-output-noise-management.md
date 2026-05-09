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
source:
  - pilee-history:2026-05-01#13
  - pilee-history:2026-05-01#19
  - user-direction:2026-05-09-glimpse-stderr-noise
reviewed_at: 2026-05-09
reviewed_commit: bc0f77e0329817186105ad06b89835672adf2881
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

## Failure Mode

모든 출력이 펼쳐지면 중요한 assistant 판단과 검증 증거가 도구 로그 사이에 묻힙니다. 반대로 완전히 숨기면 재현성이 사라지므로, 요약과 확장 가능성을 함께 제공합니다.
