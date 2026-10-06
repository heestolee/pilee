# 압축 시 기존 대화 화면 보존

성공한 `compaction_end`에서 **기존 화면을 지우거나 재생성하지 않고 압축 요약만 뒤에 추가**한다. 이미 보던 질문·답변·도구 출력은 같은 컴포넌트와 펼침 상태로 남아 위로 스크롤해 읽을 수 있다.

- `index.ts`는 성공한 압축 완료 이벤트에만 `preserveCompactionScreen()`의 수신 객체를 사용한다. 코어의 `chatContainer.clear()`와 `renderSessionEntries()` 호출만 생략한다.
- 진행 표시 종료, 취소키 복구, 컨텍스트 검증, 요약·비용 표시, footer, 대기 입력·재시도 처리는 기존 Pi 핸들러가 수행한다. 실패·취소 이벤트도 그대로 전달한다.
- 실제 화면의 메서드를 임시 교체하지 않는다. 대기 명령이 화면 재구성·세션 전환으로 재진입하면 원래 인스턴스를 사용하므로 필요한 화면 교체는 정상 실행된다.
- 일반 `renderSessionEntries()`에는 Pi가 선택한 엔트리를 그대로 전달한다. 전체 분기 원문을 다시 주입하지 않는다. 기존 입력 렌더 최적화의 설치는 유지하며 캐시 알고리즘은 변경하지 않는다.
- 모델용 `buildContextEntries()` / `buildSessionContext()`, 압축 설정과 원본 JSONL은 변경하지 않는다.

## 적용 범위와 한계

`renderSessionEntries`가 있는 Pi 런타임에 적용한다(0.84.4 검증). 해당 진입점이 없는 구버전은 기존 동작을 유지한다.

패키지 파일 갱신 후 실행 중인 Pi에는 `/reload` 또는 재시작이 필요하다. 이미 설치된 구형 wrapper도 `/reload`에서 전체 분기 투영을 중단하며, wrapper는 중첩하지 않는다.

**보존 대상은 실행 중 압축 직전에 보이던 화면이다.** 재시작·리로드·분기/세션 전환처럼 화면을 다시 구성할 때는 Pi 기본 동작(압축 요약과 남은 대화)을 사용한다. 이미 사라진 과거 화면을 복구하거나 재시작 때 모든 원문을 재생하는 기능이 아니다. 저장된 세션 원문은 그대로 남는다.

## 회귀 검증

저장소 루트에서 파일을 명시해 실행한다.

```bash
node scripts/run-typescript-test.mjs extensions/tool-group-renderer/transcript-history.test.ts extensions/tool-group-renderer/mcp-renderer.test.ts

PI_INTERACTIVE_BASE=/path/to/active/pi-coding-agent/dist/modes/interactive \
  node scripts/run-typescript-test.mjs extensions/tool-group-renderer/transcript-history.runtime.test.ts extensions/tool-group-renderer/transcript-render.runtime.test.ts
```

runtime 테스트는 지정한 실제 Pi 클래스와 렌더 컴포넌트, 메모리 세션, 출력 수집용 가짜 터미널을 사용한다. 모델/API 호출은 하지 않는다.

- 압축 후 기존 컴포넌트 identity·순서·펼침 상태, clear/replay 미실행, 요약 1회 추가 및 연속/전체 압축
- 출력 스트림의 scrollback 삭제·과거 행 재출력 부재
- 모델 컨텍스트·저장 엔트리 불변, 진행 표시·취소키·비용 표시 유지
- 취소·실패 및 잘못된 컨텍스트의 기존 오류 처리
- 실제 Pi 대기열 처리 함수를 통한 일반 입력·overflow 재시도·재진입 화면 교체
- 일반 재구성·분기·다른 세션과 구형 wrapper 리로드의 경계

환경변수가 없으면 runtime 항목은 skip이므로 동작 PASS로 간주하지 않는다. 이 검증은 실제 사용자 터미널의 스크롤 조작·포커스·전체 확장 조합까지 보장하지 않는다. 사용 중인 Pi에 디버거를 연결하거나 사용자 터미널의 키·포커스를 조작하지 않는다.
