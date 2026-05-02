---
name: db-write-migration
description: 백엔드 서비스(trip/payment/language-school)의 마이그레이션 디렉토리에 파일을 작성하고 pnpm migration:run으로 실행·검증하는 워크플로우. DDL/대량 백필/배포 시 자동 반영되어야 하는 모든 DB 변경. set-based SQL, idempotency, down() 작성, Step 3.5 사용자 승인 게이트, dev 검증.
---

# DB Write Migration (백엔드 서비스별 마이그레이션)

각 서비스의 마이그레이션 디렉토리에 파일을 작성하고
AI가 직접 `pnpm migration:run`으로 실행·검증까지 수행하는 워크플로우.

## 사용 시점

- DDL: CREATE/ALTER/DROP TABLE, INDEX
- 대량 데이터 백필 / 상태 전환
- 배포 시 자동 반영되어야 하는 모든 DB 변경

## 사용 안 하는 경우

- 사람이 DBeaver로 일회성 SQL 돌리기 → `db-write` 스킬
- `backend/tools/database-migration/` (Knex) — 로컬 .env가 reader endpoint로 설정돼 있어 현재 write 불가
- MongoDB(stay), Elasticsearch(search) — 프레임워크가 달라 별도 스킬/절차

## 지원 서비스 & 프레임워크

| 서비스 | 프레임워크 | 마이그레이션 경로 | 파일 확장자 |
|---|---|---|---|
| **trip** | Sequelize | `backend/apps/trip/migrations/` | `.js` |
| **payment** | TypeORM | `backend/apps/payment/src/migrations/` | `.ts` |
| **language-school** | TypeORM | `backend/apps/language-school/src/Shared/Infrastructure/Persistence/Migrations/` | `.ts` |

공통 원칙(set-based SQL, idempotency, down() 작성, 사전 조사, Step 3.5 승인 게이트)은 세 서비스 모두 동일하게 적용. 문서 내 예시/명령어는 trip Sequelize 기준이므로, payment/language-school 사용 시 TypeORM `MigrationInterface` 포맷과 `pnpm migration:generate` 경로만 해당 서비스에 맞게 바꾸면 됨.

**대상이 아닌 서비스:**
- **stay** — MongoDB + `migrate` CLI 사용. 별도 절차 필요.
- **search** — Elasticsearch 기반. 인덱스 버저닝/리인덱스/alias cutover 패턴으로 별도 작업.

---

## 단계별 워크플로우

### Step 1. 대상 파악 (작성 전 필수)

무작정 코드부터 짜면 예약어·규모·조건 실수로 되돌아오게 됨. **먼저 현재 DB 조회**.

```bash
# 규모 확인
creatrip-db debug query "SELECT COUNT(*) FROM <대상> WHERE <조건>" --env dev

# 샘플 확인
creatrip-db debug query "SELECT * FROM <대상> WHERE <조건> LIMIT 5" --env dev

# prod 규모도 체크 (배포 시 소요 시간 가늠)
creatrip-db debug query "SELECT COUNT(*) FROM <대상> WHERE <조건>" --env prod
```

결과를 사용자에게 공유하고 "대상 N건, prod 기준 예상 소요 ~초" 보고.

### Step 2. 마이그레이션 파일 생성

```bash
# trip (Sequelize)
cd backend/apps/trip
pnpm migration:generate --name <descriptive-name>

# payment (TypeORM)
cd backend/apps/payment
pnpm migration:generate --name=<descriptive-name>

# language-school (TypeORM)
cd backend/apps/language-school
pnpm migration:generate --name=<descriptive-name>
```

산출물:
- trip: `backend/apps/trip/migrations/YYYYMMDDHHMMSS-<name>.js`
- payment: `backend/apps/payment/src/migrations/<timestamp>-<name>.ts`
- language-school: `backend/apps/language-school/src/Shared/Infrastructure/Persistence/Migrations/<timestamp>-<name>.ts`

(CLI 기본 생성 파일명에 불필요한 `,` 접두사 들어가는 경우 있음 → `mv`로 정리)

### Step 3. 스크립트 작성 원칙

#### A) Set-based SQL 필수 (for loop 금지)

대량 데이터 처리는 **INSERT ... SELECT 또는 단일 UPDATE ... JOIN**으로.

```js
// ❌ 이러면 3,895 그룹 × 5 roundtrip = 24분
for (const group of groups) {
  await sequelize.query('SELECT ...');
  await sequelize.query('INSERT ...');
}

// ✅ 단일 set-based 쿼리 = 19초 (75배 빠름)
await sequelize.query(`
  INSERT INTO target (col1, col2)
  SELECT col1, col2 FROM source
  WHERE ...
    AND NOT EXISTS (SELECT 1 FROM target WHERE ...)
  GROUP BY ...
`);
```

TypeORM은 `queryRunner.query('...')`로 동일하게 실행 가능.

배포 블록 최소화 목표: **2분 이내로 끝나도록**.

#### B) Idempotency (재실행 안전성)

- INSERT: `NOT EXISTS` 절 또는 `INSERT IGNORE` + UNIQUE 제약
- UPDATE: 이미 새 값인 row 제외하는 WHERE (`WHERE col = old_value`)
- DELETE (down): 스크립트가 만든 것만 정확히 식별할 마커 필요
  - 예: `created_by IS NULL` (시스템 백필 표시)
  - 예: `period_end < '<기준일>'`

> **INSERT IGNORE 함정 주의**: UNIQUE 충돌 시 silent skip 발생. 카운트 비교로 검증 필수.

#### C) MySQL 8 예약어 주의

alias·컬럼명으로 사용 금지:
- `year_month` (INTERVAL 키워드와 충돌) — `sales_ym` 등으로
- `rank`, `window`, `row`, `interval`
- 의심되면 백틱 감싸기보다 **이름 자체 변경** 권장

#### D) down() 롤백 쿼리 반드시 작성

`pnpm migration:run:undo`가 이 블록을 실행. 스크립트로 만든 레코드만 정확히 되돌릴 조건 필요.

### Step 3.5. 초안 검토·승인 (실행 전 필수 게이트)

**Step 4 실행 전 반드시 사용자에게 확인받고 승인을 받아야 함.**

사용자에게 제시할 것:
- 생성한 파일 경로
- up() / down() 핵심 SQL 요약 (full 파일 링크 포함)
- 사전 조사(Step 1)에서 나온 영향 규모와 일치하는지 교차 확인
- 예상 실행 시간

"이 초안으로 `pnpm migration:run` 진행할까요?" 질문으로 끝맺고
**명시적 승인(진행/네/OK 등) 전에는 Step 4를 실행하지 않음.**

사용자가 수정 요청하면 Step 3로 돌아가서 반영 후 다시 Step 3.5로.

### Step 4. dev 실행 & 검증

```bash
# 해당 서비스 디렉토리로 이동 후
pnpm migration:run
```

- 각 서비스의 `.env`의 `DATABASE_HOST`(writer endpoint) 사용 → write 가능
- pending migration만 실행. 이미 적용된 건 skip.

**실행 중 진행 확인**:
stdout 버퍼링으로 로그가 안 보이면 DB에 직접 카운트 쿼리:
```bash
creatrip-db debug query "SELECT COUNT(*) FROM <target>" --env dev
```

### Step 5. 사후 검증

```bash
# 카운트 비교
creatrip-db debug query "SELECT COUNT(*) FROM <target>" --env dev
# 기대값: Step 1 사전 조사에서 예상한 수치

# 샘플 확인
creatrip-db debug query "SELECT * FROM <target> ORDER BY id LIMIT 3" --env dev
creatrip-db debug query "SELECT * FROM <target> ORDER BY id DESC LIMIT 3" --env dev
```

### Step 6. 재실행이 필요한 경우

이미 기록된 마이그레이션은 그냥 `pnpm migration:run`으로 다시 안 돎.

**Sequelize (trip)** — `SequelizeMeta` 테이블 사용:
```bash
cd backend/apps/trip
npx sequelize-cli db:migrate:undo --name <YYYYMMDDHHMMSS-name>.js
pnpm migration:run
```

**TypeORM (payment, language-school)** — `migrations` 테이블 사용:
```bash
cd backend/apps/<service>
pnpm typeorm migration:revert  # 마지막 applied만 되돌림
pnpm migration:run
```

둘 다 마지막 applied를 undo하면 다른 사람의 migration이 롤백될 수 있으니 로그 확인 필수.

### Step 7. 커밋 + 로그 기록

검증 통과 후에만 커밋. 커밋 후에는 이 스킬 하단의 **실행 기록 로그**에 한 줄 추가.

---

## v2 마이그레이션 전략 (대규모 스키마 변경)

> **2026-04-22 카테고리 v2 → v1 롤백 사례**: 4단계 무중단 스키마 마이그레이션을 직접 완주한 경험.

### Expand → Migrate → Switch → Contract

```
1. Expand
   - 새 v2 테이블/컬럼 추가
   - 기존 v1은 그대로 유지
   - 양쪽 다 쓰기 가능 (dual write)

2. Migrate
   - 기존 v1 데이터를 v2로 복사 (마이그레이션)
   - 양쪽 다 읽기/쓰기 (검증 단계)
   - 데이터 일관성 모니터링

3. Switch
   - 읽기를 v2로 전환
   - 일정 기간 v1도 백업으로 유지
   - 문제 시 즉시 롤백

4. Contract
   - v1 dual write 중단 (v2만 쓰기)
   - 일정 기간 후 v1 테이블 DROP
   - 백업 테이블 정리
```

### 핵심 가치

- **무중단**: 각 단계 완료 후 다음 단계로 진행 가능
- **롤백 가능**: 문제 시 이전 단계로 돌아갈 수 있음
- **부분 실패 허용**: 한 단계 실패해도 전체 시스템 안정

---

## AWS Aurora endpoint 주의

증상 `ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION` (errno 1792):
- 접속한 endpoint가 **reader** (`.cluster-ro-<id>...`)이라 write 불가
- Writer는 `-ro` 없음 (`.cluster-<id>...`)
- **해결**: 각 서비스의 공식 마이그레이션 프레임워크(Sequelize/TypeORM)를 쓰면 해당 앱의 `.env`의 writer endpoint 사용. Knex(tools/database-migration)는 .env가 reader일 가능성 있어 write 실패

---

## 커밋 전 체크리스트

- [ ] **Step 1 수행**: 사전 조사로 대상 규모·샘플 확인
- [ ] **Set-based SQL**: for loop 없음, 단일 SQL로 대량 처리
- [ ] **Idempotency**: 재실행 시 NOT EXISTS / IGNORE / 이미-처리 WHERE로 중복 방지
- [ ] **예약어 회피**: `year_month` 등 MySQL 8 예약어 alias 없음
- [ ] **down() 명확**: 스크립트가 만든 것만 정확히 되돌림
- [ ] **Step 3.5 사용자 승인**: 초안 검토받고 진행 지시 획득
- [ ] **dev 실행 성공**: `pnpm migration:run` 실제로 돌려서 에러 없이 완료
- [ ] **dev 검증**: 사후 카운트/샘플이 기대값과 일치
- [ ] **재실행 안전성**: undo + run 해도 동일 결과
- [ ] **예상 소요 < 2분**: prod 규모 대입해도 배포 블록 부담 없음
- [ ] **외부 부작용 없음**: 이메일·람다·슬랙 호출 등 없음
- [ ] **실행 기록 업데이트**: 스킬 하단 로그에 항목 추가

---

## 흔히 놓치는 함정

| 함정 | 증상 | 예방 |
|---|---|---|
| for loop 순차 처리 | 수십 분 소요, 배포 타임아웃 | set-based SQL |
| `year_month` alias | `TS1064 SQL syntax error` | `sales_ym` 등 다른 이름 |
| Knex(tools) 경로로 write 시도 | `ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION` | 각 서비스의 공식 프레임워크(Sequelize/TypeORM) 사용 |
| `migrate:undo`만 실행 | 엉뚱한 migration 롤백 | Sequelize는 `--name` 명시, TypeORM은 로그 확인 후 revert |
| down()이 다른 레코드까지 삭제 | 관련 없는 데이터 유실 | 시스템 백필 마커(`created_by IS NULL`) 활용 |
| 초안만 짜고 커밋 | prod에서 실패 발견 | dev에서 반드시 실행 + 검증 후 커밋 |
| 승인 없이 실행 | 사용자가 의도와 다른 결과 발견 시 되돌리기 부담 | Step 3.5 게이트 반드시 거치기 |
| stay/search에 본 스킬 적용 | 프레임워크 불일치로 실패 | stay(MongoDB)/search(ES)는 범위 밖 — 별도 절차 필요 |
| INSERT IGNORE silent skip | UNIQUE 충돌 시 일부 데이터 누락 | 카운트 비교로 검증 |

---

## 레퍼런스

Sequelize(trip) 예시: `backend/apps/trip/migrations/20260420002405-backfill-settlement-batch-before-2026-04.js`
- set-based INSERT ... SELECT 2개
- NOT EXISTS + INSERT IGNORE 멱등성
- created_by IS NULL + period 조건으로 정확한 down()
- 14만 대상 19초 완료

TypeORM(payment) 패턴: `backend/apps/payment/src/migrations/` 하위 기존 파일
- `implements MigrationInterface`
- `public async up(queryRunner: QueryRunner)` / `down(queryRunner)`
- 내부에서 `await queryRunner.query(\`...\`)`

---

## 실행 기록 로그 (필수)

**작업 완료 시 반드시 로그를 남길 것.** 이 단계를 건너뛰면 안 됨.

기록 파일: `docs/db-write-log.local.md` (.gitignore 포함)

기록 형식:
```
### YYYY-MM-DD 작업 제목
- **스킬**: db-write | db-write-migration
- **서비스**: trip | payment | language-school
- **대상**: 테이블명 (N건)
- **작업**: 한줄 요약
- **핵심 패턴**: 사용한 SQL 패턴
- **소요**: N초/분
- **교훈**: 다음에 참고할 점 (선택)
```

이 로그는 이후 비슷한 작업 시 레퍼런스로 활용됨. 작업 시작 전에도 이 파일을 읽어서 유사 사례를 참고할 것.

기록 후 Notion 동기화 필수 — 상세 규칙: `docs/db-write-log.sync.local.md` 참조
