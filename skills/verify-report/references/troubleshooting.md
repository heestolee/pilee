# Verify Report — 트러블슈팅

자주 깨지는 케이스 + 표준 복구 절차. 매번 즉흥 처리하지 말고 이 순서대로.

## agent-browser daemon 깨짐

### 증상
- `agent-browser screenshot` 호출 시 `EPIPE`, `ECONNREFUSED`, `Cannot find session`
- 같은 명령 반복했는데 갑자기 실패
- `agent-browser open`이 영원히 응답 안 함

### 표준 복구 절차

```bash
# 1. 현재 daemon 상태 확인
agent-browser status 2>&1
ls /tmp/agent-browser-* 2>/dev/null

# 2. 관련 세션 모두 종료
agent-browser close-all --session {session} 2>/dev/null || true

# 3. daemon 강제 종료
pkill -f "agent-browser" || true
sleep 1

# 4. 동일 세션 이름으로 재시작
agent-browser open {url} --session {session}
agent-browser wait 3000 --session {session}
```

> **세션 이름은 즉흥 작명 금지** — `report-admin`, `report-web` 같은 표준 이름 유지. 매번 새 이름 만들면 daemon 누적되어 더 깨짐.

### 그래도 실패하면

```bash
# 모든 daemon socket 정리
rm -rf /tmp/agent-browser-* 2>/dev/null
pkill -9 -f agent-browser
sleep 2
# 새로 시작
agent-browser install  # 한 번만, 이미 했으면 생략
agent-browser open {url} --session {session}
```

## ffmpeg GIF 깨짐

### 증상
- `Invalid data found when processing input`
- 프레임 누락된 GIF
- 검은 화면만 나오는 GIF

### 원인 + 해결

| 원인 | 확인 | 해결 |
|------|------|------|
| 프레임 파일 누락 | `ls *-frame-*.png \| wc -l` | 누락 프레임 다시 캡처 |
| 프레임 번호 비연속 | `ls *-frame-*.png` 출력 확인 | 번호 재정렬 또는 `-i %*d.png` 패턴 변경 |
| 프레임 크기 다름 (스크롤 후 등) | 크기 비교 | 동일 viewport에서 캡처 |
| ffmpeg 미설치 | `which ffmpeg` | `brew install ffmpeg` |

## .context/work/ 디렉토리 충돌

### 증상
- 다른 작업의 캡처 파일이 섞여 있음
- `report.html`이 이전 캡처 잔여물

### 해결

**confirm 모드 시작 시 자동 정리** (옵션 — 사용자 확인 권장):
```bash
# 기존 캡처 보존하고 진행하려면 SKIP, 새로 시작하려면 정리
ls .context/work/{workspace}/captures/ 2>/dev/null
```

AskUserQuestion으로:
```
기존 캡처 파일이 있습니다 ({count}개). 어떻게 처리할까요?

옵션:
- 보존하고 추가 (update 모드 권장)
- 모두 삭제하고 새로 시작
- 그대로 두고 새 파일만 생성
```

## 로그인 세션 만료

### 증상
- `agent-browser` 세션이 로그아웃 페이지로 리다이렉트
- "이 페이지를 볼 권한이 없습니다" 메시지 캡처됨

### 해결

```bash
# 세션 재로그인
agent-browser open {login-url} --session {session}
agent-browser fill "input[name='email']" "{credential.email}" --session {session}
agent-browser fill "input[name='password']" "{credential.password}" --session {session}
agent-browser click "button:has-text('로그인')" --session {session}
agent-browser wait 3000 --session {session}
```

세션은 daemon이 살아있는 한 쿠키 유지. 단, 서버 만료 시간이 있으면 재로그인 필요.

## 동일 항목 여러 번 재캡처되는 경우

### 증상
- 사용자가 "캡처 v1, v2, v3..." 만들면서 통째 재작성

### 예방

`update` 모드 또는 `--ask-before` 모드 활용:
- 사용자 푸시백 ("이거 좀 다르게") → **재캡처 항목만 식별** → 그 항목만 다시 (전체 재작성 X)
- 변경 없는 항목은 그대로 보존

## project artifact storage 업로드 충돌

### 증상
- `409 Conflict` 또는 `422 Unprocessable Entity` (sha 불일치)
- `Validation Failed` (파일 크기/형식)

### 해결

[upload-scripts.md](upload-scripts.md)의 sha 조회 + 추가 절차 따라.

500KB 이상은 반드시 `--input` 방식 (CLI 인자 크기 제한).

## report.html이 GitHub에서 안 보임

### 증상
- private repo의 `?raw=true` URL 직접 열면 인증 페이지

### 해결
업로드 전 base64 data URI 임베딩 — [upload-scripts.md](upload-scripts.md) 참조.
