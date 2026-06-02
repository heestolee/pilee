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
  - extensions/utils/glimpse
  - extensions/workspace
source:
  - pilee-history:2026-05-01#15
  - pilee-history:2026-05-03#26
  - pilee-history:2026-05-04#35
  - user-direction:2026-05-09-glimpse-stderr-noise
  - user-direction:2026-05-11-glimpse-cmd-v-paste
  - user-direction:2026-05-12-workspace-save-restore
  - user-direction:2026-05-11-glimpse-zoom-shortcuts
reviewed_at: 2026-06-02
reviewed_commit: 83617e9544615d818e6a7a17fa807f029a7db835
related:
  - fork-panel-spatial-continuity
  - mcp-stderr-isolation
  - theme-information-hierarchy
  - terminal-workspace-restore
---

## Judgment

터미널 기능은 표준이라고 가정하지 말고 host별 adapter로 다룹니다. Ghostty는 어떤 AppleScript 동작은 지원하지 않고, 어떤 설정은 기본 상속 옵션이 우선하며, notification escape sequence도 기대와 다를 수 있습니다.

## Adapter Rule

새 탭, split, focus, notification, config reload, workspace restore는 host capability를 확인하고 fallback을 둡니다. 예를 들어 Cmd+T 동작은 working directory 설정만으로 충분하지 않고 tab inheritance 옵션도 같이 봐야 합니다. 알림은 OSC sequence보다 host에서 실제 동작하는 notifier를 우선합니다. 새 terminal에 Pi를 다시 띄우는 명령은 bare `pi`나 자동 `pi update`에 의존하지 않습니다. 새 shell의 PATH가 현재 Pi 프로세스와 다를 수 있으므로, 현재 프로세스의 `process.execPath` + `process.argv[1]` 또는 명시적 wrapper 경로를 보존해 `--session`을 실행해야 합니다. Ghostty workspace 복원처럼 host geometry가 제한적으로만 노출되는 기능은 session continuity와 layout fidelity를 분리해 표시해야 합니다.

## WebView/Open Rule

Glimpse/WebView와 OS browser도 host입니다. static `file://` anchor가 브라우저에서는 동작해도 WebView에서는 기대대로 외부 open을 넘기지 않을 수 있습니다. preview/open 기능은 local server route, allowlisted realpath, host-side opener처럼 host adapter 경계를 명시해 구현합니다.

WebView의 native edit menu가 `Cmd+C`를 항상 페이지 selection에 전달한다고 가정하지 않습니다. 사용자가 검토/계획/리포트 텍스트를 복사해야 하는 Glimpse artifact는 `user-select:text`와 selection 기반 copy shim(`copy` event + `Cmd/Ctrl+C` keydown + clipboard/execCommand fallback)을 함께 넣습니다. 복사는 artifact 검토의 기본 affordance이지 브라우저 전용 편의 기능이 아닙니다.

붙여넣기는 반대로 OS pasteboard를 읽어 현재 focus된 WebView 입력 영역에 전달하는 동작입니다. JS clipboard read workaround에 의존하면 secure context/permission/WKWebView 정책에 막힐 수 있으므로, macOS Glimpse adapter는 native host에서 `Cmd+V`를 key equivalent/local key monitor로 받아 `NSPasteboard`의 plain text를 focused `input`/`textarea`/`contenteditable`에 삽입합니다. 즉 copy는 페이지 selection 보강이고, paste는 host edit shortcut 보강입니다.

확대/축소도 browser 기본값으로 기대하지 않습니다. Chrome의 `Cmd++`, `Cmd+-`, `Cmd+0`은 Chrome app이 처리하는 shortcut이므로, Glimpse에서는 macOS host adapter가 View menu/key equivalent/local key monitor 경로로 받아 `WKWebView.pageZoom`을 조정해야 합니다. `Cmd++`는 keyboard layout에 따라 `Cmd+=` 또는 keyCode 24로 들어올 수 있으므로 문자와 keyCode fallback을 함께 둡니다.

macOS WebView는 기능 실패가 아닌 Text Services/InputMethodKit stderr noise를 터미널에 흘릴 수 있습니다. 예를 들어 Caps Lock LED/IMK runloop wakeup 계열 로그는 사용자가 검토할 report/error가 아니므로 Glimpse host adapter에서 allowlisted noise만 필터링합니다. 단, actionable native host stderr는 계속 stderr로 전달해야 합니다.

## Local Metadata Rule

Artifact Browser가 worktree metadata, Pi session title, Frame transcript를 읽어 capture group label을 만들 때도 host-local filesystem을 다루는 것입니다. 파일이 없거나 JSON이 깨졌거나 workspace 이름이 맞지 않아도 UI가 실패하면 안 되며, workspace/unclassified fallback으로 내려가야 합니다.

## Failure Mode

host 차이를 숨기면 사용자는 “설정했는데 왜 안 되지?” 상태가 됩니다. pilee는 terminal host를 추상화하되, 실패할 수 있는 경계를 코드와 문서에 남깁니다.
