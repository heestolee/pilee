# Verify Report — 리포트 & 기록 템플릿

## HTML 리포트 구조 (로컬 프리뷰용)

이미지 참조: 로컬 상대 경로 (현재 디렉토리 기준). `/show-report`의 Glimpse 프리뷰가 로컬 이미지 경로를 data URI로 인라인 처리하므로, report.html 자체는 상대 경로를 유지한다.

```html
<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>Verify Report — {ticket}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Pretendard', 'Apple SD Gothic Neo', 'Segoe UI', sans-serif;
    line-height: 1.6;
    color: #1f2937;
    background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
    min-height: 100vh;
  }
  .container { max-width: 1100px; margin: 0 auto; padding: 40px 24px; }
  header {
    background: linear-gradient(135deg, #10b981 0%, #047857 100%);
    color: white;
    padding: 40px;
    border-radius: 14px;
    margin-bottom: 32px;
    box-shadow: 0 10px 25px rgba(16, 185, 129, 0.2);
  }
  header h1 { font-size: 28px; line-height: 1.25; margin-bottom: 8px; }
  header .subtitle { font-size: 16px; opacity: 0.92; }
  header .meta { margin-top: 16px; font-size: 14px; opacity: 0.88; display: flex; gap: 12px; flex-wrap: wrap; }
  .badge { display: inline-flex; align-items: center; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; background: rgba(255,255,255,0.2); }
  .badge.outcome { background: rgba(209, 250, 229, .95); color: #065f46; }
  section { background: white; border-radius: 14px; padding: 32px; margin-bottom: 24px; box-shadow: 0 1px 3px rgba(0,0,0,0.06); }
  section h2 { font-size: 22px; margin-bottom: 16px; color: #111827; display: flex; align-items: center; gap: 8px; }
  p { margin-bottom: 12px; color: #4b5563; }
  .pass-banner { background: #d1fae5; border: 1px solid #10b981; color: #065f46; padding: 16px 20px; border-radius: 10px; font-weight: 700; margin-bottom: 16px; font-size: 15px; }
  .info-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }
  .info-item { background: #f9fafb; padding: 12px 16px; border-radius: 10px; border: 1px solid #e5e7eb; }
  .info-item .label { font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: .5px; margin-bottom: 4px; }
  .info-item .value { font-weight: 700; color: #1f2937; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 13px; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  th, td { padding: 10px 14px; text-align: left; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
  th { background: #f9fafb; color: #374151; font-weight: 700; }
  .pass { color: #059669; font-weight: 800; }
  .fail { color: #dc2626; font-weight: 800; }
  .skip { color: #d97706; font-weight: 800; }
  .detail { white-space: pre-wrap; line-height: 1.65; color: #4b5563; }
  .step { background: #f9fafb; border-radius: 10px; padding: 20px; margin-bottom: 16px; border: 1px solid #e5e7eb; }
  .step-header { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .step-num { background: #10b981; color: white; min-width: 32px; height: 32px; padding: 0 9px; border-radius: 999px; display: inline-flex; align-items: center; justify-content: center; font-weight: 800; font-size: 13px; }
  .step-title { font-weight: 800; color: #1f2937; font-size: 16px; }
  .step-meta { color: #6b7280; font-size: 13px; margin-top: 2px; }
  .evidence { display: grid; gap: 14px; margin-top: 14px; }
  img { display: block; max-width: 100%; border: 1px solid #d1d5db; border-radius: 8px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,.08); }
  figcaption { color: #6b7280; font-size: 12px; margin-top: 6px; }
  code { background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-family: 'SF Mono', Menlo, Consolas, monospace; font-size: 13px; color: #be185d; }
  pre { background: #1f2937; color: #f9fafb; padding: 16px; border-radius: 10px; overflow-x: auto; white-space: pre-wrap; font-size: 13px; line-height: 1.5; margin: 12px 0; }
  pre code { background: none; color: inherit; padding: 0; }
</style>
</head>
<body>
<div class="container">
  <header>
    <h1>Verify Report — {ticket}</h1>
    <div class="subtitle">{summary-or-final-summary}</div>
    <div class="meta">
      <span><strong>일자</strong> {date}</span>
      <span><strong>브랜치</strong> {branch}</span>
      <span><strong>PR</strong> <a href="{pr-url}">#{pr-number}</a></span>
      <span class="badge outcome">PASSED</span>
    </div>
  </header>

  <section>
    <h2>📋 요약</h2>
    <div class="pass-banner">✅ <strong>{pass-count} passed</strong> · {fail-count} failed · {skip-count} skipped/unverified</div>
    <div class="info-grid">
      <div class="info-item"><div class="label">workspace</div><div class="value">{workspace}</div></div>
      <div class="info-item"><div class="label">report</div><div class="value">{report-path}</div></div>
    </div>
  </section>

  <section>
    <h2>🧪 검증 항목</h2>
    <table>
      <tr><th>#</th><th>항목</th><th>분류</th><th>형태</th><th>결과</th></tr>
      <tr><td>A1</td><td>...</td><td>UI_CAPTURE</td><td>PNG</td><td class="pass">PASS</td></tr>
      <tr><td>A2</td><td>...</td><td>BE</td><td>—</td><td class="skip">SKIP (CODE_DIFF)</td></tr>
    </table>
  </section>

  <section>
    <h2>📸 상세 증거</h2>
    <div class="step">
      <div class="step-header">
        <div class="step-num">A1</div>
        <div><div class="step-title">...</div><div class="step-meta">UI_CAPTURE · PASS</div></div>
      </div>
      <p class="detail">설명...</p>
      <div class="evidence"><img src="A1-...png" alt="A1"></div>
    </div>
  </section>
</div>
</body>
</html>
```

### Renderer design 기준

Verify Report renderer는 외부 generative UI dependency에 의존하지 않고, 좋은 시각화 패턴만 deterministic HTML/CSS 기본값으로 흡수한다.

- Flat: 장식용 gradient, heavy shadow, noisy background를 피하고 border/surface/spacing으로 위계를 만든다.
- Compact: 상단에는 핵심 판정과 coverage gap만 두고, raw 원문은 접는다.
- Goal-oriented: 가능한 경우 항목을 “목표 → 검증 방법 → 결과 → 증거” 흐름으로 보여준다.
- Visual only where useful: UI 변경이 없는 NETWORK/CONSOLE/CODE_DIFF 검증은 억지 스크린샷보다 count/table/diagram 같은 기계적 근거를 우선한다.
- Deterministic: AI가 매번 report HTML을 새로 디자인하지 않고, renderer가 일관된 구조와 접근성을 보장한다.

### Raw evidence 표시 원칙

JSON/TXT/network/console/diff처럼 원문 확인이 필요한 evidence는 별도 “의도 인덱스” 섹션으로 분리하지 않고, 해당 raw evidence의 `<details>` 토글 안에 intent block을 함께 둔다.

권장 구조:

```html
<details class="raw-evidence">
  <summary>Raw evidence — Network resources <span>network</span></summary>
  <dl class="evidence-intent">
    <div><dt>왜 수집했나</dt><dd>gtm.js 중복 로드 여부 확인</dd></div>
    <div><dt>봐야 할 것</dt><dd>matchedResourceCount=1</dd></div>
    <div><dt>기대 결과</dt><dd>GTM bootstrap resource가 정확히 1회 관측됨</dd></div>
    <div><dt>실제 관찰</dt><dd>matchedResourceCount=1</dd></div>
  </dl>
  <pre><code>{...raw json...}</code></pre>
</details>
```

이 규칙은 정보 구조를 strict하게 고정하려는 목적이 아니라, raw 파일을 펼치는 순간 “왜/무엇/기대/관찰”을 같은 시선 흐름에서 읽게 하는 renderer default다. PASS/coverage gap 판정은 strict하게 유지하고, 레이아웃은 검증 타입에 맞게 변형할 수 있다.

## context.md `## Report` 섹션

`upload` 모드일 때만 작성 (confirm 모드는 작성 X — 로컬에서만 확인하니까).

```markdown
### {date} Verify Report

**Issue**: {ticket}
**Evidence archive**: {artifact-url}

| # | 항목 | 분류 | 결과 | 스크린샷 |
|---|------|------|------|---------|
| A1 | ... | UI_CAPTURE | PASS | ![A1](...?raw=true) |
| A2 | ... | BE | SKIP | — |
```

## PR 본문 `## 스크린샷 / 영상` 섹션

```markdown
## 스크린샷 / 영상

> [검증 리포트 (HTML)]({report-url})

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

## 캡처/검증 분류 AskUserQuestion 템플릿 (Step 1)

```
다음 항목들을 어떤 캡처/검증 증거로 남길지 분류했습니다. 수정할 게 있으신가요?

| # | 항목 | 분류 | 이유 |
|---|------|------|------|
| A1 | 리뷰답글 권한 토글 노출 | UI_CAPTURE | admin 메뉴에서 보임 — 캡처가 가장 확실 |
| A2 | 권한 가드 mutation 차단 | BE | UI 변화 없음 → API 응답/CODE_DIFF 권장 |

옵션:
- 분류대로 진행
- A2를 UI_CAPTURE로 변경 (직접 시연하고 싶다)
- 항목 수정/추가/삭제
```

## 환경 선택 AskUserQuestion 템플릿 (Step 2)

```json
{
  "questions": [{
    "question": "캡처 환경을 선택해주세요.\n\n감지된 환경:\n- Preview: {preview-url}\n- Local: {local-url}",
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

## Live Glimpse 프리뷰 처리

Step 5에서 `verify_report_live action=start`를 호출하면 Glimpse live preview가 열린다. 이후 각 항목을 `action=update`로 갱신하고, Step 6에서 `action=finish`를 호출해 정적 `report.html`을 export한다.

```json
{"action":"start","title":"Verify Report — {ticket}","items":[{"id":"V1","title":"...","type":"UI_CAPTURE","status":"pending"}]}
{"action":"update","runId":"{runId}","item":{"id":"V1","title":"...","type":"UI_CAPTURE","status":"pass","evidence":[{"kind":"image","path":".context/work/{workspace}/captures/v1.png"}]}}
{"action":"finish","runId":"{runId}","finalSummary":"..."}
```

다시 열 때는 `/show-report`를 사용한다.

```text
/show-report .context/work/{workspace}/captures/report.html
/show-report                          # 목록에서 선택
/show-report --browser report.html    # 시스템 브라우저 fallback
```

처리 규칙:
- 로컬 확인 완료: 업로드하지 않고 종료.
- 업로드 명시: Step 7 upload 진행.
- 보완 필요: 필요한 항목 재캡처 또는 `/verify-report --update`로 보완.
- Glimpse 실패: `/show-report --browser` 또는 시스템 브라우저 open fallback.

## 후속 단계 AskUserQuestion 템플릿 (Step 9)

```json
{
  "questions": [{
    "question": "리포트 생성 완료. 다음 단계를 선택해주세요.",
    "options": [
      "/create-pr — PR 생성 (이 리포트 포함)",
      "/reflect — 학습 캡처",
      "/verify-report --upload — project artifact storage 업로드 (upload 모드)",
      "/verify-report --update — 추가 검증 항목 처리",
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
