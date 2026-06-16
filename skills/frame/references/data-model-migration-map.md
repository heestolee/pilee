# Data Model / Migration Map

Data Model / Migration Map은 Backend Layer Map이나 Architecture Flow와 별개의 영역이다.

- Backend Layer Map: 책임 위치와 call-flow
- Architecture Flow: 런타임 데이터/로직 이동
- Data Model / Migration Map: 실제 저장 구조, DDL/DML/backfill, 관계 제약, 검증 query

## 언제 켜나

다음 중 하나라도 있으면 `/frame` Step 2에서 별도 영역으로 보여준다.

- 새 테이블/컬럼/index/FK/UNIQUE/default/nullability가 생기거나 바뀐다.
- DML/seed/backfill/runbook이 필요하다.
- row별 설정과 section/global 설정, source-of-truth와 fallback source 구분이 리뷰 핵심이다.
- migration 실행 여부와 별개로 DB 구조가 사용자-facing 동작의 의미를 바꾼다.

## Canonical frame.json shape

```ts
frame.data_model_migration_map = {
  triggered: true,
  mode: "migration-map",
  triggerReason: "Special Price 섹션 접힘 설정을 row 목록과 분리해야 함",
  entities: [...],
  relationships: [...],
  migrationOperations: [...],
  runtimeFlow: [...],
  verificationQueries: [...]
}
```

## TFT Studio visual 템플릿

```tft-visual
{
  "kind": "data-model-migration-map",
  "title": "스팟 · 이벤트 · 수가표 데이터 구조",
  "subtitle": "DDL/DML과 runtime fallback source를 분리해서 보는 DB 구조 지도",
  "runtimeFlow": [
    "웹은 현재 언어의 spot_translation을 기준으로 상세 정보를 조회",
    "Event는 event row별 is_displayed/is_collapsed를 사용",
    "Special Price는 feeScheduleDisplay fallback source와 setting.is_collapsed를 함께 사용"
  ],
  "entities": [
    {
      "name": "spot_translation",
      "description": "언어별 상세 정보. 하위 event/fee schedule이 참조하는 기준 row",
      "sourceOfTruth": true,
      "columns": [
        { "name": "code", "type": "string", "primaryKey": true },
        { "name": "spot_code", "foreignKey": true, "references": "spot.code" },
        { "name": "language", "type": "LanguageType" }
      ]
    },
    {
      "name": "spot_trans_fee_schedule_display_setting",
      "status": "new",
      "description": "Special Price 섹션 전체 접힘 설정. fee schedule row 목록과 분리",
      "columns": [
        { "name": "spot_trans_code", "foreignKey": true, "references": "spot_translation.code", "unique": true, "nullable": false },
        { "name": "is_collapsed", "type": "boolean", "defaultValue": "false" }
      ]
    }
  ],
  "relationships": [
    {
      "from": "spot_translation.code",
      "to": "spot_trans_fee_schedule_display_setting.spot_trans_code",
      "cardinality": "1 : 0..1",
      "description": "언어별 상세 row 하나가 Special Price 섹션 설정을 최대 하나 가진다"
    }
  ],
  "migrationOperations": [
    {
      "type": "DDL",
      "target": "spot_trans_fee_schedule_display_setting",
      "description": "section-level is_collapsed 저장 테이블 생성",
      "rollback": "down()에서 테이블 제거",
      "status": "planned"
    }
  ],
  "verificationQueries": [
    {
      "id": "V1",
      "title": "1:0..1 제약 검증",
      "sql": "select spot_trans_code, count(*) from spot_trans_fee_schedule_display_setting group by 1 having count(*) > 1;"
    }
  ],
  "notes": [
    { "title": "읽는 법", "body": ["Entity 카드는 실제 저장 구조", "Relationships는 cardinality와 제약", "Migration Plan은 DDL/DML/backfill/rollback을 분리해서 본다"] }
  ]
}
```

## 작성 규칙

- `kind`는 `data-model-migration-map`을 우선 사용한다.
- `entities[].columns[]`는 실제 schema/DDL 확인 후 채운다. 불확실하면 `status: "open_question"`으로 남긴다.
- DDL/DML/backfill/rollback/verify는 `migrationOperations[].type`으로 분리한다.
- migration 실행이 아직 안 됐으면 PASS처럼 쓰지 말고 `verificationQueries[]`와 verify plan caveat로 남긴다.
- visual은 설명 surface이고 canonical 원천은 `frame.json.data_model_migration_map`이다.
