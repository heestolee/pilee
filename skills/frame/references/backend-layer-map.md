# Backend Layer Map

백엔드 레이어 맵은 구현 순서가 아니라 **책임 위치와 call-flow를 사용자가 함께 검수하기 위한 지도**다. 사용자가 backend 레이어를 잘 모르거나 resolver/usecase/service/repository/entity/VO/loader가 함께 등장하면 `/frame` Step 2에서 먼저 보여준다. FE 중심 작업이라도 버튼/셀렉트박스/카드 action이 기존 backend/API/cache/refresh 경계를 재사용해야 하면 Backend/Action Boundary Map으로 보여준다.

정확한 기획 근거가 있는 source-grounded frame에서는 레이어 맵이 단순 아키텍처 설명이 아니라 **기획 책임 분배표**가 된다. 각 레이어/경계는 `R1`, `R2` 같은 requirement ID를 가져야 하며, implementation plan은 이 맵에서 파생되어야 한다. 신규 backend 구현이 없다는 이유만으로 `triggered:false`로 숨기지 말고, 변경 금지/재사용 경계는 `mode="boundary-only"`로 남긴다.

## 언제 켜나

다음 중 하나라도 있으면 켠다.

- Resolver/Controller, Usecase, Service, Repository, Entity, VO, Loader/DataLoader, Migration 중 2개 이상이 영향 범위에 있음
- UI 버튼/셀렉트박스/카드 action이 기존 approval/status-change/API/cache/refresh 경계를 재사용하거나 변경하지 않아야 함
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

## Layer Visual Map 템플릿

사용자가 레이어 구조를 잘 모르거나 backend 책임 배치가 구현 판단을 좌우하면, 표 바로 아래에 `tft-visual` fenced block을 추가한다. Mermaid는 fallback일 뿐이며, 기본은 TFT Studio가 렌더링하는 SVG/카드형 visual이다.

```tft-visual
{
  "kind": "backend-layer-map",
  "title": "언어별 미디어 수정 요청 레이어 지도",
  "subtitle": "사용자 행동이 어떤 backend 책임으로 넘어가는지 초보자용 설명과 함께 표시",
  "flow": ["공급자 관리 화면에서 언어별 미디어 수정", "수정 요청 payload 저장", "운영자 검수", "승인 시 실제 미디어 source 반영"],
  "layers": [
    {
      "layer": "Entry/API",
      "title": "GraphQL mutation / DTO",
      "role": "요청 접수창",
      "beginnerDescription": "화면에서 보낸 언어별 이미지 목표 상태를 처음 받는 입구입니다. 복잡한 승인 정책은 여기서 계산하지 않습니다.",
      "requirements": ["R4"],
      "responsibilities": ["localizedImages input/output shape 유지"],
      "files": ["DTO, GraphQL schema"],
      "evidence": ["schema/codegen"],
      "risk": ["요청을 받자마자 실제 미디어 source를 저장하면 승인 전 반영 버그가 됩니다."]
    },
    {
      "layer": "Application Flow / Usecase",
      "title": "Create/Approve update request usecase",
      "role": "업무 총괄자",
      "beginnerDescription": "수정 요청 생성, 기존 pending 반려, 승인 반영 순서를 조립합니다. 여러 작업자의 순서를 정하는 총괄자입니다.",
      "requirements": ["R4", "R6", "R7"],
      "responsibilities": ["승인 전 즉시 저장 금지", "승인 시 canonical media source 반영", "기존 pending 대표 미디어 요청 반려"],
      "files": ["update-request/usecase"],
      "evidence": ["integration/unit test", "dry-run/log evidence"]
    }
  ],
  "notes": [
    { "title": "읽는 법", "body": ["위에서 아래로 사용자의 요청이 흘러갑니다.", "카드 오른쪽의 R 번호는 기획 요구사항 ID입니다.", "각 카드의 초보자 설명이 이해되지 않으면 구현 전에 레이어 책임을 다시 나눕니다."] }
  ]
}
```

Layer Visual Map 규칙:

- `kind`는 반드시 `backend-layer-map`으로 둔다.
- `layers[].requirements`는 Requirement Matrix의 ID와 일치해야 한다.
- `beginnerDescription`은 “요청 접수창”, “업무 총괄자”, “DB 창구”처럼 쉬운 비유를 포함한다.
- `files`는 후보 파일을 1~3개만 적고, 파일 나열이 visual의 주 내용이 되지 않게 한다.
- `evidence`는 해당 레이어가 닫혔음을 어떤 검증으로 볼지 적는다.
- visual이 canonical을 대체하지 않는다. 같은 내용은 `backend_layer_map.layers[]`에도 저장한다.

## Architecture / Data Flow Map 템플릿

Layer Visual Map이 “각 레이어가 무슨 책임인지”를 설명한다면, Architecture/Data Flow Map은 “데이터와 로직이 실제로 어디를 지나가는지”를 보여준다. 전체 구조, 데이터 흐름, DB PK/FK, resolver → usecase → service/domain/VO → repository → table 흐름이 구현 위치·검증 증거·source-of-truth 판단에 영향을 주면 `kind: "architecture-flow"` visual을 추가한다. 사용자가 먼저 요청했을 때만의 옵션이 아니라, backend/data/API/DB 흐름이 작업 이해를 좌우하는 source-grounded full frame의 필수 surface다.

```tft-visual
{
  "kind": "architecture-flow",
  "title": "언어별 미디어 수정 요청 데이터 흐름",
  "subtitle": "UI에서 제출된 언어별 미디어 목표 상태가 승인 후 실제 table에 반영되는 경로",
  "lanes": ["UI", "API / Resolver", "Usecase", "Domain / VO", "Repository", "DB", "Ops Review"],
  "nodes": [
    {
      "id": "requester-ui",
      "lane": "UI",
      "type": "screen",
      "title": "공급자 관리 화면 미디어 편집",
      "description": "언어별 미디어 추가·삭제·순서·대표 지정 변경을 draft로 누적",
      "badges": ["R2", "R3", "draft-only"]
    },
    {
      "id": "create-usecase",
      "lane": "Usecase",
      "type": "usecase",
      "title": "수정 요청 생성 Usecase",
      "description": "즉시 저장하지 않고 BASIC_INFO / LOCALIZED_MEDIA payload로 보관",
      "badges": ["R12", "R13", "R16"]
    },
    {
      "id": "media-table",
      "lane": "DB",
      "type": "table",
      "title": "localized_entity_media",
      "description": "승인 후 반영되는 언어별 미디어 source-of-truth",
      "badges": ["source-of-truth"],
      "columns": [
        { "name": "id", "badges": ["PK"] },
        { "name": "translation_id", "badges": ["FK"], "references": "localized_entity_translation.id" },
        { "name": "asset_id", "badges": ["FK"], "references": "media_asset.id" },
        { "name": "sort_order" },
        { "name": "is_main" }
      ]
    }
  ],
  "edges": [
    { "from": "requester-ui", "to": "create-usecase", "label": "언어별 목표 상태 제출" },
    { "from": "create-usecase", "to": "media-table", "label": "승인 전에는 쓰지 않음", "kind": "risk" }
  ]
}
```

Architecture/Data Flow Map 규칙:

- `lanes`는 사용자가 읽는 큰 흐름 순서로 둔다. 기본은 UI → API/Resolver → Usecase → Domain/VO → Repository → DB → Ops/Review다.
- `nodes[].type`은 `screen`, `resolver`, `usecase`, `service`, `domain`, `vo`, `repository`, `table`, `review`, `ops`처럼 책임/형태가 보이게 적는다.
- DB table node는 가능하면 `columns`에 `PK`, `FK`, `UNIQUE`, `JSON`, `source-of-truth`, `legacy` badge를 넣는다. 정확한 컬럼명은 실제 schema를 읽은 뒤 채운다.
- `edges[].label`에는 “조회”, “payload 저장”, “승인 시 반영”, “legacy pending 반려”처럼 데이터/로직 이동의 의미를 짧게 쓴다.
- Layer Visual Map과 Architecture/Data Flow Map은 둘 다 설명 surface다. canonical 구조는 `backend_layer_map`, `architecture_flow_map`, `requirement_matrix`, `implementation_plan`, 실제 code/schema에 남긴다.
- Architecture/Data Flow Map의 주요 lane/node/edge는 Requirement Matrix의 ID와 연결되어야 하며, source-of-truth table/node는 verification evidence를 가져야 한다.

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
- Architecture/Data Flow가 트리거된 작업이면 `architecture_flow_map` 또는 이에 준하는 visual/verify_plan에 lane/node/edge/source-of-truth 또는 action boundary와 requirement ID가 명시되어 있다.
- lane이 많거나 가로 폭이 과도하면 renderer가 세로 top-down 배치를 선택할 수 있게 `direction:"auto"` 또는 생략을 우선한다. 반드시 가로가 더 읽기 쉬운 작은 그래프에서만 `direction:"RIGHT"`를 명시한다.
- edge label은 카드 본문 위에 올리지 않는다. label은 pill 배경을 가진 별도 시각 요소로 두고, edge는 카드 바깥 gutter/bus를 통해 우회하도록 visual을 작성한다.
- 열린 레이어/흐름 책임 질문은 `decision_queue` 또는 `risk_register.needs_decision`에 들어 있다.
- implementation plan의 파일 순서는 이 맵에서 파생되어야 하며, 맵을 대체하지 않는다.
