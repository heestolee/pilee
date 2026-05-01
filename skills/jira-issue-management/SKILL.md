---
name: jira-issue-management
description: Manages Jira issue creation and updates with proper Wiki markup formatting. Use when the user asks to create, update, or clean up Jira tickets — phrases like "Jira 이슈 만들어줘", "COM-XXXX 업데이트", "티켓 정리해줘", "create a Jira ticket", "update Jira description" trigger this skill. Automatically formats descriptions in Jira Wiki markup with proper sections, tables, and code blocks. Falls back through MCP servers (creatrip-internal → Atlassian) → REST API.
---

# Jira Issue Management

Jira 티켓 생성·업데이트를 항상 깔끔한 Wiki markup으로 처리하는 스킬.

## When to Use

자동 트리거 케이스 (한국어/영어 무관):

- "Jira 이슈 만들어줘", "COM에 티켓 만들어줘", "create a Jira ticket"
- "COM-2400 업데이트해줘", "이슈 description 정리해줘", "update Jira"
- "Jira 티켓 깔끔하게 정리", "wiki markup으로 변환", "format Jira"
- 사용자가 Jira 작업을 명시적으로 요청한 모든 상황

## 1. 티켓 키 추출

사용자 입력에서 티켓 키 추출:

| 입력 형태 | 처리 |
|----------|------|
| `https://creatrip.atlassian.net/browse/COM-2345` | → `COM-2345` |
| `COM-2345` | 그대로 사용 |
| `2345` (숫자만) | → `COM-2345` (기본 프로젝트 COM 가정) |
| 쉼표 구분 여러 티켓 | 하나씩 순서대로 처리 |
| 키 없이 "이슈 만들어줘"만 | → CREATE 모드로 진입 |

## 2. 모드 결정

### Update 모드 (티켓 키 있음)

```
1) 현재 description 읽기 (1단계 참고)
2) Wiki markup으로 재구성 (2단계 참고)
3) 업데이트 (3단계 참고)
```

### Create 모드 (새 이슈 생성 요청)

```
1) 사용자에게 필요한 정보 확인:
   - Summary (제목)
   - Issue Type (Task / Bug / Story / Epic 중 어느 거?)
   - 추가 필드 (assignee, labels, sprint 등 — 명시적 지정 시만)
2) Description은 사용자가 준 정보로 Wiki markup 생성
3) Jira에 새 이슈 생성
```

## 3. MCP/API 우선순위

도구 사용 우선순위 (있는 거 먼저 사용):

### Read

```
1순위: mcp(action:"call", tool:"jira_getIssue",
         args:'{"issueIdOrKey":"COM-XXXX"}')
       (creatrip-internal MCP)

2순위: mcp(action:"call", tool:"getJiraIssue",
         args:'{"cloudId":"creatrip.atlassian.net",
                "issueIdOrKey":"COM-XXXX",
                "responseContentFormat":"markdown"}')
       (Atlassian MCP — markdown 옵션 활용)

3순위: bash → curl REST API v2
```

### Update

```
1순위: mcp(action:"call", tool:"jira_updateIssue",
         args:'{"issueIdOrKey":"COM-XXXX",
                "fields":{"description":"...wiki..."}}')

2순위: mcp(action:"call", tool:"editJiraIssue",
         args:'{"cloudId":"creatrip.atlassian.net",
                "issueIdOrKey":"COM-XXXX",
                "fields":{"description":"...markdown..."},
                "contentFormat":"markdown"}')

3순위: bash → curl PUT REST API v2 (wiki markup)
```

### Create

```
1순위: mcp(action:"call", tool:"jira_createIssue", args:'{...}')
2순위: Atlassian MCP createJiraIssue
3순위: REST API POST /issue
```

## 4. Wiki Markup 변환 규칙

### 변환 테이블

| 마크다운 | Wiki markup |
|---------|-------------|
| `## 제목` | `h2. 제목` |
| `### 제목` | `h3. 제목` |
| `**bold**` | `*bold*` |
| `*italic*` | `_italic_` |
| `` `code` `` | `{{code}}` |
| ` ```json ` | `{code:json}` |
| `[text](url)` | `[text\|url]` |
| `> 인용` | `{quote}인용{quote}` |
| `- 항목` | `* 항목` |
| `  - 중첩` | `** 중첩` |
| `1. 순서` | `# 순서` |

### 테이블 변환

마크다운:
```
| 필드 | 타입 | 필수 |
|------|------|------|
| name | string | Y |
```

Wiki markup:
```
|| 필드 || 타입 || 필수 ||
| name | string | Y |
```

### 표준 섹션 구조 (적용 가능할 때만)

```
h2. 배경
(왜 이 작업이 필요한지)

h2. 요구사항
(무엇을 해야 하는지)

h2. 기술 스펙
(API 설계, 데이터 모델 등)

h2. 수용 기준
(완료 조건)

h2. 참고
(관련 링크, 티켓)
```

**모든 섹션이 모든 티켓에 필요하진 않음.** 내용 없으면 빈 섹션 만들지 말기.

## 5. 작업 원칙

### 절대 변경 금지

- **내용 의미** — 포맷팅만 바꾸기, 의미 보존
- **원본 언어** — 한국어면 한국어, 혼합이면 혼합 유지
- **오탈자** — 명확한 오류만 수정 (예: `Tabel` → `Table`)
- **빈 섹션** — 추가하지 말기

### 권장 동작

- 긴 본문은 의미 단위로 섹션 분리
- 구조화된 데이터(필드 정의, API 파라미터, 매핑 등)는 반드시 테이블로
- 코드/명령어는 코드 블록으로 (인라인은 `{{}}`, 블록은 `{code:lang}`)
- 외부 링크는 `[label|url]` 형태로

## 6. 결과 출력

### Update 완료 시

```
✓ COM-XXXX 정리 완료
   - {몇 개 섹션으로 재구성}
   - {특이사항 있으면 한 줄}
```

### Create 완료 시

```
✓ COM-XXXX 생성 완료 (Issue Type: {type})
   - URL: https://creatrip.atlassian.net/browse/COM-XXXX
   - {간단한 description 요약 한 줄}
```

여러 티켓 처리 시 각각 결과 출력.

## 7. Edge Cases

| 상황 | 처리 |
|------|------|
| 티켓이 존재하지 않음 (404) | 사용자에게 알리고 작업 중단 |
| MCP/API 모두 실패 | bash로 curl 시도, 그것도 실패면 에러 메시지 + 디버그 정보 |
| description이 비어있음 (update) | 사용자에게 "현재 비어있는데 새로 작성할 내용을 알려달라" 요청 |
| Atlassian MCP에서 markdown 응답 받았는데 wiki markup으로 PUT 해야 할 때 | 마크다운 → wiki markup 변환 후 사용 |
| 사용자가 description 외 다른 필드(summary, assignee 등) 변경 요청 | 그것도 같이 처리 (의도가 명확하면) |
