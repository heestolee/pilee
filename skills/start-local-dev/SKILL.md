---
name: start-local-dev
description: 로컬 개발 서버를 시작하거나 포트 충돌, stale process, 환경변수/서비스 연결 문제를 진단할 때 사용. 특정 회사/레포의 포트·명령·서비스 의존성은 project/private overlay 스킬을 우선 따른다.
---

# Start Local Dev

로컬 개발 서버를 진단 가능하게 시작하기 위한 범용 절차다.

> 특정 레포 전용 명령과 고정 포트가 있으면 해당 project/private skill을 사용한다.

## 원칙

- 실행 전 포트 충돌을 확인한다.
- dev server가 fallback port로 떠서 앱 연결이 깨지는지 확인한다.
- 기존 프로세스를 죽일 때는 사용자 의도를 확인한다.
- 서비스 간 의존성이 있으면 한쪽만 local이고 다른 쪽은 remote/dev인 상태를 의식적으로 선택한다.
- 로그 파일과 health endpoint로 readiness를 검증한다.

## Workflow

### 1. 요구 범위 확인

- frontend만인지, backend/API도 필요한지
- local dependency를 모두 띄울지, remote/dev backend를 볼지
- 특정 role/account/feature flag가 필요한지

### 2. 포트 점검

프로젝트의 고정 포트 목록이 있으면 먼저 확인한다.

```bash
lsof -nP -iTCP:<port> -sTCP:LISTEN
```

충돌 시 사용자에게 선택지를 제시한다.

- 기존 프로세스 유지
- 기존 프로세스 종료 후 새로 실행
- 중단 후 사용자가 수동 정리

### 3. 공식 start command 사용

레포 README/AGENTS/package scripts의 공식 명령을 우선한다. 개별 dev command를 직접 실행해 fallback port가 생기는 패턴은 피한다.

### 4. readiness 확인

- stdout/stderr 로그
- health check
- 브라우저 첫 화면/API ping
- 콘솔/네트워크 에러

### 5. 문제 발생 시

- stale lock/cache/process 정리
- env backup/restore 여부 확인
- service-to-service host가 local/dev 중 어디를 보는지 확인
- dependency install 상태 확인

## Output

완료 보고에는 다음을 포함한다.

- 실행 명령
- 떠 있는 URL/포트
- local/dev 연결 선택
- 확인한 로그/health evidence
- 남은 문제와 다음 진단 명령
