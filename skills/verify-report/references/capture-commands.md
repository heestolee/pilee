# Verify Report — 캡처 명령어

## 출력 디렉토리

**워크스페이스 안에 저장**: `.context/work/{workspace}/captures/`

```bash
mkdir -p .context/work/{workspace}/captures
```

> ⚠️ `/tmp/`는 사용 금지 — Edit 도구가 차단하고 휘발됨.

## 세션 관리

- **앱별 분리**: admin, web 별도 세션 — `--session report-admin`, `--session report-web`
- **역할별 분리**: 같은 앱이라도 역할이 다르면 별도 세션 — `--session report-admin-partner`, `--session report-admin-manager`
- **세션 이름 규칙**: `report-{app}[-{role}]` — 일관된 패턴 유지

## PNG 캡처 (단일 상태)

```bash
agent-browser open {url} --session {session}
agent-browser wait 2000 --session {session}
# 필요한 interaction (click, fill, scroll 등)
agent-browser screenshot .context/work/{workspace}/captures/{filename}.png --session {session}
```

## GIF 캡처 (다단계 플로우) — 고화질 설정

```bash
# 각 단계마다 프레임 캡처
agent-browser screenshot .context/work/{workspace}/captures/{항목}-frame-1.png --session {session}
# interaction...
agent-browser screenshot .context/work/{workspace}/captures/{항목}-frame-2.png --session {session}
# ...반복

# ffmpeg GIF 합성 — 고화질 설정 (sierra2_4a + 256색 + lanczos)
ffmpeg -framerate 1.5 -i .context/work/{workspace}/captures/{항목}-frame-%d.png \
  -vf "scale=1280:-1:flags=lanczos,split[s0][s1];[s0]palettegen=stats_mode=full:max_colors=256[p];[s1][p]paletteuse=dither=sierra2_4a" \
  -loop 0 \
  .context/work/{workspace}/captures/{항목}.gif

# 임시 프레임 파일 삭제
rm .context/work/{workspace}/captures/{항목}-frame-*.png
```

### GIF 화질 vs 용량 트레이드오프

| 설정 | 화질 | 용량 | 권장 |
|------|------|------|------|
| `bayer:bayer_scale=3` (이전) | 낮음 | 작음 | ❌ |
| `sierra2_4a` (현재 기본) | 높음 | 보통 | ✅ |
| `floyd_steinberg` | 매우 높음 | 큼 | 5초 미만 짧은 GIF만 |

용량 체크:
```bash
ls -lh .context/work/{workspace}/captures/{항목}.gif
```

GitHub PR/Issue 첨부 한도: **25MB**. 대부분 1280-wide GIF는 안 넘침.

만약 25MB 초과하면:
```bash
# 폭 줄이기
scale=960:-1
# 또는 palette 색상 축소
max_colors=128
# 또는 framerate 줄이기
-framerate 1
```

## 단일 프레임 인터랙션 패턴

자주 쓰는 패턴 모음 — agent-browser 명령:

```bash
# 페이지 진입 + 안정화
agent-browser open {url} --session {session}
agent-browser wait 2000 --session {session}

# 클릭
agent-browser click "button:has-text('추가')" --session {session}

# 입력
agent-browser fill "input[name='title']" "제목 텍스트" --session {session}

# 스크롤
agent-browser scroll-to "h2:has-text('설정')" --session {session}

# antd 모달 안에서 스크롤 (자주 헷갈림)
agent-browser scroll-element ".ant-modal-wrap" 200 --session {session}

# antd 드롭다운 항목 선택
agent-browser click ".ant-select-item:has-text('파트너')" --session {session}
```

## 에러 처리

- **재시도 1회** 자동
- 그래도 실패 시 → [troubleshooting.md](troubleshooting.md)의 daemon 복구 절차
- 복구 후에도 실패 시 해당 항목 SKIP 표시 (`결과: SKIP — daemon 복구 실패`)
