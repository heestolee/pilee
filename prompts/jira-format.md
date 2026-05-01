---
description: Jira 티켓 description을 Jira wiki markup으로 깔끔하게 정리
argument-hint: "[COM-XXXX 또는 Jira URL]"
---
$@

위 티켓을 다음 절차로 정리해줘.

## 입력 처리

티켓 키를 추출:
- URL `https://creatrip.atlassian.net/browse/COM-2345` → `COM-2345`
- 키 `COM-2345` → 그대로
- 숫자만 `2345` → `COM-2345` (기본 프로젝트 COM)

여러 티켓이 쉼표로 구분되어 있으면 하나씩 순서대로 처리.

## 1단계: 티켓 읽기

**우선순위 1**: creatrip-internal MCP 사용 (가능하면)
```
mcp__creatrip-internal__jira_getIssue(issueIdOrKey: "COM-XXXX")
```

**우선순위 2**: Atlassian MCP
```
mcp__claude_ai_Atlassian__getJiraIssue(cloudId: "creatrip.atlassian.net", issueIdOrKey: "COM-XXXX", responseContentFormat: "markdown")
```

**우선순위 3**: REST API (환경변수 `JIRA_EMAIL`, `JIRA_API_TOKEN` 필요)
```bash
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  "https://creatrip.atlassian.net/rest/api/2/issue/COM-XXXX?fields=summary,description"
```

## 2단계: description 재구성 — Jira wiki markup

### 핵심 원칙

- **섹션 헤더**: `h2.`, `h3.` 으로 논리적 그룹핑
- **테이블**: 필드 정의/API 파라미터/상태 매핑은 반드시 테이블로
  - 헤더: `|| 필드 || 타입 || 필수 || 설명 ||`
  - 행: `| icon_type | string | Y | 아이콘 종류 |`
- **목록**: `*` 불릿, `**` 중첩 불릿, `#` 번호 목록
- **코드**: `{{monospace}}` 인라인, `{code:json}...{code}` 블록
- **링크**: `[라벨|URL]`
- **강조**: `*bold*`, `_italic_`
- **인용**: `{quote}...{quote}`

### 일반적인 섹션 구조

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

모든 티켓에 모든 섹션이 필요하진 않음. 실제 내용에 맞게 판단.

### 변환 규칙

- 마크다운 `##` → `h2.`, `###` → `h3.`
- 마크다운 테이블 `| a | b |` → Jira `|| a || b ||` (헤더) + `| a | b |` (행)
- 마크다운 `` `code` `` → `{{code}}`
- 마크다운 `**bold**` → `*bold*`
- 마크다운 `[text](url)` → `[text|url]`
- 마크다운 ` ```json ` → `{code:json}`

**중요**: 내용 의미는 절대 변경하지 마. 포맷팅만 개선. 원본 언어 유지 (한국어면 한국어, 혼합이면 혼합).

## 3단계: 티켓 업데이트

**우선순위 1**: MCP의 contentFormat: "markdown" 사용 가능하면 마크다운 그대로 OK
```
mcp__creatrip-internal__jira_updateIssue(issueIdOrKey: "COM-XXXX", fields: {description: "..."})
```

**우선순위 2**: REST API v2는 반드시 wiki markup
```bash
curl -s -u "$JIRA_EMAIL:$JIRA_API_TOKEN" \
  -X PUT \
  -H "Content-Type: application/json" \
  "https://creatrip.atlassian.net/rest/api/2/issue/COM-XXXX" \
  -d '{"fields":{"description":"...wiki markup..."}}'
```

## 4단계: 확인

성공 시 (HTTP 204 또는 MCP 성공):
> COM-XXXX 정리 완료!

실패 시 에러 원인과 함께 표시.
