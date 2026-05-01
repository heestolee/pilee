---
name: start-local-dev
description: 로컬 개발 서버 (FE web/admin + BE) 시작하거나 실행 중 문제가 있을 때. "로컬 띄워줘", "개발 서버 시작" 같은 요청에 사용. creatrip product 모노레포 전용.
---

# Start Local Dev

프론트엔드(web/admin) + 백엔드(dev 또는 local router)를 빠르게 띄우는 스킬.

## 언제 사용하나

- "로컬 FE + 로컬 BE 같이 띄우기"
- "한 줄 명령으로 실행하고 싶다"
- "포트 충돌 났어"
- "router timeout 떴어"

## 고정 포트 (변경 불가)

product 레포는 **각 서비스가 고정 포트만 사용**해야 한다. 다른 포트로 fallback되면 네트워크 연결이 깨짐 (백엔드 CORS + 프론트 env가 특정 포트 가정).

### 프론트엔드
| 서비스 | 포트 | fallback 발생 시 |
|--------|------|-----------------|
| **web** (Next.js) | **5173** | 5174로 떨어지면 ❌ 네트워크 깨짐 |
| **admin** (Vite) | **3000** | 3001로 떨어지면 ❌ 네트워크 깨짐 |

### 백엔드 라우터
| 서비스 | 포트 | 비고 |
|--------|------|------|
| **router** (Apollo Federation) | **4000** | 모든 FE 요청의 진입점 |
| **supergraph** | **8088** | composition 서비스 |

### 로컬 서비스 (--backend:local 시)
| 서비스 | HTTP | gRPC |
|--------|------|------|
| **trip** | 17000 | 9090 |
| **payment** | 7004 | 9094 |
| **stay** | 7005 | 9095 |
| **search** | 7002 | 9092 |
| **language-school** | 7003 | 9093 |

### 아키텍처
```
FE (5173/3000)
  └→ Router (4000)
       ├→ trip local (17000)         ← spot, reservation, member, ...
       ├→ payment local (7004)        ← gRPC 9094로 trip과 통신
       ├→ stay local (7005)
       ├→ search local (7002)
       └→ language-school local (7003)
       (또는 dev URL로 우회)
```

**중요**: FE에서 backend 직접 호출 안 됨 (CORS). 반드시 Router(4000) 경유.

## 1단계: 포트 충돌 확인 (필수)

실행 전에 핵심 포트 점유 상태 확인:

```bash
for p in 3000 5173 4000 8088 7002 7003 7004 7005 17000 17001 17002 17003 17004 17005; do
  lsof -nP -iTCP:$p -sTCP:LISTEN
done
```

**중요**: `pnpm start`는 자체적으로 stale 프로세스를 정리하지만, 직접 `pnpm dev:web` 등을 실행하면 fallback이 일어남. 항상 `pnpm start` 사용.

점유된 포트가 있으면 바로 실행하지 말고 먼저 사용자에게 확인:

> 4000, 17000 포트에 이미 프로세스가 떠 있습니다. 기존 프로세스를 유지하고 진행할까요, 종료 후 다시 실행할까요?

3가지 옵션:
- 기존 프로세스 유지하고 그대로 진행
- 기존 프로세스 종료 후 새로 실행
- 이번 실행 중단, 사용자가 수동 정리

### 5173/3000 포트 fallback 절대 금지

만약 이전 vite/next 실행이 5174, 3001 등 fallback 포트를 사용 중이면 그 프로세스도 죽여야 함:

```bash
for p in 3001 3002 5174 5175; do
  pid=$(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null)
  [ -n "$pid" ] && echo "Killing fallback $pid on port $p" && kill -9 $pid
done
```

## 2단계: CLI 한 줄 실행

```bash
# FE(web) + 개발 서버(dev) 바라보기
pnpm start --frontend:web --backend:dev

# FE(web+admin) 동시 실행 + 개발 서버(dev)
pnpm start --frontend:web,admin --backend:dev

# FE(web) + 로컬 router(local) + trip만 로컬
pnpm start --frontend:web --backend:local --service:trip

# FE(web) + 로컬 router(local) + trip,payment 로컬
pnpm start --frontend:web --backend:local --service:trip,payment

# FE(web+admin) + 로컬 router(local) + trip 로컬
pnpm start --frontend:web,admin --backend:local --service:trip
```

## backend:local 옵션 규칙

- `--service`는 필수
- 지원 서비스: `trip`, `payment`, `stay`, `search`, `language-school`
- 콤마 구분: `--service:trip,payment`

## 문제 해결

### 0) 🔥 가장 흔한 이슈 — trip → payment 호출이 dev로 가는 문제

**원인**: 로컬 서비스가 **2개 이상**일 때만 서비스 간 .env가 자동 업데이트됨. `--service:trip` 처럼 1개만 띄우면 trip의 PAYMENT_GRPC_HOST는 dev URL 그대로 → trip이 dev payment를 호출.

**해결책**: 서비스 간 통신이 필요하면 **모두 한 번에 로컬로 띄우기**

```bash
# ❌ trip만 로컬 → payment 호출 시 dev로 연결됨
pnpm start --frontend:web --backend:local --service:trip

# ✅ trip + payment 둘 다 로컬 → trip의 .env가 자동으로 localhost:9094 가리킴
pnpm start --frontend:web --backend:local --service:trip,payment
```

**서비스 간 의존성 (자동 .env 업데이트 대상)**:
- `payment` → trip(gRPC), stay(gRPC), language-school(gRPC)
- `stay` → trip(gRPC), payment(gRPC/REST)
- `search` → trip(gRPC), language-school(gRPC)
- `language-school` → trip(gRPC), payment(gRPC)
- `trip` → payment(gRPC/REST), stay(gRPC), language-school(gRPC)

서로 호출하는 두 서비스는 반드시 함께 로컬로 띄우거나, 둘 다 dev 사용.

### 0-B) 비정상 종료 후 .env 잔존 백업

**증상**: 로컬 서비스가 떴는데도 dev로 호출되거나, 환경변수 이상함

**진단**:
```bash
# 백업 파일이 남아있으면 이전 실행이 비정상 종료된 것
ls backend/apps/*/.env.router-backup 2>/dev/null
```

**해결**:
```bash
# 백업으로 .env 복원 (안전)
for f in backend/apps/*/.env.router-backup; do
  [ -f "$f" ] && original="${f%.router-backup}" && mv "$f" "$original" && echo "Restored: $original"
done
```

### 0-C) 현재 .env 상태 진단

trip → payment 호출이 어디로 가는지 확인:
```bash
grep PAYMENT_GRPC_HOST backend/apps/trip/.env
```

- `localhost:9094` → ✅ 로컬 payment 호출
- `payment-...com` → ❌ dev payment 호출 (둘 다 로컬로 띄워야 함)

### 1) Router 기동 실패 / supergraph timeout

VPN 재연결 후 재시도하고, 그래도 안 되면 backend env 재생성:
```bash
cd backend && pnpm set-env
```

### 2) 로컬 서비스 로그 확인

```bash
tail -f backend/tools/local-router/.trip-server.log
tail -f backend/tools/local-router/.payment-server.log
tail -f backend/tools/local-router/.stay-server.log
tail -f backend/tools/local-router/.search-server.log
tail -f backend/tools/local-router/.language-school-server.log
```

### 3) 포트가 안 풀려서 자꾸 충돌

기존 프로세스 강제 종료:
```bash
# 모든 관련 포트의 프로세스 PID 찾아서 죽이기
for p in 4000 8088 7002 7003 7004 7005 17000 17001 17002 17003 17004 17005; do
  pid=$(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null)
  [ -n "$pid" ] && echo "Killing $pid on port $p" && kill -9 $pid
done
```

### 4) tmux orphan 프로세스

```bash
tmux ls 2>/dev/null
tmux kill-server 2>/dev/null  # 모든 tmux 세션 종료
```

### 5) Turbo daemon orphan 프로세스

`turbo` 빌드/watch가 종료 후에도 daemon 프로세스가 남아 다음 실행을 방해함. 증상: exit 143/144, 의문의 캐시 충돌.

```bash
# Turbo daemon 정리
turbo daemon clean 2>/dev/null
pkill -f "turbo.*daemon" 2>/dev/null

# turbo 관련 모든 프로세스 확인
ps aux | grep -E "turbo|pnpm" | grep -v grep
```

### 6) trip 백엔드 부팅 실패 — SWC 파싱 에러

**증상**: 60초 timeout, trip이 ready 상태 안 됨

**진단**: trip-server.log 확인 (보통 비어있거나 SWC 에러):
```bash
cat backend/tools/local-router/.trip-server.log

# log가 비었다면 stderr 확인
ls -la backend/tools/local-router/.trip-server.{log,err}
```

**자주 발생하는 원인**:
- TypeScript `satisfies` 키워드를 SWC가 못 파싱
- 테스트 파일(`*.spec.ts`)에 신문법 사용 → trip 컴파일 시 포함되어 fail

**해결**:
- 즉시 우회: `--service:trip` 빼고 dev로 trip 사용 (가능한 경우)
- 근본 해결: 문제 파일 찾아서 SWC가 지원하는 문법으로 수정 또는 빌드 설정 업데이트

### 7) 외부 webhook (Stripe 등) 처리

**증상**: 결제 완료해도 voucher 미발급, payment를 로컬로 띄워도 webhook은 dev backend로 감

**원인**: Stripe 등 외부 서비스의 webhook URL이 dev 환경에 고정 등록되어 있음. 로컬에서 결제하면 webhook이 dev로 가서 dev 코드가 실행됨.

**해결책**:

#### A. Stripe CLI listen + forward (권장)
```bash
# 별도 터미널에서
stripe login  # 한번만
stripe listen --forward-to localhost:7004/webhooks/stripe \
  --events payment_intent.succeeded,payment_intent.payment_failed,charge.refunded
```

이 명령이 webhook secret을 출력하면 `payment/.env`의 `STRIPE_WEBHOOK_SECRET`에 임시 저장 (커밋 X).

#### B. 마이그레이션 + dev 머지 후 검증 (대안)
풀 로컬 검증이 어려우면:
1. 코드 변경 PR 생성
2. dev에 머지
3. dev에서 실제 결제로 검증
4. 마이그레이션은 별도로 idempotency 테스트

### 8) 다중 워크스페이스 점유 진단

다른 conductor 워크스페이스가 동일 포트 점유 시 어디서 잡고 있는지 확인:

```bash
# 점유 프로세스의 cwd 확인
for p in 3000 4000 5173 17000 7004; do
  pid=$(lsof -nP -iTCP:$p -sTCP:LISTEN -t 2>/dev/null | head -1)
  [ -n "$pid" ] && echo "Port $p (PID $pid):" && lsof -p $pid 2>/dev/null | grep cwd | head -1
done
```

cwd가 현재 워크스페이스와 다르면 사용자에게 확인:
> 포트 4000을 다른 워크스페이스(`...damascus`)가 잡고 있어요. 그 쪽 종료 후 진행할까요?

### 9) 에이전트 환경(Bash 도구)에서 띄우기

pi 에이전트가 직접 `pnpm start`를 실행할 때:

- `pnpm start`는 **포그라운드 실행**이 정상 동작 → 에이전트의 Bash 도구는 timeout(보통 2~5분) 후 종료됨
- **반드시 백그라운드로 실행** (`run_in_background: true`):

```bash
# 에이전트가 직접 띄울 때
nohup pnpm start --frontend:web --backend:local --service:trip,payment \
  > /tmp/pnpm-start.log 2>&1 &
echo "PID: $!"
```

- 진행 상황은 별도 명령으로 폴링:
```bash
tail -50 /tmp/pnpm-start.log
ps -p <PID> > /dev/null && echo "running" || echo "stopped"
```

- **추천**: 에이전트가 띄우지 말고 사용자에게 "별도 터미널에서 실행해주세요"로 위임. 또는 `/fp right` 로 새 패널에서 실행.

## 수동 fallback (start 스크립트 미사용)

`pnpm start` 스크립트 이슈가 있거나 일부 서버만 띄워서 테스트해야 하는 부득이한 경우에만:

```bash
# 터미널 1: backend
cd backend && pnpm dev:router trip payment

# 터미널 2: web
cd frontend && pnpm dev:web:local 4000

# 또는 admin
cd frontend && pnpm dev:admin:local 4000
```

## 프로세스 라이프사이클 가이드

- **백그라운드 실행 금지** — `pnpm start &` 같은 백그라운드 실행은 로그 추적이 어려움
- **새 터미널/패널에서 실행** — `/fp right` 또는 새 Ghostty 탭으로 분리해서 실행 후 메인 패널에선 다른 작업
- **종료는 Ctrl+C 한 번** — 정상 종료. 두 번 누르면 강제 종료라 자식 프로세스가 좀비로 남을 수 있음
- **`pnpm dev:web`/`pnpm dev:admin` 직접 실행 금지** — port fallback 발생. 항상 `pnpm start` 통해서
