---
name: db-write
description: 운영/개발 DB에 데이터를 쓰거나 수정하는 작업 시 사용. 사용자가 DBeaver 등 클라이언트에서 직접 실행하고, AI는 4단계 (작업 설명 → 사전 SELECT → 실행 SQL → 사후 SELECT) 포맷으로 SQL과 검증 쿼리를 제공. 1만 건 이상 대량 작업, 트랜잭션 위험, FK/CASCADE 트레이드오프 처리.
---

# DB 쓰기 작업 가이드

## 원칙

- **사용자가 주체**: SQL을 이해하고 확신을 가진 상태에서 직접 실행
- **AI는 서브**: SQL 작성 + 검증 쿼리 제공
- **실행은 DBeaver 등 DB 클라이언트에서**: 이 세션에서 직접 실행하지 않음

> 배포 파이프라인에 태우는 **마이그레이션 스크립트 작성·실행**은 이 스킬 범위 밖.
> Trip 서비스 Sequelize / Payment·Language-school TypeORM 마이그레이션이면 `db-write-migration` 스킬 사용.

## 사용 시점

- 사용자가 `/db-write` 호출
- "운영 DB에서 ... 수정해줘", "데이터 정리 SQL 짜줘" 같은 요청
- 일회성 SELECT/UPDATE/INSERT/DELETE — 코드 배포 없이 DBeaver에서 실행할 작업

## 4단계 작업 포맷 (반드시 이 순서로)

### 1단계: 작업 설명

- 뭘 하는 건지 한줄로 설명
- 영향 범위 (몇 건, 어떤 테이블)
- 기존 데이터에 미치는 영향

### 2단계: 사전 확인 (SELECT)

- DBA MCP로 먼저 조회하고, **확인한 결과를 테이블/요약으로 정리**하여 보여줌
- 사용자가 이 단계만 봐도 현재 상태와 영향 범위를 이해할 수 있어야 함
- 결과 요약 아래에 **실행 직전 재확인용 SQL**을 DBeaver 복붙 가능한 형태로 제공

### 3단계: 실행 쿼리 (INSERT/UPDATE/DELETE)

- 실제 데이터 변경 쿼리
- 기대 결과 안내 (예: "84 rows affected 나와야 정상")
- **1만 건 이상은 반드시 배치 분할** (아래 "대량 UPDATE 안전 가이드" 참조)
- 소량(1만 건 미만)만 트랜잭션으로 감싸기:

```sql
START TRANSACTION;
-- 실행 쿼리
-- 결과 확인 후 문제 없으면:
COMMIT;
-- 문제 있으면:
-- ROLLBACK;
```

### 4단계: 사후 확인 (SELECT)

- 실행 후 결과가 맞는지 확인하는 SELECT 쿼리
- 기대 결과 안내

---

## 대량 UPDATE 안전 가이드 (1만 건 이상)

> **실제 장애 사례 (2026-04-24)**: `issued_online_coupon` 131만 row UPDATE를 단일 트랜잭션으로 실행 후 COMMIT 전 결과 확인하느라 수 분간 트랜잭션을 유지 → DB 서버 전체 성능 저하 → 유저 웹 SSR 서버 크래시 + 어드민 로그인 장애 발생.

### 왜 위험한가

대량 UPDATE를 한 트랜잭션으로 실행하면:
1. **buffer pool 점유**: 수십만 dirty page가 RAM 캐시를 차지 → 다른 테이블 쿼리도 디스크 읽기 발생
2. **undo log 누적**: COMMIT 전까지 undo log 해제 불가 → MVCC 읽기 성능 저하
3. **row lock 유지**: COMMIT 전까지 해당 row에 대한 쓰기 요청 전부 대기
4. 위 3가지가 합쳐지면 DB 서버 전체가 느려지고, 연쇄적으로 웹 서버까지 크래시

### 안전한 방법: 배치 분할 + autocommit

```sql
-- START TRANSACTION으로 감싸지 않는다!
-- autocommit 모드에서 각 UPDATE가 즉시 커밋됨

UPDATE target_table
SET column = new_value
WHERE <조건>
LIMIT 50000;
-- 0 rows affected 나올 때까지 반복 실행
```

**핵심 원칙**:
- `START TRANSACTION` 사용 금지 — autocommit으로 각 배치가 즉시 커밋되어야 함
- `LIMIT`으로 배치 크기 제한 (1만~5만 권장)
- 각 배치 실행 후 lock 해제 + undo log 정리 → DB 서버 부하 분산
- 0 rows affected 나올 때까지 동일 쿼리 반복 실행

### 배치 분할이 가능한 조건

- UPDATE의 SET 절이 **멱등(idempotent)** 해야 함 (이미 변경된 row를 다시 UPDATE해도 같은 결과)
- WHERE 조건이 변경 후에도 동일한 row를 계속 매칭하면 무한루프 → WHERE에 변경 전 값 조건 추가:

```sql
-- 잘못된 예: 무한루프
UPDATE t SET status = 'DONE' WHERE type = 'A' LIMIT 1000;

-- 올바른 예: 변경된 row는 더 이상 매칭 안 됨
UPDATE t SET status = 'DONE' WHERE type = 'A' AND status != 'DONE' LIMIT 1000;
```

### 배치 분할 체크리스트

- [ ] 대상 건수 사전 조회 (SELECT COUNT)
- [ ] 배치 크기 결정 (1만~5만)
- [ ] WHERE 조건에 멱등성 보장 조건 포함
- [ ] `START TRANSACTION` 미사용 확인 (autocommit)
- [ ] 트래픽 적은 시간대 실행 권장 고지

---

## INSERT IGNORE의 함정 (silent failure)

> **실제 사고**: UNIQUE 제약 충돌 시 `INSERT IGNORE`는 에러 없이 그 row만 스킵. 1,830건 넣으려는데 정규식 검증 안 했더라면 1,500건 누락이 그대로 dev DB로 갔을 케이스.

### 위험한 상황

```sql
INSERT IGNORE INTO category (code, name) VALUES (...);
-- 결과: "1830 rows affected" 같이 보이지만, UNIQUE 충돌로 실제론 330건만 INSERT됨
-- 에러 안 나오니까 그냥 넘어감 → 사일런트 데이터 누락
```

### 안전한 사용

- INSERT IGNORE 후 반드시 **카운트 비교**:
  ```sql
  -- 실행 전
  SELECT count(*) FROM source;        -- 예: 1830
  -- 실행 후
  SELECT count(*) FROM target;        -- 1830이어야 함, 다르면 IGNORE된 것
  ```
- 또는 `INSERT ... ON DUPLICATE KEY UPDATE` 사용 — 명시적 충돌 처리
- DELETE + INSERT 패턴이 더 안전한 케이스 많음

---

## 데드락 회피 (gap lock)

> **3/24 프로덕션 장애**: 동시 INSERT가 InnoDB의 gap lock을 서로 잡으려다 데드락 발생.

### 일반적 원인

- AUTO_INCREMENT 테이블에서 동시 INSERT
- 한 트랜잭션이 DELETE 후 INSERT, 다른 트랜잭션이 INSERT만 (서로 다른 gap을 lock)

### 회피 방법

1. **불필요한 락 제거** — "동시 접근 시나리오가 실제로 발생하는가?" 먼저 검증
   - 개인 itinerary처럼 한 유저만 건드리는 데이터는 락 불필요
2. **retry 로직** — gap lock 데드락은 짧고 일시적 → MySQL 자동 retry로 해결 가능 (어플리케이션 레벨에서 max 3회)
3. **트랜잭션 격리 수준 검토** — `READ COMMITTED`로 낮추면 gap lock 비활성화 (대신 phantom read 허용)

### 트레이드오프

- 락 추가 = 데드락 위험 ↑, 정합성 ↑
- 락 제거 = 데드락 위험 ↓, 동시성 ↑, 정합성 책임이 비즈니스 로직으로 이동

**원칙**: "안전하게 항상 락 걸자"는 부주의한 결정. 데이터의 소유 특성과 동시 접근 시나리오를 먼저 따져본다.

---

## bulkCreate + updateOnDuplicate (ORM 최적화)

> **PR 리뷰에서 배운 패턴**: 건건 UPDATE를 N번 부르지 말고, 한 번의 set-based 쿼리로.

### Before (N번 DB 호출)

```typescript
for (const item of items) {
  await Item.update({ status: 'DONE' }, { where: { id: item.id } });
}
// 100건이면 DB 100번 왕복
```

### After (1번 DB 호출)

```typescript
await Item.bulkCreate(
  items.map(i => ({ id: i.id, status: 'DONE' })),
  { updateOnDuplicate: ['status'] },
);
// 단일 INSERT ... ON DUPLICATE KEY UPDATE
```

또는 raw SQL:

```sql
INSERT INTO items (id, status)
VALUES (1, 'DONE'), (2, 'DONE'), ..., (100, 'DONE')
ON DUPLICATE KEY UPDATE status = VALUES(status);
```

---

## 트레이드오프 프레이밍 원칙

데이터가 있는 테이블에 쓰는 작업은 **본질적으로 트레이드오프가 동반됨** (FK 충돌, PK 중복, CASCADE 연쇄, 의미 불일치 등). 이건 "치명적 위험"이 아니라 **정상적인 의사결정 대상**이다.

### 하지 말 것

- ❌ "치명적 이슈", "심각한 데이터 손실", "이대로 실행하면 큰일" 같은 과장 프레이밍
- ❌ 혼자 "이건 위험하니 중단해야 합니다"로 결론내리기
- ❌ 대안 A/B/C 늘어놓고 "권장은 B입니다" 하고 끝내기 (사용자가 선택해야 할 문제)

### 할 것

- ✅ 발견한 트레이드오프를 **사실 그대로** 서술: "X 테이블에 N건 CASCADE 연결됨. 이대로 DELETE하면 N건도 삭제됨"
- ✅ 수용 가능한지/변경 가능한지 **사용자에게 질문**으로 넘기기
- ✅ 선택지별 결과를 **구체적 숫자로** 제시 (추상적 "위험" 표현 금지)

---

## AskUserQuestion 활용

사전 조사 중 **사용자 판단이 필요한 결정 포인트**가 생기면, 스크립트를 완성하기 전에 `AskUserQuestion` 툴로 물어본다.

### 언제 쓰나

1. **참조 충돌 처리 방향**: FK CASCADE/NO ACTION/SET NULL 중 어느 동작을 허용할지
2. **기존 데이터 처리**: 덮어쓰기 vs 유지 vs 병합 중 어느 방침인지
3. **의미 불일치 수용 여부**: "type은 바뀌지만 연결된 다른 테이블은 그대로" 같은 상황 허용 여부
4. **실행 범위 축소 옵션**: "충돌 없는 것만 동기화" vs "충돌 포함 전체 동기화"
5. **백업/롤백 정책**: 백업 테이블 생성 여부, 유지 기간

### 작성 가이드

- 한 질문당 옵션 **2~4개**, 각 옵션은 한 줄로 명확히
- 옵션에 **구체적 숫자와 결과**를 담기 (예: "legal_location 49건 유지 — 의미 불일치 있음" vs "legal_location 49건 DELETE — 데이터 소실")
- 여러 결정 포인트는 `questions` 배열에 한 번에 묶기

---

## SQL 작성 함정 (실전 교훈)

### WHERE 조건 누락/실수

- **UPDATE/DELETE에 WHERE 절 절대 빠지면 안 됨** — 전체 테이블 영향
- 테스트용으로 쓴 `WHERE id = 1`이 그대로 남지 않았는지 재확인
- enum/status 문자열 대소문자 확인
- IN 리스트 값·길이 재확인

### MySQL 8 예약어 회피

alias/컬럼명으로 쓰지 않기:
- `year_month` (INTERVAL 키워드와 충돌 → TS1064 SQL syntax error)
- `rank`, `window`, `row`, `interval`
- 대체: `sales_ym`, `row_no` 등 도메인 prefix

### 대량은 set-based로

- 수천 row 이상은 단일 SQL로 작성 (`UPDATE t1 JOIN t2 ON ... SET ...`)
- 클라이언트에서 loop 돌리는 SQL 제공 금지 — 사용자가 DBeaver에서 수동 반복 실행하게 됨

### 롤백 쿼리 동봉

- UPDATE: 실행 전 백업 테이블 생성 가이드
```sql
CREATE TABLE backup_target_YYYYMMDD AS
SELECT id, column FROM target_table WHERE <조건>;
```
- DELETE: status 컬럼이 있으면 `UPDATE ... SET status = 'DELETED'` 권장 (soft delete)

### Idempotency

사용자가 실수로 두 번 돌릴 가능성 고려:
- `UPDATE ... WHERE col = old_value` — 이미 new_value면 0 rows affected
- `INSERT IGNORE` + UNIQUE 제약 (단, 위 함정 주의)
- `INSERT ... ON DUPLICATE KEY UPDATE`

---

## 주의사항

- DBA MCP(SELECT only)로 먼저 현재 상태를 확인한 후 SQL을 작성
- 대량 작업(100건 이상)은 배치 단위로 나누는 것을 고려
- DROP/TRUNCATE 등 비가역 작업은 반드시 사용자에게 경고
- 운영 DB 접속정보를 이 세션에 노출하지 않음
- 트래픽 적은 시간대 실행 권장 (대량 UPDATE의 경우)

---

## 전달 전 체크리스트

- [ ] 사전 SELECT로 영향 범위 숫자 확인했나
- [ ] WHERE 조건 재검증 (빠짐/오타/대소문자) 했나
- [ ] **1만 건 이상이면 배치 분할 적용했나**
- [ ] **배치 분할 시 START TRANSACTION 미사용 확인했나**
- [ ] 소량일 때만 BEGIN/COMMIT 블록으로 감쌌나
- [ ] 롤백 방법 명시했나
- [ ] 예약어 alias 없나
- [ ] 재실행 안전한가
- [ ] UPDATE/DELETE에 WHERE 있나
- [ ] INSERT IGNORE 사용 시 카운트 비교 검증 포함했나
- [ ] 트레이드오프를 "위험"이 아닌 "결정 포인트"로 서술했나
- [ ] 사용자 결정이 필요한 지점은 AskUserQuestion으로 물었나
- [ ] **실행 기록 로그에 기록했나**

---

## 실행 기록 로그 (필수)

**작업 완료 시 반드시 로그를 남길 것.** 이 단계를 건너뛰면 안 됨.

db-write-migration과 공유 기록 파일: `docs/db-write-log.local.md` (.gitignore 포함)

작업 시작 전에도 이 파일을 읽어서 유사 사례를 참고할 것.

기록 후 Notion 동기화 필수 — 상세 규칙: `docs/db-write-log.sync.local.md` 참조
