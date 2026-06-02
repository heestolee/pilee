---
title: Interactive shell은 bash가 아닌 터미널 세션이다
tags:
  - interactive-shell
  - shell
  - tui
  - dev-server
  - overlay
  - dispatch
  - hands-free
  - timeout
category: workflow
status: active
confidence: high
applies_to:
  - extensions/interactive-shell
  - skills/interactive-shell
source:
  - user-direction:2026-05-14-my-pi-tool-overrides
  - github:jonghakseo/my-pi/extensions/interactive-shell
  - github:jonghakseo/my-pi/skills/interactive-shell
reviewed_at: 2026-06-02
reviewed_commit: 7861f10310348338896d444480de22f1ba919273
related:
  - bash-tool-title-output-override
  - tool-output-noise-management
  - terminal-host-integration
---

## Judgment

일반 명령은 `bash`로 충분하지만, dev server, TUI, REPL, log viewer처럼 계속 실행되거나 사용자 입력이 필요한 프로그램은 bash 출력으로 다루면 흐름이 쉽게 깨집니다. 이런 경우에는 명령 실행이 아니라 **터미널 세션**으로 다뤄야 합니다.

my-pi의 `interactive-shell`은 이 경계를 별도 tool로 둡니다. pilee도 같은 원칙을 가져와 `interactive_shell`을 overlay/hands-free/dispatch 세션 도구로 제공합니다.

## Tool Contract

- 일반 비인터랙티브 명령은 `bash`를 사용합니다.
- TUI/REPL/dev server/log tail처럼 화면이나 지속 세션이 필요하면 `interactive_shell`을 사용합니다.
- 새 세션은 `command`, `cwd`, `mode`, `timeout` 등을 받을 수 있습니다.
- 기존 세션은 `sessionId`로 query/input/kill/background/reattach할 수 있습니다.
- `mode=interactive`는 visible overlay를 엽니다.
- `mode=hands-free`는 세션을 유지하면서 quiet/update 기준으로 상태를 돌려줍니다.
- `mode=dispatch`는 finite fire-and-forget 작업을 background로 보내고 완료 알림을 남깁니다.

## Boundary

`interactive_shell`은 subagent가 아닙니다. 다른 AI에게 일을 맡기는 목적이면 `subagent`를 사용하고, 사람이 보거나 조작할 수 있는 터미널 프로그램을 유지해야 할 때만 `interactive_shell`을 사용합니다.

## Safety Notes

- `cwd`는 명령 세션의 실행 위치입니다. 명시하지 않으면 현재 세션 cwd를 따릅니다.
- `timeout`은 장시간 실행 프로세스를 자동 종료하는 안전장치입니다.
- 장시간 dev server/log viewer는 `handsFree.autoExitOnQuiet:false` 같은 설정이 필요할 수 있습니다.
- 완료 알림과 background widget은 편의 장치이며, 실제 검증 결과를 대신하지 않습니다.
