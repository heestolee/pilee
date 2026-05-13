---
title: MCP 결과는 큰 출력만 digest-first로 다룬다
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
reviewed_at: 2026-05-12
reviewed_commit: d98008aad8f6049883436cb079597282efde6fc0
related:
  - tool-output-noise-management
  - artifact-archive-reopenability
  - mcp-stderr-isolation
  - web-search-curator
---

## Judgment

MCP tool 결과는 웹 검색처럼 대화 context를 쉽게 오염시킬 수 있지만, 항상 요약하면 안 됩니다. MCP 결과에는 다음 action의 정확한 입력값이 되는 issue id, thread id, block id, URL, 상태값이 포함될 수 있기 때문입니다.

따라서 MCP는 작은 결과는 그대로 통과시키고, 큰 결과만 digest-first artifact로 전환합니다.

## Threshold Rule

`extensions/mcp-bridge`는 MCP 결과가 일정 길이 이상이면 대화창에 원문을 직접 넣지 않습니다.

- 작은 결과: 기존처럼 그대로 반환합니다.
- 큰 결과: deterministic digest, 주요 identifier/URL preview, `responseId`, artifact path만 반환합니다.
- 원문은 `~/Documents/agent-history/mcp/<server>/<tool>/` 아래 HTML, `raw.json`, `full.txt`로 저장합니다.
- 세션 중 원문이 필요하면 `get_mcp_content(responseId=...)`로 lazy retrieval합니다.

이 기준은 UI collapse가 아니라 context 절감 규칙입니다. 원문을 이미 model context에 넣고 접는 것이 아니라, 처음 반환부터 digest만 싣습니다.

## Deterministic Digest Rule

MCP 기본 digest는 AI 요약이 아니라 deterministic summary여야 합니다.

- JSON array/object는 item count, top-level keys, 주요 필드(`id`, `key`, `title`, `status`, `url` 등)를 보여줍니다.
- text/log는 앞·뒤 일부 줄과 식별자/URL preview를 보여줍니다.
- token, password, authorization, cookie 같은 민감 키는 digest에서 redaction합니다.
- raw artifact는 local-only이며, 사용자가 명시적으로 열거나 `get_mcp_content`를 호출할 때만 원문을 봅니다.

## Failure Mode

MCP 결과를 무조건 잘라내면 후속 작업에 필요한 identifier를 잃습니다. 반대로 긴 JSON/API dump를 그대로 대화에 넣으면 실제 판단과 다음 질문이 노이즈에 묻힙니다. threshold 기반 digest와 lazy retrieval을 함께 써야 정확성과 토큰 절감을 동시에 지킬 수 있습니다.
