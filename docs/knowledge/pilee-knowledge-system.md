---
title: pilee 지식 계층과 정합성 갱신
tags:
  - pilee
  - knowledge
  - history
  - journal
  - sanitized
  - reviewed-at
  - graph
  - 지식
  - 히스토리
  - 정합성
category: knowledge
status: active
applies_to:
  - docs/knowledge
  - scripts/knowledge.mjs
  - skills/pilee-knowledge
  - .github/workflows/knowledge-sync.yml
source:
  - pilee-history:2026-05-05#knowledge-system
reviewed_at: 2026-05-05
reviewed_commit: f11f8c9b1e8e4664502eb3331507dc37bb7d8392
related:
  - verify-report-workflow
  - web-search-curator
  - subagent-model-policy
---

## Overview

pilee의 기록은 private journal과 public knowledge로 나눕니다. journal은 개인적 동기와 시행착오를 보존하고, knowledge는 그중 현재도 유효하며 공개 가능한 설계 지식만 정리합니다. 이 분리는 “왜 그런 결정을 했는가”와 “지금 어떤 원칙이 유효한가”를 동시에 남기면서도, 개인적·회사 관련 맥락이 공개 문서로 새는 문제를 막기 위한 구조입니다.

## Layering Rule

private journal은 원본 서사입니다. 감정, 실패 과정, 회사 업무 맥락, 세션의 뒷이야기까지 포함할 수 있습니다. public knowledge는 journal에서 추출한 결론 계층입니다. 그래서 여기에는 비밀 경로, 회사 도메인, 고객 데이터, 개인적 감상보다 기능의 목적·현재 구조·판단 기준·대체된 결정만 남깁니다.

문서 단위는 기능 하나가 아니라 그 기능을 만들게 한 재사용 가능한 판단 하나입니다. 단순히 “무엇을 만들었다”가 아니라 “왜 이 방식이 앞으로도 유효한 원칙인가”에 답할 수 있을 때 knowledge 문서가 됩니다. 기능마다 판단이 다르면 문서가 많아져도 괜찮고, README graph와 coverage report가 그 지층을 탐색하게 해줍니다.

이 구조는 [verify-report-workflow](./verify-report-workflow.md)처럼 한 기능이 여러 번 개선된 뒤에도 “현재 유효한 검증 리포트 원칙”만 빠르게 읽게 해줍니다. 과거의 시행착오는 journal에 남고, public 문서는 현재 운영 기준으로 갱신됩니다.

## Metadata Model

pilee knowledge는 product knowledge의 `scope.path + verified_at` 모델을 그대로 쓰지 않습니다. pilee는 100% AI-driven 개인 설정 레포이므로, 코드를 변경한 사람이 문서 책임자를 추적하는 방식보다 “어떤 기능/판단 영역에 적용되는가”가 더 중요합니다.

- `applies_to`는 이 지식이 설명하는 기능, 스킬, 확장, 자동화 영역입니다.
- `reviewed_at`은 마지막으로 현재 판단이 유효하다고 확인한 날짜입니다.
- `reviewed_commit`은 그 검토가 기준 삼은 git commit입니다. 같은 날짜에 추가 커밋이 생겨도 review 후보에서 빠지지 않게 하는 보조 기준입니다.
- `related`는 README graph의 명시적 edge입니다.
- `supersedes`는 대체된 과거 결정이나 개념 label입니다.

## Review Loop

정합성 갱신은 완전 자동 수정보다 “후보를 찾고, AI/사용자가 공개 가능한 형태로 재작성하고, 검토 기준을 갱신하는” 흐름을 따릅니다. `scripts/knowledge.mjs --freshness`는 base, summary, doctrine, README coverage, deterministic actions, AI/human review actions, candidates를 한 report로 나눠 보여줍니다. `--review-candidates`는 최근 commit과 로컬 journal에서 각 문서의 tags/applies_to와 맞닿는 흔적을 찾아 리뷰 후보를 제안합니다. 후보 문서는 내용을 읽고, 실제로 바뀐 원칙이 있으면 수정한 뒤 `--confirm`으로 `reviewed_at`과 `reviewed_commit`을 갱신합니다.

## Privacy Guardrail

journal에서 knowledge로 승격할 때는 원문을 복사하지 않습니다. 회사명, 내부 티켓, 고객/파트너 정보, 개인적 감정은 제거하고, 범용적인 설계 판단으로 바꿉니다. 공개 문서가 구체 사례를 필요로 하면 “업무 레포”, “private journal”, “특정 workflow”처럼 추상화합니다.
