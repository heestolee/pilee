# Verify Report — Coverage & Capture Quality

리포트의 목표는 “증거를 모았다”가 아니라 “PM·비개발자가 기획 의도대로 구현됐는지 화면으로 이해한다”이다. 캡처 파일이 있어도 기획 근거와 사용자-facing 성공 기준을 닫지 못하면 PASS가 아니다.

## 0. PM-facing report contract

Verify Report는 개발자용 디버깅 로그가 아니라 구현 공유 문서다. 시작 전에 각 항목을 다음 계약으로 고정한다.

| 계약 필드 | 질문 |
|-----------|------|
| Requirement source | Jira/Notion/Slack/와이어프레임/PR test plan/frame/사용자 지시 중 무엇을 증명하는가? |
| Frame handoff adjudication | Frame 항목이면 reuse/revise/add/drop/blocked 중 무엇이고 이유는 무엇인가? |
| Audience claim | PM·기획자가 읽을 한 문장 성공 기준은 무엇인가? |
| Primary feature verb | 이 기능을 실제로 닫는 핵심 동사는 create/update/read-display/permission/event 중 무엇인가? |
| Actor / role | 누가 조작하거나 보는가? admin/member/partner/anonymous 등 |
| Subject identity | 같은 row/order/review/user/item임을 무엇으로 보장하는가? |
| User-facing oracle | 화면에서 무엇이 보여야 성공인가? |
| Oracle surface | 그 oracle을 판정하려면 전체 어디까지 봐야 하는가? 첫 viewport/대표 1건인가, 전체 list/page/carousel/option/role/state/downstream인가? |
| Primary capture | focused crop/GIF/viewport 중 무엇이 primary인가? |
| Technical support | API/DB/code/test는 어떤 claim을 보조하는가? |
| Excluded setup noise | 로그인/빌드/bootstrap/selector 시행착오 중 report에서 숨길 것은 무엇인가? |

하나의 리포트는 위 계약을 item별로 반복한 PM-facing story여야 한다. 기술 검증은 중요하지만 상단 결론을 대신하지 않는다.

### 0.1 Frame handoff adjudication rule

Frame은 requirement source이고 verify-report는 evidence adjudicator다. Frame Requirement Matrix/Domain Work Map/verify focus가 있으면 report가 처음부터 다시 발명하지 않고 추적성을 이어받는다. 하지만 Frame을 완전 SSOT로 복사하면 구현 중 바뀐 scope, 최신 사용자 지시, 데이터/권한 현실성, 캡처 가능성을 놓칠 수 있다.

따라서 verify-report 시작 전 각 Frame 항목에 판정을 붙인다.

| 판정 | 의미 | evidence 계약 |
|------|------|---------------|
| `reuse` | Frame 항목이 현재 검증에서도 그대로 유효 | Requirement ID를 유지하고 동일 claim을 evidence로 닫는다. |
| `revise` | intent는 유효하지만 subject/action/oracle/evidence가 바뀌어야 함 | Requirement ID와 변경 이유를 남기고 대체 경로를 명시한다. |
| `add` | Frame에는 없지만 최신 지시/diff/runtime 현실에서 새 축이 필요 | 새 출처와 추가 이유를 명시한다. |
| `drop` | scope 밖/중복/오래된 항목 | 제외 사유를 남기고 PASS 항목으로 만들지 않는다. |
| `blocked` | 대체 경로도 없어 evidence를 만들 수 없음 | Coverage Gap/blocked로 남긴다. |

이 판정 없이 Frame 항목을 그대로 PASS 목록으로 복사하거나, 반대로 Frame 추적성을 버리고 독립 리스트업만 하면 실패다.

### 0.2 Prior correction intent rule

이전 사용자 교정이나 실패 회고가 있으면 그대로 집행하기 전에 `literal`과 `intent`를 분리한다.

| 단계 | 확인 |
|------|------|
| Primary action | 기능의 핵심 동사가 create/update/read-display/permission/event 중 무엇인지 고정한다. |
| Correction literal | 과거 교정을 문장 그대로 실행하면 어떤 subject/action이 필요한지 적는다. |
| Correction intent | 그 교정이 막으려던 실패를 적는다. 예: 다른 조건의 데이터를 섞지 않기, setup noise 제외, role 혼동 방지. |
| Feasibility | literal이 현재 권한 정책, user-facing 노출, side effect 조건에서 현실적인지 확인한다. |
| Equivalent path | literal이 비현실적이면 core feature path에서 같은 intent를 보존하는 subject/action을 찾는다. |

`blocked`는 literal이 불가능하다는 이유만으로 쓰지 않는다. 같은 intent를 보존하는 equivalent path가 있으면 그 경로를 item detail에 명시하고 PASS/FAIL을 판단한다. 대체 경로도 없거나 위험 side effect 승인이 없을 때만 Coverage Gap/blocked로 내린다.

## 1. Coverage matrix first

검증 시작 전에 기획 근거와 요구사항을 보고 축을 만든다. 구현 diff는 누락 리스크를 보완하는 보조 입력이며, PM-facing UI 기능에서 code diff만으로 상단 PASS를 닫지 않는다.

### 1.0 Oracle surface gate

각 claim은 evidence 수집 전에 “무엇이 보이면 성공인가”뿐 아니라 “그 판정을 위해 전체 어디까지 봐야 하는가”를 가져야 한다. 이를 oracle surface라고 부른다. Oracle surface는 케이스별 UI 요소명이 아니라 claim의 판정 경계다.

원칙:

1. **Partial view는 partial evidence**다. 첫 viewport, 대표 row, 첫 page, 최종 상태 1장은 claim 전체를 닫을 때만 primary가 될 수 있다.
2. **같은 claim은 같은 path로 비교**한다. before/after, role별 허용/차단, option state 비교는 route, subject, viewport, role, interaction path를 맞춘다.
3. **전체 range claim은 전체 range를 덮는다.** 리스트/캐러셀/페이지네이션/검색 결과/option set/count/rank/order claim은 전체 item range 또는 명시한 sampling boundary를 보여야 한다.
4. **Downstream claim은 downstream까지 간다.** create/update/save가 성공 기준이면 저장 직후 화면뿐 아니라 reload/read/downstream user-facing 표시까지 봐야 한다.
5. **기술 evidence는 보조다.** code/id/API JSON은 UI motion/crop이 보여주는 판정을 검산하는 supporting evidence이며, 사용자-facing claim을 대체하지 않는다.

Oracle surface template:

| Claim type | Oracle surface | PASS 금지 예시 |
|------------|----------------|----------------|
| list/carousel/page 중복·정렬·누락 | 전체 item range와 순서. before/after면 같은 interaction path로 끝까지 비교 | 첫 화면 3개만 보고 9개 전체 동일/분리 PASS |
| filter/search/result count | 입력 조건, empty/data/overflow, 전체 result boundary 또는 sampling 기준 | 첫 page만 보고 전체 filter PASS |
| option/default/selection | no data, existing data, refresh/stale, 저장 후 재조회 | 기본 선택 첫 렌더만 보고 저장/유지 PASS |
| create/update action | 입력 → 저장 → reload/read → downstream 표시 | toast만 보고 실제 저장/표시 PASS |
| permission/role | 허용 role success + 차단 role denial + 잘못된 role blocker 배제 | admin 기능을 partner 실패로 blocked 처리 |
| responsive/layout | mobile/boundary/desktop의 문제 표면 전체 | desktop crop 하나로 responsive PASS |
| event/network | trigger/non-trigger path, payload/count, duplicate emission | 이벤트 1회 발화만 보고 미발화/중복 없음 PASS |

Hard gate: item detail 또는 plan에 oracle surface가 없거나, evidence가 surface 전체를 덮지 못했는데 PASS라면 coverage incomplete다.

| 변경 유형 | 필수 축 | 권장 evidence |
|----------|---------|---------------|
| static UI state/section/component | contextual crop, full viewport context, desktop/mobile applicability | contextual focused crop primary + same-route full viewport supporting + mobile/desktop pair when applicable |
| responsive/layout class | mobile, breakpoint boundary, desktop, before/after | viewport screenshot + 문제 영역 crop |
| sidebar/nav/menu | expanded, collapsed, role/account별 차이, before/after | nav 영역 crop |
| typography/logo/token | screenshot, DOM class/token, computed style, before/after | crop + computed style text |
| table/card/list | empty, data, overflow/scroll | section crop + data fixture 설명 |
| repeated card/thumbnail/badge/tag/list item | consumer surface matrix, actual route subject, desktop/mobile variants, exclusion/gap classification | surface별 focused crop primary + full viewport supporting + DOM/network/API support |
| default selection/option panel | no data, data exists, refresh/stale selection | UI crop + state/log excerpt |
| primary create/update/read action | happy path, 저장/조회, downstream 표시, 필요한 regression path | UI crop/GIF + DB/API support |
| network/event | trigger, non-trigger, request payload/count | network JSON/TXT + optional UI context |
| BE/API/permission | authorized, unauthorized, error path | 하단 기술 보조 검증의 response JSON/status/log |

## 1.1 UI capture bundle default

모든 정적 `UI_CAPTURE` item은 기본적으로 “contextual crop + full viewport + 적용 가능한 desktop/mobile” 번들을 갖는다. 이 규칙은 카드/썸네일에 한정되지 않고, 버튼, 배너, 폼, 테이블, 모달, 사이드바, 안내문, 설정 화면처럼 화면에 보이는 모든 UI claim에 적용한다.

Evidence bundle:

1. **Contextual focused crop — primary**
   - 검증 포인트가 바로 보이는 crop을 primary evidence로 둔다.
   - 너무 좁게 잘라 텍스트/상태만 남기지 않는다. 리뷰어가 위치와 의미를 인식할 수 있도록 section heading, container edge, nearby label, card title, selected tab, surrounding row 중 필요한 맥락을 포함한다.
   - 반대로 full viewport 전체를 primary로 쓰고 리뷰어가 검증 포인트를 찾게 만들지 않는다.
2. **Full viewport context — supporting**
   - 같은 route/action/viewport에서 전체 visible viewport screenshot을 supporting evidence로 첨부한다.
   - 여기서 full viewport는 현재 화면 높이의 일반 screenshot을 뜻한다. 긴 full-page/scroll capture는 여전히 supporting toggle/appendix이고 primary가 아니다.
3. **Desktop/mobile applicability**
   - user-facing Web UI가 desktop과 mobile에서 모두 접근 가능하면 두 viewport를 모두 검증한다. 기본 예시는 mobile 390×844 전후와 desktop 1320~1440px 전후다.
   - responsive/layout 변경이면 section 2의 breakpoint boundary까지 추가한다.
   - admin desktop-only, native-only, mobile-only, 특정 role/route에서 한 viewport만 의미 있는 경우에는 생략하지 말고 item detail 또는 Coverage Gap에 “왜 해당 viewport를 검증하지 않았는지”를 적는다.
4. **Motion claim 예외**
   - 클릭/전환/열림/닫힘 같은 flow는 GIF/짧은 영상이 primary이고, final-state contextual crop + full viewport가 supporting이다.

Hard gate: 정적 UI item을 PASS로 두면서 contextual crop이 없거나, full viewport context가 없거나, user-facing Web의 desktop/mobile 한쪽을 검증하지 않았는데 사유가 없으면 coverage incomplete다.

## 1.2 Repeated surface fan-out preset

반복 카드, 썸네일, badge, tag, list item, 공통 row 컴포넌트처럼 여러 consumer surface에 퍼지는 UI 변경은 단일 컴포넌트 캡처로 닫지 않는다. 사용자가 “모든 카드 surface를 봐줘”라고 말하지 않아도 `/verify-report`가 fan-out matrix를 만든다. 이 preset은 section 1.1의 UI capture bundle을 각 surface에 반복 적용하는 특수 케이스다.

Trigger 예시:

- 공통 카드/썸네일 component, converter, fragment, tag/badge policy, display helper가 변경됐다.
- 같은 필드나 label이 list/search/map/mobile/detail/sidebar/embed 등 여러 route에서 소비된다.
- “카드에 태그 노출”, “badge 우선순위”, “혜택 문구”, “가격/할인/환급률 표시”처럼 반복 UI 정책이 바뀐다.

Workflow:

1. 변경 diff, Frame/PR test plan, import/consumer 관계, project overlay preset에서 후보 surface를 만든다.
2. 각 surface를 `capture`, `technical evidence`, `exclusion/gap` 중 하나로 분류한다.
3. `capture` surface는 actual route와 subject identity를 고정한다. 같은 subject를 못 쓰면 equivalent subject와 이유를 detail에 쓴다.
4. 정적 UI는 focused element/section crop을 primary evidence로 두고, full viewport는 route/context supporting evidence로만 둔다.
5. 모바일 전용 또는 responsive surface는 별도 viewport(예: 390×844)에서 캡처한다. desktop crop으로 mobile card PASS를 대체하지 않는다.
6. DOM text assertion, GraphQL/network response, DB/read-only subject 탐색은 보조 evidence로 붙인다.
7. actual route/subject가 없거나 구조상 적용 대상이 아니면 PASS가 아니라 exclusion/gap으로 명시한다.

Surface matrix template:

| surface | route/subject | expected oracle | evidence | status |
|---------|---------------|-----------------|----------|--------|
| list card | URL + item id | badge/tag text visible | focused crop + viewport | capture |
| search result card | query + item id | same policy text visible | crop + network boolean | capture |
| map desktop card | map route + poi id | card tag in desktop POI/list | crop + viewport | capture |
| mobile selected card | mobile viewport + selected item | same tag in mobile card | 390×844 crop + viewport | capture |
| nearby/recommendation card | detail route + related item | same card policy visible | section crop | capture |
| embed/recent/history card | actual route if available | visible policy or not applicable | crop or code/route evidence | exclusion/gap |

Hard gate: repeated-surface UI 변경인데 report에 consumer surface matrix가 없거나, 공통 component 한 장만으로 모든 surface PASS를 선언하면 해당 report는 coverage incomplete다.

## 2. Responsive preset

responsive 관련 diff가 있으면 최소 아래를 본다. 프로젝트 breakpoints가 다르면 그 값으로 대체한다.

- **mobile**: 390×844 전후
- **breakpoint boundary**: 480/500px 또는 해당 프로젝트의 breakpoint ±20px
- **desktop**: 1320~1440px

각 축을 별도 item으로 만들거나, 하나의 item detail에 축별 evidence를 명시한다. 하나라도 빠지면 final summary의 `Coverage gaps / Unverified`에 남긴다.

## 3. Before/After comparison

기존 UI/동작을 바꾸는 작업은 before/after를 기본 후보로 판단한다. 비교 캡처는 “좋아 보이는 after”보다 리뷰어가 의도를 빠르게 이해하게 해준다.

### Include before/after when

- 기존 화면의 깨짐을 고쳤거나 layout/spacing/typography/nav를 조정했다.
- 사용자가 기존 대비 변화, 회귀 방지, 복구 여부를 궁금해한다.
- 요구사항이 “A가 B처럼 보여야 한다”, “기존 C는 유지되어야 한다”처럼 상대적이다.
- PR 리뷰어가 before를 모르면 after의 의미를 판단하기 어렵다.

### Skip before/after when

- 완전히 신규 화면/플로우라 의미 있는 before가 없다.
- before 재현이 결제, 알림, 외부 API, 운영 데이터 변경 같은 side effect를 만든다.
- 같은 데이터/권한/시간 상태를 맞출 수 없어 비교가 오히려 부정확하다.
- before 환경 준비 비용이 검증 가치보다 크다.

Skip할 때는 숨기지 말고 item detail이나 Coverage Gap에 “before 생략 사유”를 남긴다.

### Source selection

Before source 우선순위:

1. 사용자가 제공한 before URL/capture
2. PR base preview, develop, production 등 배포된 기준 환경
3. base branch를 로컬에서 실행한 기준 화면
4. 기존 report/archive capture

After source는 현재 branch의 local/preview를 사용한다. 둘은 route, query, viewport, account/role, data fixture, interaction을 최대한 맞춘다.

### Evidence labeling

```text
Before — develop 390×844 partner dashboard summary crop
After — local 390×844 partner dashboard summary crop
Comparison note — after는 summary card가 1열로 쌓이고, 기존 승인 대기 수치는 유지됨
```

`verify_report_live`는 여러 image evidence를 grid로 배치하므로 before/after 이미지를 같은 item에 넣으면 나란히 비교하기 쉽다. 긴 full-page before/after는 supporting으로 두고 primary crop을 별도로 둔다.

## 4. Evidence metadata

각 evidence label/detail에는 다음을 포함한다.

- URL / 환경: local, PR Preview, dev, production
- viewport: `390×844`, `1440×900`
- account/role
- branch/commit/PR
- action: reload, click, scroll, filter 조건 등
- expected vs actual

좋은 label 예시:

```text
V2 Before — develop 390×844 partner dashboard summary crop
V2 After — local 390×844 partner dashboard summary crop
V3 supporting — local 390×2016 full-page context
V4 network — preview PR-123 GA event matchedResourceCount=0
```

## 5. Capture-first UI evidence

Primary evidence는 검증 포인트가 바로 보이는 이미지/GIF여야 한다. UI 기능의 상단 PASS는 “코드상 가능함”이 아니라 “실제 사용자가 보는 화면에서 기획 의도가 드러남”으로 닫는다.

권장 순서:

1. element/section crop
2. viewport screenshot
3. full-page screenshot은 supporting context만

긴 이미지를 본문에 크게 펼치면 리포트 가독성이 떨어지고, 리뷰어가 검증 포인트를 찾기 어렵다.

### Tall image rule

다음에 해당하면 primary evidence로 쓰지 않는다.

- 높이 1600px 이상
- viewport 높이의 2배 이상
- 여러 섹션이 이어진 full-page screenshot

필요하면 full-page 이미지는 토글/details/appendix/link 뒤에 둔다. `verify_report_live`는 PNG/JPEG/GIF/WebP의 실제 크기를 읽어 긴 이미지를 자동으로 접힌 토글에 넣는다. 그래도 primary crop은 별도로 캡처해야 한다.

## 6. Motion evidence quality gate

움직임 claim의 primary GIF/영상은 “움직인다”만 보여주면 충분하지 않다. 리뷰어가 텍스트, 색상, 최종 상태를 판독할 수 있어야 PASS evidence다.

권장 기본값:

- 기본 생성 경로: `skills/verify-report/scripts/make-motion-gif.mjs`
- Web/desktop 원본 영상 변환: 원본 해상도 유지(`--width source`), `--fps 12`, `--duration 8`, `palettegen=stats_mode=diff:max_colors=256`, `paletteuse=dither=sierra2_4a`
- 모바일/native 원본 영상 변환: 원본 해상도 유지가 기본이고, 용량 때문에 줄여야 할 때만 `--max-width 720` 이상을 사용한다.
- 길이: 3~8초. 8초를 넘기면 대기/로딩/셋업 구간을 잘라낸다.
- 원본 WebM/MP4와 대표 final-state PNG/crop을 supporting evidence로 둔다.

PASS 금지 예시:

- 390px 폭으로 줄여 카드/버튼 텍스트를 읽을 수 없음
- 8fps 이하로 클릭/전환 흐름이 끊겨 보임
- `palettegen/paletteuse` 없이 변환해 색이 깨지거나 banding이 심함
- 20초 이상 길어서 검증 포인트를 찾기 어려움
- 원본 영상이나 final-state PNG 없이 손실 GIF만 남김

## 7. Gate strength: hard gate vs soft lint

강제는 모두 같은 강도로 걸지 않는다. PM-facing 신뢰를 깨는 항목만 hard gate이고, 보조 품질은 soft lint다.

### Hard gate — 위반 시 PASS 금지

- 요구사항/기획 근거 또는 PM-readable 성공 기준이 없다.
- UI item인데 primary 화면 캡처/GIF가 없거나, 캡처 안에 expected UI가 보이지 않는다.
- 정적 UI item인데 contextual focused crop, same-route full viewport supporting, 적용 가능한 desktop/mobile viewport 중 하나가 없고 생략 사유도 없다.
- 반복 카드/썸네일/badge/tag UI 변경인데 consumer surface matrix 없이 단일 surface나 공통 component 캡처만으로 전체 PASS를 선언했다.
- Frame Requirement Matrix/verify focus가 있는데 reuse/revise/add/drop/blocked handoff 판정 없이 복사하거나 무시했다.
- state transition/before-after claim인데 같은 subject identity가 보장되지 않고, equivalent path도 명시되지 않았다.
- 과거 교정 literal이 비현실적인데 primary action과 correction intent를 재해석하지 않고 blocked/pass로 처리했다.
- actor/role이 성공 기준의 일부인데 잘못된 계정/role로 검증했다.
- motion/flow claim인데 GIF/짧은 영상 없이 정적 PNG만 있다.
- setup/login/bootstrap 실패를 기능 PASS evidence처럼 넣었다.

### Soft lint — 경고 후 보완 권장

- evidence metadata 일부가 부족하다.
- full-page supporting image가 너무 길다.
- 하단 기술 보조 검증이 부족하지만 상단 UI claim은 화면으로 이미 닫혔다.
- before source를 못 맞췄지만 신규 기능이거나 생략 사유가 명확하다.

PASS는 아래가 모두 참일 때만 쓴다.

- 해당 item의 성공 기준이 PM-readable하게 명확하다.
- 계획한 coverage axis가 모두 evidence로 닫혔다.
- evidence에 환경/viewport/role/action 메타데이터가 있다.
- UI item이면 primary crop/GIF 또는 명확한 viewport screenshot이 있다.
- before/after가 필요한 item이면 둘 다 같은 subject/축으로 캡처했거나, before 생략 사유가 명확하다.

아래 상황은 PASS 금지:

- 모바일만 봤는데 desktop responsive 회귀 가능성이 남아 있음
- desktop만 봤는데 user-facing mobile 화면도 접근 가능한 UI임
- crop이 너무 좁아 위치/맥락을 알 수 없거나, full viewport supporting이 없어 실제 route context를 확인할 수 없음
- before가 핵심인 UI 변경인데 after만 보고 완료 선언함
- 캡처가 full-page 하나뿐이라 검증 포인트가 불명확함
- 환경/계정/viewport를 알 수 없음
- actor/role이 틀렸거나 검증 대상 기능과 무관한 계정 실패를 gap처럼 섞음
- 로그는 있지만 필터 조건/expected count가 없음

## 8. Final summary template

```markdown
Verified — PM-facing behavior
- V1: Jira COM-123 요구대로 관리자가 옵션을 켜면 사용자 상세 화면에 새 CTA가 보임 (before/after primary crop)
- V2: 와이어프레임 기준 390×844 모바일에서 카드가 1열로 쌓이고 CTA와 겹치지 않음 (focused crop)

Coverage gaps / Unverified
- V3: PR Preview가 아직 뜨지 않아 preview 환경 미검증
- V4: 기존 before 기준을 맞출 수 없어 after-only로 검증, 생략 사유 기록

Technical support checks
- T1: API 응답에 신규 필드가 내려오고 권한 없는 mutation은 403으로 차단됨
- T2: 관련 unit test 통과

Blocked / Known unrelated failures
- type-check: 기존 GraphQL schema mismatch로 실패, touched files focused check는 통과
```
