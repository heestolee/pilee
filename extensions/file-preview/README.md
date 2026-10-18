# 공통 로컬 파일 TUI 미리보기

Pi 1.3의 공식 `registerMarkdownTransformer`와 내장 `Markdown`, `Text`, `ScrollView`를 사용합니다. 세션 원문·모델 문맥·파일 내용을 수정하지 않습니다. 새 의존성이나 별도 터미널 renderer는 없습니다. 링크 파서는 Pi TUI가 **공개 export하는 `Marked`**를 재사용합니다.

## 키보드로 사용

- `/preview <경로>`: 로컬 UTF-8 파일을 읽기 전용 overlay로 엽니다.
- `/preview`: 현재 세션의 user/assistant Markdown 링크를 목록으로 다시 찾습니다. 로드한 기존 대화도 포함합니다.
- 상대 경로는 세션 cwd 기준입니다. 절대 경로, `file://`, 공백·괄호·한글 경로를 지원합니다. 공백이 있는 command 경로는 전체를 그대로 쓰거나 한 쌍의 따옴표로 감쌀 수 있습니다. shell 확장·실행은 하지 않습니다.
- `↑↓`/`j k`, `PgUp/PgDn`, `Home/End` 또는 `g/G`: 스크롤.
- `c`: 화면용 정제 문자열이 아닌 원문 전체 복사. `r`: Markdown 원문/렌더 전환.
- `Esc`, `q`, `Ctrl+C`: 원래 Pi로 복귀. SQL 실행·편집 기능은 없습니다.

Markdown은 제목·목록·표·코드블록을 내장 renderer로 표시합니다. SQL 등은 호스트가 지원하는 언어 하이라이트를 적용합니다. 파일 안의 HTTP(S) 링크는 유지하고, 로컬·custom-scheme 링크가 OS 실행 경로로 빠지지 않도록 overlay 안에서는 비활성화합니다.

## 로컬 링크 클릭 — macOS 선택 설치

**기본값은 command-only**입니다. 터미널이 OSC8 링크를 지원하고 macOS helper 앱이 본인 marker·bundle ID를 갖고 있으며, LaunchServices 기본 handler가 정확히 그 앱일 때만 로컬 Markdown 링크를 `pilee-preview://<무작위 세션>/<파일 capability>`로 렌더합니다. HTTP 링크·코드블록·인라인 코드·이미지·HTML은 바꾸지 않습니다. 미지원 호스트·다른 OS·helper 미설치·등록 실패 시 깨진 custom 링크를 만들지 않고 기존 링크와 `/preview`를 유지합니다. helper 설치/제거 후 `/reload` 또는 새 세션이 필요합니다.

`--install`과 `--uninstall`은 **실제 설치/제거를 수행하므로 사용자가 명시적으로 승인한 경우에만** 실행합니다.

```sh
# 읽기 전용 상태 조회
node extensions/file-preview/install-handler.mjs --check

# 전역 설치 없이 지정한 새 디렉터리로 빌드만
node extensions/file-preview/install-handler.mjs --build .context/file-preview/Preview.app

# 승인 후 macOS URL handler 설치
node extensions/file-preview/install-handler.mjs --install

# 승인 후 복구: 소유 marker·bundle ID를 확인하고 등록 해제/제거
node extensions/file-preview/install-handler.mjs --uninstall
```

설치 부작용은 `~/Applications/Pilee File Preview.app` 생성/교체와 LaunchServices의 전용 `pilee-preview` scheme 등록입니다. 기존 앱은 본인 marker와 `dev.pilee.file-preview` ID가 모두 일치해야 교체합니다. 기본 HTTP/file handler나 shell 설정은 건드리지 않습니다. 앱은 dispatcher와 **Node 실행 파일의 사본**을 소유하여 예전 runtime 디렉터리 삭제에도 의존하지 않습니다. 그만큼 디스크 공간을 사용하며, Node 보안 업데이트 시 helper도 재설치해야 합니다. 앱은 로컬 ad-hoc 서명이며 공증 배포물은 아닙니다. 기본 scheme 소유권이 확인되지 않으면 클릭은 계속 비활성화됩니다.

## 보안·수명 경계

- 세션마다 `127.0.0.1`의 임의 포트, 256-bit bearer token, 파일별 128-bit capability를 생성합니다. URL에는 host/port/파일 경로/명령을 넣지 않습니다.
- dispatcher는 고정 loopback으로 **capability만** 보내며 파일을 읽거나 실행하지 않습니다. 서버는 현재 세션에 등록된 경로만 열고, HTTP 응답에 파일 내용·URL·경로를 담지 않습니다. 외부 네트워크 전송은 없습니다.
- `~/.pi/agent/file-preview/sessions/`는 `0700`, registry는 `0600`입니다. dispatcher는 symlink·다른 소유자·group/world 접근·비정상 JSON/port/token·죽은 PID를 거부합니다. 같은 OS 계정의 악성 프로세스까지 격리하는 sandbox는 아닙니다.
- 서버는 정확한 Host·bearer·POST·capability를 요구합니다. Origin, browser fetch site, body, 임의 경로 요청을 거부합니다. CORS·redirect는 없습니다.
- 파일은 클릭 시 realpath와 읽기 전용 FD로 검증합니다. 일반 파일만 허용하고 교체/성장 감지, 1 MiB·20,000줄 제한, UTF-8·NUL 검사를 적용합니다. ANSI/OSC·제어문자는 표시 전에 정제하며 복사용 원문은 보존합니다. capability는 경로 권한이지 파일 내용 snapshot이 아닙니다.
- 렌더 변환에는 디스크/전체 세션 스캔이 없습니다. Markdown 캐시는 16개, 파일/capability는 세션당 최대 2,000개입니다. 128 KiB를 넘는 단일 Markdown 메시지는 변환을 생략합니다. 목록 재탐색은 세션 로드·트리 전환·명시 `/preview`에서만 합니다.
- busy/기존 preview/목록 선택 중 클릭은 거부하여 overlay 중첩을 막습니다. 세션 종료·교체·트리 전환은 registry와 서버를 정리하고 옛 UI callback을 차단합니다. 강제 kill 뒤 남은 registry도 죽은 PID면 사용할 수 없습니다. 사용 중인 세션에는 TUI 안내를 표시하고, handler 전달 실패는 macOS 알림으로 안내합니다(알림 표시 여부는 OS 설정에 따릅니다).
- 파서가 normalized source와 원문 위치를 안전하게 연결하지 못하는 복잡한 중첩 Markdown은 보수적으로 변환하지 않습니다. `/preview <경로>`는 계속 사용할 수 있습니다. `#`가 파일명 자체인 경우 `notes%231.md` 또는 percent-encoded `file://` URL로 fragment와 구분하세요.

## 검증 범위

`files`, `links`, `viewer`, `bridge`, `index`, `installer` 테스트를 각각 지정하여 실행합니다. 실제 임시 파일·loopback HTTP·미등록 앱 빌드를 사용합니다. 실제 Pi의 일반/전체화면 PTY에서 command 경로도 검증합니다. **OS handler 등록 후 Ghostty 링크 클릭→원래 Pi 복귀는 별도 E2E가 필요하며 이 테스트로 완료됐다고 주장하지 않습니다.**

```sh
PILEE_TEST_HOST_ROOT="$PWD/node_modules/@earendil-works/pi-coding-agent" \
  node scripts/run-typescript-test.mjs \
  extensions/file-preview/files.test.ts extensions/file-preview/links.test.ts \
  extensions/file-preview/viewer.test.ts extensions/file-preview/bridge.test.ts \
  extensions/file-preview/index.test.ts extensions/file-preview/installer.test.mjs
```
