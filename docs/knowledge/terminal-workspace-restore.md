---
title: 터미널 workspace 복원은 snapshot과 host adapter를 분리한다
tags:
  - workspace
  - terminal
  - ghostty
  - snapshot
  - restore
  - session
category: runtime
status: active
confidence: high
applies_to:
  - extensions/workspace
  - extensions/fork-panel
source:
  - user-direction:2026-05-12-workspace-save-restore
reviewed_at: 2026-11-19
reviewed_commit: 3e3b6c97a4dd610f9b2a2153d788ff95fb208d6e
related:
  - terminal-host-integration
  - fork-panel-spatial-continuity
  - session-identity-over-filenames
---

## Judgment

터미널 탭과 split 패널 묶음은 사용자가 기억하는 작업공간입니다. 이를 복원하려면 “어떤 세션을 어떤 탭/패널에 열었는가”라는 workspace snapshot과 “그 탭/패널을 실제 host에서 어떻게 여는가”라는 terminal host adapter를 분리합니다.

## Snapshot Rule

snapshot에는 현재 front window의 Ghostty window/tab/terminal ID, 탭 순서, terminal title/cwd, 정확히 연결된 Pi session file, panel label, fork metadata를 저장합니다. 여러 창 전체나 split tree/비율을 capture하는 기능은 아닙니다.

새 Pi process는 공식 `ctx.ui.setTitle()`로 자기 stdout에 짧은 임시 nonce 표식을 표시합니다. 읽기 전용 AppleScript가 **모든 창·탭·terminal**의 제목을 조회해 표식과 일치하는 단 하나의 terminal ID와 window ID를 확인합니다. 현재 focus/selected terminal이나 제목·cwd 유사도로 추정하지 않습니다. host timeout·중복 표식·제한된 재시도 후 미발견은 unbound 사유로 남깁니다. 등록 중 session-title 갱신은 표식을 보존하고, 완료·실패 시 최신 사람이 읽을 수 있는 제목으로 돌립니다. 상시 opaque token, UI monkeypatch, 키 입력은 사용하지 않습니다.

registry는 process nonce별 atomic 파일입니다. 공유 파일 RMW·sessionFile dedupe·24시간 TTL을 쓰지 않습니다. 조용히 열린 패널도 PID 생존·OS 프로세스 시작 시각·exact host ID가 맞으면 포함하고, 죽거나 PID가 재사용된 프로세스와 identity 없는 legacy `active-sessions.json`은 제외합니다. 시작 시각은 locale/timezone을 고정한 OS 조회로 대조하며, 확인할 수 없는 기록은 exact로 승격하지 않습니다. 같은 제목·cwd·header ID를 가진 별도 session 파일은 합치지 않습니다. 프로세스 nonce는 reload에도 유지하되 등록 generation과 현재 ctx를 확인하여 이전 session의 늦은 응답·cleanup이 새 등록을 덮지 못하게 합니다. headless/RPC/subagent/noTTY에서는 등록과 autosave를 실행하지 않습니다.

자동·수동 저장 모두 모든 capture 패널의 정확한 연결과 읽기 전용 v3 header-cwd preflight가 통과해야 complete입니다. 미등록 패널(일반 shell 포함), 중복 binding, 유실·미저장 session 파일이 하나라도 있으면 항목별 사유를 표시하고 **저장과 자동본 삭제를 모두 하지 않습니다**. 이전 runtime 패널은 새 binding 등록을 위해 `/reload`가 필요하며 강제 재시작하거나 최근 대화로 연결을 보완하지 않습니다. 기존 저장본의 미연결·legacy fallback도 복구 때 계속 차단합니다.

## Autosave Rule

실행 중인 Ghostty/macOS TUI는 **매 정각 하나씩**, 내용이 같아도 새 자동 snapshot을 저장합니다. 시작 직후 저장과 elapsed-hour interval은 없고, 현재 시각으로 다음 wall-clock hour를 계산하는 one-shot timer를 매번 예약합니다. 이벤트 루프·capture 지연은 정각부터 최대 5초만 허용하며, 늦게 깨어난 timer는 지난 slot을 저장하지 않고 다음 정각을 기다립니다. 꺼져 있던 시간이나 실패한 slot을 소급 생성하지 않습니다. snapshot의 저장시각과 slot key는 같은 실제 정각을 가리킵니다.

여러 Pi 패널은 같은 slot의 atomic mkdir claim을 경쟁합니다. 한 패널만 capture하고, 시간 경과나 PID 추정으로 다른 소유자의 claim을 탈취하지 않습니다. 실패·crash한 slot도 재실행하지 않지만 다음 정각은 별도 claim이라 계속 저장할 수 있습니다. shutdown/reload는 timer와 진행 중 capture를 취소하며 stale ctx는 재예약·snapshot write를 하지 않습니다. 저장 허용 시각과 lifecycle 유효성은 분리하여, 현재 소유자의 capture가 정각 허용 지연을 넘기면 `capturing`에 남기지 않고 실패·건너뜀 사유를 기록합니다. 종료된 generation은 새 runtime의 상태를 덮어쓰지 않습니다.

자동 snapshot은 최근 **10개 FIFO**입니다. 새 complete snapshot의 임시파일 write와 atomic rename이 성공한 뒤에만 오래된 `source=auto`를 정리합니다. 예전 `autosave.json` alias와 예전 자동 archive도 이 보관 대상에 포함하지만, 새 alias는 만들지 않습니다. `source=manual`은 이름에 autosave가 있어도 삭제하지 않고, corrupt/unknown 파일과 snapshot 디렉터리 밖의 `restore-sources`·복구 기록도 보존합니다. 불완전 capture나 write/rename 실패에서는 정상본을 삭제하지 않습니다. 완전한 단일 패널 snapshot도 저장하며 이전 다중 패널보다 작다는 이유로 차단하지 않습니다.

`/workspace list`와 자동완성은 남아 있는 유효한 저장본을 **최신순으로 모두 표시**합니다. 읽기만으로 prune·숨김·복원성 점수 정렬을 하지 않습니다. `--all`은 이전 호출 호환을 위한 no-op이며 help에는 노출하지 않습니다. 번호는 같은 Pi 세션에서 직전에 표시한 목록의 id/path/content hash에 고정됩니다. 파일 변경·삭제 또는 reload 후 목록 기록 부재는 새 순서로 재해석하지 않고 다시 선택하도록 안내합니다.

## Restore Rule

기본 restore mode는 append입니다. workspace 복원은 사용자의 현재 창을 닫거나 대체하지 않고, 새 tab을 추가한 뒤 저장된 session을 `pi --session`으로 다시 엽니다. 새 shell의 PATH는 현재 Pi 프로세스와 다를 수 있으므로 bare `pi`에 의존하지 않고 현재 실행 중인 Pi command 또는 명시 wrapper를 사용합니다. `/workspace list`가 보여주는 번호는 복원 대상 선택 UI의 일부이므로 `/workspace restore 2`처럼 그대로 사용할 수 있어야 합니다.

목록은 session/panel 수와 무관하게 최신순이지만, 최신본을 자동 복구 대상으로 선택하지는 않습니다. 대상을 생략한 restore는 실행하지 않습니다. exact id 또는 보존 snapshot 파일 경로를 직접 지정할 수도 있고, 부분 이름이 여러 저장본과 일치하면 선택을 요구합니다. 예전 `autosave` exact ID도 실제로 남아 있는 alias 파일만 가리키며 최신 자동본으로 추정 치환하지 않습니다. restore report에는 requested target, resolved id/path, source SHA256과 pinned source 경로를 함께 표시합니다.

선택한 원본 bytes는 content hash별 `restore-sources`에 보존합니다. 이후 autosave alias 교체나 archive prune이 실행 원본을 바꾸지 못하게 합니다. 이 pin은 작업공간 배치와 session 경로의 보존이지, JSONL 대화 내용을 저장 당시 시점으로 롤백하는 기능이 아닙니다.

## Full Preflight Rule

실행 계획은 terminal cwd와 session cwd를 별도로 가집니다. `pi --session`이 실제 사용하는 header cwd를 읽기 전용으로 검증하고 launch와 READY expected cwd에 똑같이 사용합니다. 빈 파일을 초기화할 수 있는 `SessionManager.open()`을 검증기로 사용하거나 session header를 고쳐 오류를 숨기지 않습니다. 지원 형식은 v3로 명시합니다. 구형·버전 누락 세션은 Pi가 로드하며 자동 변환하고, 미래 버전은 계약이 검증되지 않았으므로 host 생성 전에 차단합니다. 변환 정책은 별도 확인 대상입니다.

모든 원본 패널의 명시 session 파일·header·실제 cwd·중복을 검사한 후에만 host를 호출합니다. 같은 header ID를 가진 별도 fork 파일은 합치지 않고, 같은 realpath 파일의 중복 배정은 차단합니다. 하나라도 미해결이면 원본 total/ready/blocked와 패널별 사유를 표시하고 target 생성 0회로 끝냅니다. 일부 READY만 전체 복구 완료로 보고하지 않으며, 현재는 부분 실행을 지원하지 않습니다. foreign session의 fork metadata 조회에는 호출자 환경변수를 섞지 않습니다.

## Completion-gated Restore Rule

생성 요청이 반환됐거나 일정 시간이 지났다는 사실은 복구 완료가 아닙니다. 한 패널의 실제 대상과 세션 준비를 확인한 뒤 같은 탭의 다음 패널을 만들고, 그 탭이 끝난 뒤 다음 탭을 만듭니다.

- Ghostty의 `new tab` / `split`과 surface configuration의 `command`로 프로세스를 직접 시작합니다. `System Events`, 키 입력, 붙여넣기, 고정 대기 뒤 현재 선택 패널을 재조회하는 방식으로 복구하지 않습니다.
- 시작 시 대상 창을 한 번 고정하고, 이후에는 생성 API가 반환한 tab/terminal ID만 사용합니다. 사용자의 포커스 이동을 대상 선택으로 해석하지 않습니다.
- 각 실행에 고유한 launch request를 부여합니다. 새 Pi의 `session_start`가 실제 sessionFile/cwd를 대조해 READY receipt를 쓰며, 부모는 해당 프로세스 생존과 정확한 host 대상의 존재도 확인합니다. 전역 registry의 과거 세션 기록은 READY 증거가 아닙니다.
- 세션 종료·전환·리로드는 receipt를 무효화합니다. 이미 실패한 receipt는 최초 mismatch를 보존하고 lifecycle 정보를 별도로 남깁니다. 완료한 패널도 다음 생성 전과 최종 완료 전에 다시 확인합니다.
- 생성 실패, 대상 유실, 세션 불일치, READY 제한 시간 초과는 다음 생성을 중단합니다. 완료한 패널은 자동으로 닫거나 재생성하지 않고 실행별 progress 기록에 완료 대상과 실패 단계를 남깁니다. source runtime 종료도 진행 중 복구를 취소합니다.

동일 source hash의 실행은 process 간 atomic claim으로 하나만 허용합니다. host create 전에 생성 가능성을 journal에 먼저 기록하며, 이후 timeout·실패·완료 상태에서 다시 실행하면 새 append 대신 기존 기록을 안내합니다. create 전 no-target 실패만 claim을 해제합니다. 자동 resume·기존 탭 삭제·불확실한 claim 만료는 수행하지 않습니다. 오래된 source hash 없는 실패 기록을 새 실행으로 자동 병합하지도 않습니다.

이 계약은 입력창·포커스에 의존한 잘못된 대상 실행을 막습니다. 사용자가 복구 대상을 닫거나 프로세스를 종료하는 것까지 무시하고 성공을 보장하지는 않습니다. 그런 경우 실패를 명시하고 멈추는 것이 정상입니다. READY는 목표 Pi 세션 로드 확인이며, 화면 렌더 완료나 모델 응답 완료를 의미하지 않습니다.

검증은 명령 handler 연결, 순차 READY gate, 대상/세션 유실, timeout, 취소를 mock host로 재현하고 생성 AppleScript를 컴파일합니다. 실제 terminal host E2E는 승인된 disposable 공간에서만 수행하며, 작업 중인 사용자의 탭·패널을 fixture로 쓰지 않습니다.

## Layout Fidelity Rule

Ghostty AppleScript가 split tree, pane 비율, tty를 안정적으로 노출하지 않으면 exact layout 복원을 약속하지 않습니다. 탭 순서와 패널 수, session/cwd/panel label을 우선 복원하고, split 방향·비율은 순차 split 같은 근사 복원으로 표시합니다. `--dry-run`은 실제 생성 없이 복구 계획과 차단 이유를 사용자에게 먼저 보여주는 안전장치입니다. 새 exact registry도 기존 저장본의 누락 identity를 자동 복원하지는 않습니다. 등록·저장 검증은 임시 HOME/세션과 fake host를 사용하며, 실제 nonce 제목 반영·권한과 기존 패널의 reload 전환은 승인된 runtime 검증에서 별도로 확인해야 합니다.

## Failure Mode

workspace 복원을 “세션 몇 개를 다시 열기”로만 보면 P0/P1/P2 위치 기억과 cwd/session provenance가 사라집니다. 반대로 host layout fidelity를 과장하면 사용자는 종료 전 화면이 그대로 복원될 것으로 오해합니다. pilee는 복원 가능한 session continuity와 복원 불가능한 host geometry를 명확히 분리해야 합니다.
