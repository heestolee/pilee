---
title: User-facing 출력은 한국어를 기본으로 한다
tags:
  - korean-output
  - localization
  - web-search
  - ui
  - rewrite
  - 한국어
category: ui
status: active
confidence: high
applies_to:
  - extensions/user-facing-language
  - extensions/web-access
  - web_search workflow=summary-review
  - extensions/custom-style
  - skills/verify-report
source:
  - pilee-history:2026-05-05#46
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-05-26-clear-verdict-before-caveat
reviewed_at: 2026-05-26
reviewed_commit: 1f5c3acfcb23b01a3fc6bc30592dbe0156748c4f
related:
  - web-search-curator
  - curator-approved-source-selection
  - theme-information-hierarchy
---

## Judgment

사용자가 한국어로 작업하는 pilee 세션에서 user-facing prose는 한국어가 기본입니다. 검색어와 출처가 영어여도 버튼, 상태, 요약, fallback 라벨이 영어로 남으면 승인 UX가 끊깁니다.

## Language Rule

API 이름, 코드 식별자, 원문 제목, URL처럼 보존해야 하는 문자열은 유지합니다. 하지만 설명 문장, 안내, 오류, deterministic fallback, query rewrite 결과는 한국어 중심으로 작성합니다. 검색 provider에는 필요하면 한국어 답변 지시를 함께 보냅니다.

## Progress Summary Rule

사용자에게 보이는 progress note, tool preamble, reasoning/progress summary도 한국어가 기본입니다. 특히 Codex/OpenAI 계열이 노출하는 meta reasoning summary가 `Summarizing implementation`, `Checking files`, `I need to...` 같은 영어 자기서술로 새면 안 됩니다. 장황한 자기 설명을 번역해 늘리지 말고 `구현 요약 중`, `파일 확인 중`, `검증 실행 중`처럼 짧은 한국어 상태 라벨로 줄입니다. 명령어·파일 경로·raw log/error는 원문을 유지합니다.

## Result Judgment Tone Rule

검증·감사·DB 확인처럼 사용자가 결과 판정을 기대하는 응답에서는, 근거가 충분히 닫힌 항목에 대해 결론을 먼저 명확히 말하는 편이 좋습니다. 확인된 내용이 모두 맞으면 `모두 맞습니다`, `적용됐습니다`, `문제 없습니다`처럼 말하고, 해석상 덧붙일 내용은 `참고로` 또는 `주의점` 문장으로 분리합니다. 실제 불일치가 없는데 `대체로`, `보인다`, `아마`처럼 틀린 항목이 있는 듯한 hedge를 붙이면 사용자가 다시 확인해야 하는 비용이 생깁니다.

이 규칙은 하드 가드가 아니라 SHOULD 톤의 응답 스타일입니다. 진짜 미확인 항목, 부분 검증, 불일치, 위험은 숨기지 말고 `미확인`, `주의점`, `남은 확인`으로 분리해 표시합니다.

## Review Artifact Rule

GitHub Actions나 local resolver가 만드는 PR body, resolver plan 요약처럼 사용자가 읽는 검토 산출물도 한국어 우선입니다. 단, doc id, branch, command, file path, commit hash는 그대로 둡니다. 한국어 설명과 원문 식별자를 분리하면 사용자는 맥락을 읽으면서도 재현 명령을 잃지 않습니다. Review queue의 상세 목록은 repo markdown 파일보다 PR body에 두어, diff는 실제 source 변경만 보여주게 합니다.

## Failure Mode

부분적으로만 번역된 UI는 기능적으로 동작해도 사용자가 검토할 때 비용을 만듭니다. localization은 마지막 polish가 아니라 curator/verify 같은 승인형 workflow의 신뢰 조건입니다.
