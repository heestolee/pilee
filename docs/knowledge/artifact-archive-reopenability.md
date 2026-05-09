---
title: 검토 산출물은 다시 열 수 있어야 한다
tags:
  - artifact
  - archive
  - show-report
  - history
  - html
  - reopen
  - captures
  - frame-studio
  - conductor
category: workflow
status: active
confidence: high
applies_to:
  - extensions/archive-to-html
  - show-report
  - extensions/backlog
  - extensions/web-access
source:
  - pilee-history:2026-05-01#17
  - pilee-history:2026-05-05#47
  - pilee-history:2026-05-05#48
  - pilee-history:2026-05-05#51
  - pilee-history:2026-05-07#74
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-05-07-conductor-history-artifact-browser
reviewed_at: 2026-05-09
reviewed_commit: bcad70f6b593d38cf4179e35c83c6f7510eceeed
related:
  - live-artifact-preview-pattern
  - backlog-source-session-provenance
  - verify-report-workflow
  - frame-studio-interactive-decision-ui
---

## Judgment

검토 산출물은 세션이 끝난 뒤에도 다시 열 수 있어야 합니다. 스크린샷 리포트, 웹 검색 승인 결과, backlog 원 세션 전문은 “그 순간 봤다”로 끝나지 않고 나중에 재검토 가능한 artifact로 남아야 합니다.

## Archive Rule

완료된 HTML report와 web search review는 workspace capture와 사용자 history archive에 저장합니다. `/show-report`는 최근 workspace 산출물, archive, Frame transcript, planning markdown, Pi/Conductor session provenance를 함께 탐색할 수 있어야 하며, native viewer가 안 되면 browser fallback을 제공합니다.

## Open Original Rule

artifact browser에서 “원본 열기”는 static `file://` 링크에 기대지 않고 extension host가 허용한 realpath를 system opener로 여는 방식이 안전합니다. Glimpse/WebView가 외부 링크를 삼킬 수 있으므로, 열기 요청은 allowlisted local path와 host-side open 동작으로 처리합니다.

## Preview Navigation Rule

Artifact Browser 안의 `열기`는 새 static wrapper를 또 띄우기보다 현재 local server의 `/preview` route로 이동해 같은 창에서 preview를 보여줍니다. preview top bar에는 artifact browser로 돌아가는 `이전`, host-side browser open, `닫기`가 있어야 합니다. 다시 열 수 있음은 파일이 있다는 뜻을 넘어, 사용자가 preview와 원본 확인 사이를 안전하게 왕복할 수 있음을 뜻합니다.

`이전`은 항상 Artifact Browser 홈으로 보내는 버튼이 아닙니다. work-unit detail, Conductor detail, capture group drill-down 같은 하위 맥락에서 artifact를 열었다면 preview URL에 현재 hash state를 `return`으로 넘기고, `이전`은 그 상태로 복원해야 합니다. 예를 들어 `Pi 이력 목록 → 특정 worktree 상세 → Frame transcript preview` 흐름에서 `이전`은 특정 worktree 상세로 돌아가야 정보 scent가 끊기지 않습니다.

## Artifact Browser Rule

artifact 종류가 늘어나면 한 목록에 섞지 않습니다. `/show-report`는 work-unit 축과 artifact-class 축을 동시에 지켜야 합니다.

1. Pi 이력 — `/wt resume`으로 복구한 worktree와 일반 Pi worktree/session을 작업 단위로 묶습니다. 원본 Conductor 세션, Pi 복구 세션, Pi 대화 세션, 복구 컨텍스트, 관련 검증 리포트/Frame/기획 markdown/캡처/웹 검색을 하위 섹션으로 보여줍니다.
2. 컨덕터 이력 — runtime profile이 지정한 Conductor master DB와 project JSONL roots에 남은 원본 이력을 보여줍니다. `/wt resume` 산출물이 아니라 원본 보존 이력이라는 의미가 중심입니다.
3. 웹 검색 — web-search review HTML은 verify report와 섞지 않고 별도 artifact class로 둡니다. worktree/session과 연결되는 검색은 해당 Pi 이력 아래에도 노출하고, 연결되지 않는 검색은 웹 검색 기본 그룹에 남깁니다.
4. 검증 리포트 — verify report HTML처럼 판정이 있는 검증 산출물입니다.
5. 기획 / Frame — TFT Studio transcript와 `.context/plans`, `.context/work/**/context.md`, `todo.md` 등 planning markdown처럼 생각 과정이나 작업 계획을 남기는 문서입니다.
6. 캡처 / 미디어 — 아직 리포트로 묶이지 않았거나 원본 확인이 필요한 PNG/JPEG/GIF/WebP/SVG evidence입니다.

이 구분은 “작업 단위 이력”, “판정이 있는 리포트”, “생각 과정 전문”, “해석 전 원자료”를 섞지 않기 위한 정보 구조입니다.

## Capture Group Rule

캡처 / 미디어 축은 raw file을 평면 목록으로만 보여주지 않습니다. workspace 단위로 먼저 묶고, 가능하면 Jira ticket/title, session title, Frame identity를 label로 사용해 “어떤 작업의 원자료인가”를 보여줍니다. 사용자는 group card에서 폴더를 열듯 drill-down한 뒤 개별 이미지/GIF/WebP/SVG를 확인합니다.

metadata가 없으면 workspace fallback이나 미분류 group으로 남깁니다. 그룹화는 raw evidence를 판정 리포트로 승격하는 것이 아니라, 많은 캡처가 쌓였을 때 재탐색 가능한 구조를 제공하는 것입니다.

Raw capture가 verify-report sidecar(`captures/evidence-intent.json`)나 case worker 결과(`verify-workers/results/*.json`)에서 온 경우에는 `purpose`, `inspectFor`, `expected`, `observed`, `role`, `relatedItem` 같은 evidence intent를 card와 preview top guide에 함께 보여줍니다. 원자료 탭은 PASS 판정을 대신하지 않지만, 파일만 보고도 “왜 남긴 캡처인지 / 어디를 봐야 하는지”를 알 수 있어야 reopenability가 실제 검토 가능성으로 이어집니다. Verify Report HTML 안에서는 raw JSON/TXT/network/console/diff의 intent를 별도 섹션으로 떼지 않고 해당 raw 토글 내부에 co-locate해, 원문을 펼친 시점의 시선 흐름 안에서 관찰 가이드를 읽게 합니다.

## Pi / Conductor Provenance Rule

`/wt resume`으로 복구되어 `.pi/conductor-context.loaded.md`가 남아 있는 worktree는 `Pi 이력`의 복구 단위입니다. 이 카드에는 원본 Conductor 세션 링크, Pi 복구 세션, 이후 Pi 대화 세션을 분리해서 보여주고, 관련 검증/기획/캡처/웹 검색 artifact를 하위 섹션으로 묶습니다.

일반 Pi 세션은 fork-panel 세션만의 보조 자료가 아닙니다. Artifact Browser의 `Pi 이력`은 home/pilee/worktree/session directory에 남은 일반 P0 session JSONL까지 모두 보여줘야 하며, 임의의 “최근 12개” 같은 hidden cap으로 과거 세션을 누락시키면 안 됩니다. 각 세션 카드에는 `P0` 또는 fork-panel label(`P1`, `P2`…)과 `부모/P0`/`fork-panel` source badge를 표시해 사용자가 부모 대화와 자식 패널을 구분할 수 있게 합니다.

`컨덕터 이력`은 runtime profile이 제공하는 Conductor master DB와 원본 JSONL root를 기준으로 한 보존 이력입니다. Public Artifact Browser는 특정 로컬 DB 경로나 project directory를 내장하지 않고, profile이 없으면 해당 축을 생략하거나 generic session/archive만 보여줍니다. Conductor 이력 카드에는 ticket/title/branch/status/session id 같은 요약 metadata와 이전 사용자 요청 목록을 보여주되, 원본 Conductor JSONL은 전체 내용을 inline으로 펼치지 않고 allowlisted host-side open/preview로 연결합니다. 큰 원본 세션은 truncate preview와 browser open을 분리해 WebView가 과도한 raw transcript를 직접 삼키지 않게 합니다.

원본 Conductor session이 Pi worktree로 복구된 흔적과 매칭되면 `Pi로 복구됨` badge를 표시합니다. 이 badge는 원본을 대체했다는 뜻이 아니라, 같은 작업 단위가 Pi 세계에도 연결되어 있음을 알려주는 provenance bridge입니다.

## Session Preview Encoding Rule

Pi/Conductor session JSONL은 raw UTF-8 원본입니다. Artifact Browser preview가 이를 iframe/data URI로 감싸면 data URI에도 `charset=utf-8`을 명시해야 합니다. outer HTML에만 `<meta charset>`이 있으면 iframe 내부 data document가 별도 문서로 해석되어 한국어가 mojibake처럼 보일 수 있습니다.

세션 JSONL은 raw line을 그대로 펼치기보다 실제 대화만 추려 보여줍니다. system/model/session/tool/thinking/encrypted payload와 tool result 같은 실행 노이즈는 숨기고, 사용자 메시지와 assistant의 실제 답변 text만 대화 버블로 표시합니다. Pi v3 JSONL의 `type: "message"`와 Conductor/Claude JSONL의 top-level `type: "user" | "assistant"`, `last-prompt` shape를 모두 지원해야 합니다. 한쪽 schema만 파싱하면 다른 쪽 이력이 “비어 있음”으로 보입니다.

Conductor master 탭은 profile이 지정한 원본 project JSONL만 믿지 않습니다. Conductor DB `session_messages`의 user 요청을 함께 preview로 보여줘야 원본 JSONL 파일이 없거나 일부 workspace source lookup이 실패해도 작업 의도를 잃지 않습니다. DB preview는 요청 요약/탐색 보조이고, 전체 대화 근거는 원본 Conductor 세션 전문 export/open으로 분리합니다.

세션 전문 보기는 `/backlog`의 source-session export 방식과 같은 `pi --export <sessionFile> <outputPath>` 렌더러를 재사용합니다. Pi session JSONL은 그대로 export하고, Conductor/Claude JSONL은 원본 파일을 직접 export하지 않습니다. 먼저 로컬 `session-exports/show-report/normalized` 아래에 Pi-compatible session JSONL로 변환한 뒤 exporter에 넘깁니다. 이 guard가 없으면 Pi exporter가 session header 없는 raw JSONL을 열면서 원본을 새 Pi session header로 덮어쓸 수 있습니다.

세션 export HTML은 사람이 읽는 기본값이 되어야 합니다. `Default`가 tool result를 거의 모두 포함해 `All`과 비슷해지는 세션에서는 `No-tools`를 기본 filter로 열고, sidebar/tree filter와 본문 path 렌더링도 같은 filter를 따라야 합니다. 사용자가 tool 결과가 필요한 순간에만 `Default`/`All`로 확장하는 것이 session 전문의 정보 위계를 지킵니다.

세션 export는 source session의 realpath, size, mtime, cache version으로 캐시합니다. 원본이 바뀌지 않았고 cache version이 같으면 기존 HTML을 재사용해 반복 열기를 빠르게 합니다. exporter UI나 post-process 규칙이 바뀌면 cache version을 올려 stale HTML을 자동 무효화합니다.

`브라우저에서 열기`는 macOS file association에 맡기지 않습니다. `.jsonl`처럼 기본 앱이 없어 `open <file>`이 실패할 수 있으므로, session JSONL은 export된 HTML 전문 파일을 열고, 일반 artifact는 Artifact Browser의 allowlisted localhost `/preview?path=...&full=1` URL을 외부 브라우저로 엽니다. 직접 `/show-report --browser <session.jsonl>`로 연 경우에도 원본 파일을 바로 `open`하지 않고 export된 HTML을 열어야 합니다. 이렇게 하면 원본 경계는 유지하면서도 브라우저 버튼이 파일 확장자에 의존하지 않습니다.

## Failure Mode

artifact가 임시 파일에만 남으면 검증과 의사결정의 근거가 사라집니다. reopenability는 보고서 기능이 아니라 accountability 기능입니다.
