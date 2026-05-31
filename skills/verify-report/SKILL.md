---
name: verify-report
description: PR/구현 검증을 PM·비개발자도 이해할 수 있는 캡처 중심 HTML 리포트로 만든다. Jira/Notion/Slack/와이어프레임/PR test plan 같은 기획 근거를 사용자-facing 동작과 매핑하고, 핵심 UI 흐름은 스크린샷/GIF를 primary evidence로 증명한다. 로직/API/DB/code diff 검증은 하단 기술 보조 검증으로 정리한다. 기본은 로컬 확인용이며 업로드/PR 업데이트는 명시 요청 시에만 한다.
argument-hint: "[base-url] [--upload] [--update] [--ask-before] [--no-workers]"
---

# Verify Report

구현이 기획 의도대로 동작한다는 사실을 **PM·비개발자도 캡처/GIF만 보고 이해할 수 있게** HTML 리포트로 만든다. 리포트의 중심은 개발 과정 로그가 아니라 “기획 근거 → 사용자-facing 성공 기준 → 실제 화면 증거”의 매핑이다. 화면 변화는 PNG/GIF 캡처를 primary evidence로 삼고, 로직/API/DB/code diff 검증은 하단 기술 보조 검증으로 분리한다.

## 원칙

- **PM-facing이 기본값**: 리포트는 개발자 디버깅 로그가 아니라 PM·기획자·디자이너가 구현 핵심과 동작을 빠르게 이해하는 공유 문서다. 내부 셋업/삽질보다 사용자-facing 결과를 먼저 보여준다.
- **기획 근거와 구현 동작을 매핑**: Jira, Notion, Slack, 와이어프레임, PR test plan, frame 성공 기준이 있으면 각 요구를 실제 화면 동작/상태와 연결한다. 출처가 없는 코드 리스크는 별도 기술 보조 검증으로 내린다.
- **Frame은 requirement source, report는 evidence adjudicator**: TFT Frame의 Requirement Matrix/Domain Work Map/verify focus는 중요한 입력 source지만 최종 판정표를 그대로 복사하는 SSOT가 아니다. `/verify-report`는 Frame 항목을 `reuse`/`revise`/`add`/`drop`/`blocked`로 재판정하고, 최신 사용자 지시·구현 diff·데이터/권한 현실성·캡처 가능성으로 evidence 계약을 확정한다.
- **과거 교정은 intent로 재해석**: 이전 실패 회고나 사용자 교정은 중요한 제약이지만, 기능의 primary action을 덮어쓰는 literal 요구가 아니다. 먼저 교정이 막으려던 실패(intent)를 추출하고, 현재 데이터/권한/side effect상 literal 실행이 비현실적이면 같은 intent를 보존하는 현실적인 equivalent path를 제안하거나 선택한다. blocked는 교정 intent까지 보존할 대체 경로가 없을 때만 쓴다.
- **캡처 중심 리포트**: UI 기능의 primary evidence는 focused screenshot/GIF다. code diff, API 응답, DB 조회, unit test는 PM-facing 화면 증거를 보조하거나 비가시 정책을 설명하는 하단 근거로 둔다.
- **Coverage 먼저, 캡처는 그 다음**: 리포트 시작 전에 요구사항으로 검증 축을 정의한다. 캡처가 있어도 해당 축을 닫지 못하면 PASS가 아니다.
- **Motion-first evidence**: 이동/전환/클릭/열림/닫힘/스무스함/끊김 없음처럼 시간 흐름이 claim이면 정적 PNG만으로 PASS 처리하지 않는다. GIF/짧은 영상이 primary evidence이고, 대표 final-state PNG/crop은 supporting evidence로 함께 둔다. GIF는 판독 가능한 품질이어야 하며, 기본 생성 경로는 `skills/verify-report/scripts/make-motion-gif.mjs` helper다. helper 기본값은 원본 해상도 유지(`--width source`), 12fps, 8초 trim, `palettegen/paletteuse` + `sierra2_4a` dithering이다. 저용량을 이유로 390px/8fps/no-palette처럼 텍스트와 색상이 깨지는 설정을 primary evidence에 쓰지 않는다.
- **Setup noise 격리**: 로그인, 빌드, Metro/dev-server, pod/env/codegen, dependency bootstrap처럼 검증 전 준비 과정은 리포트의 PASS item에 넣지 않는다. setup 자체가 검증 대상이거나, 검증을 막은 blocked/coverage gap일 때만 짧게 남긴다.
- **미검증 명시**: 자동화로 확인하지 못한 항목은 PASS로 쓰지 않고 `미검증`/`blocked`/`Coverage Gap`에 남긴다.
- **렌더링 claim은 실제 렌더로 닫는다**: 구조도, TUI, WebView, Markdown/HTML preview, SVG/이미지 생성처럼 “보인다”가 성공 기준인 작업은 source text, Mermaid codeblock, raw inline SVG, HTML 파일 생성만으로 PASS가 아니다. 실제 artifact를 열어 렌더링된 결과를 확인하고, 가능하면 캡처를 evidence로 남긴다.
- **짧고 초점 있는 primary evidence**: 리포트 본문 핵심 증거는 검증 claim을 직접 닫는 artifact여야 한다. 정적 UI는 viewport/섹션/element crop, flow UI는 GIF/짧은 영상이 primary다. 세로로 긴 full-page 캡처는 필요할 때만 보조 증거로 남기고 토글/appendix/link 뒤에 둔다. `role: "primary"`인 이미지/GIF는 renderer가 full-width로 보여주므로, 한 항목의 핵심 before/after 합성 이미지나 단일 핵심 crop에는 반드시 primary role을 붙인다.
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

## Preflight 선택

검증 축은 필요하지만 데이터/계정/preview/before 기준이 불명확하거나, 작은 hotfix에 full report가 과할 수 있으면 먼저 `/verify-report-preflight`를 사용한다.

- `light`: focused screenshot/log/test 1~2개 또는 `/verify-report --no-workers`로 닫는다.
- `standard/full`: coverage plan을 확정한 뒤 이 스킬의 live report 흐름으로 들어간다.
- `blocked`: 캡처를 시작하지 말고 필요한 URL/role/data/side-effect 승인만 사용자에게 요청한다.

Preflight는 PASS 증거가 아니며, 최종 판정은 여전히 이 스킬의 evidence/coverage gate 또는 `/verify` 결과로 닫는다.

## 모드 (default: confirm-only)

| 모드 | 설명 | 트리거 |
|------|------|--------|
| **confirm** (default) | 로컬 캡처/검증 증거 수집 + HTML 프리뷰만. 업로드 X | 기본 |
| **upload** | confirm + project artifact storage 업로드 + PR 본문 갱신 | `--upload` 인자 또는 사용자가 명시 요청 |
| **update** | 기존 리포트에 신규 검증 항목 append/update/replace | `--update` 인자 또는 “추가/교체/기존 리포트에 반영” 키워드 감지 |
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

## Step 1: 기획 근거 수집 + 성공 기준 매핑 + 캡처/증거 유형 분류

소스 우선순위:
1. **사용자가 이번 검증에서 직접 지정한 기준** — “이 화면을 보여줘”, “기획대로 동작하는지 증명해줘” 같은 최신 지시
2. **기획 근거** — Jira, Notion, Slack, 와이어프레임, 디자인 시안, 요구사항 문서
3. **PR test plan** — `gh pr view` body의 `## Test plan`
4. **Verify 체크리스트** — `.context/work/{workspace}/context.md`의 `## Verifications`
5. **Frame 성공 기준** — `.pi/frame.json` 또는 frame transcript의 success criteria
6. **구현 코드 분석** — 기획 근거가 비어 있는 리스크를 보완하는 보조 입력
7. **정책축 스캔 / 백엔드 레이어 맵** — 비가시 정책·레이어 책임은 하단 기술 보조 검증 후보로 승격

Frame/TFT plan이 있으면 먼저 **Frame handoff adjudication** 을 작성한다. Frame 항목을 그대로 복사하거나 무시하지 말고, 각 requirement/verify item에 아래 판정을 붙인다.

| 판정 | 의미 | 처리 |
|------|------|------|
| `reuse` | Frame 항목의 claim/subject/evidence가 현재 검증에도 그대로 맞음 | Requirement ID를 유지해 V/T item으로 승격 |
| `revise` | intent는 맞지만 subject/action/evidence가 현재 현실과 다름 | Requirement ID와 변경 사유를 남기고 equivalent path로 수정 |
| `add` | 최신 사용자 지시, 구현 diff, 데이터/권한 확인에서 새 축 발견 | 새 V/T item으로 추가하고 출처를 명시 |
| `drop` | 현재 scope 밖, 중복, 더 이상 유효하지 않음 | report에서 제외하되 이유를 남김 |
| `blocked` | 대체 경로도 없어 검증 불가 | Coverage Gap/blocked item으로 남김 |

수집 직후 먼저 **핵심 사용자 행동(primary action)** 을 고정한다. 이 기능이 `create`, `update`, `read/display`, `delete`, `permission denial`, `event emission` 중 무엇으로 성공하는지 분리한다. 과거 교정이 있으면 문장을 literal과 intent로 나눈다. 예를 들어 “같은 기존 항목으로 비교”가 권한 정책상 불가능한데 기능의 핵심이 “새 항목 생성 시 선택값 저장/표시”라면, literal 기존 항목 수정에 매이지 말고 “user-facing에 노출되는 생성 가능한 subject로 새 항목을 만들어 선택값별 표시를 확인”하는 equivalent path로 재구성한다.

수집 직후 각 요구를 **PM-facing 검증 계약**으로 바꾼다.

| 필드 | 의미 |
|------|------|
| 근거 출처 | Jira/Notion/Slack/와이어프레임/PR test plan/frame/사용자 지시 |
| Frame handoff 판정 | Frame 항목이면 reuse/revise/add/drop/blocked 중 무엇인지와 이유 |
| PM-readable claim | 비개발자가 이해할 수 있는 성공 문장 |
| 핵심 사용자 행동 | create/update/read-display/permission/event 중 기능을 실제로 닫는 primary verb |
| 사용자/관리자 시나리오 | 어떤 role이 어떤 화면에서 무엇을 조작하는지 |
| 대상 subject | 같은 row/id/order/review/user 등 상태 전환을 증명할 기준 subject |
| 화면 oracle | 무엇이 보이면 기획대로 구현된 것인지 |
| primary visual evidence | screenshot/GIF/crop 중 무엇으로 보여줄지 |
| 하단 기술 보조 검증 | API/DB/code/test가 필요한 경우만 기록 |
| 제외할 noise | 로그인 실패, bootstrap, selector 삽질 등 report에서 숨길 준비 과정 |

과거 교정/실패 회고가 현재 기능의 primary action과 충돌하면, 아래 순서로 처리한다.

1. 교정 literal과 intent를 분리한다. (`기존 row만 써라` vs `서로 다른 조건의 데이터를 섞지 마라`)
2. literal 실행 가능성을 확인한다. 권한 정책, user-facing 노출 여부, side effect 위험을 본다.
3. literal이 비현실적이면 core feature path에서 intent를 보존하는 equivalent subject/action을 찾는다.
4. equivalent path가 있으면 그 경로를 검증 계약에 명시하고 진행한다. 없을 때만 blocked/unverified로 내린다.

그 다음 각 항목을 **검증 축(coverage axis)** 으로 쪼개고, 축마다 **화면 캡처로 검증할지, 하단 보조 근거로 검증할지** 분류한다.

필수 coverage 도출 규칙:

| 변경 감지 | 기본 검증 축 |
|----------|--------------|
| responsive class/layout 변경 | mobile(예: 390px) + breakpoint boundary(예: 480/500/640px) + desktop(예: 1320~1440px) |
| nav/sidebar/menu 변경 | expanded + collapsed + 영향받는 role/account |
| typography/logo/token 변경 | screenshot + DOM class/token + computed `font-size`/`line-height` |
| table/card/overflow 변경 | empty state + data state + overflow/scroll state |
| option/default selection 변경 | no data + data exists + stale/refresh selection 유지 |
| create/update/read 등 primary action이 있는 기능 | primary action happy path + downstream user-facing 표시/저장 확인 + 필요한 regression path |
| 기존 UI/동작을 바꾸는 수정 | 같은 route/action/viewport/role의 before + after 비교 |
| 정책축 스캔이 있는 작업 | channel_matrix의 각 채널 + time_basis/default_fallback/application_cardinality/data_migration/api_cache_identity 축 |
| 백엔드 레이어 맵이 있는 작업 | entry_point/application_flow/domain_rule/data_access/cache_batching/persistence/consumer 책임 축 |
| rendered artifact / diagram / Studio UI 변경 | UI_CAPTURE 또는 artifact preview capture. source text/HTML 생성만으로 PASS 금지 |

> 더 자세한 프리셋은 [references/coverage-and-capture-quality.md](references/coverage-and-capture-quality.md)를 따른다.

| 분류 | 설명 | 리포트 증거 |
|------|------|-------------|
| **UI_CAPTURE** | 화면에 보이는 상태/플로우 | PNG/GIF + 짧은 설명 |
| **NETWORK** | GA/픽셀/API 요청 발화/미발화 | request/response 로그, matched count, 필터 조건 |
| **CONSOLE** | 콘솔 출력/런타임 상태 | console log/error 캡처 |
| **CODE_DIFF** | 코드 구조 자체가 근거 | 하단 기술 보조 검증의 관련 diff/파일/라인 요약 |
| **BE** | API/권한/DB만 영향 | 하단 기술 보조 검증의 API 응답, SQL 결과, 로그 또는 CODE_DIFF |
| **SKIP** | 이번 리포트에서 제외 | 제외 사유 |

정책축 스캔이 있는 작업은 “보이는 화면”만 캡처하지 말고, 각 채널이 올바른 기준 시간을 쓰는지와 DEFAULT/다중 적용 규칙이 실제 결과에 반영되는지를 항목으로 분리한다. 화면 증거가 없는 축은 BE/API/SQL/log/code diff 증거로 닫고, 닫지 못하면 Coverage Gap으로 남긴다.

백엔드 레이어 맵이 있는 작업은 사용자-facing 결과뿐 아니라 “책임이 올바른 레이어에 있는가”도 CODE_DIFF/BE 증거로 닫는다. 예를 들어 resolver는 연결만 하는지, repo는 조회 조건만 소유하는지, VO는 계산/불변식을 소유하는지, loader key에 기준 값이 들어가는지를 항목화한다.

분류 결과를 사용자에게 보여주고 확인한다. 이 계획은 개발자용 테스트 목록이 아니라 PM-facing 리포트의 목차여야 한다.

```markdown
다음 기획 근거 → 구현 동작 → 캡처 증거 매핑으로 리포트를 만들겠습니다. 수정할 게 있나요?

| # | Frame handoff | 근거 출처 | PM-readable 성공 기준 | 시나리오/subject | primary evidence | 하단 보조 검증 |
|---|---------------|-----------|-------------------------|------------------|------------------|----------------|
| V1 | reuse R1 | Jira COM-123 | 관리자가 새 옵션을 켜면 사용자 화면에 새 CTA가 보인다 | admin 설정 → user detail / item=123 | before/after focused crop | API 응답 JSON |
| V2 | 와이어프레임 | 모바일에서 카드가 한 줄로 겹치지 않는다 | anonymous / 390×844 | mobile crop | 없음 |
| V3 | PR test plan | 클릭 플로우가 끊기지 않고 상세로 이동한다 | member / click CTA | GIF primary + final PNG | console error 0 |
| T1 | 코드 리스크 | 권한 없는 mutation은 차단된다 | unauthorized role | 없음 | API 403 response |
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
| UI 단일 상태 | focused PNG/crop 1장 |
| UI 다단계 플로우 / 스무스함 / 이동 | 고화질 GIF 또는 짧은 영상 primary + 대표 final-state PNG/crop supporting. 기본 GIF 생성은 `make-motion-gif.mjs` helper를 사용하고, 원본 해상도 유지 + 12fps + palette 최적화를 기본값으로 한다. |
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
- flow/motion claim은 GIF/짧은 영상 primary evidence가 있어야 `pass`로 닫는다. 대표 final-state PNG/crop은 supporting으로 함께 둔다.
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

finish 전에 결과를 네 그룹으로 분리한다. 상단은 PM-facing 캡처 검증이고, 로직/API/DB/code diff는 하단 기술 보조 검증으로 내린다. `verify_report_live finish`는 report lint도 실행해 motion claim의 GIF 누락, GIF+PNG pairing 누락, setup noise PASS item, primary tall image, evidence metadata 누락을 Report Lint 섹션과 tool details에 경고로 남긴다. 경고는 PASS를 자동으로 뒤집지는 않지만, motion claim의 GIF 누락처럼 PM-facing 이해를 깨는 항목은 Coverage Gap 후보로 보고 보완하거나 unverified 처리한다.

```markdown
Verified — PM-facing behavior
- 기획 근거와 매핑된 사용자-facing 동작이 캡처/GIF로 닫힌 항목

Coverage gaps / Unverified
- 필요한 축이 빠진 항목
- 캡처는 있지만 검증 기준을 닫지 못한 항목
- case worker가 `UNVERIFIED`로 올렸고 main이 추가 증거/질문/보완 없이 닫지 못한 항목

Technical support checks
- API/DB/code diff/unit test처럼 화면 증거를 보조하는 하단 근거
- 비가시 정책 자체가 요구사항인 경우의 BE/NETWORK/CODE_DIFF 근거

Blocked / Known unrelated failures
- 권한/외부 환경/기존 실패로 막힌 항목
- setup noise는 검증을 실제로 막은 경우에만 여기에 짧게 기록
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
| 기획 근거가 있는 UI 검증 | 근거 출처 → PM-readable 성공 기준 → 실제 화면 캡처/GIF를 같은 item에 매핑한다. |
| 화면 변화가 있는 검증 | PNG/GIF 캡처를 primary evidence로 남긴다. code/test/DB는 하단 보조 근거다. |
| 이동/전환/클릭/열림/닫힘/스무스함 검증 | GIF/짧은 영상을 primary로 두고, 대표 PNG/crop을 supporting으로 함께 둔다. 최종 PNG만으로 PASS 처리하지 않는다. |
| responsive/layout 변경 | mobile + breakpoint boundary + desktop 축을 모두 계획하고, 누락 시 Coverage Gap으로 남긴다. |
| 기존 대비 변경이 중요한 UI | before + after를 같은 viewport/role/action으로 캡처하고 차이를 설명한다. |
| 긴 full-page 캡처 | primary evidence로 쓰지 않는다. crop/section 이미지를 본문에 두고 full-page는 토글/appendix/link로 둔다. |
| 화면 변화가 없는 검증 | UI 캡처로 억지 증명하지 말고 NETWORK/CONSOLE/CODE_DIFF 증거로 남기되, PM-facing 섹션이 아니라 하단 기술 보조 검증으로 둔다. |
| GA/픽셀 미발화 검증 | `targetEvents`, 필터 조건, matched count, matched requests를 JSON으로 저장한다. |
| 사용자가 “BE는 빼” | BE/CODE_DIFF 항목을 SKIP 표시하고 사유를 남긴다. |
| 사용자가 “추가로 X도 확인” | update 모드로 기존 리포트에 항목 append. |
| 사용자가 “그 리포트에 교체/업데이트” | 새 리포트를 만들지 말고 기존 `captures/report.html`의 같은 item을 update/replace한다. archive copy는 자동으로 생겨도 workspace report는 같은 검증 artifact로 유지한다. |
| 로그인/빌드/env/부트스트랩 삽질이 있었음 | 핵심 검증 target이 아니면 report item에서 제외한다. 필요한 경우 내부 setup note나 blocked 사유에만 짧게 남긴다. |
| subagent가 `UNVERIFIED` 반환 | main이 추가 evidence 수집/brief 수정 후 재위임/사용자 질문/Coverage Gap 중 하나로 처리한다. subagent가 계획 밖 새 캡처·질문을 하지 않는다. |
| 사용자가 “업로드는 나중에” | confirm 모드로 종료하고 `/verify-report --upload` 안내. |
| Glimpse 창이 안 뜸/닫힘 | 업로드하지 않고 `/archive --browser report.html` 또는 `open report.html` fallback 안내. |
