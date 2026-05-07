---
title: Ember는 knowledge의 친근한 입구다
tags:
  - ember
  - branding
  - command
  - knowledge
category: knowledge
status: active
applies_to:
  - extensions/ember
  - skills/pilee-knowledge
  - scripts/knowledge.mjs
  - docs/knowledge
source:
  - user-direction:2026-05-05-ember-branding
reviewed_at: 2026-05-07
reviewed_commit: 858d8a21fb045c561b35a90172f37eb149d89b92
related:
  - pilee-knowledge-system
  - private-journal-public-doctrine
  - readme-philosophy-user-gate
---

# Ember는 knowledge의 친근한 입구다

`불씨 / Ember`는 pilee knowledge 시스템의 canonical rename이 아니라, 사용자가 세션에서 남은 작은 깨달음을 다루기 쉽게 하는 command/branding layer다.

## 판단

저장소와 문서의 공식 용어는 계속 `knowledge`로 둔다.

- 저장 위치: `docs/knowledge/`
- CLI: `scripts/knowledge.mjs`
- 운영 용어: `freshness`, `confidence`, `reviewed_commit`, `review queue`

`/ember`는 이 구조 위에 얹는 friendly entrypoint다. 파이리의 작은 불꽃처럼, 아직 doctrine이 되지 않은 세션의 깨달음을 후보로 모으고(`collect`), 불길을 살피고(`tend`), 검토 queue를 정리하며(`review`), stale/review_needed 문서를 로컬 맥락으로 실제 해소한다(`resolve`).

## 왜 full rename이 아닌가

`knowledge`는 공개 문서와 자동화가 다루는 데이터 모델을 명확하게 설명한다. 반면 `Ember`는 감성적이고 기억하기 쉽지만, 내부 구조 전체를 대체하면 새 사용자가 `docs/knowledge`와 `/ember`의 관계를 이해하기 어려워질 수 있다.

따라서 사용자-facing affordance만 `Ember`를 쓰고, repository-facing vocabulary는 `knowledge`를 유지한다.

## 적용 기준

`Ember`를 써도 좋은 곳:

- slash command: `/ember`
- README의 짧은 소개 문구
- 사용자 알림/도움말: "불씨를 knowledge 작업으로 이어갑니다"
- 로컬 resolver 진입점: `/ember resolve`, 내부 명령은 `scripts/knowledge.mjs --resolve-stale`

`knowledge`를 유지해야 하는 곳:

- 디렉토리/스크립트/패키지 구조
- generated README block
- frontmatter와 freshness report
- GitHub Action 및 정합성 자동화의 핵심 용어

이 원칙은 [pilee 지식 계층과 정합성 갱신](./pilee-knowledge-system.md), [Private journal과 public doctrine은 분리한다](./private-journal-public-doctrine.md), [README 철학 변경은 사용자 판단 게이트를 지난다](./readme-philosophy-user-gate.md)와 함께 적용된다.
