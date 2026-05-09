---
title: 세션 분류는 원본 위의 sidecar다
tags:
  - archive
  - show-report
  - session-classification
  - sidecar
  - session
  - ai-suggestion
  - user-confirmation
category: workflow
status: active
confidence: high
applies_to:
  - extensions/archive-to-html
  - concern:archive
  - concern:show-report
source:
  - user-direction:2026-05-09-show-report-session-classification
  - user-direction:2026-05-09-archive-command-name
  - user-direction:2026-05-09-session-classification-select-tags
reviewed_at: 2026-05-09
reviewed_commit: 8f4b01cde92ee9c363d85cfc7e8dffaaa48c9fce
related:
  - artifact-archive-reopenability
  - session-export-source-preservation
  - backlog-source-session-provenance
  - deterministic-fallbacks-preserve-workflow
---

# 세션 분류는 원본 위의 sidecar다

## Judgment

대화 세션은 한 파일 안에 여러 맥락이 섞일 수 있습니다. 홈 세션 하나에도 잡담, 영상 분석, 기능 개선, knowledge 정리, 검증 리포트 확인이 이어질 수 있습니다. 따라서 세션을 다시 찾기 쉽게 만들려면 원본 JSONL을 고치지 말고, 별도의 sidecar metadata로 분류와 세그먼트를 얹어야 합니다.

이 분류는 canonical history가 아니라 navigation layer입니다. 원본 대화, session export, Verify Report, TFT Studio transcript는 그대로 두고 `/archive` Artifact Browser에서 사람이 찾기 쉬운 category/tag/summary/segment view를 제공합니다. 기존 `/show-report` alias도 같은 분류 sidecar를 읽어야 합니다.

## Sidecar Rule

세션 분류는 `~/.pi/agent/state/session-classification/*.json` 같은 local state에 저장합니다. 저장 단위는 session realpath hash이며, metadata에는 다음만 둡니다.

- session path reference
- primary category
- tags
- short summary
- optional segments with title/category/tags/summary/message index range
- created/updated timestamp

원본 JSONL, normalized export, HTML export는 분류 저장 때문에 수정하지 않습니다. 원본을 바꾸면 source-preservation 경계가 깨지고, 나중에 세션 export/cache 검증이 어려워집니다.

## AI Suggestion Rule

AI는 분류의 최종 결정자가 아니라 초안 작성자입니다. `/archive`가 세션 대화를 읽어 AI segment suggestion을 만들 수 있지만, 사용자가 확인하고 저장하기 전까지는 sidecar에 쓰지 않습니다.

추천 결과도 public doctrine이나 PR body에 raw session text를 옮기면 안 됩니다. 저장되는 summary는 나중에 찾기 위한 짧은 설명이어야 하며, private/company/customer/path detail은 요약에서 제거합니다. 모델 호출이 실패하거나 API key가 없으면 deterministic fallback으로 단일 세그먼트를 제안하되, fallback임을 UI에 표시합니다.

## UI Rule

`/archive`는 session card에 `분류` action을 제공하고, category/tag/summary/segments를 사용자가 직접 수정할 수 있게 합니다. 목록에는 category filter를 제공해 `pilee 개선`, `영상 분석`, `잡담/방향성`, `업무 검증`처럼 사용자가 만든 맥락으로 세션을 찾을 수 있어야 합니다.

분류(category)는 1차 보관함입니다. 자유 입력만 두면 기준이 흩어지므로 UI는 selectbox를 기본으로 하고, 마지막 옵션에서 직접 입력을 열어 예외를 허용합니다. 이 값은 `/archive` 상단 필터와 카드 grouping에 바로 쓰입니다.

태그(tags)는 같은 분류 안에서 나중에 찾기 위한 보조 검색 키워드입니다. category보다 작은 cross-cutting facet이므로 필수 판단 축처럼 보이게 하지 말고, 쉼표 구분 입력과 짧은 설명으로 선택 항목임을 드러냅니다.

세그먼트 분류는 검색과 탐색을 돕는 색인입니다. 세그먼트가 있다고 해서 세션을 실제로 쪼개거나 revive/export 대상이 바뀌는 것은 아닙니다.

## Review triggers

- 분류 저장이 원본 JSONL 또는 normalized export를 수정하기 시작할 때
- AI 추천이 사용자 확인 없이 자동 저장될 때
- category/tags가 public/private 경계를 넘는 구체 회사·계정·고객 정보를 담기 시작할 때
- `/archive` filter가 원본 artifact 접근성을 방해할 때
