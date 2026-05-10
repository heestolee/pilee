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
  - skills/frame
  - extensions/tft-commands
source:
  - pilee-history:2026-05-06#67
  - pilee-history:2026-05-07#73
  - user-direction:2026-05-09-tft-studio-optional-stages
  - user-direction:2026-05-09-tft-studio-context-return
  - user-direction:2026-05-10-tft-studio-chronological-flow
reviewed_at: 2026-05-10
reviewed_commit: 335351fe327052d2a3f3e4f05081d38de37abefb
related:
  - frame-planning-identity
  - frame-verify-contract
  - ask-user-question-option-design
  - live-artifact-preview-pattern
---

## Judgment

`/frame`은 사용자가 계획을 감사하게 만드는 문서 생성 명령이 아니라, 목표·범위·검증 렌즈를 함께 좁히는 decision gate입니다. Pi text-mode fallback만으로는 이 체감이 약할 수 있으므로, UI가 가능한 환경에서는 TFT Studio가 질문 흐름을 별도 Glimpse 창에 묶어 보여줍니다.

TFT Studio는 Frame/Decide/Verify/Verify Report를 탭으로 나누는 작업 단위 shell입니다. 1차 구현에서는 Frame tab이 기존 co-thinking 기능을 계속 담당하고, Decide/Verify/Verify Report tab은 같은 identity 안에서 후속 또는 선택 stage state를 붙일 자리로 노출합니다. 탭은 UI 구획일 뿐이고, canonical source는 각 단계의 structured data여야 합니다.

TFT Studio는 pipeline 강제 UI가 아닙니다. `Frame → Decide → Verify → Verify Report`는 가장 풍부한 full cycle일 뿐이며, 작업 성격에 따라 `Frame only`, `Frame → Verify`, `Frame → Verify Report`, `Verify Report only`, `Decide 없이 Verify` 같은 부분 cycle도 정상 경로입니다. 전 단계 기록이 없다는 이유로 현재 탭 사용을 막지 않습니다.

Self-healing도 독립 TFT stage가 아닙니다. 검증 실패나 coverage gap 이후 실행되는 repair loop이므로 별도 탭으로 두지 않고, Studio에 표시한다면 Verify tab 안의 `Self-healing runs` / `Re-verify result` append section으로 남깁니다.

## Identity Rule

TFT Studio의 소유자는 현재 패널이 아니라 작업 단위입니다. worktree가 있으면 worktree identity를 쓰고, home/planning 상태라면 ticket 또는 session planning identity를 씁니다. 이렇게 해야 P0/P1 패널 이동이나 재개가 있어도 같은 frame/decision/verification 대화가 같은 Studio run으로 이어집니다.

## Interaction Rule

TFT Studio는 tabbed markdown live view와 single/multi option, 직접 입력을 지원합니다. markdown live view는 frame draft의 success criteria처럼 표가 핵심인 문서를 그대로 읽을 수 있어야 하므로 GitHub-style pipe table(`| header |`, `|---|`)을 table로 렌더링합니다. Decide/Verify 문서는 `####` 같은 깊은 heading을 자주 쓰므로 `#`~`######` heading도 literal markdown이 보이지 않게 렌더링해야 합니다. 표나 heading이 raw pipe/`####` paragraph로 깨지면 검증 기준을 함께 좁히는 UI 목적을 잃습니다.

사용자가 선택하거나 취소하면 tool 응답으로 돌아오고, headless/no-UI 환경에서는 blocking하지 않고 numbered text fallback으로 내려갑니다. 질문 대기는 agent turn을 붙잡는 blocking 상태라서 무한 대기하지는 않지만, 실제 frame 검토는 긴 회의/휴식 후에도 이어질 수 있으므로 기본 timeout은 짧은 30분이 아니라 작업 세션 단위의 긴 window로 둡니다.

사용자가 선택한 뒤에는 완료 카드가 선택값·직접 입력값·원 질문을 남겨 “Pi가 다음 단계를 준비 중”임을 보여줍니다. 즉 선택 직후 질문 UI가 사라져도 사용자가 방금 무엇을 제출했는지 화면에서 확인할 수 있어야 합니다.

TFT Studio의 메인 화면은 최신 활성 step을 위에 따로 띄우고 그 아래에 과거 전문을 붙이는 구조가 아니라, `update → question → answer`를 시간순으로 보여주는 진행 타임라인이어야 합니다. 사용자가 Step 3에서 선택 중이면 Step 1, Step 2 다음에 Step 3 질문이 inline으로 보여야 하며, pending question의 제목/옵션 UI는 한 번만 렌더링합니다. 원자료 성격의 로그만 하단에 분리합니다. 그래야 사용자가 화면을 3→1→2 순서로 읽는 인지적 역전이나 같은 질문이 두 번 보이는 혼선을 피할 수 있습니다.

즉 TFT Studio는 AskUserQuestion 원칙을 대체하지 않습니다. 같은 decision gate를 더 읽기 쉬운 UI로 표현하는 surface입니다. `/frame`의 핵심 정렬 질문에서는 추천안이 명백해 보여도 묻고, `(명백: ...)` 주석으로 AI 판단 근거를 같이 보여줘야 합니다.

Generative UI 스타일의 flat/compact visual pattern은 TFT Studio에도 유용하지만, dependency나 “모델이 매번 UI를 생성하는 방식”을 붙이는 것은 맞지 않습니다. TFT Studio는 prose-heavy co-thinking artifact이므로 `텍스트는 tool 밖에, visual만 tool 안에` 같은 규칙을 그대로 적용하면 오히려 목적을 잃습니다. 대신 renderer는 deterministic하게 유지하고, tab shell·표·요약 카드·간단한 다이어그램 같은 보조 시각화만 사용해 사용자가 목표/범위/검증 렌즈를 더 빨리 읽게 합니다.

## Transcript Rule

TFT Studio는 UI에 렌더된 markdown/update/question/answer 흐름을 identity별 transcript JSON으로 저장합니다. tool result의 `transcriptPath`는 이 전체 전문 저장 위치이며, agent에게 돌아오는 즉시 응답은 선택값·직접 입력값·현재 탭 digest 중심입니다.

이 구분이 중요합니다. LLM context에 전체 co-thinking 전문을 매번 주입하면 context budget과 attention이 무너집니다. 대신 tool result는 `contextDigest`, `tabSnapshot`, `transcriptRef`를 반환해야 합니다. `transcriptRef.openCommand`는 `/archive <transcriptPath>` 형태로 전문을 다시 여는 참조이며, 전문은 필요할 때 파일 또는 WebView로 확인하는 artifact입니다.

Transcript는 canonical source가 아니라 provenance입니다. 중요한 판단/결정/검증 결과가 transcript에만 있으면 실패입니다. 저장 완료 시 Studio 마지막 update/finish에는 `frame.json` path와 canonical hash 또는 해당 stage canonical reference를 남겨 사용자가 “어떤 대화가 어떤 계약으로 저장됐는지”를 추적할 수 있어야 합니다.

## Reopen Rule

사용자가 이전 TFT 흐름을 다시 보고 싶어 하면 같은 worktree/ticket/session identity로 `frame_studio action=open`을 호출합니다. 활성 run이 없더라도 저장된 transcript를 복원해 Glimpse/WebView에서 `TFT 전문` 섹션으로 다시 보여줘야 합니다.

Reopen은 읽기 전용 artifact 보기에서 끝나면 안 됩니다. 사용자가 기획을 이어가려는 경우 `/tft open <transcriptPath>` 또는 같은 identity의 `/tft open`으로 live TFT Studio를 재개할 수 있어야 합니다. `done`/`aborted` transcript도 재진입 시 status를 다시 `running`으로 전환해 후속 질문·수정이 같은 timeline에 이어져야 하며, 새 transcript를 만들지 않습니다. 마지막 질문이 `cancelled`/`timeout`/미응답 상태라면 재진입 시 같은 질문을 새 pending question으로 복구하고, 사용자가 답하면 Pi follow-up turn으로 답변 요약을 전달해 agent가 그 지점부터 계속 진행해야 합니다.

## Boundary

TFT Studio는 `/frame` co-thinking에서 시작해 `/decide`, `/verify`, `/verify-report`를 같은 work unit 안에 묶는 UI 계층입니다. 구현 계획을 자동 생성하거나 검증 완료를 선언하는 도구가 아닙니다. frame 결과의 검증 가능성은 여전히 [frame-verify-contract](./frame-verify-contract.md)와 [evidence-first-verification-gate](./evidence-first-verification-gate.md)의 기준을 따릅니다.

Frame tab은 `frame.json`, Decide tab은 `decisions[]`, Verify tab은 검증 결과, Verify Report tab은 evidence/report artifact refs를 보여줍니다. Decide tab은 product식 tradeoff comparison과 항상 수행되는 challenge를 보여주되, 최종 원천은 `frame.json.decisions[]`의 structured record입니다. Verify tab은 success criteria 판정뿐 아니라 실패 이후 self-healing run과 re-verify 결과를 append할 수 있습니다. 탭 간 이동이 canonical write 순서를 우회하면 안 되지만, 빈 이전 탭이 현재 탭 사용을 차단해서도 안 됩니다.

Stage optionality와 stage output contract는 분리합니다. Decide/Verify를 강제로 하지는 않지만, 수행했다면 tool result의 `stageOutputContract`를 따라 `frame.json.decisions[]`, `frame.json.verifications[]`, 또는 명시적인 자유/계획 canonical record에 남깁니다. `transcriptRef`는 그 기록을 감사할 수 있는 링크이지 기록 자체가 아닙니다.
