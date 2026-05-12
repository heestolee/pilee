# Policy Axis Scan

정책축 스캔은 혜택/캠페인/예약/결제/정산처럼 “룰은 정했지만 축을 놓치면 후반에 모델이 뒤집히는” 작업을 `/frame` 초반에 붙잡는 게이트다.

## 언제 켜나

다음 중 하나라도 있으면 켠다.

- 혜택, 쿠폰, 캠페인, 멤버십, 포인트, 환급률, 가격, 정산, 예약, 영수증
- 현재 값과 과거 예약/구매/생성 시점 값이 다를 수 있음
- DEFAULT, fallback, override, priority, multi-mapping, merge, sum, block 같은 정책어가 등장함
- Web/Admin/Slack/알림/API처럼 같은 정책을 여러 채널에서 다르게 소비함
- migration, seed, runbook, rollback, idempotent re-run, cache identity가 정책 재현성에 영향 줌

## 스캔 축

| 축 | 반드시 확인할 질문 | 흔한 선택지 |
|---|---|---|
| 시간 기준 | 현재 시점 기준인가, 이벤트/예약/구매/생성 시점 기준인가? | current / reservation.createdAt / payment.createdAt / explicit basisTime |
| 적용 수 | 한 대상에 정책 1개만 붙나, 여러 개가 동시에 붙나? | single / multiple allowed / overlap forbidden |
| 다중 적용 | 여러 개면 무엇을 하나? | priority / sum / max / merge guide / block as invalid |
| DEFAULT/fallback | DEFAULT는 언제 노출/계산되나? | fallback only / always merge / hide when non-default exists |
| 채널 차이 | 채널마다 기준 시간·표시·검증이 같은가? | Web current, post-booking event-time, Slack event-time 등 |
| 데이터 책임 | migration이 schema만 맡나, seed/default/운영 데이터까지 맡나? | schema only / default seed / one-off runbook |
| 재실행/롤백 | idempotent re-run과 rollback 데이터 보존 조건은? | safe re-run / destructive down / restore required |
| API/cache identity | 정책 조합과 기간이 id/cache/loader key에 드러나나? | campaign code combo / period id / basisTime key 포함 |

## Step 2 카드 템플릿

```markdown
정책축 스캔:
- 트리거: 캠페인/환급률/예약 후 화면/Slack/마이그레이션
- 시간 기준: Web 목록·상세는 현재 기준, 예약 후 화면·Slack은 예약 생성 시점 기준으로 보임
- 적용 수: 한 spot에 non-default campaign 여러 개 가능 여부 미정
- DEFAULT: non-default가 있으면 숨기는지, 안내문은 병합하는지 미정
- 채널 차이: Web/Admin/Slack/예약 후 화면이 같은 표시 규칙인지 확인 필요
- 데이터: migration은 DEFAULT seed까지 책임, 운영 campaign mapping은 runbook 후보
- cache: GraphQL id가 campaign 조합을 표현해야 함
남은 가장 큰 불확실성: 한 spot에 여러 non-default campaign을 허용할지
```

## 채널 매트릭스 템플릿

```markdown
| 채널 | 기준 시간 | 정책 선택 | DEFAULT 처리 | 표시/계산 | 검증 |
|---|---|---|---|---|---|
| Web 목록/상세 | 현재 | active campaign | non-default 있으면 숨김 | 환급률 표시 | UI 캡처 + query |
| 예약 후 화면 | 예약 생성 시점 | reservation basis campaign | 당시 기준 | 당시 환급률/가이드 | reservation query |
| Slack/알림 | 예약 생성 시점 | reservation basis campaign | 기본/캠페인명 규칙 | 최종 환급률 + 멤버십 suffix | unit test/log |
| Admin | 현재 | active campaign | 상태 표시 | campaign status | admin UI/test |
```

## 질문으로 승격하는 기준

스캔 축을 모두 사용자에게 묻지 않는다. 아래 조건이면 하나만 AskUserQuestion으로 승격한다.

1. 선택에 따라 DB 제약, migration, API shape, cache key, 검증 범위가 달라진다.
2. 코드/문서/티켓으로 확정할 수 없다.
3. 후반 PR review에서 나오면 구현 모델이 뒤집힐 가능성이 있다.

질문 예:

```markdown
현재 이해: “캠페인별 캐시백 환급률과 안내문을 적용한다.”
막힌 결정: 한 스팟에 여러 non-default campaign이 동시에 붙을 수 있는지
추천 답안: 2번 — 기간 이력을 보존하려면 여러 기간 row는 허용하되, 같은 시점의 중복 적용은 정책으로 막는 편이 안전합니다.
질문: 스팟별 non-default campaign 적용 수를 어떻게 볼까요?

1. 항상 1개만 허용 — DB/도메인 제약으로 중복 차단
2. 여러 기간 이력은 허용, 같은 시점 중복은 차단
3. 여러 개 동시 적용 허용 — 환급률/안내문 병합 규칙까지 정의
4. 먼저 기존 운영 데이터를 확인하고 결정
```

## 완료 조건

정책축 스캔이 켜진 frame은 저장 전에 다음 중 하나를 만족해야 한다.

- `policy_axis_scan`에 각 축의 결정/출처/미해결 여부가 들어 있다.
- 또는 기존 schema에 필드가 없다면 `review_lenses`, `risk_register`, `success_criteria`, `verify_plan.manual_checks`에 같은 내용이 명시되어 있다.
- 미해결 축이 있으면 `decision_queue` 또는 `ask_first`에 들어 있다.
- 채널별 정책이 다르면 채널 매트릭스가 frame draft 또는 `frame.md`에 남아 있다.
