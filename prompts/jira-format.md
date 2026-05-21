---
description: Jira 티켓 description을 대상 Jira의 실제 입력 포맷에 맞게 정리한다. Jira Cloud는 ADF, 일부 legacy/도구는 wiki/markdown/plain을 쓸 수 있으므로 전송 전 포맷 경로를 판정하고 preview한다.
argument-hint: "[Jira issue key 또는 URL]"
---
$@

위 Jira 티켓/본문을 정리한다. 먼저 대상 Jira/도구가 어떤 description 포맷을 받는지 판정한다.

## 1. 입력 처리

- 이슈 키나 URL이 있으면 추출한다.
- 키 없이 본문만 있으면 local draft로 처리한다.
- 조직별 기본 project key 추론은 private/project overlay가 있을 때만 적용한다.

## 2. 현재 상태 읽기

가능한 Jira MCP/API가 있으면 summary/description을 읽는다. 없으면 사용자가 제공한 텍스트만 정리한다.

## 3. 포맷 경로 판정

Jira description 포맷은 도구별로 다르다. 추측으로 wiki markup을 보내지 않는다.

- *Jira Cloud REST v3*: `description`은 Atlassian Document Format(ADF) object다.
- *ADF 지원 MCP/API*: heading/table/list를 ADF node로 보낸다.
- *Markdown 변환 지원 MCP*: `contentFormat: "markdown"` 같은 명시 옵션이 있을 때만 markdown을 보낸다.
- *Legacy Jira/wiki 지원 API*: 해당 API가 wiki markup을 렌더링한다고 확인된 경우에만 `h2.`, `|| table ||`, `{{code}}`를 보낸다.
- *string-only MCP*: description string이 단일 paragraph로 저장될 수 있으므로 rich markup을 기대하지 않는다. 이때는 plain fallback을 사용하고 한계를 preview에 명시한다.

## 4. Description 재구성

기본 섹션:

- 배경 / 목적
- 요구사항 또는 변경 범위
- Acceptance criteria / 검증 방법
- 리스크 / 주의사항
- 참고 링크

내용 없는 섹션은 만들지 않는다.

## 5. ADF 작성 기준

Jira Cloud rich formatting이 필요하면 ADF를 사용한다.

ADF 최소 형태:

```json
{
  "type": "doc",
  "version": 1,
  "content": [
    { "type": "heading", "attrs": { "level": 2 }, "content": [{ "type": "text", "text": "배경" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "본문" }] },
    {
      "type": "bulletList",
      "content": [
        { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "항목" }] }] }
      ]
    }
  ]
}
```

자주 쓰는 매핑:

| 표현 | ADF node |
|---|---|
| 섹션 제목 | `heading` level 2/3 |
| 문단 | `paragraph` |
| 불릿 | `bulletList` + `listItem` |
| 번호 목록 | `orderedList` + `listItem` |
| 표 | `table` + `tableRow` + `tableHeader`/`tableCell` |
| 인라인 코드 | text mark `code` |
| 링크 | text mark `link` |

## 6. Wiki/Markdown은 확인된 경우에만

아래 변환은 대상 API가 해당 문법을 렌더링한다고 확인된 경우에만 사용한다.

| Markdown | Wiki markup |
|---|---|
| `## 제목` | `h2. 제목` |
| `### 제목` | `h3. 제목` |
| `**bold**` | `*bold*` |
| `` `code` `` | `{{code}}` |
| `[text](url)` | `[text\|url]` |
| `- 항목` | `* 항목` |

Jira Cloud/string-only 경로에는 이 문법을 넣지 않는다.

## 7. Preview 먼저

외부 Jira에 update/create하지 말고 먼저 preview를 보여주고 사용자 확인을 받는다.

Preview에는 반드시 포함한다.

```text
포맷 경로: ADF / Markdown 변환 / Wiki markup / Plain fallback
사용 도구: MCP/API 이름
렌더링 예상: heading/table/list 지원 여부
```

Plain fallback이면 “rich formatting 불가”를 명시한다.

## 8. 전송 후 확인

성공 응답만으로 완료를 단정하지 않는다.

- 다시 읽어서 description이 의도한 형태인지 확인한다.
- raw `h2.`, `{{`, `||`, `##`가 본문에 보이면 포맷 실패다.
- 화면 캡처나 사용자 확인 전에는 “WYSIWYG 렌더링 정상”이라고 말하지 않는다.
