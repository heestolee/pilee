# Backend Layer Map

백엔드 레이어 맵은 구현 순서가 아니라 **책임 위치와 call-flow를 사용자가 함께 검수하기 위한 지도**다. 사용자가 backend 레이어를 잘 모르거나 resolver/usecase/service/repository/entity/VO/loader가 함께 등장하면 `/frame` Step 2에서 먼저 보여준다.

정확한 기획 근거가 있는 source-grounded frame에서는 레이어 맵이 단순 아키텍처 설명이 아니라 **기획 책임 분배표**가 된다. 각 레이어는 `R1`, `R2` 같은 requirement ID를 가져야 하며, implementation plan은 이 맵에서 파생되어야 한다.

## 언제 켜나

다음 중 하나라도 있으면 켠다.

- Resolver/Controller, Usecase, Service, Repository, Entity, VO, Loader/DataLoader, Migration 중 2개 이상이 영향 범위에 있음
- API 응답 값이 Web/Admin/Slack/job 등 여러 소비 채널로 흘러감
- “어디에 로직을 둬야 하는지”가 정책/검증/구조 비용을 바꿈
- cache key, loader scope, transaction boundary, ORM include/where/order가 결과 의미를 바꿀 수 있음
- 사용자가 해당 backend 구조에 익숙하지 않다고 밝힘

## 레이어 역할 기본값

| 레이어 | 흔한 이름 | 기본 책임 | 넣으면 안 되는 것 |
|---|---|---|---|
| Entry point | Resolver, Controller, Handler | API field/action을 받고 usecase/loader로 연결 | 복잡한 DB 조건, 핵심 정책 계산 |
| Application flow | Usecase, Application service | 사용자 행동 단위 흐름, 기준 시간/권한/transaction 조합 | ORM 세부 where 난립, UI 표시 문구 |
| Domain rule | VO, Domain service, Entity method | 계산, 불변식, 중복 방어, 의미 있는 값 조합 | IO, DB 조회, request context 직접 접근 |
| Data access | Repository, ORM query | where/include/order/lock, 영속성 조회/저장 | 사용자 행동 정책, 표시 포맷 |
| Cache/batching | Loader, DataLoader, cache | batching, cache key, request scope | 기준 값을 빠뜨린 전역 cache |
| Persistence | Entity, Migration, Schema | source-of-truth, FK/unique/index/nullability | 런타임 분기 정책 |
| Consumer | Web, Admin, Slack, job | 결과 표시/전달, 채널별 copy/format | source-of-truth 재계산 |
| External | API client, webhook, queue | 외부 시스템 경계, retry/observability | 내부 도메인 불변식 |

## Step 2 카드 템플릿

```markdown
백엔드 레이어 맵:

Call-flow:
GraphQL Reservation.beautyCashbackCampaign
  → ReservationResolver field resolver
  → BeautyCashbackCampaignLoader / Repo
  → BeautyCashbackCampaign + Period + Spot mapping entities
  → BeautyCashbackBenefit VO
  → Web 예약 후 화면 / Slack 알림

| 레이어 | 요구사항 | 이번 작업 책임 | 확인 상태 |
|---|---|---|---|
| Resolver | R1,R4 | reservation.createdAt/spotCode로 reservation-scoped benefit 노출 | 확인 필요 |
| Usecase/Service | R4 | 영수증 가이드 조회 기준 시간 전달 | 가정 |
| Repository | R4 | spot + basisTime으로 active/inactive period 조회 | 확인 필요 |
| VO | R2 | refundRate 합산/중복 방어/cache id | 확인 필요 |
| Loader | R4 | basisTime이 cache key에 포함되는지 | 열린 질문 |
| Consumer | R1,R5 | Web/Slack이 reservation 기준 값을 쓰는지 | 확인 필요 |
```

## 질문으로 승격하는 기준

레이어 맵 전체를 사용자에게 묻지 않는다. 아래 조건이면 하나만 AskUserQuestion으로 승격한다.

1. 책임 위치에 따라 public API, DB query, cache key, 테스트 위치가 달라진다.
2. 코드 패턴만으로 어느 레이어가 책임져야 하는지 확정하기 어렵다.
3. 잘못 고르면 후반에 “repo에서 할 일이 아니라 usecase 정책이었다”, “VO 불변식이어야 했다” 같은 리뷰가 나올 가능성이 있다.

질문 예:

```markdown
현재 이해: “예약 시점 기준 캠페인 환급률을 노출한다.”
막힌 결정: 기준 시간 선택 책임을 어느 레이어가 소유해야 하는지
추천 답안: 2번 — 예약 시점은 사용자 행동 맥락이므로 usecase/resolver input에서 명시하고, repository는 받은 basisTime으로 조회만 하는 편이 안전합니다.
질문: 기준 시간 책임을 어디에 둘까요?

1. Repository 내부 — 호출자는 현재/과거 구분 없이 spotCode만 전달
2. Usecase/Resolver input — basisTime을 명시적으로 전달하고 repo는 조회 조건만 수행
3. VO — 조회 후 benefit 조합 단계에서 기준 시간 필터링
4. 먼저 기존 유사 흐름을 더 읽고 결정
```

## 완료 조건

백엔드 레이어 맵이 켜진 frame은 저장 전에 다음 중 하나를 만족해야 한다.

- `backend_layer_map`에 callFlow와 각 레이어 책임/검증 포인트가 들어 있다.
- source-grounded frame이면 각 레이어에 requirement ID가 붙어 있고, 해당 ID가 Requirement Matrix와 Domain Work Map에 존재한다.
- 또는 기존 schema에 필드가 없다면 `review_lenses`, `risk_register`, `success_criteria`, `verify_plan.manual_checks`에 같은 내용이 명시되어 있다.
- 열린 레이어 책임 질문은 `decision_queue` 또는 `risk_register.needs_decision`에 들어 있다.
- implementation plan의 파일 순서는 이 맵에서 파생되어야 하며, 맵을 대체하지 않는다.
