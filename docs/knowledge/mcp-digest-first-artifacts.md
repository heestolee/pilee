---
title: MCP 결과는 구조화 출력부터 digest-first로 다룬다
tags:
  - mcp
  - digest-first
  - artifact
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
reviewed_at: 2026-06-02
reviewed_commit: 311264e60e1921c55e9ea5206f65659ac810ddba
related:
  - tool-output-noise-management
  - artifact-archive-reopenability
  - mcp-stderr-isolation
  - web-search-curator
---

## Judgment

MCP tool 결과는 웹 검색처럼 대화 context를 쉽게 오염시킬 수 있습니다. 특히 Slack/Notion/Jira 같은 외부 시스템은 MCP `content[].text`에 JSON string을 담아 반환하는 일이 많고, 이 JSON을 그대로 보여주면 사용자는 실제 대화·문서·이슈 내용보다 schema noise를 먼저 보게 됩니다.

따라서 MCP는 **구조화 출력부터 digest-first**로 다룹니다. JSON-like 결과는 크기와 무관하게 deterministic human digest로 바꾸고, 짧은 plain text만 그대로 통과시킵니다.

## Digest-First Rule

`extensions/mcp-bridge`는 MCP 결과를 대화창에 넣기 전에 사람이 읽는 layer와 원문 layer를 분리합니다.

- JSON-like 결과: 크기와 무관하게 digest, `responseId`만 사용자-visible로 반환합니다. `Retrieved ...` 같은 상태 문구 뒤에 JSON payload가 붙어도 같은 규칙을 적용합니다.
- Slack 결과: JSON key/value가 아니라 채널, 참여자, 시간 범위, 대화 스레드 본문을 Pi의 MCP 결과 블럭에 직접 표시합니다.
- Notion 결과: 페이지 제목, URL, 최종 수정, 주요 properties, 본문/block preview를 표시합니다.
- Jira 결과: issue key, summary, status, assignee/reporter, URL, description preview를 표시합니다.
- 짧은 plain text 결과: schema dump가 아니면 그대로 반환할 수 있습니다.
- 원문은 `~/Documents/agent-history/mcp/<server>/<tool>/` 아래 HTML, `raw.json`, `full.txt`로 저장합니다.
- 세션 중 원문이 필요하면 `get_mcp_content(responseId=...)`로 lazy retrieval합니다.

이 기준은 UI collapse가 아니라 context 절감 규칙입니다. 원문을 이미 model context에 넣고 접는 것이 아니라, 처음 반환부터 digest만 싣습니다.

## Deterministic Digest Rule

MCP 기본 digest는 AI 요약이 아니라 deterministic summary여야 합니다.

- Slack/Notion/Jira처럼 source shape를 아는 결과는 domain formatter가 먼저 처리합니다.
- generic JSON array/object는 item count, top-level keys, 주요 필드(`id`, `key`, `title`, `status`, `url` 등)를 보여줍니다.
- text/log는 threshold를 넘을 때 앞·뒤 일부 줄과 식별자/URL preview를 보여줍니다.
- token, password, authorization, cookie 같은 민감 키는 digest에서 redaction합니다.
- raw artifact는 local-only이며, 사용자가 명시적으로 열거나 `get_mcp_content`를 호출할 때만 원문을 봅니다.

## Failure Mode

MCP 결과를 무조건 숨기면 후속 작업에 필요한 identifier를 잃습니다. 반대로 JSON/API dump를 그대로 대화에 넣으면 실제 판단과 다음 질문이 schema noise에 묻힙니다. source-specific human digest와 lazy retrieval을 함께 써야 정확성, 가독성, 토큰 절감을 동시에 지킬 수 있습니다.
