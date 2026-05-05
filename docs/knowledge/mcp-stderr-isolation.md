---
title: MCP stderr는 TUI 출력이 아니다
tags:
  - mcp
  - stderr
  - stdio
  - terminal
  - tui
  - noise
category: runtime
status: active
applies_to:
  - extensions/mcp-bridge
  - extensions/fork-panel
source:
  - pilee-history:2026-05-05#53
reviewed_at: 2026-05-05
reviewed_commit: 059f44559c6838a6912d08626cfcd09d08671fb1
related:
  - tui-rendering-sanitization
  - terminal-host-integration
---

## Judgment

MCP server의 stderr 배너와 경고는 JSON-RPC 통신이 아니며, Pi TUI에 직접 출력되어서는 안 됩니다. child process stderr를 terminal에 inherit하면 입력창이 그려진 뒤 외부 로그가 끼어들어 화면이 오염됩니다.

## Transport Rule

MCP transport는 stdout을 JSON-RPC 채널로 유지하되 stderr는 pipe로 열고 drain합니다. telemetry나 banner를 끌 수 있는 환경변수는 기본으로 꺼두고, 서버별 설정이 필요하면 명시적으로 override합니다.

## Failure Mode

오염된 터미널은 기능 실패가 아니어도 사용자는 패널이 깨졌다고 인식합니다. interactive UI에서는 “별도 로그니까 괜찮다”가 아니라, 사용자가 보는 화면을 보호하는 것이 runtime 책임입니다.
