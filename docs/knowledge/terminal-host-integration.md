---
title: 터미널 연동은 host adapter로 다룬다
tags:
  - terminal
  - ghostty
  - applescript
  - notify
  - host
  - integration
category: runtime
status: active
confidence: high
applies_to:
  - extensions/fork-panel
  - extensions/notify
  - extensions/custom-style
  - extensions/mcp-bridge
  - extensions/archive-to-html
source:
  - pilee-history:2026-05-01#15
  - pilee-history:2026-05-03#26
  - pilee-history:2026-05-04#35
reviewed_at: 2026-05-09
reviewed_commit: 3ed57eb2a2ece44cbec876f620350f4fd6cd2b6b
related:
  - fork-panel-spatial-continuity
  - mcp-stderr-isolation
  - theme-information-hierarchy
---

## Judgment

터미널 기능은 표준이라고 가정하지 말고 host별 adapter로 다룹니다. Ghostty는 어떤 AppleScript 동작은 지원하지 않고, 어떤 설정은 기본 상속 옵션이 우선하며, notification escape sequence도 기대와 다를 수 있습니다.

## Adapter Rule

새 탭, split, focus, notification, config reload는 host capability를 확인하고 fallback을 둡니다. 예를 들어 Cmd+T 동작은 working directory 설정만으로 충분하지 않고 tab inheritance 옵션도 같이 봐야 합니다. 알림은 OSC sequence보다 host에서 실제 동작하는 notifier를 우선합니다.

## WebView/Open Rule

Glimpse/WebView와 OS browser도 host입니다. static `file://` anchor가 브라우저에서는 동작해도 WebView에서는 기대대로 외부 open을 넘기지 않을 수 있습니다. preview/open 기능은 local server route, allowlisted realpath, host-side opener처럼 host adapter 경계를 명시해 구현합니다.

## Local Metadata Rule

Artifact Browser가 worktree metadata, Pi session title, Frame transcript를 읽어 capture group label을 만들 때도 host-local filesystem을 다루는 것입니다. 파일이 없거나 JSON이 깨졌거나 workspace 이름이 맞지 않아도 UI가 실패하면 안 되며, workspace/unclassified fallback으로 내려가야 합니다.

## Failure Mode

host 차이를 숨기면 사용자는 “설정했는데 왜 안 되지?” 상태가 됩니다. pilee는 terminal host를 추상화하되, 실패할 수 있는 경계를 코드와 문서에 남깁니다.
