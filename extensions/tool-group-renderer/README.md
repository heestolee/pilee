# 대화 화면과 모델 컨텍스트

`transcript-history.ts`는 Pi의 `renderSessionEntries` 입력만 현재 분기의 전체 원문으로 바꾼다. 자동·수동 압축은 그대로 수행하지만, 사용자는 같은 대화 화면을 위로 스크롤해서 이전 질문과 답변을 계속 읽을 수 있다. `/reload`나 세션 재시작도 같은 화면 투영을 사용한다.

- 원천은 `sessionManager.getBranch()`다. 다른 분기나 다른 세션의 원문을 섞지 않는다.
- `buildContextEntries()` / `buildSessionContext()`와 압축 설정, 원본 JSONL은 변경하지 않는다. 화면 복원을 모델에 메시지로 재전송하지 않는다.
- 압축 완료 이벤트는 최신 요약을 별도로 붙이므로 그 요약만 화면 재구성 입력에서 제외한다. 재시작 때는 전체 원문과 요약을 시간순으로 표시한다.
- 기존 Pi 렌더러가 숨긴 custom message와 도구 출력의 접힘 상태를 계속 처리한다.
- 다시 로드해도 wrapper를 중첩하지 않고, 현재 세션의 SessionManager를 렌더 시점에 읽는다.

지원 경계: `renderSessionEntries`가 있는 Pi 런타임에 적용한다(0.84.4 검증). 해당 진입점이 없는 구버전은 기존 동작을 유지한다. 저장 당시 이미 잘린 도구 출력이나 JSONL에 없는 원문을 복구하는 기능은 아니다.

## 적용

현재 실행 중인 Pi에는 `/reload`가 필요하다. 이미 압축된 세션도 저장된 현재 분기의 원문을 다시 표시한다. 패키지 파일이 갱신돼도 실행 중인 다른 세션에 자동으로 로드되지는 않는다.

## 회귀 검증

저장소 루트에서 검증할 파일을 명시해 실행한다.

```bash
node scripts/run-typescript-test.mjs extensions/tool-group-renderer/transcript-history.test.ts extensions/tool-group-renderer/mcp-renderer.test.ts

PI_INTERACTIVE_BASE=/path/to/active/pi-coding-agent/dist/modes/interactive \
  node scripts/run-typescript-test.mjs extensions/tool-group-renderer/transcript-history.runtime.test.ts
```

runtime 테스트는 지정한 실제 Pi 클래스와 렌더 컴포넌트를 사용한다. 수정 전 유실, 확장 factory 연결, 수동·자동 압축 이벤트, 전체 압축, 요약 중복, reload, 분기/세션 격리, 원본 및 모델 컨텍스트 불변을 확인한다. 환경변수가 없으면 runtime 항목은 skip이므로 전체 동작 PASS로 간주하지 않는다. 사용자 터미널의 포커스·키 입력은 조작하지 않는다.
