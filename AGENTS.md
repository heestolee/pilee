# pilee

이창희의 개인 pi coding agent 설정. Conductor 1852세션 경험을 기반으로 커스터마이징.

## 핵심 원칙

- **TFT 4 철칙**: 분기점 질문 의무 + (명백) 표기 패턴, 위험 결정 단독 금지, 근거 없는 완료 금지, 결과 정해진 질문 금지
- **frame.json 사이클**: frame → decide → verify가 하나의 구조화된 흐름. verify는 frame.json의 mechanical reader
- **양방향 합리화 차단**: "안 묻기" 합리화 + "과하게 묻기" 합리화 둘 다 차단
- **AskUserQuestion 규칙**: 한 줄 질문, 옵션에 결론 적기 금지, 처리된 항목 메뉴화 금지, 0개면 안 띄움
- **토큰 의식**: 안 쓰는 익스텐션 비활성화, 스킬 최소화, 시스템 프롬프트 중복 제거

## Karpathy-style coding guardrails

- **요청 추적성**: 모든 변경된 줄은 사용자 요청, frame success criteria, decision mitigation, 또는 검증 실패와 직접 연결돼야 한다.
- **단순한 해법 우선**: 요청되지 않은 기능, 옵션, 확장성, 추상화는 넣지 않는다.
- **외과수술식 변경**: 인접 코드 정리·취향 리팩터링·포맷 변경은 별도 요청 없이는 하지 않는다.
- **오류는 추측하지 말고 읽는다**: 실패하면 전체 에러/로그/exit code를 먼저 읽고 원인을 확인한 뒤 수정한다.

## Atomic evidence workflow

- **컨텍스트는 보조 장치다**: 오래된 transcript나 많은 맥락을 현재 truth로 보지 않는다. 현재 작업의 truth는 작은 claim, scope, evidence다.
- **작게 닫는다**: 큰 작업은 claim/slice 단위로 쪼개고, 각 slice는 독립적으로 검증 가능한 결과를 가져야 한다.
- **증거 없이는 완료가 아니다**: 도구 호출 성공, 파일 생성, Studio update 성공은 사용자-facing 성공과 다르다.
- **도구 성공은 사용자 성공이 아니다**: UI/TUI/렌더링/리포트 claim은 실제 화면·artifact·캡처로 확인해야 한다.
- **근본원인 없이 수정하지 않는다**: 실패하면 전체 로그/출력/실제 렌더 상태를 먼저 읽고 원인을 좁힌다.

## Public / Private 경계

- **public pilee**: 재사용 가능한 Pi 엔진, 안전 프로토콜, sanitized doctrine만 둔다.
- **private overlay**: 회사명, repo/path/profile, 계정 alias, Notion/Conductor/local script 경로, install/check command, raw history를 둔다.
- 판단법: 값이 “내 환경/회사/계정에서만 맞는 구체값”이면 public code에 박지 말고 profile·private skill·local config로 뺀다. public에는 interface와 generic fallback만 남긴다.

## 상세 기록

설계 결정, 분석 결과, 개선 근거 → `docs/pilee-history.md` 참조
공개 가능한 최신 설계 지식/검색 그래프 → `docs/knowledge/README.md` 참조

## 투두/백로그 제안 규칙

작업 중 다음 상황이 발생하면, 사용자에게 `/task` 또는 `/backlog` 추가를 제안한다:
- 후속 과제가 발견됐지만 지금은 범위 밖인 경우
- 버그를 발견했지만 현재 작업과 무관하여 넘어가는 경우
- 사용자가 "나중에", "다음에", "언젠가" 같은 언급을 한 경우
- 개선 아이디어가 나왔지만 지금 구현하지 않기로 한 경우

제안 방식: 옵션으로 간결하게
- `/task` — 현재 세션에서 추적할 작업 (스크린세이버 투두에 표시됨)
- `/backlog` — 장기 백로그 (우선순위 관리, 영구 저장)
- 안 넣음

물어바야 할 상황에서만 물을 것. 매 작업마다 의례적으로 묻지 않는다.

## pilee 변경 마무리 규칙

pilee 레포에 변경이 생기면 최종 보고 전에 반드시 `pilee-final-check` 절차를 적용한다.
- 요청 의도와 diff를 매핑하고, 실제 동작 구멍을 한 번 더 찾는다.
- 구멍을 발견하면 수정한 뒤 같은 검증을 다시 실행한다.
- 검증 없이 “완료/문제없음”을 선언하지 않는다.

## pilee 변경 배포 규칙

pilee 레포에 변경이 생기면 **명시적 푸시 보류 지시가 없는 한 반드시 push**한다.
- 적용 흐름: push → (대상 머신에서) `pi update` → pi 재시작
- `pi update` = git pull + npm install. 재시작은 별도.

## 기록 규칙

pilee에 변경이 있는 세션이 끝나기 전, `docs/pilee-history.md`에 해당 세션의 작업 내용을 추가할 것.
- 새 날짜면 `## YYYY-MM-DD` 헤더 추가
- 같은 날짜면 기존 헤더 아래에 항목 추가
- 형식: `#### N. 제목` + 핵심 결정/변경 사항 불릿
- 사용자가 요청하지 않아도 세션 마무리 시 자동 기록

### Notion 동기화 (필수)

기록 후 Notion 동기화 필수. 상세 규칙: `docs/pilee-history.sync.local.md` 참조
