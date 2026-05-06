# Verify Report — Coverage & Capture Quality

리포트의 목표는 “증거를 모았다”가 아니라 “성공 기준을 증거로 닫았다”이다. 캡처 파일이 있어도 변경 리스크를 커버하지 못하면 PASS가 아니다.

## 1. Coverage matrix first

검증 시작 전에 변경 diff와 요구사항을 보고 축을 만든다.

| 변경 유형 | 필수 축 | 권장 evidence |
|----------|---------|---------------|
| responsive/layout class | mobile, breakpoint boundary, desktop | viewport screenshot + 문제 영역 crop |
| sidebar/nav/menu | expanded, collapsed, role/account별 차이 | nav 영역 crop |
| typography/logo/token | screenshot, DOM class/token, computed style | crop + computed style text |
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

## 3. Evidence metadata

각 evidence label/detail에는 다음을 포함한다.

- URL / 환경: local, PR Preview, dev, production
- viewport: `390×844`, `1440×900`
- account/role
- branch/commit/PR
- action: reload, click, scroll, filter 조건 등
- expected vs actual

좋은 label 예시:

```text
V2 primary — local 390×844 partner dashboard summary cards crop
V3 supporting — local 390×2016 full-page context
V4 network — preview PR-123 GA event matchedResourceCount=0
```

## 4. Crop-first UI evidence

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

## 5. PASS gate

PASS는 아래가 모두 참일 때만 쓴다.

- 해당 item의 성공 기준이 명확하다.
- 계획한 coverage axis가 모두 evidence로 닫혔다.
- evidence에 환경/viewport/role/action 메타데이터가 있다.
- UI item이면 primary crop 또는 명확한 viewport screenshot이 있다.

아래 상황은 PASS 금지:

- 모바일만 봤는데 desktop responsive 회귀 가능성이 남아 있음
- 캡처가 full-page 하나뿐이라 검증 포인트가 불명확함
- 환경/계정/viewport를 알 수 없음
- 로그는 있지만 필터 조건/expected count가 없음

## 6. Final summary template

```markdown
Verified
- V1: local 390×844에서 모바일 카드 1열 확인 (primary crop)
- V2: desktop 1440×900에서 차트/요약 카드 겹침 없음 확인

Coverage gaps / Unverified
- V3: PR Preview가 아직 뜨지 않아 preview 환경 미검증

Blocked / Known unrelated failures
- type-check: 기존 GraphQL schema mismatch로 실패, touched files focused check는 통과
```
