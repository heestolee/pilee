---
description: Jira 티켓 description을 Wiki markup으로 깔끔하게 정리
argument-hint: "[티켓 키 또는 URL] (예: COM-2345 또는 https://creatrip.atlassian.net/browse/COM-2345)"
---
Jira 티켓 description을 정리해줘.

## 입력
다음 인자에서 티켓 키를 추출해서 사용해:
$@

티켓 키 추출 규칙:
- URL 형태 `https://creatrip.atlassian.net/browse/COM-2345` → `COM-2345`
- 키 형태 `COM-2345` → 그대로 사용
- 숫자만 `2345` → `COM-2345` (기본 프로젝트 COM)
- 쉼표로 구분된 여러 티켓 → 하나씩 순서대로 처리

## 실행 순서

### 1단계: 티켓 읽기

다음 우선순위로 티켓을 가져와:

1. **MCP** (있으면 우선) — creatrip-internal MCP 서버:
```
mcp(action:"call", tool:"jira_getIssue", args:'{"issueIdOrKey":"COM-XXXX"}')
```

2. **Atlassian MCP**:
```
mcp(action:"call", tool:"getJiraIssue", args:'{"cloudId":"creatrip.atlassian.net","issueIdOrKey":"COM-XXXX","responseContentFormat":"markdown"}')
```

3. **REST API fallback**:
```bash
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://creatrip.atlassian.net/rest/api/2/issue/COM-XXXX?fields=summary,description"
```

### 2단계: Wiki Markup으로 재구성

현재 description을 읽고 **Jira wiki markup**으로 정리해.

#### 핵심 원칙

- **섹션 헤더**: `h2.`, `h3.` 으로 논리적 그룹핑
- **테이블**: 필드 정의, API 파라미터, 상태 매핑 등 구조화된 데이터는 반드시 테이블로
  - 헤더: `|| 필드 || 타입 || 필수 || 설명 ||`
  - 행: `| icon_type | string | Y | 아이콘 종류 |`
- **목록**: `*` 불릿, `**` 중첩 불릿, `#` 번호 목록
- **코드**: `{{monospace}}` 인라인, `{code:json}...{code}` 블록
- **링크**: `[라벨|URL]`
- **강조**: `*bold*`, `_italic_`
- **인용**: `{quote}...{quote}`

#### 일반적인 섹션 구조

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

모든 티켓에 모든 섹션이 필요하진 않아. 실제 내용에 맞게 판단해.

#### 변환 규칙 (마크다운 → Wiki markup)

| 마크다운 | Wiki markup |
|---------|-------------|
| `## 제목` | `h2. 제목` |
| `### 제목` | `h3. 제목` |
| `\| a \| b \|` (헤더) | `\|\| a \|\| b \|\|` |
| `\| a \| b \|` (행) | `\| a \| b \|` |
| `` `code` `` | `{{code}}` |
| `**bold**` | `*bold*` |
| `*italic*` | `_italic_` |
| `[text](url)` | `[text\|url]` |
| ` ```json ` | `{code:json}` |
| `> 인용` | `{quote}인용{quote}` |

**중요 규칙**:
- **내용 의미는 절대 변경 X**. 포맷팅만 개선
- **원본 언어 유지**: 한국어면 한국어, 혼합이면 혼합
- 오탈자도 있는 그대로. 명확한 오류만 수정
- 빈 섹션 추가하지 말기 (배경 없으면 배경 섹션 만들지 말기)

### 3단계: 티켓 업데이트

다음 중 하나로 업데이트:

1. **MCP** (creatrip-internal):
```
mcp(action:"call", tool:"jira_updateIssue", args:'{"issueIdOrKey":"COM-XXXX","fields":{"description":"...wiki markup..."}}')
```

2. **Atlassian MCP** — 마크다운 그대로 OK:
```
mcp(action:"call", tool:"editJiraIssue", args:'{"cloudId":"creatrip.atlassian.net","issueIdOrKey":"COM-XXXX","fields":{"description":"...markdown..."},"contentFormat":"markdown"}')
```

3. **REST API**:
```bash
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -X PUT \
  -H "Content-Type: application/json" \
  "https://creatrip.atlassian.net/rest/api/2/issue/COM-XXXX" \
  -d '{"fields":{"description":"...wiki markup..."}}'
```

**주의**: REST API v2는 반드시 wiki markup을 사용. MCP의 `contentFormat: "markdown"`을 쓸 때만 마크다운 가능.

### 4단계: 확인

업데이트 성공 시 (HTTP 204 또는 MCP 성공 응답) 다음 형식으로 짧게 알려:

```
✓ COM-XXXX 정리 완료
   - {몇 개 섹션 추가/재구성했는지}
   - {특이사항 있으면 한 줄}
```

여러 티켓이면 각각 완료 메시지 출력.
