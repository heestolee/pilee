---
name: verify-report
description: PR/구현 검증을 위해 스크린샷/GIF 캡처와 네트워크 로그, 콘솔 출력, 코드 diff 같은 검증 근거를 HTML 리포트로 만든다. 화면 캡처가 가장 확실한 증거인 UI 검증, 이벤트/BE처럼 로그가 필요한 검증 모두에 사용한다. 기본은 로컬 확인용이며 업로드/PR 업데이트는 명시 요청 시에만 한다.
argument-hint: "[base-url] [--upload] [--update] [--ask-before]"
---

# Verify Report

구현이 요구사항을 만족한다는 **캡처/검증 증거**를 수집해 HTML 리포트로 만든다. 화면 변화는 PNG/GIF 캡처가 가장 확실한 검증 근거가 될 수 있으므로 우선 활용한다. 화면 변화가 없거나 이벤트/BE처럼 눈에 보이지 않는 동작은 네트워크 로그/콘솔 결과/코드 diff 같은 기계적 근거를 함께 남긴다.

## 원칙

- **캡처/증거 우선**: UI는 화면 캡처를 우선 증거로 삼고, 비가시 동작은 성공 기준을 어떤 로그/결과로 확인할지 먼저 정한다.
- **미검증 명시**: 자동화로 확인하지 못한 항목은 PASS로 쓰지 않고 `미검증`에 남긴다.
- **업로드 opt-in**: 기본 `/verify-report`는 로컬 리포트 확인까지만 한다. agent-storage 업로드와 PR 본문 갱신은 `--upload` 또는 사용자의 명시적 업로드 액션이 있을 때만 한다.
- **프리뷰 강제**: HTML 생성 후 Glimpse WebView로 먼저 보여주고, 사용자가 확인한 뒤 다음 행동을 정한다.

## 모드 (default: confirm-only)

| 모드 | 설명 | 트리거 |
|------|------|--------|
| **confirm** (default) | 로컬 캡처/검증 증거 수집 + HTML 프리뷰만. 업로드 X | 기본 |
| **upload** | confirm + agent-storage 업로드 + PR 본문 갱신 | `--upload` 인자 또는 사용자가 명시 요청 |
| **update** | 기존 리포트에 신규 검증 항목 append | `--update` 인자 또는 “추가” 키워드 감지 |
| **ask-before** | 항목별 검증 실행 전 사전 확인 | `--ask-before` 인자 또는 사용자가 요구 |

## 실행 단계 개요

| Step | 설명 | confirm | upload | update |
|------|------|:---:|:---:|:---:|
| 1 | 성공 기준 수집 + 캡처/증거 유형 분류 | ✓ | ✓ | ✓ (신규만) |
| 2 | 검증 환경 확인 | ✓ | ✓ | ✓ |
| 3 | 로그인/권한 Credential 확보 | ✓ | ✓ | ✓ |
| 4 | 검증 계획 수립 → 유저 확인 | ✓ | ✓ | ✓ |
| 4-B | (ask-before 모드만) 항목별 사전 확인 | opt | opt | opt |
| 5 | `verify_report_live` 시작 → 브라우저/명령 자동화로 캡처/증거 수집 | ✓ | ✓ | ✓ |
| 6 | live preview 갱신 → 정적 HTML export → 유저 리뷰 | ✓ | ✓ | ✓ (병합) |
| 7 | agent-storage 업로드 |  | ✓ | ✓ |
| 8 | context.md + PR 본문 업데이트 |  | ✓ | ✓ |
| 9 | 후속 단계 AskUserQuestion | ✓ | ✓ | ✓ |

> 상세 참조:
> - [references/capture-commands.md](references/capture-commands.md) — agent-browser 명령, ffmpeg GIF 합성, 브라우저 증거 수집
> - [references/upload-scripts.md](references/upload-scripts.md) — agent-storage 업로드
> - [references/report-templates.md](references/report-templates.md) — HTML/context.md/PR 템플릿
> - [references/troubleshooting.md](references/troubleshooting.md) — agent-browser daemon 복구, 자주 깨지는 케이스

## Step 1: 성공 기준 수집 + 캡처/증거 유형 분류

소스 우선순위:
1. **PR test plan** — `gh pr view` body의 `## Test plan`
2. **Verify 체크리스트** — `.context/work/{workspace}/context.md`의 `## Verifications`
3. **자체 도출** — Frame 성공 기준 + 구현 코드 분석

수집 직후 각 항목을 **화면 캡처로 검증할지, 다른 증거로 검증할지** 분류한다.

| 분류 | 설명 | 리포트 증거 |
|------|------|-------------|
| **UI_CAPTURE** | 화면에 보이는 상태/플로우 | PNG/GIF + 짧은 설명 |
| **NETWORK** | GA/픽셀/API 요청 발화/미발화 | request/response 로그, matched count, 필터 조건 |
| **CONSOLE** | 콘솔 출력/런타임 상태 | console log/error 캡처 |
| **CODE_DIFF** | 코드 구조 자체가 근거 | 관련 diff/파일/라인 요약 |
| **BE** | API/권한/DB만 영향 | API 응답, SQL 결과, 로그 또는 CODE_DIFF |
| **SKIP** | 이번 리포트에서 제외 | 제외 사유 |

분류 결과를 사용자에게 보여주고 확인한다.

```markdown
다음 검증 항목과 증거 유형으로 리포트를 만들겠습니다. 수정할 게 있나요?

| # | 성공 기준 | 캡처/증거 유형 | 이유 |
|---|-----------|----------------|------|
| V1 | dev 스팟상세에서 GA 이벤트 미발화 | NETWORK | 화면 변화 없음, 네트워크 요청 여부가 핵심 증거 |
| V2 | 신규 버튼 노출 | UI_CAPTURE | 화면에 보이는 상태는 캡처가 가장 확실 |
| V3 | 권한 없는 mutation 차단 | BE | API 응답/권한 로직 검증 |
```

## Step 2: 검증 환경 확인

```bash
which agent-browser  # 미설치 시: npm install -g agent-browser && agent-browser install
which ffmpeg          # GIF 항목이 있을 때만. 미설치 시: brew install ffmpeg
```

대상 URL: `$ARGUMENTS` > Preview URL (PR 감지) > dev/staging URL > 로컬 서버 순으로 자동 감지 후 AskUserQuestion으로 확인한다. 환경 차이가 검증 결과에 영향을 주는 경우(`NODE_ENV` vs 배포 환경 등)는 리포트에 명시한다.

## Step 3: 로그인/권한 Credential 확보

검증 항목에서 필요한 역할을 판별해 역할별 AskUserQuestion으로 확보한다. 추가 계정을 거부하면 해당 항목은 SKIP 또는 부분 검증으로 표시한다.

## Step 4: 검증 계획 수립

| 캡처/증거 유형 | 형태 |
|----------|------|
| UI 단일 상태 | PNG 1장 |
| UI 다단계 플로우 | GIF |
| NETWORK | JSON/표 + 필요 시 화면 PNG |
| CONSOLE | 로그 excerpt + 필요 시 화면 PNG |
| CODE_DIFF | 파일/라인/diff 요약 |
| BE/API | 응답 JSON/상태코드/쿼리 결과 |

**파일 경로**: `.context/work/{workspace}/captures/` 안에 저장한다.

> ⚠️ `/tmp/`는 사용 금지 — 휘발되고 `/show-report`/Glimpse 프리뷰 탐색 대상이 아니다.

파일명: kebab-case `{항목번호}-{설명}.{png|gif|json|txt}`

AskUserQuestion으로 계획 확인.

## Step 4-B: (옵션) 사전 항목별 확인

`--ask-before` 모드 또는 사용자가 “사전 확인하자” 요청한 경우, 각 항목 시작 전마다 확인한다.

```markdown
[V1] dev 스팟상세 GA 이벤트 미발화 — NETWORK + PNG
URL: https://dev.creatrip.com/en/spot/13214
액션: reload → 7초 대기 → scroll → performance resource에서 이벤트명 필터

진행할까요?
```

옵션: 진행 / 건너뛰기 / 다른 액션으로

## Step 5: `verify_report_live` 시작 → 캡처/증거 수집

[references/capture-commands.md](references/capture-commands.md)를 따른다.

캡처 계획이 확정되면 먼저 live report를 시작한다. 이때 Glimpse가 열리고, 이후 항목별 진행 상태가 SSE로 실시간 갱신된다.

```json
{
  "action": "start",
  "title": "Verify Report — {ticket-or-branch}",
  "ticket": "{ticket}",
  "summary": "이번 리포트에서 검증할 성공 기준 요약",
  "items": [
    { "id": "V1", "title": "신규 버튼 노출", "type": "UI_CAPTURE", "status": "pending" },
    { "id": "V2", "title": "GA 이벤트 미발화", "type": "NETWORK", "status": "pending" }
  ]
}
```

각 항목 시작 시 `running`, 완료 시 `pass`/`fail`/`skip`/`unverified`로 갱신한다.

```json
{
  "action": "update",
  "runId": "{runId}",
  "item": {
    "id": "V1",
    "title": "신규 버튼 노출",
    "type": "UI_CAPTURE",
    "status": "pass",
    "detail": "Preview 환경에서 버튼 노출 확인",
    "evidence": [{ "label": "버튼 노출", "kind": "image", "path": ".context/work/{workspace}/captures/v1-button.png" }]
  }
}
```

- UI 캡처 증거: PNG/GIF를 남긴다.
- NETWORK 증거: 필터 조건, matched count, matched request 목록을 JSON/TXT로 남긴다.
- CONSOLE 증거: 콘솔 error/warn/log excerpt를 남긴다.
- CODE_DIFF 증거: 관련 파일/라인과 diff summary를 남긴다.

캡처/증거는 “무엇을 실행했는지”와 “결과가 무엇인지”를 재현 가능하게 남긴다. 예: `reload + scroll`, `targetEvents`, `matchedResourceCount`.

## Step 6: live preview 갱신 → 정적 HTML export → 유저 리뷰

모든 항목을 처리한 뒤 `verify_report_live action=finish`로 `.context/work/{workspace}/captures/report.html`을 export한다. live Glimpse 창은 최종 상태로 갱신되고, 이후에는 `/show-report`로 다시 열 수 있다.

```json
{
  "action": "finish",
  "runId": "{runId}",
  "finalSummary": "PASS/SKIP/미검증 및 주의사항 요약"
}
```

재오픈/수동 오픈:
- `/show-report .context/work/{workspace}/captures/report.html`
- `/show-report` 목록에서 선택
- `/show-report --browser .context/work/{workspace}/captures/report.html` 브라우저 fallback

액션 처리:
- 로컬 프리뷰 확인만 한 경우: confirm 모드 완료. 업로드하지 않는다.
- 사용자가 업로드를 명시한 경우: Step 7(upload)로 진행한다.
- 보완이 필요한 경우: 필요한 항목을 재검증하거나 update 모드로 보완한다.
- live/Glimpse 실행 실패: 정적 HTML export 후 시스템 브라우저 fallback을 안내하고 업로드하지 않는다.

**update 모드**: 기존 run이 있으면 같은 `runId`에 항목을 append/update한다. 없으면 새 `start` 후 기존 `report.html` 내용을 참고해 필요한 항목만 보완한다.

## Step 7: agent-storage 업로드 (upload 모드만)

[references/upload-scripts.md](references/upload-scripts.md)를 따른다.

기본 confirm 모드에서는 이 단계를 스킵한다. 사용자가 `/verify-report --upload`를 명시하거나 리포트 확인 후 업로드를 직접 요청한 경우에만 진행한다.

## Step 8: context.md + PR 본문 업데이트 (upload 모드만)

[references/report-templates.md](references/report-templates.md)를 따른다.

- `context.md ## Report`에는 검증 기준 커밋, 증거 링크, PASS/SKIP/미검증을 기록한다.
- PR 본문 `## 스크린샷 / 영상`에는 업로드된 HTML 리포트와 핵심 증거만 요약한다.
- confirm 모드에서는 PR/context를 수정하지 않는다.

## Step 9: 후속 단계

```json
{
  "questions": [{
    "question": "검증 리포트 생성 완료. 다음 단계를 선택해주세요.",
    "options": [
      "/create-pr — PR 생성 (upload된 리포트가 있으면 포함)",
      "/reflect — 학습 캡처",
      "/verify-report --upload — agent-storage 업로드",
      "/verify-report --update — 추가 검증 항목 처리",
      "일단 멈춤"
    ]
  }]
}
```

## 자주 마주치는 케이스

| 케이스 | 해결 |
|--------|------|
| 화면 변화가 있는 검증 | PNG/GIF 캡처를 우선 증거로 남긴다. |
| 화면 변화가 없는 검증 | UI 캡처로 억지 증명하지 말고 NETWORK/CONSOLE/CODE_DIFF 증거로 남긴다. |
| GA/픽셀 미발화 검증 | `targetEvents`, 필터 조건, matched count, matched requests를 JSON으로 저장한다. |
| 사용자가 “BE는 빼” | BE/CODE_DIFF 항목을 SKIP 표시하고 사유를 남긴다. |
| 사용자가 “추가로 X도 확인” | update 모드로 기존 리포트에 항목 append. |
| 사용자가 “업로드는 나중에” | confirm 모드로 종료하고 `/verify-report --upload` 안내. |
| Glimpse 창이 안 뜸/닫힘 | 업로드하지 않고 `/show-report --browser report.html` 또는 `open report.html` fallback 안내. |
