---
name: verify-report
description: PR/구현 검증을 위해 스크린샷/GIF 캡처와 네트워크 로그, 콘솔 출력, 코드 diff 같은 검증 근거를 HTML 리포트로 만든다. UI/이벤트/BE처럼 여러 검증 축이 있으면 case별 subagent가 계획된 캡처·로그 수집과 1차 검증을 병렬 수행하고 main이 최종 판정한다. 기본은 로컬 확인용이며 업로드/PR 업데이트는 명시 요청 시에만 한다.
argument-hint: "[base-url] [--upload] [--update] [--ask-before] [--no-workers]"
---

# Verify Report

구현이 요구사항을 만족한다는 **캡처/검증 증거**를 수집해 HTML 리포트로 만든다. 화면 변화는 PNG/GIF 캡처가 가장 확실한 검증 근거가 될 수 있으므로 우선 활용한다. 화면 변화가 없거나 이벤트/BE처럼 눈에 보이지 않는 동작은 네트워크 로그/콘솔 결과/코드 diff 같은 기계적 근거를 함께 남긴다.

## 원칙

- **Coverage 먼저, 캡처는 그 다음**: 리포트 시작 전에 변경 diff/요구사항으로 검증 축을 정의한다. 캡처가 있어도 해당 축을 닫지 못하면 PASS가 아니다.
- **캡처/증거 우선**: UI는 화면 캡처를 우선 증거로 삼고, 비가시 동작은 성공 기준을 어떤 로그/결과로 확인할지 먼저 정한다.
- **미검증 명시**: 자동화로 확인하지 못한 항목은 PASS로 쓰지 않고 `미검증`/`blocked`/`Coverage Gap`에 남긴다.
- **짧고 초점 있는 primary evidence**: 리포트 본문 핵심 증거는 viewport/섹션/element crop을 우선한다. 세로로 긴 full-page 캡처는 필요할 때만 보조 증거로 남기고 토글/appendix/link 뒤에 둔다. `role: "primary"`인 이미지/GIF는 renderer가 full-width로 보여주므로, 한 항목의 핵심 before/after 합성 이미지나 단일 핵심 crop에는 반드시 primary role을 붙인다.
- **텍스트 합성 캡처는 glyph 확인**: 메시지 본문·알림톡·TUI처럼 실제 텍스트를 이미지로 렌더링할 때는 대상 언어 glyph가 있는 폰트(예: 한글은 Apple SD Gothic Neo/AppleGothic/Noto Sans CJK)를 사용한다. `□`/tofu box가 보이면 인코딩 문제가 아니라 폰트 fallback 실패일 가능성이 높으므로 리포트 확정 전에 재렌더링한다.
- **Raw evidence에도 의도를 붙인다**: 모든 evidence에는 가능한 한 `purpose`, `inspectFor`, `expected`, `observed`, `role`, `relatedItem`을 붙여 “왜 수집했는지 / 무엇을 봐야 하는지”가 report와 `/archive`의 캡처/미디어 탭에서도 보이게 한다. Raw 파일의 의도는 별도 섹션으로 분리하지 말고 해당 raw 토글 내부 상단에 함께 보여 시선이 흩어지지 않게 한다.
- **Item detail은 읽히는 설명이어야 한다**: `detail`에는 긴 한 문단을 넣지 말고 조건/관찰/제약을 문장 단위나 줄바꿈 bullet로 나눈다. renderer는 긴 detail을 자동 bullet card로 정리하고 backtick inline code와 URL link를 강조하지만, agent도 “왜 직접 캡처하지 못했는지 / 무엇으로 대체 검증했는지 / 남은 gap은 무엇인지”가 눈에 들어오게 작성한다.
- **판정은 엄격하게, 레이아웃은 기본값으로**: PASS/미검증/coverage gap과 evidence metadata는 strict하게 지키되, 섹션 순서·카드 수·표현 방식은 케이스에 맞게 renderer default가 흡수한다. 에이전트는 양식 채우기보다 기준을 증거로 닫는 데 집중한다.
- **Renderer design default**: report UI는 generative-ui식 디자인 절제를 참고하되, 사용자에게 읽고 싶을 만큼 강한 verdict/coverage hierarchy를 제공한다. 검증 report는 심심한 문서가 아니라 판단 artifact이므로 상단 verdict, PASS/GAP 색상, 핵심 증거 카드의 리듬을 살린다. 새 dependency를 붙여 AI가 매번 HTML을 생성하게 하지 않고, deterministic renderer가 일관된 구조를 만든다.
- **Before/After 비교는 판단해서 포함**: 기존 UI/동작이 기준점으로 의미 있는 변경은 작업 전(before)과 작업 후(after)를 같은 축/viewport/role로 캡처하고, 차이를 설명한다. 신규 화면처럼 baseline이 없거나 부작용 위험이 큰 경우는 생략 사유를 남긴다.
- **업로드 opt-in**: 기본 `/verify-report`는 로컬 리포트 확인까지만 한다. project artifact storage 업로드와 PR 본문 갱신은 `--upload` 또는 사용자의 명시적 업로드 액션이 있을 때만 한다.
- **Case worker fan-out 기본**: main agent가 coverage 계획·환경·허용 액션을 정의하고, 여러 검증 축은 case worker subagent가 계획된 캡처/로그/명령 실행과 1차 검증을 병렬 수행한다. `--no-workers`가 있거나 단일·자명한 항목이면 main이 직접 실행한다.
- **Main final adjudicator**: subagent는 계획된 evidence를 만들고 의견을 반환할 뿐이다. 최종 `pass`/`fail`/`unverified` 판정, 계획 밖 추가 캡처/재캡처 승인, 사용자 질문, `verify_report_live` 업데이트는 main만 한다.
- **프리뷰 강제**: HTML 생성 후 Glimpse WebView로 먼저 보여주고, 사용자가 확인한 뒤 다음 행동을 정한다.

## 모드 (default: confirm-only)

| 모드 | 설명 | 트리거 |
|------|------|--------|
| **confirm** (default) | 로컬 캡처/검증 증거 수집 + HTML 프리뷰만. 업로드 X | 기본 |
| **upload** | confirm + project artifact storage 업로드 + PR 본문 갱신 | `--upload` 인자 또는 사용자가 명시 요청 |
| **update** | 기존 리포트에 신규 검증 항목 append | `--update` 인자 또는 “추가” 키워드 감지 |
| **ask-before** | 항목별 검증 실행 전 사전 확인 | `--ask-before` 인자 또는 사용자가 요구 |

Escape hatch:
- `--no-workers`: case worker subagent fan-out을 끄고 main agent가 모든 항목의 플로우 실행과 판정을 직접 수행한다. report live/update/finish 절차는 동일하다.

## 실행 단계 개요

| Step | 설명 | confirm | upload | update |
|------|------|:---:|:---:|:---:|
| 1 | 성공 기준 수집 + 캡처/증거 유형 분류 | ✓ | ✓ | ✓ (신규만) |
| 2 | 검증 환경 확인 | ✓ | ✓ | ✓ |
| 3 | 로그인/권한 Credential 확보 | ✓ | ✓ | ✓ |
| 4 | 검증 계획 수립 → 유저 확인 | ✓ | ✓ | ✓ |
| 4-B | (ask-before 모드만) 항목별 사전 확인 | opt | opt | opt |
| 5 | `verify_report_live` 시작 → case worker plan/brief 작성 → 필요 시 공유 증거 수집 | ✓ | ✓ | ✓ |
| 5-B | case worker subagent fan-out으로 계획된 캡처/로그/명령 실행 + 1차 검증 (`--no-workers`면 skip) | ✓ | ✓ | ✓ |
| 6 | main 결과 adjudication → live preview 갱신 → 정적 HTML export → 유저 리뷰 | ✓ | ✓ | ✓ (병합) |
| 7 | project artifact storage 업로드 |  | ✓ | ✓ |
| 8 | context.md + PR 본문 업데이트 |  | ✓ | ✓ |
| 9 | 후속 단계 AskUserQuestion | ✓ | ✓ | ✓ |

> 상세 참조:
> - [references/coverage-and-capture-quality.md](references/coverage-and-capture-quality.md) — 검증 축 도출, UI 변경 프리셋, 긴 이미지 처리 규칙
> - [references/capture-commands.md](references/capture-commands.md) — agent-browser 명령, crop helper, ffmpeg GIF 합성, 브라우저 증거 수집
> - [references/case-worker-fanout.md](references/case-worker-fanout.md) — case worker subagent planned capture/log collection, escalation, main adjudication
> - [references/upload-scripts.md](references/upload-scripts.md) — project artifact storage 업로드
> - [references/report-templates.md](references/report-templates.md) — HTML/context.md/PR 템플릿
> - [references/troubleshooting.md](references/troubleshooting.md) — agent-browser daemon 복구, 자주 깨지는 케이스

## Step 1: 성공 기준 수집 + 캡처/증거 유형 분류

소스 우선순위:
1. **PR test plan** — `gh pr view` body의 `## Test plan`
2. **Verify 체크리스트** — `.context/work/{workspace}/context.md`의 `## Verifications`
3. **자체 도출** — Frame 성공 기준 + 구현 코드 분석

수집 직후 각 항목을 **검증 축(coverage axis)** 으로 쪼개고, 축마다 **화면 캡처로 검증할지, 다른 증거로 검증할지** 분류한다.

필수 coverage 도출 규칙:

| 변경 감지 | 기본 검증 축 |
|----------|--------------|
| responsive class/layout 변경 | mobile(예: 390px) + breakpoint boundary(예: 480/500/640px) + desktop(예: 1320~1440px) |
| nav/sidebar/menu 변경 | expanded + collapsed + 영향받는 role/account |
| typography/logo/token 변경 | screenshot + DOM class/token + computed `font-size`/`line-height` |
| table/card/overflow 변경 | empty state + data state + overflow/scroll state |
| option/default selection 변경 | no data + data exists + stale/refresh selection 유지 |
| 기존 UI/동작을 바꾸는 수정 | 같은 route/action/viewport/role의 before + after 비교 |

> 더 자세한 프리셋은 [references/coverage-and-capture-quality.md](references/coverage-and-capture-quality.md)를 따른다.

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

| # | 성공 기준 / 검증 축 | 캡처/증거 유형 | 환경 메타데이터 | 이유 |
|---|----------------------|----------------|------------------|------|
| V1 | dev 스팟상세에서 GA 이벤트 미발화 | NETWORK | dev / reload+scroll / anonymous | 화면 변화 없음, 네트워크 요청 여부가 핵심 증거 |
| V2 | 신규 버튼 노출 — mobile 390px | UI_CAPTURE | before=base / after=local / 390×844 / member | 화면에 보이는 상태는 before/after 비교가 가장 명확 |
| V3 | 신규 버튼 노출 — desktop 1440px | UI_CAPTURE | before=base / after=local / 1440×900 / member | responsive 회귀를 막기 위한 별도 축 |
| V4 | 권한 없는 mutation 차단 | BE | preview / unauthorized role | API 응답/권한 로직 검증 |
```

## Step 2: 검증 환경 확인

```bash
which agent-browser  # 미설치 시: npm install -g agent-browser && agent-browser install
which ffmpeg          # GIF 항목이 있을 때만. 미설치 시: brew install ffmpeg
```

대상 URL: `$ARGUMENTS` > Preview URL (PR 감지) > dev/staging URL > 로컬 서버 순으로 자동 감지 후 AskUserQuestion으로 확인한다. 환경 차이가 검증 결과에 영향을 주는 경우(`NODE_ENV` vs 배포 환경 등)는 리포트에 명시한다.

프로젝트별 preview URL, 계정 alias, 업로드 대상 저장소 규칙이 있으면 private/project overlay skill을 추가로 로드한다.

Before/After가 필요한 항목은 before 기준도 함께 정한다.

- 우선순위: 사용자 제공 before URL/capture > PR base preview/develop/production > base branch local 실행 > 기존 report/archive capture
- before와 after는 가능한 한 같은 route, query, data fixture, viewport, role, action으로 맞춘다.
- before 재현이 과도하게 비싸거나 데이터/결제/외부 side effect 위험이 있으면 캡처하지 말고 `before 생략 사유`를 Coverage Gap 또는 detail에 남긴다.

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

각 항목에는 리포트에서 확인 가능한 메타데이터를 포함한다.

- URL / 환경: local, PR Preview, dev, production 등
- viewport: `390×844`, `1440×900` 등
- account/role: admin, partner, anonymous 등
- commit/branch 또는 PR 번호
- 실행 액션: reload, click, scroll, filter 조건 등

**파일 경로**: `.context/work/{workspace}/captures/` 안에 저장한다.

> ⚠️ `/tmp/`는 사용 금지 — 휘발되고 `/archive`/Glimpse 프리뷰 탐색 대상이 아니다.

파일명: kebab-case `{항목번호}-{설명}.{png|gif|json|txt}`

UI 캡처 계획은 primary/supporting과 before/after 여부를 분리한다.

| 역할 | 권장 형태 | 리포트 표시 |
|------|-----------|-------------|
| primary before | 변경 전 기준 상태의 viewport/section/element crop | after와 같은 항목에 나란히 표시 |
| primary after | 변경 후 검증 상태의 viewport/section/element crop | before와 같은 항목에 나란히 표시 |
| primary combined | before/after를 한 이미지 안에 합성한 핵심 비교 crop | `role: "primary"`로 full-width 단일 카드 표시 |
| supporting context | full-page, 긴 스크롤 캡처, raw debug screenshot | 토글/details/appendix/link 뒤에 표시 |

Before/After는 다음 조건이면 포함한다.

- 기존 UI/동작의 개선·회귀 방지가 핵심인 변경
- 사용자가 “기존 대비”, “전/후”, “깨짐/복구”, “regression”을 언급한 변경
- responsive/nav/typography처럼 전 상태와 비교할 때 의도가 더 분명해지는 변경

다음 조건이면 생략 가능하지만 사유를 남긴다.

- 완전히 신규 화면/기능이라 의미 있는 before가 없음
- before 환경을 띄우는 비용이 검증 가치보다 큼
- 결제/알림/외부 API처럼 before 재현이 side effect를 만들 수 있음
- 동일 데이터/권한 상태를 맞출 수 없어 비교가 오히려 오해를 부름

세로 1600px 이상 또는 viewport 높이의 2배 이상인 이미지는 primary evidence로 쓰지 말고 crop을 추가한다. `verify_report_live` HTML은 긴 이미지를 자동으로 접힌 토글에 넣지만, 검증 품질상 primary crop을 별도로 남겨야 한다.

AskUserQuestion으로 계획 확인.

## Step 4-B: (옵션) 사전 항목별 확인

`--ask-before` 모드 또는 사용자가 “사전 확인하자” 요청한 경우, 각 항목 시작 전마다 확인한다.

```markdown
[V1] dev 스팟상세 GA 이벤트 미발화 — NETWORK + PNG
URL: https://example.local/path
액션: reload → 7초 대기 → scroll → performance resource에서 이벤트명 필터

진행할까요?
```

옵션: 진행 / 건너뛰기 / 다른 액션으로

## Step 5: `verify_report_live` 시작 → case worker plan/brief 작성

[references/capture-commands.md](references/capture-commands.md)와 [references/case-worker-fanout.md](references/case-worker-fanout.md)를 따른다.

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

각 항목은 main 또는 worker가 실행을 시작할 때 `running`으로 갱신한다. main이 명백히 판단할 수 있는 `skip`/`blocked`/`fail`은 바로 기록할 수 있지만, 여러 축 검증의 `pass`는 Step 5-B case worker 결과를 main이 adjudication하거나 `--no-workers` 직접 실행 후 Step 6에서 확정한다.

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
    "evidence": [{
      "label": "After — mobile 390px",
      "kind": "image",
      "path": ".context/work/{workspace}/captures/v1-button.png",
      "role": "primary",
      "relatedItem": "V1",
      "purpose": "모바일에서 신규 버튼이 fold 위에 노출되는지 확인",
      "inspectFor": ["버튼 위치", "기존 sticky CTA와 겹침 없음"],
      "expected": "버튼이 보이고 CTA와 겹치지 않는다",
      "observed": "버튼이 title 아래에 보이며 overlap 없음"
    }]
  }
}
```

- UI 캡처 증거: primary crop PNG/GIF를 먼저 남기고, full-page는 필요 시 supporting으로 남긴다.
- Before/After 증거: label을 `Before — ...`, `After — ...`로 시작하고, detail에 “무엇이 달라져야 하는지 / 달라지면 안 되는지”를 설명한다.
- Raw evidence intent: `purpose`에는 수집 이유, `inspectFor`에는 리뷰어가 봐야 할 포인트, `expected`에는 닫아야 할 기준, `observed`에는 실제 관찰, `role`에는 primary/supporting/raw, `relatedItem`에는 V1 같은 검증 항목 id를 넣는다. `verify_report_live finish`는 이 metadata를 `captures/evidence-intent.json` sidecar로 남겨 `/archive` raw media preview에서도 재사용한다. 정적 report에서는 JSON/TXT/network/console/diff 같은 raw evidence를 각 검증 item 안의 기본 접힘 토글로 렌더하고, 토글 내부 상단에 intent block을 먼저 보여준 뒤 raw 원문을 둔다. Raw evidence card는 가로 grid에 끼워 반쪽 너비가 되지 않게 full-width 세로 배치한다.
- NETWORK 증거: 필터 조건, matched count, matched request 목록을 JSON/TXT로 남긴다.
- CONSOLE 증거: 콘솔 error/warn/log excerpt를 남긴다.
- CODE_DIFF 증거: 관련 파일/라인과 diff summary를 남긴다.

PASS 처리 조건:
- 성공 기준의 모든 필수 coverage axis가 증거로 닫혔을 때만 `pass`.
- before/after가 필요한 항목은 after만 캡처하고 PASS로 닫지 않는다. before 생략이 정당하면 detail에 사유를 명시한다.
- 캡처가 있어도 축이 빠졌으면 `unverified` 또는 별도 Coverage Gap 항목으로 남긴다.
- 자동화/권한/외부 환경 때문에 못 본 항목은 `blocked`로 남기고 차단 사유를 적는다.

캡처/증거는 “무엇을 실행했는지”와 “결과가 무엇인지”를 재현 가능하게 남긴다. 예: `reload + scroll`, `targetEvents`, `matchedResourceCount`.

Fan-out을 사용할 경우, 실행 전에 `.context/work/{workspace}/captures/verify-workers/`에 최소 세 가지를 작성한다.

- `plan.json`: 검증 항목, 필수 coverage axis, 기대 결과, 환경(URL/viewport/role), worker별 허용 액션, output path
- `evidence-index.md`: main이 이미 가진 공유 증거와 worker가 만들어야 할 planned evidence 목차. 각 evidence마다 왜/봐야 할 것/기대/관찰/역할/관련 기준을 적는다.
- `briefs/{itemId}.md`: subagent가 읽을 case별 작업 지시. 허용/금지 액션과 result JSON path를 명시

큰 이미지/영상은 복사하지 말고 기존 `.context/work/{workspace}/captures/` 경로를 참조한다. Worker가 새로 만드는 evidence도 이 capture root 아래에 저장하게 한다.

## Step 5-B: case worker fan-out (기본, `--no-workers`면 skip)

[references/case-worker-fanout.md](references/case-worker-fanout.md)를 따른다.

기본적으로 main은 case별 worker subagent를 병렬 실행해 planned capture/log/test/API-read와 1차 검증을 맡긴다. 단, 다음 경우에는 fan-out을 생략하고 main이 직접 실행·판정한다.

- 사용자가 `--no-workers`를 지정함
- 검증 항목이 1개이고 실행 플로우가 짧고 자명함
- subagent 도구가 현재 환경에서 사용할 수 없음
- 계정/session/evidence를 별도 subagent session으로 넘기면 안 됨
- 결제/알림/외부 write처럼 worker가 실수하면 side effect가 생기는 플로우

Subagent 규칙:

- brief에 적힌 URL/viewport/role/action/output path 안에서 planned evidence를 직접 만든다.
- 계획 밖 새 캡처/재캡처, 다른 계정/다른 route/다른 viewport 추가, DB/API write, `verify_report_live` update는 하지 않는다.
- 사용자에게 직접 질문하지 않는다. 계획된 evidence가 부족하거나 새 캡처가 필요하다고 판단하면 `UNVERIFIED`와 `main_action_required`를 반환한다.
- 출력은 result JSON 파일과 함께 `PASS` / `FAIL` / `UNVERIFIED`, 생성/사용한 evidence path 목록이어야 한다.

메인 규칙:

- subagent 결과를 그대로 믿지 않는다. result JSON과 evidence path가 존재하고 criteria를 실제로 닫는지 확인한 뒤 최종 판정한다.
- `UNVERIFIED`는 main으로 escalation된 작업이다. main이 추가 증거 수집, brief 수정 후 재위임, 기준 재해석, 사용자 질문, Coverage Gap 기록 중 하나로 처리한다.
- 추가 증거가 필요하면 main이 직접 처리하거나, 계획을 명시적으로 갱신한 뒤 해당 case만 다시 worker에 맡긴다.

Subagent launch가 필요한 경우, 현재 Pi subagent 규칙에 따라 먼저 `subagent help`를 확인하고, `subagent batch` launch 후에는 status/detail polling을 하지 말고 완료 follow-up을 기다린다.

## Step 6: main 결과 adjudication → live preview 갱신 → 정적 HTML export → 유저 리뷰

모든 case worker 결과를 main이 adjudication한 뒤 `verify_report_live action=update`로 각 항목의 최종 상태와 evidence를 반영하고, 마지막에 `verify_report_live action=finish`로 `.context/work/{workspace}/captures/report.html`을 export한다. live Glimpse 창은 최종 상태로 갱신되고, 이후에는 `/archive`로 다시 열 수 있다.

finish 전에 결과를 세 그룹으로 분리한다.

```markdown
Verified
- 증거로 닫힌 항목

Coverage gaps / Unverified
- 필요한 축이 빠진 항목
- 캡처는 있지만 검증 기준을 닫지 못한 항목
- case worker가 `UNVERIFIED`로 올렸고 main이 추가 증거/질문/보완 없이 닫지 못한 항목

Blocked / Known unrelated failures
- 권한/외부 환경/기존 실패로 막힌 항목
```

```json
{
  "action": "finish",
  "runId": "{runId}",
  "finalSummary": "PASS/SKIP/미검증 및 주의사항 요약"
}
```

재오픈/수동 오픈:
- `/archive .context/work/{workspace}/captures/report.html`
- `/archive` 목록에서 선택
- `/archive --browser .context/work/{workspace}/captures/report.html` 브라우저 fallback

액션 처리:
- 로컬 프리뷰 확인만 한 경우: confirm 모드 완료. 업로드하지 않는다.
- 사용자가 업로드를 명시한 경우: Step 7(upload)로 진행한다.
- 보완이 필요한 경우: 필요한 항목을 재검증하거나 update 모드로 보완한다.
- live/Glimpse 실행 실패: 정적 HTML export 후 시스템 브라우저 fallback을 안내하고 업로드하지 않는다.

**update 모드**: 기존 run이 있으면 같은 `runId`에 항목을 append/update한다. 없으면 새 `start` 후 기존 `report.html` 내용을 참고해 필요한 항목만 보완한다.

## Step 7: project artifact storage 업로드 (upload 모드만)

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
      "/verify-report --upload — project artifact storage 업로드",
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
| responsive/layout 변경 | mobile + breakpoint boundary + desktop 축을 모두 계획하고, 누락 시 Coverage Gap으로 남긴다. |
| 기존 대비 변경이 중요한 UI | before + after를 같은 viewport/role/action으로 캡처하고 차이를 설명한다. |
| 긴 full-page 캡처 | primary evidence로 쓰지 않는다. crop/section 이미지를 본문에 두고 full-page는 토글/appendix/link로 둔다. |
| 화면 변화가 없는 검증 | UI 캡처로 억지 증명하지 말고 NETWORK/CONSOLE/CODE_DIFF 증거로 남긴다. |
| GA/픽셀 미발화 검증 | `targetEvents`, 필터 조건, matched count, matched requests를 JSON으로 저장한다. |
| 사용자가 “BE는 빼” | BE/CODE_DIFF 항목을 SKIP 표시하고 사유를 남긴다. |
| 사용자가 “추가로 X도 확인” | update 모드로 기존 리포트에 항목 append. |
| subagent가 `UNVERIFIED` 반환 | main이 추가 evidence 수집/brief 수정 후 재위임/사용자 질문/Coverage Gap 중 하나로 처리한다. subagent가 계획 밖 새 캡처·질문을 하지 않는다. |
| 사용자가 “업로드는 나중에” | confirm 모드로 종료하고 `/verify-report --upload` 안내. |
| Glimpse 창이 안 뜸/닫힘 | 업로드하지 않고 `/archive --browser report.html` 또는 `open report.html` fallback 안내. |
