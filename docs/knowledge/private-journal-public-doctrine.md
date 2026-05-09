---
title: Private journal과 public doctrine은 분리한다
tags:
  - knowledge
  - journal
  - privacy
  - sanitized
  - doctrine
  - history
category: knowledge
status: active
confidence: high
applies_to:
  - docs/knowledge
  - skills/pilee-knowledge
  - scripts/knowledge.mjs
source:
  - pilee-history:2026-05-05#49
  - pilee-history:2026-05-05#52
reviewed_at: 2026-05-09
reviewed_commit: 8008a92dddb6de7430712c36d9dee0dc53b09f8f
related:
  - pilee-knowledge-system
  - judgment-doc-unit
  - freshness-diagnosis-report
---

## Judgment

pilee-history는 원본 서사이고 knowledge는 공개 가능한 현재 판단입니다. 둘을 섞으면 개인적 동기, 회사 업무 맥락, 실험 과정이 public repo 문서로 새거나, 반대로 공개 문서가 지나치게 조심스러워져 판단을 잃습니다.

## Separation Rule

Private journal에는 감정, 시행착오, 구체 사건을 남길 수 있습니다. Public doctrine에는 현재 유효한 목적, 판단 기준, 운영 규칙, 대체된 결정만 남깁니다. 원문 복붙 대신 회사명/경로/티켓/고객 정보는 제거하고 재사용 가능한 설계 언어로 재작성합니다.

## Promotion Rule

journal entry 하나가 곧 knowledge doc은 아닙니다. 공개 가능한 판단이 있고, 이후 작업자가 다시 검색할 가치가 있을 때만 승격합니다.

## Local Log Rule

로컬 resolver나 세션 분석 과정은 private evidence를 충분히 사용해도 되지만, 로그와 공개 문서는 층을 나눕니다. `.context/knowledge-resolver/`의 실행 산출물과 `runs.jsonl`은 local-only로 두고, PR에는 수정/confirm-only/보류 같은 sanitized 결과만 씁니다. 반복 실행에서 얻은 재사용 가능한 운영 원칙만 public knowledge로 승격합니다.
