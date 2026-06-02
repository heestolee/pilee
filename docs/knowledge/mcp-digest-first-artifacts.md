---
title: MCP 결과는 구조화 출력부터 digest-first로 다룬다
tags:
  - mcp
  - digest-first
  - tool-output
  - lazy-retrieval
category: runtime
status: active
confidence: high
applies_to:
  - extensions/mcp-bridge
  - get_mcp_content
source:
  - user-direction:2026-05-11-mcp-digest-first-artifacts
  - user-direction:2026-06-02-mcp-human-digest
  - user-direction:2026-06-02-mcp-slack-block-not-artifact
  - user-direction:2026-06-02-mcp-scroll-only-no-artifact
  - user-direction:2026-06-02-mcp-slack-participants-no-preview
  - user-direction:2026-06-02-mcp-notion-image-url-hidden
  - user-direction:2026-06-02-mcp-one-line-collapsed-render
reviewed_at: 2026-06-02
reviewed_commit: 66927aafbf8d2d774a033e700f50bca494701178
related:
  - tool-output-noise-management
  - mcp-stderr-isolation
  - web-search-curator
---

## Judgment

MCP tool 결과는 웹 검색처럼 대화 context를 쉽게 오염시킬 수 있습니다. 특히 Slack/Notion/Jira 같은 외부 시스템은 MCP `content[].text`에 JSON string을 담아 반환하는 일이 많고, 이 JSON을 그대로 보여주면 사용자는 실제 대화·문서·이슈 내용보다 schema noise를 먼저 보게 됩니다.

따라서 MCP는 **구조화 출력부터 digest-first**로 다룹니다. JSON-like 결과는 크기와 무관하게 deterministic human digest로 바꾸고, 짧은 plain text만 그대로 통과시킵니다.

## Digest-First Rule

`extensions/mcp-bridge`는 MCP 결과를 대화창에 넣기 전에 사람이 읽는 digest layer와 세션 중 재조회 가능한 원문 layer를 분리합니다.

- JSON-like 결과: 크기와 무관하게 digest, `responseId`만 사용자-visible로 반환합니다. `Retrieved ...` 같은 상태 문구 뒤에 JSON payload가 붙어도 같은 규칙을 적용합니다.
- Slack 결과: JSON key/value가 아니라 채널, 참여자, 시간 범위, 대화 스레드 본문을 Pi의 MCP 결과 블럭에 직접 표시합니다. 메시지에 `userId`만 있고 별도 user/profile map이 있는 형태도 참여자와 발화자 이름으로 해석합니다.
- Notion 결과: 페이지 제목, URL, 최종 수정, 주요 properties, 본문/block preview를 표시합니다. Markdown 이미지 링크의 signed URL은 출력하지 않고 `- 이미지: 파일명 · Notion 원문에서 확인`으로 축약합니다.
- Jira 결과: issue key, summary, status, assignee/reporter, URL, description preview를 표시합니다.
- 짧은 plain text 결과: schema dump가 아니면 그대로 반환할 수 있습니다.
- Slack/Notion/Jira처럼 source-specific human digest가 만들어진 경우 generic `보존한 식별자/URL preview`를 덧붙이지 않습니다. 사람이 읽을 수 있는 digest 자체가 기본 surface입니다.
- 별도 HTML/raw/full artifact 파일은 기본 생성하지 않습니다. Slack/Notion/Jira는 원본 시스템이 더 나은 source of truth이므로 로컬 중복 보관을 만들지 않습니다.
- 같은 세션 중 원문이 필요하면 `get_mcp_content(responseId=...)`로 lazy retrieval합니다.
- Pi 화면에서는 MCP 결과를 기본 한 줄 카드로 렌더링하고, 기존 tool output 펼침 단축키 `Ctrl+O`로 readable digest를 펼칩니다. 이는 content를 버리는 것이 아니라 UI 기본 표시만 줄이는 규칙입니다.

이 기준은 UI collapse가 아니라 context 절감 규칙입니다. 원문을 이미 model context에 넣고 접는 것이 아니라, 처음 반환부터 digest만 싣습니다.

## Deterministic Digest Rule

MCP 기본 digest는 AI 요약이 아니라 deterministic summary여야 합니다.

- Slack/Notion/Jira처럼 source shape를 아는 결과는 domain formatter가 먼저 처리합니다.
- generic JSON array/object는 item count, top-level keys, 주요 필드(`id`, `key`, `title`, `status`, `url` 등)를 보여줍니다.
- text/log는 threshold를 넘을 때 앞·뒤 일부 줄과 식별자/URL preview를 보여줍니다.
- token, password, authorization, cookie 같은 민감 키는 digest에서 redaction합니다.
- raw 원문은 세션 메모리에만 보존하고, 사용자가 `get_mcp_content`를 호출할 때만 봅니다.

## Failure Mode

MCP 결과를 무조건 숨기면 후속 작업에 필요한 identifier를 잃습니다. 반대로 JSON/API dump를 그대로 대화에 넣으면 실제 판단과 다음 질문이 schema noise에 묻힙니다. source-specific human digest와 lazy retrieval을 함께 써야 정확성, 가독성, 토큰 절감을 동시에 지킬 수 있습니다.
