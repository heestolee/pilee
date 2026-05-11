---
title: Embedded WebView script는 escape 경계를 보존한다
tags:
  - webview
  - embedded-script
  - escape
  - string-raw
  - regex
  - glimpse
  - frame-studio
  - renderer
  - html
  - smoke-test
category: runtime
status: active
confidence: high
applies_to:
  - extensions/frame-studio
  - extensions/archive-to-html
  - extensions/web-access
  - extensions/archive-to-html/verify-report-live.ts
source:
  - pilee-history:2026-05-06#71
  - pilee-history:2026-05-07#89
  - user-direction:2026-05-09-ember-backfill
reviewed_at: 2026-05-11
reviewed_commit: 55766aa7231850e0c715240fe796224a9dac843c
related:
  - frame-studio-interactive-decision-ui
  - live-artifact-preview-pattern
  - artifact-archive-reopenability
  - tui-rendering-sanitization
  - deterministic-fallbacks-preserve-workflow
---

## Judgment

Extension host가 HTML 문자열 안에 browser script를 생성할 때는 escape boundary가 하나 더 생깁니다. TypeScript template literal, HTML parser, browser JavaScript parser가 같은 문자열을 순서대로 해석하기 때문에 `\r?\n`, `\*\*`, escaped pipe 같은 backslash가 한 단계 앞에서 소비될 수 있습니다.

WebView가 열렸는데 “데이터를 기다리는 중”처럼 보이는 문제는 서버 state나 SSE가 아니라 embedded script parse failure일 수 있습니다. 따라서 WebView renderer 변경은 TypeScript compile만으로 충분하지 않고, 생성된 HTML에서 browser script를 추출해 파싱하는 smoke test가 필요합니다.

## Escape Rule

Browser script를 HTML template 안에 직접 넣는 경우 다음 중 하나를 사용합니다.

- `String.raw\`...\``로 host template literal의 backslash 소비를 막습니다.
- 별도 static client script 파일로 분리해 bundler/loader가 escape를 책임지게 합니다.
- script 생성 후 `new Function(script)` 또는 동등한 parse smoke로 browser-side syntax를 검증합니다.

Regex, markdown parser, table renderer, SSE client처럼 backslash가 많은 코드는 특히 위험합니다. Host 코드에서 정상으로 보이는 `/\r?\n/`이 generated HTML에서는 줄바꿈이 들어간 invalid regex가 될 수 있습니다.

## Smoke Test Rule

WebView/Artifact Browser/curator HTML을 생성하는 변경은 최소한 다음을 확인합니다.

1. 생성 HTML에서 `<script>` 본문을 추출합니다.
2. `new Function(script)`로 문법 오류를 잡습니다.
3. 중요한 escape sequence가 문자열에 남아 있는지 확인합니다.
4. 초기 `/state` fetch 또는 SSE 연결을 막는 top-level parse failure가 없는지 확인합니다.

UI가 headless에서 실제로 열리지 않더라도 script parse smoke는 deterministic하게 실행할 수 있습니다. 이 규칙은 [Live artifact는 local preview first다](./live-artifact-preview-pattern.md)의 local preview workflow를 더 안전하게 만듭니다.

## Failure Mode

- WebView 창은 열리지만 초기 상태 문구만 계속 보입니다.
- Server state에는 markdown/question이 있는데 client script가 죽어 렌더링하지 않습니다.
- Markdown table, inline code, escaped pipe가 paragraph로 깨지거나 browser script syntax error를 냅니다.
- Headless tests는 TypeScript check만 통과해 실제 WebView parse failure를 놓칩니다.

## Review Trigger

다음 변경이 생기면 이 doctrine을 다시 검토합니다.

- TFT Studio, Artifact Browser, web-search curator, Verify Report live preview의 HTML shell을 바꿀 때
- Markdown renderer나 regex-heavy client code를 template literal에 넣을 때
- Browser script를 external file/bundled asset으로 분리할 때
- Glimpse/WebView runtime이 script loading 방식을 바꿀 때
