---
title: Verify Report와 coverage-aware 증거 검증 흐름
tags:
  - verify-report
  - verification
  - evidence
  - coverage
  - capture
  - crop
  - before-after
  - glimpse
  - live-preview
  - report
  - show-report
  - subagent
  - fan-out
  - 검증
  - 리포트
  - 증거
category: verification
status: active
confidence: high
applies_to:
  - skills/verify-report
  - extensions/archive-to-html
  - extensions/archive-to-html/verify-report-live.ts
  - show-report
source:
  - pilee-history:2026-05-05#43
  - pilee-history:2026-05-05#47
  - pilee-history:2026-05-05#48
  - pilee-history:2026-05-06#68
  - pilee-history:2026-05-06#69
  - user-direction:2026-05-07-local-resolver
reviewed_at: 2026-05-09
reviewed_commit: b10752d9e7268f12cbd6e41ec1d9567c27073d52
related:
  - pilee-knowledge-system
  - web-search-curator
  - evidence-first-verification-gate
  - live-artifact-preview-pattern
  - artifact-archive-reopenability
  - private-overlay-package-boundary
supersedes:
  - make-report-confirm-only-upload-flow
---

## Overview

Verify Report는 “완료했다고 말하기 전에 증거를 남긴다”는 원칙을 UI/로그/코드 diff까지 확장한 검증 리포트 흐름입니다. 현재 기준은 단순히 캡처 파일을 모으는 것이 아니라, 변경 리스크를 coverage axis로 쪼갠 뒤 각 축을 증거로 닫는 것입니다.

기본 동작은 로컬 확인용 report를 먼저 만들고 Glimpse에서 확인한 뒤, 명시적으로 요청된 경우에만 외부 업로드나 PR 갱신으로 넘어갑니다. 프로젝트별 preview URL, 계정 alias, artifact storage 규칙은 private/project overlay가 제공하고, public verify-report는 coverage/evidence protocol에 집중합니다.

## Current Shape

검증은 `UI_CAPTURE`, `NETWORK`, `CONSOLE`, `CODE_DIFF`, `BE`, `SKIP` 같은 증거 타입으로 나뉩니다. 화면 변화가 핵심인 작업은 PNG/GIF 캡처가 강한 증거이고, GA 이벤트·API·백엔드 동작처럼 화면에 드러나지 않는 작업은 네트워크 로그, 콘솔 출력, 코드 diff, 서버 검증 결과를 evidence로 남깁니다.

기본 검증 구조는 evidence-first case worker fan-out입니다. main agent가 coverage 계획, 환경, 허용 액션을 정의하고, 여러 검증 축이 있으면 case별 subagent가 계획된 캡처/로그/명령 실행과 1차 검증을 병렬 수행합니다. Subagent는 brief에 적힌 planned evidence를 만들 수 있지만, 계획 밖 새 캡처/재캡처나 계정·route·viewport 확장은 `UNVERIFIED`와 `main_action_required`로 main에게 올립니다. 최종 report 상태와 사용자 질문은 main agent가 처리합니다.

live preview는 [web-search-curator](./web-search-curator.md)의 “작업 중 Glimpse 창이 상태를 실시간으로 보여준다”는 UX를 검증 리포트에 적용한 것입니다. 검증 계획을 세운 뒤 `start → update → finish`로 항목 상태가 변하고, finish 시 정적 HTML report가 남아 나중에도 다시 열 수 있습니다.

## Coverage Rule

캡처는 coverage 계획 뒤에 옵니다. responsive/layout 변경이면 mobile, breakpoint boundary, desktop을 각각 확인하고, nav 변경이면 expanded/collapsed와 role 차이를 봅니다. typography 변경은 screenshot만으로 닫지 않고 DOM class/token과 computed style을 함께 확인합니다.

기존 UI/동작을 바꾸는 작업은 before/after도 coverage 후보입니다. 같은 route, viewport, role, 데이터 상태로 작업 전 기준과 작업 후 결과를 나란히 보여주면 리뷰어가 “무엇이 바뀌었고 무엇은 유지됐는지”를 더 빨리 판단할 수 있습니다.

계획한 축이 빠졌다면 캡처가 있더라도 PASS가 아닙니다. 해당 항목은 `unverified`, `blocked`, 또는 Coverage Gap으로 남겨야 합니다.

## Capture Quality Rule

Primary evidence는 검증 포인트가 바로 보이는 viewport/section/element crop이어야 합니다. Before/after가 필요한 항목은 `Before — ...`, `After — ...` label로 같은 item에 넣어 비교되게 합니다. Full-page나 세로로 긴 스크롤 캡처는 supporting context로만 사용하고, 리포트에서는 토글/details/appendix/link 뒤에 둡니다.

긴 캡처를 그대로 본문에 펼치면 리뷰어가 실제 검증 지점을 찾기 어렵습니다. 따라서 Verify Report는 “전체 페이지를 찍었다”보다 “어떤 영역에서 무엇을 확인했는가”를 우선합니다.

## Evidence Intent Rule

Evidence는 파일 경로가 아니라 “검증 의도를 가진 관찰 단위”여야 합니다. report item evidence와 case worker result의 `evidence_created`에는 가능한 한 `purpose`(왜 수집했나), `inspectFor`(리뷰어가 봐야 할 것), `expected`(닫아야 할 기준), `observed`(실제 관찰), `role`(primary/supporting/raw), `relatedItem`(V1 같은 항목 id)을 함께 적습니다.

이 metadata는 live/static report의 evidence card와 `/show-report` 캡처/미디어 raw card·preview의 관찰 가이드로 재사용됩니다. `verify_report_live finish`는 direct evidence metadata를 `captures/evidence-intent.json` sidecar로 남기고, case worker는 `verify-workers/results/*.json`에 같은 metadata를 남깁니다. 따라서 시간이 지난 뒤 원본 PNG/GIF/JSON만 열어도 “이 파일이 왜 남았는지”와 “어디를 봐야 하는지”를 알 수 있어야 합니다. Metadata가 없으면 artifact browser는 원자료를 보여줄 수는 있지만 판정 근거로 읽기 어렵기 때문에, main agent가 보완하거나 Coverage Gap에 남겨야 합니다.

Raw evidence intent는 별도 “의도 인덱스” 섹션으로 분리하기보다 해당 raw evidence 토글 내부에 함께 둡니다. JSON/TXT/network/console/diff를 펼치는 순간 상단에서 `purpose → inspectFor → expected → observed`를 읽고 바로 아래 raw 원문을 확인하는 구조가 시선 분산을 줄입니다. 이 raw 토글은 관련 검증 item 안에 co-locate하되, 가로 grid의 반쪽 너비 카드가 아니라 full-width 세로 배치로 보여야 원문 가독성이 유지됩니다.

Renderer 디자인은 generative-ui류 도구의 패턴을 참고하되 dependency로 붙이지 않습니다. 검증 report는 매번 모델이 HTML을 새로 만드는 창작물이 아니라, 시간이 지나도 재오픈 가능한 판정 artifact입니다. 다만 너무 neutral/flat해서 사용자가 읽고 싶지 않은 문서가 되면 실패입니다. 따라서 deterministic renderer가 강한 verdict/coverage hierarchy, PASS/GAP 색상 리듬, 목표→방법→결과 흐름, raw toggle co-location을 제공하고, 모델은 양식 꾸미기보다 evidence closure에 집중하게 합니다.

## Case Worker Fan-out Rule

`/verify-report`는 별도 `--workers` 모드를 노출하지 않습니다. 기본값은 “main이 검증 계약을 정하고, case worker subagent가 계획된 증거 수집과 1차 검증을 병렬 수행하며, main이 최종 판정한다”입니다. 사용자가 `--no-workers`를 지정하거나 단일·자명한 항목이면 main이 직접 실행·판정합니다.

Fan-out의 속도 이점은 worker가 각 case의 planned capture/log/test flow를 직접 탄다는 데 있습니다. Main이 모든 화면 플로우를 먼저 돌아본 뒤 subagent가 읽기만 하는 구조가 아닙니다. 다만 worker가 계획 밖 새 시나리오를 발명하면 검증 범위가 흔들리므로, unplanned recapture나 추가 viewport/role/route가 필요하면 `UNVERIFIED`와 `main_action_required`로 올립니다. 이 escalation은 실패가 아니라 main이 추가 캡처, brief 수정 후 재위임, 기준 재해석, 사용자 질문, Coverage Gap 중 하나를 선택하게 하는 안전장치입니다.

Subagent verdict는 untrusted input입니다. Main은 result JSON, evidence path 존재 여부, criteria closure를 확인한 뒤에만 `verify_report_live` item을 `pass`/`fail`/`unverified`로 업데이트합니다.

## Reopen Rule

완료된 report는 `/show-report`의 검증 리포트 축에서 다시 열 수 있어야 합니다. Frame transcript나 원본 media와 섞지 말고, 판정이 있는 report 자체를 재검토 가능한 artifact로 남깁니다. 원본 evidence를 열어야 할 때는 browser/WebView의 static link 동작에 기대지 않고 artifact browser의 host-side open 흐름을 사용합니다.

report preview는 artifact browser 안에서 `/preview` route로 열리고, top bar의 `이전`, `브라우저에서 열기`, `닫기`로 탐색 경계를 유지해야 합니다. 검증 report는 생성 시점뿐 아니라 리뷰어가 나중에 열어 보는 시점에도 조작 가능한 증거여야 합니다.

원본 capture가 별도 media tab에 남는 경우에는 workspace/Jira/session/frame label로 group drill-down할 수 있어야 합니다. 다만 Verify Report의 PASS 판정은 여전히 report item evidence와 coverage gap에 있고, capture group은 원자료 탐색 보조입니다.

## Decision Rules

- report 작성은 검증의 일부이지 PR 업로드의 동의가 아닙니다.
- 사용자가 upload를 명시하지 않으면 로컬 report와 archive까지만 처리합니다.
- “화면이 바뀌지 않는다”는 이유로 검증을 생략하지 않고, 더 적절한 evidence type을 선택합니다.
- UI evidence는 crop/section image를 primary로 두고, 긴 full-page image는 supporting으로 둡니다.
- evidence에는 purpose/inspectFor/expected/observed/role/relatedItem을 붙여 raw artifact가 나중에도 읽히게 합니다.
- raw evidence intent는 raw 토글 안에 co-locate해 원문과 관찰 가이드가 분리되지 않게 합니다.
- raw evidence 토글은 각 검증 item 안에서 full-width 세로 배치해 원문 읽기 폭을 확보합니다.
- renderer는 strong verdict/coverage hierarchy를 deterministic하게 제공하되, AI-generated HTML dependency에 판정 artifact의 구조를 맡기지 않습니다.
- 기존 대비 변화가 검증 포인트이면 before/after를 포함합니다.
- before가 없거나 위험하면 생략 사유를 detail 또는 Coverage Gap에 남깁니다.
- 여러 검증 축은 기본적으로 case worker fan-out을 사용해 planned capture/log/test flow를 병렬화하되, `--no-workers`는 main 직접 실행·판정 escape hatch입니다.
- live preview는 사용자의 중간 확인을 돕기 위한 것이며, 최종 판단은 export된 report와 검증 결과에 근거합니다.

## Why It Matters

pilee의 TFT 원칙은 근거 없는 완료 선언을 금지합니다. Verify Report는 그 원칙을 사람이 읽을 수 있는 artifact로 바꾸는 장치입니다. 작업자가 바뀌거나 세션이 끊겨도 report HTML과 archive가 남기 때문에, “무엇을 확인했는지”, “어떤 축이 빠졌는지”, “어떤 항목은 왜 skip/blocked인지”를 재검토할 수 있습니다.

## Gotchas

업로드/PR 업데이트 기능은 편리하지만 가장 조심해야 하는 경계입니다. 로컬 확인 전 자동 업로드가 기본값이 되면 report는 검증 도구가 아니라 의례적 산출물이 됩니다. 따라서 기본값은 항상 preview-first이고, 외부 반영은 opt-in으로 유지합니다.

또한 full-page screenshot 하나만 있는 리포트는 증거가 있어 보이지만 coverage가 부족할 수 있습니다. PASS는 캡처 존재가 아니라 coverage axis가 닫혔는지로 판단합니다.
