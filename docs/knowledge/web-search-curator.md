---
title: Web Search curator와 승인형 요약 흐름
tags:
  - web-search
  - tavily
  - curator
  - glimpse
  - summary-review
  - korean-output
  - rewrite
  - 검색
  - 요약
  - 승인
category: web-access
status: active
applies_to:
  - extensions/web-access
  - web_search workflow=summary-review
  - show-report web-search-archive
source:
  - pilee-history:2026-05-05#44
  - pilee-history:2026-05-05#45
  - pilee-history:2026-05-05#46
reviewed_at: 2026-05-05
reviewed_commit: d5829047aef2c107923607d377fae7e225a2f3cd
related:
  - verify-report-workflow
  - pilee-knowledge-system
---

## Overview

Web Search curator는 Tavily 검색 결과를 바로 답변으로 넘기지 않고, 사용자가 Glimpse 창에서 결과를 고르고 요약 초안을 승인한 뒤 최종 답변으로 반영하는 흐름입니다. 목적은 웹 검색을 “자동 인용 생성”이 아니라 “사용자가 확인한 자료 기반 요약”으로 바꾸는 것입니다.

## Interaction Model

`workflow: summary-review`가 켜지면 curator UI가 먼저 열리고, 검색 결과는 SSE로 점진적으로 채워집니다. 사용자는 결과를 선택하거나 추가 검색을 요청할 수 있고, 필요하면 query rewrite로 검색어를 더 구체화합니다. 요약 초안은 preview 단계에서 승인되기 전까지 최종 답변으로 취급하지 않습니다.

이 구조는 [verify-report-workflow](./verify-report-workflow.md)의 live preview와 같은 UX 철학을 공유합니다. 완료된 뒤 정적 산출물만 보여주는 대신, 진행 중인 상태를 사용자가 볼 수 있고, 승인한 결과는 archive되어 나중에 다시 확인할 수 있습니다.

## Korean-first Rule

pilee의 기본 사용 언어가 한국어이므로, query/source가 영어여도 사용자가 보는 설명 prose는 한국어가 기본입니다. API 이름, 코드 식별자, 원문 제목처럼 보존해야 하는 문자열은 그대로 두되, 요약·버튼·상태·fallback 라벨은 한국어 중심으로 유지합니다.

## Failure Behavior

요약 모델 호출, native Glimpse, 추가 검색, rewrite 중 하나가 실패해도 검색 흐름 전체가 실패하면 안 됩니다. curator는 가능한 경우 deterministic fallback summary나 브라우저 fallback을 사용하고, raw source를 길게 노출하기보다 승인 가능한 최소 요약과 출처 목록을 남깁니다.

## Decision Rules

- 기본 `web_search`는 빠른 검색을 위해 그대로 둡니다.
- 사용자가 검토 가능한 자료 선택/승인이 필요한 상황에서만 `summary-review`를 사용합니다.
- 승인되지 않은 curator 초안은 최종 근거로 간주하지 않습니다.
- archive는 재확인용 artifact이며, 검색 결과의 영구 진실성 보장은 아닙니다.
