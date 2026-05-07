---
name: jira-issue-management
description: Jira 이슈 생성·수정·정리 요청에 사용. 이슈 본문을 Wiki markup/Markdown 등 대상 Jira가 요구하는 형식으로 정리하고, 외부 시스템에 전송하기 전 preview confirmation을 강제한다. 특정 Jira cloud/project key/MCP 우선순위는 private/project overlay를 따른다.
---

# Jira Issue Management

Jira 같은 외부 이슈 트래커에 쓰기 작업을 할 때 조용히 전송하지 않고, 읽기 → 정리 → 미리보기 → 사용자 확인 → 전송 순서를 지킨다.

## When to use

- “Jira 이슈 만들어줘”
- “티켓 업데이트해줘”
- “description 정리해줘”
- “wiki markup으로 변환해줘”
- 이슈 키/URL이 포함된 외부 이슈 업데이트 요청

## Core rule

Create/Update 모두 전송 전 preview confirmation이 필수다. 사용자가 명시적으로 즉시 전송을 요청하더라도 외부 시스템 쓰기라는 점을 짧게 알리고 최종 확인을 받는다.

## Workflow

### 1. Mode 결정

- 이슈 키/URL 있음 → update/read mode
- 키 없음 + 생성 요청 → create mode
- 단순 포맷 변환만 요청 → local draft mode, 전송하지 않음

### 2. 현재 상태 읽기

가능한 MCP/API를 사용해 현재 summary/description/status를 읽는다. 사용 가능한 도구가 없으면 사용자가 제공한 텍스트만 대상으로 local draft를 만든다.

### 3. 본문 정리

대상 Jira가 요구하는 포맷에 맞춘다.

| Markdown | Jira wiki markup |
|---|---|
| `## 제목` | `h2. 제목` |
| `### 제목` | `h3. 제목` |
| `**bold**` | `*bold*` |
| `` `code` `` | `{{code}}` |
| fenced code | `{code}` block |
| `[text](url)` | `[text|url]` |
| `- item` | `* item` |

### 4. Preview confirmation

전송 전 다음을 보여준다.

- 대상 이슈/프로젝트
- 변경 요약
- 최종 본문 preview
- 전송할 API/tool

사용자의 명시적 승인 후에만 create/update를 실행한다.

### 5. 전송 후 보고

- 이슈 키/URL
- 변경 필드
- 실패 시 error summary와 재시도 방법

## Private/project overlay

회사별 규칙은 private/project skill에 둔다.

- 기본 project key 추론
- Jira cloud URL
- MCP 서버 우선순위
- 조직별 issue type/field convention
