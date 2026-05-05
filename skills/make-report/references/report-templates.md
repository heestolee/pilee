# Make Report — 리포트 & 기록 템플릿

## HTML 리포트 구조 (로컬 프리뷰용)

이미지 참조: 로컬 상대 경로 (현재 디렉토리 기준). Step 6의 Glimpse 프리뷰 스크립트가 로컬 이미지 경로를 data URI로 인라인 처리하므로, report.html 자체는 상대 경로를 유지한다.

```html
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Verify Report — {ticket}</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 1200px; margin: 0 auto; padding: 20px; }
  h1 { border-bottom: 2px solid #ddd; padding-bottom: 10px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 30px; }
  th, td { padding: 8px 12px; border: 1px solid #ddd; text-align: left; }
  th { background: #f7f7f7; }
  .item { margin-bottom: 40px; }
  .item h3 { color: #333; }
  .item img { max-width: 100%; border: 1px solid #ddd; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
  .pass { color: #2a7; font-weight: bold; }
  .skip { color: #888; }
  .fail { color: #d22; font-weight: bold; }
</style>
</head>
<body>
<h1>Verify Report — {ticket}</h1>
<p><strong>날짜</strong>: {date} · <strong>브랜치</strong>: {branch} · <strong>PR</strong>: <a href="{pr-url}">#{pr-number}</a></p>

<h2>요약</h2>
<table>
  <tr><th>#</th><th>항목</th><th>분류</th><th>형태</th><th>결과</th></tr>
  <tr><td>A1</td><td>...</td><td>UI</td><td>PNG</td><td class="pass">PASS</td></tr>
  <tr><td>A2</td><td>...</td><td>BE</td><td>—</td><td class="skip">SKIP (CODE_DIFF)</td></tr>
</table>

<h2>상세</h2>

<div class="item">
  <h3>A1. ...</h3>
  <p>설명...</p>
  <img src="A1-...png" alt="A1">
</div>

<!-- ... 항목별 반복 ... -->
</body>
</html>
```

## context.md `## Report` 섹션

`upload` 모드일 때만 작성 (confirm 모드는 작성 X — 로컬에서만 확인하니까).

```markdown
### {date} Verify Report

**Jira**: {ticket}
**Screenshots**: https://github.com/creatrip/agent-storage/tree/main/creatrip/product/{ticket}

| # | 항목 | 분류 | 결과 | 스크린샷 |
|---|------|------|------|---------|
| A1 | ... | UI | PASS | ![A1](...?raw=true) |
| A2 | ... | BE | SKIP | — |
```

## PR 본문 `## 스크린샷 / 영상` 섹션

```markdown
## 스크린샷 / 영상

> [검증 리포트 (HTML)](https://github.com/creatrip/agent-storage/blob/main/creatrip/product/{ticket}/report-embedded.html)

### A1. 항목 설명
![A1](...?raw=true)

### A2. (BE만 영향 — 코드 변경 참조)
파일: `backend/.../partner-permission.resolver.ts`
```

PR 본문 업데이트:
```bash
gh pr view --json body | jq -r .body > /tmp/pr-body.md
# 섹션 교체
gh pr edit --body-file /tmp/pr-body.md
```

## 캡처 분류 AskUserQuestion 템플릿 (Step 1)

```
다음 항목들을 캡처 대상으로 분류했습니다. 수정할 게 있으신가요?

| # | 항목 | 분류 | 이유 |
|---|------|------|------|
| A1 | 리뷰답글 권한 토글 노출 | UI | admin 메뉴에서 보임 |
| A2 | 권한 가드 mutation 차단 | BE | UI 변화 없음 → CODE_DIFF 권장 |

옵션:
- 분류대로 진행
- A2를 UI로 변경 (직접 시연하고 싶다)
- 항목 수정/추가/삭제
```

## 환경 선택 AskUserQuestion 템플릿 (Step 2)

```json
{
  "questions": [{
    "question": "캡처 환경을 선택해주세요.\n\n감지된 환경:\n- Preview (admin): https://pull-request-admin-{pr}.preview.creatrip.com\n- Preview (web): https://pull-request-web-{pr}.preview.creatrip.com\n- Local: localhost:5173",
    "options": ["Preview 환경 사용", "로컬 환경 사용", "직접 입력"]
  }]
}
```

## 캡처 계획 AskUserQuestion 템플릿 (Step 4)

```
캡처 계획을 확인해주세요:

| # | 항목 | 형태 | URL | 액션 요약 |
|---|------|------|-----|-----------|
| A1 | 권한 토글 노출 | PNG | /admin/members | 페이지 진입 → 멤버 클릭 → 스크린샷 |
| A3 | 신규 답글 작성 | GIF | /admin/reviews | 리뷰 클릭 → 답글 입력 → 저장 → 5프레임 |

옵션:
- 계획대로 진행
- 항목 수정 (어떤 항목인지 알려주세요)
- 사전 확인 모드로 (각 항목 시작 전 확인)
```

## Glimpse 프리뷰 액션 처리

Step 6에서 실행:

```bash
node skills/make-report/scripts/preview-report-glimpse.mjs .context/work/{workspace}/captures/report.html
```

stdout 예시:

```json
{"action":"approve","reportPath":"/abs/path/.context/work/ws/captures/report.html"}
```

처리 규칙:
- `approve` / `closed`: 로컬 확인 완료. 업로드하지 않고 종료.
- `upload`: Step 7 upload 진행.
- `recapture`: 필요한 항목 재캡처 또는 `/make-report --update`로 보완.
- `error`: `/show-report` 또는 시스템 브라우저 open fallback.

## 후속 단계 AskUserQuestion 템플릿 (Step 9)

```json
{
  "questions": [{
    "question": "리포트 생성 완료. 다음 단계를 선택해주세요.",
    "options": [
      "/create-pr — PR 생성 (이 리포트 포함)",
      "/reflect — 학습 캡처",
      "/make-report --upload — agent-storage 업로드 (upload 모드)",
      "/make-report --update — 추가 항목 캡처",
      "일단 멈춤"
    ]
  }]
}
```

## update 모드 시 — 기존 리포트 병합

기존 `report.html` 읽기:
```python
import re
with open(".context/work/{workspace}/captures/report.html") as f:
    html = f.read()

# 기존 항목 추출 (간단 스크레이핑)
existing_items = re.findall(r'<div class="item">.*?</div>', html, re.DOTALL)

# 새 항목 추가 후 결합
new_html = template_with_summary + "\n".join(existing_items + new_items)
```

리포트 헤더의 "{date}"는 갱신, 다른 항목은 보존.
