---
name: db-write-migration
description: DDL, 대량 백필, 배포 시 자동 반영되어야 하는 DB 변경을 마이그레이션 파일로 설계·검증할 때 사용. set-based SQL, idempotency, rollback/down(), 실행 전 사용자 승인, dev 검증을 강제한다. 서비스별 경로/명령은 private/project overlay를 따른다.
---

# DB Write Migration

배포 파이프라인에 태워야 하는 DB 변경의 범용 안전 프로토콜이다.

> 특정 서비스의 migration framework, 파일 경로, 실행 명령은 해당 repo/project/private skill을 따른다.

## 사용 시점

- CREATE/ALTER/DROP TABLE 또는 INDEX
- 대량 데이터 백필/상태 전환
- 배포 때 자동 반영되어야 하는 데이터 변경
- 앱 코드와 DB 스키마/데이터 변경을 함께 출시해야 할 때

## 사용하지 않는 경우

- 사람이 DB 클라이언트에서 한 번 실행할 SQL → `db-write`
- MongoDB/Elasticsearch 등 RDB migration이 아닌 저장소 → 별도 절차 필요

## Workflow

### Step 1. 사전 조사

마이그레이션 작성 전에 read-only 조회로 규모와 샘플을 확인한다.

```sql
SELECT COUNT(*) FROM target WHERE ...;
SELECT * FROM target WHERE ... LIMIT 5;
```

결과를 사용자에게 공유한다.

### Step 2. 파일 생성

프로젝트의 공식 migration generator 또는 기존 convention을 사용한다. 수동 파일 생성이 필요하면 기존 파일명을 따라 timestamp/name을 정한다.

### Step 3. 작성 원칙

- 대량 처리는 set-based SQL을 사용한다.
- loop로 row마다 query하지 않는다.
- 재실행 안전성을 둔다.
- down()/rollback은 스크립트가 만든 것만 되돌린다.
- 예약어 alias/컬럼명 사용을 피한다.

```sql
INSERT INTO target (col1, col2)
SELECT col1, col2
FROM source s
WHERE NOT EXISTS (
  SELECT 1 FROM target t WHERE t.col1 = s.col1
);
```

### Step 3.5. 사용자 승인 게이트

실행 전 반드시 사용자에게 초안을 보여주고 명시적 승인을 받는다.

제시할 것:

- 파일 경로
- up/down 핵심 SQL 요약
- 사전 조사 결과와 예상 영향 row 수
- 예상 실행 시간/락 영향
- rollback 전략

승인 전에는 migration 실행을 하지 않는다.

### Step 4. Dev 실행

프로젝트의 공식 migration command를 사용한다. 실행 로그를 보존하고 실패 시 root cause를 먼저 확인한다.

### Step 5. 사후 검증

- count 비교
- 샘플 확인
- 재실행/undo가 필요한 경우 마지막 migration만 되돌리는지 확인
- 앱 코드와 contract 호환성 확인

## 체크리스트

- [ ] 사전 COUNT/샘플 확인
- [ ] set-based SQL
- [ ] idempotent 조건
- [ ] down()/rollback 명확
- [ ] 실행 전 사용자 승인
- [ ] dev 실행 및 검증
- [ ] prod 규모에서 배포 블록이 과하지 않음
- [ ] 프로젝트별 로그/문서 규칙 반영
