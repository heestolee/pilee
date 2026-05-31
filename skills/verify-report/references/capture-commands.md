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

## Crop / section evidence

Primary evidence는 검증 포인트가 바로 보이는 crop/section 이미지를 우선한다. full-page나 긴 스크롤 캡처는 supporting evidence로만 남긴다.

Playwright/브라우저 도구에서 element screenshot이 가능하면 먼저 사용한다. 이미 viewport/full-page PNG가 있을 때는 내장 helper로 잘라낸다.

```bash
# pilee checkout 안에서 실행하거나, 밖에서 실행할 때는 PILEE_DIR=/path/to/pilee 로 지정한다.
node "${PILEE_DIR:-.}/skills/verify-report/scripts/crop-png.mjs" \
  .context/work/{workspace}/captures/{source}.png \
  .context/work/{workspace}/captures/{항목}-primary-crop.png \
  --x 220 --y 360 --width 520 --height 680
```

좌표를 모르면 먼저 전체 PNG 크기를 확인한 뒤, 브라우저 devtools/이미지 뷰어로 대략 좌표를 잡고 한 번 crop → 확인 → 보정한다.

```bash
file .context/work/{workspace}/captures/{source}.png
```

긴 이미지를 보조로 남길 때 evidence label에 `supporting full-page` 또는 `전체 페이지 참고`를 명시한다. `verify_report_live`는 높이 1600px 이상 등 긴 이미지를 자동으로 접힌 토글에 넣는다.

## GIF 캡처 (다단계 플로우) — 고화질 설정

Flow/motion claim(이동, 전환, 클릭 후 화면 이동, 열림/닫힘, 스무스함)은 GIF/짧은 영상을 primary evidence로 둔다. 같은 item 안에 대표 final-state PNG/crop을 supporting evidence로 함께 남긴다.

### 품질 하한선

Primary GIF는 리뷰어가 텍스트와 색상을 판독할 수 있어야 한다. 기본 하한선은 다음과 같다.

- 길이: **3~8초**. 긴 cold-start/대기 시간은 잘라낸다.
- 폭: **원본 해상도 유지가 기본값**이다. Web/desktop을 900px 이하로 습관적으로 줄이지 않는다. 용량 때문에 줄여야 할 때만 `--max-width`를 쓰고, 텍스트가 읽히는지 확인한다.
- 프레임: 기본 **12fps**. 클릭/전환 흐름은 12~15fps, 단순 before/after 토글도 helper 기본값을 우선 사용한다.
- 색상: GIF는 256색 제한이 있으므로 **`palettegen` + `paletteuse` 필수**. `dither=sierra2_4a`를 기본으로 사용한다.
- 원본: 가능하면 원본 WebM/MP4도 supporting evidence로 함께 둔다.
- 기본 경로: 직접 `ffmpeg ... output.gif`를 손으로 작성하지 말고 `skills/verify-report/scripts/make-motion-gif.mjs` helper를 먼저 사용한다.

### WebM/MP4 원본 영상 → GIF

Playwright/브라우저/시뮬레이터가 원본 영상을 만들었다면, 바로 `scale=390` 같은 저해상도 GIF로 만들지 말고 helper 기본값을 사용한다. helper는 원본 해상도 유지, 12fps, 8초 trim, `palettegen/paletteuse`, `sierra2_4a` dithering을 기본으로 적용한다.

```bash
CAP=.context/work/{workspace}/captures
SRC="$CAP/{항목}.webm"   # 또는 .mp4
GIF="$CAP/{항목}.gif"

node "${PILEE_DIR:-.}/skills/verify-report/scripts/make-motion-gif.mjs" \
  --output "$GIF" \
  "$SRC"
```

필요하면 `--start <seconds>`와 `--duration <seconds>`로 핵심 구간만 남긴다. 25MB를 넘으면 먼저 길이를 줄이고, 그래도 크면 `--max-width 1440` 또는 `--fps 10`으로 낮춘다. 텍스트가 깨지면 폭을 더 줄이지 말고 구간을 더 짧게 자른다.

### 프레임 PNG → GIF

```bash
# 각 단계마다 프레임 캡처
agent-browser screenshot .context/work/{workspace}/captures/{항목}-frame-1.png --session {session}
# interaction...
agent-browser screenshot .context/work/{workspace}/captures/{항목}-frame-2.png --session {session}
# ...반복

# helper GIF 합성 — 원본 해상도 유지 + palette 최적화
node "${PILEE_DIR:-.}/skills/verify-report/scripts/make-motion-gif.mjs" \
  --output .context/work/{workspace}/captures/{항목}.gif \
  --frames \
  .context/work/{workspace}/captures/{항목}-frame-1.png \
  .context/work/{workspace}/captures/{항목}-frame-2.png

# 임시 프레임 파일 삭제
rm .context/work/{workspace}/captures/{항목}-frame-*.png
```

### GIF 화질 vs 용량 트레이드오프

| 설정 | 화질 | 용량 | 권장 |
|------|------|------|------|
| 직접 `ffmpeg ... output.gif` / no-palette | 낮음 | 작음 | ❌ |
| `bayer:bayer_scale=3` | 보통 | 작음 | 보조 thumbnail만 |
| `sierra2_4a` (helper 기본) | 높음 | 보통 | ✅ |
| `floyd_steinberg` | 매우 높음 | 큼 | 5초 미만 짧은 GIF만 |

용량 체크:
```bash
ls -lh .context/work/{workspace}/captures/{항목}.gif
```

GitHub PR/Issue 첨부 한도: **25MB**. helper 기본값은 원본 폭을 유지하므로, 용량이 크면 먼저 구간을 줄이고 그다음 `--max-width`를 적용한다.

만약 25MB 초과하면:
```bash
# 먼저 구간 줄이기
--duration 4
# 그래도 크면 최대 폭만 제한
--max-width 1440
# 또는 palette 색상 축소
--colors 128
# 또는 framerate 줄이기
--fps 10
```

## iOS Simulator GIF 캡처 — simctl recordVideo + helper

앱 딥링크, native tab 이동, modal transition처럼 브라우저 frame screenshot으로 흐름을 닫기 어려운 경우 `simctl recordVideo`로 mp4를 만들고 helper로 GIF를 만든다.

```bash
CAP=.context/work/{workspace}/captures
UDID=$(xcrun simctl list devices booted | awk -F'[()]' '/iPhone/ {print $2; exit}')
APP_ID=com.example.app
TARGET_URL='myapp://example/path?foo=bar'
MP4="$CAP/{항목}.mp4"
GIF="$CAP/{항목}.gif"

xcrun simctl io "$UDID" recordVideo --codec=h264 --force "$MP4" &
REC_PID=$!
sleep 1
xcrun simctl openurl "$UDID" "$TARGET_URL"
sleep 8
kill -INT "$REC_PID" || true
wait "$REC_PID" || true

node "${PILEE_DIR:-.}/skills/verify-report/scripts/make-motion-gif.mjs" \
  --output "$GIF" \
  --fps 12 \
  --duration 8 \
  "$MP4"

# 대표 final-state PNG도 supporting evidence로 남긴다.
xcrun simctl io "$UDID" screenshot "$CAP/{항목}-final.png"
```

긴 cold-start flow는 먼저 `--start`/`--duration`으로 자른다. 그래도 너무 크면 `--max-width 720` 또는 `--fps 10`을 쓰되, 텍스트가 깨지면 폭을 더 줄이지 말고 구간을 더 짧게 자른다. 리포트에는 GIF를 `role: primary`, final PNG를 `role: supporting`으로 넣는다.

## Android Emulator GIF 캡처 — screenrecord + helper

```bash
CAP=.context/work/{workspace}/captures
MP4="$CAP/{항목}.mp4"
GIF="$CAP/{항목}.gif"

adb shell screenrecord /sdcard/{항목}.mp4 &
REC_PID=$!
sleep 1
adb shell am start -W -a android.intent.action.VIEW -d 'myapp://example/path?foo=bar'
sleep 8
kill -INT "$REC_PID" || true
adb pull /sdcard/{항목}.mp4 "$MP4"
adb shell rm /sdcard/{항목}.mp4

node "${PILEE_DIR:-.}/skills/verify-report/scripts/make-motion-gif.mjs" \
  --output "$GIF" \
  --fps 12 \
  --duration 8 \
  "$MP4"
adb exec-out screencap -p > "$CAP/{항목}-final.png"
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
