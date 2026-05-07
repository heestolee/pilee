---
description: Jira 티켓 description을 대상 Jira 형식에 맞게 정리하는 프롬프트. 조직별 URL/project key/API 우선순위는 private/project overlay를 따른다.
argument-hint: "[Jira issue key 또는 URL]"
---
$@

위 Jira 티켓/본문을 다음 절차로 정리해줘.

## 1. 입력 처리

- 이슈 키나 URL이 있으면 추출한다.
- 키 없이 본문만 있으면 local draft로 처리한다.
- 조직별 기본 project key 추론은 private/project overlay가 있을 때만 적용한다.

## 2. 현재 상태 읽기

가능한 Jira MCP/API가 있으면 summary/description을 읽는다. 없으면 사용자가 제공한 텍스트만 정리한다.

## 3. Description 재구성

- 목적/배경
- 요구사항 또는 변경 범위
- Acceptance criteria / 검증 방법
- 참고 링크
- 리스크/주의사항

## 4. Jira wiki markup 변환

| Markdown | Wiki markup |
|---|---|
| `## 제목` | `h2. 제목` |
| `### 제목` | `h3. 제목` |
| `**bold**` | `*bold*` |
| `` `code` `` | `{{code}}` |
| `[text](url)` | `[text\|url]` |
| `- 항목` | `* 항목` |

## 5. Preview 먼저

외부 Jira에 update/create하지 말고 먼저 preview를 보여주고 사용자 확인을 받아라.
