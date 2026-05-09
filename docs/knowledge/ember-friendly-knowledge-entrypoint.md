---
title: Ember는 knowledge의 친근한 입구다
tags:
  - ember
  - branding
  - command
  - knowledge
category: knowledge
status: active
confidence: high
applies_to:
  - extensions/ember
  - skills/pilee-knowledge
  - scripts/knowledge.mjs
  - docs/knowledge
source:
  - user-direction:2026-05-05-ember-branding
  - user-direction:2026-05-07-local-resolver
  - user-direction:2026-05-09-ember-add-workflow-contract
reviewed_at: 2026-05-09
reviewed_commit: a62df186632e9f1bac3bbbf953fa229501f388a8
related:
  - pilee-knowledge-system
  - private-journal-public-doctrine
  - readme-philosophy-user-gate
  - judgment-doc-unit
---

# Ember는 knowledge의 친근한 입구다

`불씨 / Ember`는 pilee knowledge 시스템의 canonical rename이 아니라, 사용자가 세션에서 남은 작은 깨달음을 다루기 쉽게 하는 command/branding layer다.

## 판단

저장소와 문서의 공식 용어는 계속 `knowledge`로 둔다.

- 저장 위치: `docs/knowledge/`
- CLI: `scripts/knowledge.mjs`
- 운영 용어: `freshness`, `confidence`, `reviewed_commit`, `review queue`

`/ember`는 이 구조 위에 얹는 friendly entrypoint다. 파이리의 작은 불꽃처럼, 아직 doctrine이 되지 않은 세션의 깨달음을 후보로 모으고(`collect`), 사용자가 고른 후보를 public knowledge로 추가하거나 기존 문서에 접목하며(`add`), 불길을 살피고(`tend`), 검토 queue를 정리하며(`review`), stale/review_needed 문서를 로컬 맥락으로 실제 해소한다(`resolve`). `add`는 product식 `/add-knowledge`의 검색·범위 정렬·작성 계획·검증 단계를 pilee의 judgment-document 모델에 맞춘 진입점이고, `resolve`는 public review queue를 실제 local update PR로 바꾸는 입구다. 민감한 resolver 산출물은 로컬에만 둔다. 초기 운영에서는 PR을 열고 사용자 review/merge를 기다리는 데서 멈춘다.

## `/ember add` workflow contract

`/ember add`는 새 문서를 만드는 명령이 아니라 **불씨를 public/sanitized reusable judgment로 정렬하는 절차**다. 따라서 파일을 쓰기 전에 다음 순서를 지킨다.

1. `git status`로 무관 WIP나 충돌을 확인한다. 안전하게 분리할 수 없으면 중단한다.
2. 주제를 정규화한다: 핵심 judgment 1문장, 검색어 3~6개, 예상 `applies_to` surface.
3. `node scripts/knowledge.mjs "<검색어>"`로 기존 knowledge를 먼저 검색한다.
4. 기존 문서가 답하면 신규 문서를 만들지 않고 그 문서를 갱신한다.
5. 신규 문서는 독립적으로 검색될 판단 단위일 때만 만든다. 문서 단위는 코드 scope가 아니라 [Knowledge 문서 단위는 판단 하나다](./judgment-doc-unit.md)의 reusable judgment다.
6. 관련 public 파일은 필요한 만큼 읽되, private history/session은 로컬 근거로만 쓰고 원문·경로·민감 맥락을 공개 문서에 복사하지 않는다.
7. 신규 vs 기존 갱신, 문서 분할, confidence처럼 의미 있는 분기가 있으면 번호형 작성 계획을 먼저 확인한다. 단일 후보와 전략이 명백하면 `(명백: ...)` 근거를 보고하고 진행할 수 있다.
8. 작성 후 `node scripts/knowledge.mjs --graph`, `--validate`, `--freshness`로 검증한다. 실제 검토가 끝난 문서만 `--confirm <doc-id>`로 reviewed 기준을 갱신한다.

이 계약은 `/ember add`가 product식 `/add-knowledge`의 좋은 작업 리듬을 가져오되, pilee의 canonical 모델(`docs/knowledge`, freshness, confidence, reviewed_commit)을 흐리지 않게 한다.

## 왜 full rename이 아닌가

`knowledge`는 공개 문서와 자동화가 다루는 데이터 모델을 명확하게 설명한다. 반면 `Ember`는 감성적이고 기억하기 쉽지만, 내부 구조 전체를 대체하면 새 사용자가 `docs/knowledge`와 `/ember`의 관계를 이해하기 어려워질 수 있다.

따라서 사용자-facing affordance만 `Ember`를 쓰고, repository-facing vocabulary는 `knowledge`를 유지한다.

## 적용 기준

`Ember`를 써도 좋은 곳:

- slash command: `/ember`
- README의 짧은 소개 문구
- 사용자 알림/도움말: "불씨를 knowledge 작업으로 이어갑니다"
- 신규/갱신 작성 진입점: `/ember add`, product식 `/add-knowledge` 감각을 가져오되 문서 단위는 public/sanitized judgment로 유지
- 로컬 resolver 진입점: `/ember resolve`, 내부 명령은 `scripts/knowledge.mjs --resolve-stale`
- add/resolve 결과 보고: 수정 파일, 연결 문서, 검증 결과, 남은 freshness를 보여주고 merge는 사용자에게 맡김

`knowledge`를 유지해야 하는 곳:

- 디렉토리/스크립트/패키지 구조
- generated README block
- frontmatter와 freshness report
- GitHub Action 및 정합성 자동화의 핵심 용어

이 원칙은 [pilee 지식 계층과 정합성 갱신](./pilee-knowledge-system.md), [Private journal과 public doctrine은 분리한다](./private-journal-public-doctrine.md), [README 철학 변경은 사용자 판단 게이트를 지난다](./readme-philosophy-user-gate.md)와 함께 적용된다.
