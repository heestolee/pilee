---
name: db-write
description: 운영/개발 DB에 일회성 데이터를 쓰거나 수정하는 SQL을 설계할 때 사용. AI가 직접 실행하지 않고, 작업 설명 → 사전 SELECT → 실행 SQL → 사후 SELECT 형식으로 사용자가 DB 클라이언트에서 검토·실행할 수 있게 제공한다. 회사/프로젝트별 DB 도구와 로그 규칙은 private/project overlay를 따른다.
---

# DB Write

일회성 DB write를 안전하게 handoff하기 위한 범용 프로토콜이다.

> 특정 회사/프로젝트 DB 도구, 마이그레이션 경로, 로그 저장소가 있으면 해당 private/project skill을 우선 사용한다.

## 원칙

- **AI는 SQL과 검증 절차를 제공하고, 직접 운영/개발 DB write를 실행하지 않는다.**
- 사용자가 영향 범위를 이해한 뒤 DB 클라이언트에서 실행한다.
- 사전 조회, 실행 쿼리, 사후 검증을 분리한다.
- 추상적 “위험” 대신 row 수, 테이블, FK/CASCADE 영향처럼 구체적 사실로 설명한다.

## 사용 시점

- 코드 배포 없이 한 번 실행할 INSERT/UPDATE/DELETE SQL이 필요할 때
- 사용자가 DB 클라이언트에서 직접 실행할 쿼리를 요청할 때
- DDL/대량 백필/배포 자동 반영이 필요하면 `db-write-migration`을 사용한다.

## 4단계 출력 포맷

### 1. 작업 설명

- 무엇을 바꾸는지
- 영향 테이블/row 수
- 기존 데이터에 미치는 영향

### 2. 사전 확인 SELECT

- 현재 상태와 영향 범위를 확인하는 SELECT
- 가능하면 실제 read-only 도구로 실행해 결과 요약 제공
- 실행 직전 재확인용 SQL 제공

### 3. 실행 SQL

- 실제 INSERT/UPDATE/DELETE
- 기대 affected rows
- 소량 작업만 transaction block 제공
- 대량 작업은 batch/autocommit 전략 사용

```sql
START TRANSACTION;
-- write query
-- verify affected rows
COMMIT;
-- or ROLLBACK;
```

### 4. 사후 확인 SELECT

- 성공 여부를 검증하는 SELECT
- 기대 결과 명시

## 대량 UPDATE 안전 규칙

1만 건 이상은 단일 장기 트랜잭션을 피한다.

- `START TRANSACTION`으로 감싸지 않는다.
- `LIMIT` 또는 key-range로 배치 분할한다.
- 각 배치가 autocommit되게 한다.
- 변경 후 WHERE에서 빠지는 idempotent 조건을 둔다.

```sql
UPDATE target_table
SET status = 'DONE'
WHERE type = 'A'
  AND status <> 'DONE'
LIMIT 10000;
-- 0 rows affected까지 반복
```

## INSERT IGNORE 주의

`INSERT IGNORE`는 UNIQUE 충돌을 조용히 skip한다. 사용할 경우 반드시 실행 전후 count 비교를 제공한다. 가능하면 `INSERT ... ON DUPLICATE KEY UPDATE`처럼 충돌 처리를 명시한다.

## 사용자 결정이 필요한 경우

다음은 SQL 완성 전 사용자에게 선택지를 제시한다.

- FK/CASCADE/SET NULL/NO ACTION의 의미 차이
- 기존 데이터 덮어쓰기 vs 유지 vs 병합
- 일부만 처리 vs 충돌 포함 전체 처리
- 백업 테이블 생성 여부와 보존 기간

## 전달 전 체크리스트

- [ ] 사전 SELECT로 대상 row 수 확인
- [ ] UPDATE/DELETE WHERE 조건 재검증
- [ ] 대량 작업이면 batch/autocommit 설계
- [ ] 재실행 안전성 확인
- [ ] 롤백 또는 복구 경로 명시
- [ ] INSERT IGNORE 사용 시 count 검증 포함
- [ ] 프로젝트별 private/local 로그 규칙이 있으면 따름
