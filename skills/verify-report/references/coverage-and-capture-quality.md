# Verify Report — Coverage & Capture Quality

리포트의 목표는 “증거를 모았다”가 아니라 “성공 기준을 증거로 닫았다”이다. 캡처 파일이 있어도 변경 리스크를 커버하지 못하면 PASS가 아니다.

## 1. Coverage matrix first

검증 시작 전에 변경 diff와 요구사항을 보고 축을 만든다.

| 변경 유형 | 필수 축 | 권장 evidence |
|----------|---------|---------------|
| responsive/layout class | mobile, breakpoint boundary, desktop, before/after | viewport screenshot + 문제 영역 crop |
| sidebar/nav/menu | expanded, collapsed, role/account별 차이, before/after | nav 영역 crop |
| typography/logo/token | screenshot, DOM class/token, computed style, before/after | crop + computed style text |
| table/card/list | empty, data, overflow/scroll | section crop + data fixture 설명 |
| default selection/option panel | no data, data exists, refresh/stale selection | UI crop + state/log excerpt |
| network/event | trigger, non-trigger, request payload/count | network JSON/TXT + optional UI context |
| BE/API/permission | authorized, unauthorized, error path | response JSON/status/log |

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

## 5. Crop-first UI evidence

Primary evidence는 검증 포인트가 바로 보이는 이미지여야 한다.

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

## 6. PASS gate

PASS는 아래가 모두 참일 때만 쓴다.

- 해당 item의 성공 기준이 명확하다.
- 계획한 coverage axis가 모두 evidence로 닫혔다.
- evidence에 환경/viewport/role/action 메타데이터가 있다.
- UI item이면 primary crop 또는 명확한 viewport screenshot이 있다.
- before/after가 필요한 item이면 둘 다 같은 축으로 캡처했거나, before 생략 사유가 명확하다.

아래 상황은 PASS 금지:

- 모바일만 봤는데 desktop responsive 회귀 가능성이 남아 있음
- before가 핵심인 UI 변경인데 after만 보고 완료 선언함
- 캡처가 full-page 하나뿐이라 검증 포인트가 불명확함
- 환경/계정/viewport를 알 수 없음
- 로그는 있지만 필터 조건/expected count가 없음

## 7. Final summary template

```markdown
Verified
- V1: develop before 대비 local after 390×844에서 모바일 카드가 1열로 쌓임 (before/after primary crop)
- V2: desktop 1440×900에서 차트/요약 카드 겹침 없음 확인

Coverage gaps / Unverified
- V3: PR Preview가 아직 뜨지 않아 preview 환경 미검증
- V4: 신규 기능이라 의미 있는 before 없음, after-only로 검증

Blocked / Known unrelated failures
- type-check: 기존 GraphQL schema mismatch로 실패, touched files focused check는 통과
```
