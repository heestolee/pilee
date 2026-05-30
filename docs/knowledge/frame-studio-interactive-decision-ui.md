---
title: TFT Studio는 TFT 단계를 작업 단위 UI로 묶는다
tags:
  - tft-studio
  - frame-studio
  - frame
  - glimpse
  - ask-user-question
  - decision-ui
  - co-thinking
  - planning
category: workflow
status: active
confidence: high
applies_to:
  - extensions/frame-studio
  - extensions/archive-to-html
  - extensions/utils/companion-window.ts
  - skills/frame
  - extensions/tft-commands
source:
  - pilee-history:2026-05-06#67
  - pilee-history:2026-05-07#73
  - user-direction:2026-05-09-tft-studio-optional-stages
  - user-direction:2026-05-09-tft-studio-context-return
  - user-direction:2026-05-10-tft-studio-chronological-flow
  - user-direction:2026-05-10-tft-stage-run-cards
  - user-direction:2026-05-10-tft-visual-db-structure
  - user-direction:2026-05-10-deep-interview-frame
  - user-direction:2026-05-11-tft-studio-option-enter-submit
  - user-direction:2026-05-11-tft-studio-shortcut-label
  - user-direction:2026-05-12-tft-studio-ime-shortcut-conflict
  - user-direction:2026-05-19-single-companion-webview-toggle
  - user-direction:2026-05-20-tft-studio-scroll-preservation
  - user-feedback:2026-05-20-tft-studio-awaiting-scroll-reset
reviewed_at: 2026-05-30
reviewed_commit: de40e548359d357b1f7444ab484fa322e9b8a707
related:
  - frame-planning-identity
  - frame-verify-contract
  - ask-user-question-option-design
  - live-artifact-preview-pattern
  - tft-visual-structure-renderer
  - frame-plan-synthesis-continuity
---

## Judgment

`/frame`은 사용자가 계획을 감사하게 만드는 문서 생성 명령이 아니라, 목표·범위·검증 렌즈를 함께 좁히는 decision gate입니다. Pi text-mode fallback만으로는 이 체감이 약할 수 있으므로, UI가 가능한 환경에서는 TFT Studio가 질문 흐름을 별도 Glimpse 창에 묶어 보여줍니다.

TFT Studio는 Frame/Decide/Verify/Verify Report를 탭으로 나누는 작업 단위 shell입니다. Frame tab은 기존 co-thinking 기능뿐 아니라, 결정이 닫힌 뒤 `Implementation plan synthesis`까지 담당합니다. Plan은 별도 탭으로 사용자를 밀어내기보다 Frame의 마지막 섹션으로 보여야 흐름이 끊기지 않습니다. Decide/Verify/Verify Report tab은 같은 identity 안에서 후속 또는 선택 stage state를 붙일 자리로 노출합니다. 탭은 UI 구획일 뿐이고, canonical source는 각 단계의 structured data여야 합니다.

TFT Studio는 pipeline 강제 UI가 아닙니다. `Frame → Decide → Verify → Verify Report`는 가장 풍부한 full cycle일 뿐이며, 작업 성격에 따라 `Frame only`, `Frame → Verify`, `Frame → Verify Report`, `Verify Report only`, `Decide 없이 Verify` 같은 부분 cycle도 정상 경로입니다. 전 단계 기록이 없다는 이유로 현재 탭 사용을 막지 않습니다.

Self-healing도 독립 TFT stage가 아닙니다. 검증 실패나 coverage gap 이후 실행되는 repair loop이므로 별도 탭으로 두지 않고, Studio에 표시한다면 Verify tab 안의 `Self-healing runs` / `Re-verify result` append section으로 남깁니다.

## Identity Rule

TFT Studio의 소유자는 현재 패널이 아니라 작업 단위입니다. worktree가 있으면 worktree identity를 쓰고, home/planning 상태라면 ticket 또는 session planning identity를 씁니다. 이렇게 해야 P0/P1 패널 이동이나 재개가 있어도 같은 frame/decision/verification 대화가 같은 Studio run으로 이어집니다.

## Interaction Rule

TFT Studio는 tabbed markdown live view와 single/multi option, 직접 입력을 지원합니다. markdown live view는 frame draft의 success criteria처럼 표가 핵심인 문서를 그대로 읽을 수 있어야 하므로 GitHub-style pipe table(`| header |`, `|---|`)을 table로 렌더링합니다. Decide/Verify 문서는 `####` 같은 깊은 heading을 자주 쓰므로 `#`~`######` heading도 literal markdown이 보이지 않게 렌더링해야 합니다. 표나 heading이 raw pipe/`####` paragraph로 깨지면 검증 기준을 함께 좁히는 UI 목적을 잃습니다.

사용자가 선택하거나 취소하면 tool 응답으로 돌아오고, headless/no-UI 환경에서는 blocking하지 않고 numbered text fallback으로 내려갑니다. 질문 대기는 agent turn을 붙잡는 blocking 상태라서 무한 대기하지는 않지만, 실제 frame 검토는 긴 회의/휴식 후에도 이어질 수 있으므로 기본 timeout은 짧은 30분이 아니라 작업 세션 단위의 긴 window로 둡니다.

UI가 가능한 환경에서 Frame/Decide/Verify의 사용자 선택 질문을 일반 채팅 본문에만 번호형 메뉴로 출력하면 TFT Studio가 co-thinking surface라는 목적을 잃습니다. 따라서 stage 질문은 먼저 `frame_studio action=ask tab=<stage>`로 열고, numbered text fallback은 Studio ask가 unavailable/cancelled/timeout일 때만 사용합니다.

사용자가 선택한 뒤에는 완료 카드가 선택값·직접 입력값·원 질문을 남겨 “Pi가 다음 단계를 준비 중”임을 보여줍니다. 즉 선택 직후 질문 UI가 사라져도 사용자가 방금 무엇을 제출했는지 화면에서 확인할 수 있어야 합니다.

직접 입력을 쓰는 질문에서는 키보드 흐름이 끊기지 않아야 합니다. 일반 Enter는 textarea 줄바꿈으로 남기고, macOS `Cmd+Enter`(브라우저 `Meta+Enter`)는 현재 pending question의 `선택 완료` 제출 shortcut으로 동작합니다. `Option+Enter`/`Alt+Enter`는 macOS 한글 IME 후보창을 띄울 수 있으므로 공식 affordance로 노출하지 않습니다. 기존 사용 습관을 위해 legacy Alt+Enter는 capture 단계에서 기본 동작을 막고 제출로 처리하되, 버튼 라벨은 호출자가 `submitLabel`을 덮어써도 `선택 (⌘↵)`처럼 Command shortcut을 보여줘야 합니다.

TFT Studio의 메인 화면은 최신 활성 step을 위에 따로 띄우고 그 아래에 과거 전문을 붙이는 구조가 아니라, `update → question → answer`를 시간순으로 보여주는 진행 타임라인이어야 합니다. 사용자가 Step 3에서 선택 중이면 Step 1, Step 2 다음에 Step 3 질문이 inline으로 보여야 하며, pending question의 제목/옵션 UI는 한 번만 렌더링합니다. 원자료 성격의 로그만 하단에 분리합니다. 그래야 사용자가 화면을 3→1→2 순서로 읽는 인지적 역전이나 같은 질문이 두 번 보이는 혼선을 피할 수 있습니다.

같은 work unit 안에서 Frame, Decide, Verify, Verify Report는 여러 번 수행될 수 있습니다. 따라서 tab timeline은 단순 flat list가 아니라 `Frame Run #1`, `Frame Run #2`, `Verify Run #1`처럼 stage run 카드로 묶어 보여줘야 합니다. 새 transcript 파일을 만들지는 않고 같은 identity transcript에 append하되, `finish`/`abort` 이후 같은 tab에 새 update/start가 오면 새 run 카드로 보이게 합니다.

Live update는 사용자가 읽던 위치를 방해하면 안 됩니다. SSE로 새 `update`/`ask` state가 들어와 timeline HTML을 다시 그리더라도, 사용자가 중간을 읽고 있었다면 기존 scroll offset을 보존합니다. 사용자가 이미 하단 근처에 있을 때만 새 내용이 추가되는 진행 상황을 보기 위해 하단을 계속 따라갑니다. 탭을 사용자가 직접 바꾸는 동작은 다른 문맥으로 이동하는 것이므로 scroll 보존 대상이 아닙니다.

선택대기 질문을 띄우기 위해 `openStudio()`가 호출되더라도 이미 같은 TFT Studio URL이 열린 companion WebView를 다시 redirect/write하면 안 됩니다. 같은 redirect shell을 재주입하면 페이지 자체가 reload되어 WebView script의 scroll snapshot/restore가 개입하기 전에 scroll이 0으로 초기화됩니다. 따라서 companion 재사용 경로는 HTML/URL이 동일하면 `show`만 수행하고, 다른 artifact로 바뀐 경우에만 content를 교체합니다.

즉 TFT Studio는 AskUserQuestion 원칙을 대체하지 않습니다. 같은 decision gate를 더 읽기 쉬운 UI로 표현하는 surface입니다. `/frame`의 핵심 정렬 질문에서는 추천안이 명백해 보여도 묻고, `(명백: ...)` 주석으로 AI 판단 근거를 같이 보여줘야 합니다.

Frame 질문 UI는 deep-interview식으로 “현재 이해 / 막힌 결정 / 추천 답안 / 질문”을 한 카드에 담는 것이 좋습니다. 이 구조는 사용자가 전체 계획을 감사하게 만드는 대신, 지금 풀어야 하는 불확실성 하나와 선택 후 달라질 계약을 바로 보게 합니다. 단, 카드가 길어져 여러 결정을 한 번에 묻는다면 실패입니다.

정확한 기획 근거가 있는 source-grounded frame에서는 Frame tab이 `Source Evidence`, `Requirement Matrix`, `Domain Work Map`, `Backend Layer Map`, `Architecture/Data Flow Map`, `Implementation Plan Synthesis`, `Verification Evidence Plan`을 읽기 쉬운 순서로 보여줘야 합니다. 사용자는 큰 목표가 아니라 “기획 원문 한 줄이 어떤 구현 task, 어떤 데이터/로직 흐름, 어떤 검증 증거로 닫히는지”를 검수합니다.

TFT Studio tool 호출에서는 이 카드와 `question` 필드를 구분합니다. 판단 맥락 카드는 `update` 또는 `ask.markdown`의 본문으로 렌더링하고, `ask.question`은 “배너 버튼 스크롤 target을 어떻게 반영할까요?”처럼 짧은 질문 제목 한 줄만 담습니다. 긴 카드가 실수로 `question`에 들어오면 renderer는 제목과 본문을 방어적으로 분리해야 하지만, 그것은 사용자 화면을 보호하는 safety net이지 권장 호출 방식이 아닙니다.

Generative UI 스타일의 flat/compact visual pattern은 TFT Studio에도 유용하지만, dependency나 “모델이 매번 UI를 생성하는 방식”을 붙이는 것은 맞지 않습니다. TFT Studio는 prose-heavy co-thinking artifact이므로 `텍스트는 tool 밖에, visual만 tool 안에` 같은 규칙을 그대로 적용하면 오히려 목적을 잃습니다. 대신 renderer는 deterministic하게 유지하고, tab shell·표·요약 카드·간단한 다이어그램 같은 보조 시각화만 사용해 사용자가 목표/범위/검증 렌즈를 더 빨리 읽게 합니다.

DB schema, API shape, state ownership, source-of-truth처럼 구조 변화가 이해·선택·검증의 핵심이면 `tft-visual` fenced block을 사용합니다. TFT Studio는 이를 `elkjs` 기반 top-down 구조 그림으로 렌더링하고, 신규/변경/삭제/FK/UNIQUE badge, 관계선, relation card, 학습용 설명을 함께 보여줍니다. 이 visual은 Frame/Decide 전용이 아니라 맥락 기반 visual primitive입니다.

## Transcript Rule

TFT Studio는 UI에 렌더된 markdown/update/question/answer 흐름을 identity별 transcript JSON으로 저장합니다. 같은 action에서 동일한 `update`가 연속으로 두 번 append되면 provenance와 UI가 모두 시끄러워지므로, 저장/복원 경계에서 consecutive identical update는 접습니다. tool result의 `transcriptPath`는 이 전체 전문 저장 위치이며, agent에게 돌아오는 즉시 응답은 선택값·직접 입력값·현재 탭 digest 중심입니다.

Transcript identity는 작업 단위 기준으로 유지합니다. Re-frame, 추가 decide, self-healing 후 re-verify처럼 같은 작업 안의 반복 stage는 새 transcript 파일이 아니라 같은 transcript timeline의 새 stage run으로 표현합니다. Canonical 기록은 별도로 `frame.json`의 success criteria, `decisions[]`, `verifications[]`에 새 항목으로 남기고, transcript는 그 반복의 provenance를 run 카드로 읽기 쉽게 보여줍니다.

Frame/Decide/Verify stage를 실제로 수행했다면 canonical 저장 후 해당 stage run은 반드시 `finish`로 닫힙니다. 다음 단계 질문이 취소·timeout·UI unavailable이어도 canonical write가 성공했으면 “다음 단계 미선택”을 기록하고 finish해야 합니다. Decide tab은 Frame의 requirement ID/domain lane/architecture flow 영향을 비교표와 decision record에 이어받고, Verify tab은 requirement/domain/flow coverage와 verify-report handoff 후보를 보여줘야 합니다. 다시 `/frame`, `/decide`, `/verify`가 호출되면 그것은 새 trigger이므로 같은 work-unit transcript 안의 다음 stage run으로 시작합니다.

이 구분이 중요합니다. LLM context에 전체 co-thinking 전문을 매번 주입하면 context budget과 attention이 무너집니다. 대신 tool result는 `contextDigest`, `tabSnapshot`, `transcriptRef`를 반환해야 합니다. `transcriptRef.openCommand`는 `/archive <transcriptPath>` 형태로 전문을 다시 여는 참조이며, 전문은 필요할 때 파일 또는 WebView로 확인하는 artifact입니다.

Transcript는 canonical source가 아니라 provenance입니다. 중요한 판단/결정/검증 결과가 transcript에만 있으면 실패입니다. 저장 완료 시 Studio 마지막 update/finish에는 `frame.json` path와 canonical hash 또는 해당 stage canonical reference를 남겨 사용자가 “어떤 대화가 어떤 계약으로 저장됐는지”를 추적할 수 있어야 합니다.

## Companion WebView Rule

Ghostty는 터미널 품질과 패널 분할을 맡고, TFT Studio/Verify Report/Artifact Browser 같은 WebView는 현재 Pi 세션의 단일 companion window로 묶습니다. 같은 패널에서 Frame, Decide, Verify, Verify Report, `/show-report`가 열릴 때마다 새 Glimpse 창을 늘리지 말고 기존 companion 창의 content를 교체합니다. WebView가 여러 개 떠서 어떤 창이 현재 작업의 짝인지 헷갈리는 상태는 실패입니다.

Companion 창은 처음 열거나 숨김 후 다시 열 때 기본적으로 화면 오른쪽 절반에 배치합니다. 이미 열린 companion에 새 TFT Studio/Verify Report/Artifact Browser 내용을 싣는 재사용 경로에서는 사용자가 옮겨둔 창 위치와 크기를 보존하고, 내용만 갱신해야 합니다. 매 update/ask마다 오른쪽 절반 bounds를 다시 적용하면 companion이 사용자의 작업 공간을 침범하는 실패입니다.

사용자는 `/companion` 또는 `Ctrl+Shift+G`로 현재 패널의 짝 창을 숨기거나 다시 열 수 있어야 합니다. 토글은 stage 종류를 묻지 않습니다. 사용자는 Frame 창, Verify Report 창, Artifact Browser 창을 따로 관리하는 것이 아니라 “현재 Pi 패널의 짝 WebView 하나”만 관리합니다.

이 규칙은 TFT stage identity와 충돌하지 않습니다. Frame Studio transcript identity는 여전히 work unit 기준이고, companion window binding은 현재 Pi 세션/패널의 presentation binding입니다. 즉 같은 transcript를 다시 열어도 UI 창은 현재 패널의 companion을 재사용하고, canonical 판단 기록은 transcript/canonical artifact에 남깁니다.

## Reopen Rule

사용자가 이전 TFT 흐름을 다시 보고 싶어 하면 같은 worktree/ticket/session identity로 `frame_studio action=open`을 호출합니다. 활성 run이 없더라도 저장된 transcript를 복원해 Glimpse/WebView에서 `TFT 전문` 섹션으로 다시 보여줘야 합니다.

Reopen은 읽기 전용 artifact 보기에서 끝나면 안 됩니다. 사용자가 기획을 이어가려는 경우 `/tft open <transcriptPath>` 또는 같은 identity의 `/tft open`으로 live TFT Studio를 재개할 수 있어야 합니다. `done`/`aborted` transcript도 재진입 시 status를 다시 `running`으로 전환해 후속 질문·수정이 같은 timeline에 이어져야 하며, 새 transcript를 만들지 않습니다. 마지막 질문이 `cancelled`/`timeout`/미응답 상태라면 재진입 시 같은 질문을 새 pending question으로 복구하고, 사용자가 답하면 Pi follow-up turn으로 답변 요약을 전달해 agent가 그 지점부터 계속 진행해야 합니다.

## Plan 선택 연속성 규칙

Decide tab에서 `Plan 모드`는 “선택 결과”가 아니라 다음 행동입니다. 사용자가 `Plan 모드`를 선택했는데 agent가 “Plan 모드가 선택됐습니다”라고 finish하면 Studio가 사고 도구가 아니라 막다른 선택지가 됩니다. 따라서 Decide는 canonical decision 저장 후 `Plan 모드`가 선택되면 같은 Studio run에서 implementation plan synthesis를 렌더링하고, 이어서 `구현 시작 / 부모에 handoff / 계획 수정 / 일단 멈춤` 같은 실제 action gate를 소비한 뒤 finish해야 합니다.

Fork child panel(`P1`, `P2`, …)에서는 이 규칙이 특히 중요합니다. child panel에서 protected worktree 생성·전환이나 부모 대화 계보가 필요한 구현 착수를 암묵적으로 진행하면 안 됩니다. Plan synthesis에는 현재 패널에서 해도 되는 일과 부모 `P0`로 넘겨야 하는 일을 분리하고, `부모에 handoff`를 선택하면 copy-ready handoff summary 또는 extension이 제공하는 handoff 경로로 연결해야 합니다.

## Boundary

TFT Studio는 `/frame` co-thinking에서 시작해 `/decide`, `/verify`, `/verify-report`를 같은 work unit 안에 묶는 UI 계층입니다. 구현 계획을 자동 생성하거나 검증 완료를 선언하는 도구가 아닙니다. frame 결과의 검증 가능성은 여전히 [frame-verify-contract](./frame-verify-contract.md)와 [evidence-first-verification-gate](./evidence-first-verification-gate.md)의 기준을 따릅니다.

Frame tab은 `frame.json`, Decide tab은 `decisions[]`, Verify tab은 검증 결과, Verify Report tab은 evidence/report artifact refs를 보여줍니다. Decide tab은 product식 tradeoff comparison과 항상 수행되는 challenge를 보여주되, 최종 원천은 `frame.json.decisions[]`의 structured record입니다. Verify tab은 success criteria 판정뿐 아니라 실패 이후 self-healing run과 re-verify 결과를 append할 수 있습니다. 탭 간 이동이 canonical write 순서를 우회하면 안 되지만, 빈 이전 탭이 현재 탭 사용을 차단해서도 안 됩니다.

Stage optionality와 stage output contract는 분리합니다. Decide/Verify를 강제로 하지는 않지만, 수행했다면 tool result의 `stageOutputContract`를 따라 `frame.json.decisions[]`, `frame.json.verifications[]`, 또는 명시적인 자유/계획 canonical record에 남깁니다. `transcriptRef`는 그 기록을 감사할 수 있는 링크이지 기록 자체가 아닙니다.
