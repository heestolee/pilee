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
reviewed_at: 2026-05-09
reviewed_commit: 8050064c8c98da577174208778fc7d9f8d6025f5
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

사용자에게 보이는 progress note, tool preamble, reasoning/progress summary도 한국어가 기본입니다. 단, 장황한 자기 설명을 번역해 늘리지 말고 `문서 검토 중`, `stale ID 추출 중`, `검증 실행 중`처럼 짧은 상태 라벨로 줄입니다. 명령어·파일 경로·raw log/error는 원문을 유지합니다.

## Review Artifact Rule

GitHub Actions나 local resolver가 만드는 PR body, `docs/knowledge-review.md`, resolver plan 요약처럼 사용자가 읽는 검토 산출물도 한국어 우선입니다. 단, doc id, branch, command, file path, commit hash는 그대로 둡니다. 한국어 설명과 원문 식별자를 분리하면 사용자는 맥락을 읽으면서도 재현 명령을 잃지 않습니다.

## Failure Mode

부분적으로만 번역된 UI는 기능적으로 동작해도 사용자가 검토할 때 비용을 만듭니다. localization은 마지막 polish가 아니라 curator/verify 같은 승인형 workflow의 신뢰 조건입니다.
