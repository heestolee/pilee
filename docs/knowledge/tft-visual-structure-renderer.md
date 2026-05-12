---
title: TFT visual은 구조 변화를 학습 가능한 그림으로 보여준다
tags:
  - tft-studio
  - tft-visual
  - elkjs
  - schema-diff
  - database
  - diagram
category: workflow
status: active
confidence: high
applies_to:
  - extensions/frame-studio
  - skills/tft-guidelines
source:
  - user-direction:2026-05-10-tft-visual-db-structure
reviewed_at: 2026-05-12
reviewed_commit: c82cbb080aa012fe0dfd135d37d099821dd70e23
related:
  - frame-studio-interactive-decision-ui
  - frame-verify-contract
  - evidence-first-verification-gate
  - backend-layer-map-frame-gate
---

## Judgment

DB schema, API shape, backend layer call-flow, state ownership, source-of-truth처럼 구조 이해가 작업의 핵심이면 텍스트 표만으로 충분하지 않습니다. 사용자가 “기존에는 어떤 형태였고 어떻게 변하는지”, “대안마다 테이블/컬럼이 어떻게 달라지는지”, “어느 컬럼이 어느 컬럼을 참조하는지”, “resolver/usecase/repository/VO/loader가 어떻게 이어지는지”를 물으면 TFT Studio는 `tft-visual` fenced block이나 call-flow diagram을 구조 그림으로 렌더링해야 합니다.

이 visual은 `/frame`이나 `/decide`에만 묶인 stage 기능이 아닙니다. Frame, Decide, Verify, 일반 구현 대화 어디서든 맥락상 구조 그림이 이해·선택·검증을 돕는다면 사용할 수 있는 시각화 primitive입니다.

## Renderer Rule

TFT Studio는 `elkjs` 기반 top-down renderer를 기본으로 사용합니다. Graphviz처럼 빠른 SVG renderer도 가능하지만, pilee의 목표는 학습용 설명 카드, 접기, badge, hover/highlight 같은 HTML/CSS 자유도가 높은 구조 리뷰 UI입니다. 따라서 ELK가 node layout과 edge routing을 계산하고, 테이블 카드·컬럼 상태·설명 패널은 deterministic HTML/CSS로 렌더링합니다.

기본 방향은 `DOWN`입니다. 좌→우(`RIGHT`)는 테이블이 2~3개이고 설명이 짧을 때만 선택합니다. 테이블이 많거나 컬럼 설명이 길면 top-down으로 전환하고, 폭이 viewport를 넘으면 scale을 적용해 가로 스크롤을 피합니다.

## Visual Semantics

각 테이블과 컬럼은 상태를 가질 수 있습니다.

- `new` — 새 테이블/컬럼/source-of-truth
- `changed` / `semantic change` — 기존 구조의 의미나 제약이 바뀜
- `removed` / `deleted` — 제거되는 컬럼, 하드코딩, assumption
- `same` — 유지되는 항목
- `fk` — 다른 테이블을 참조하는 관계
- `unique` — 중복을 막는 invariant
- `unique part` — 복합 unique의 일부

관계선은 긴 문장을 edge label에 직접 쓰지 않습니다. Edge에는 `R1`, `R2`처럼 짧은 label을 두고, 아래 relation card에서 `from → to`, 왜 필요한지, 검증 포인트를 설명합니다. 이렇게 해야 label이 카드와 겹치지 않고, 사용자가 관계를 학습할 수 있습니다.

## Learning Rule

구조 그림은 반드시 설명과 함께 나와야 합니다. 특히 사용자가 해당 영역 지식이 많지 않다고 밝힌 경우, 설명은 다음 순서로 씁니다.

1. 무엇이 바뀌는가
2. 왜 이 구조가 필요한가
3. 어떤 실수를 막는가
4. 무엇을 검증해야 하는가

예를 들어 `UNIQUE`는 “중복 방지”라고만 쓰지 말고, “한 spot이 override campaign을 하나만 갖게 해서 조회 결과 모호성을 없애고 rollback 대상을 단순화한다”처럼 작업 맥락에 연결합니다. backend layer map에서는 “repository는 조회 조건만 소유하고, usecase는 기준 시간/권한/transaction을 조합하며, VO는 계산·불변식을 소유한다”처럼 레이어 책임을 작업 맥락에 연결합니다.

## Layout Containment Rule

`tft-visual`의 내부 diagram canvas는 내용에 따라 넓어질 수 있지만, timeline/stage run 같은 바깥 카드 자체를 고정 폭으로 밀어내면 안 됩니다. 바깥 카드와 timeline 계층은 `min-width: 0`과 `max-width: 100%`로 부모 폭에 맞게 줄어들고, 실제 넓은 diagram은 `.tft-visual-diagram` 내부 가로 스크롤로만 처리합니다.

즉 “보라색 stage frame”은 흰 카드 폭에 맞춰 반응형으로 줄어들고, ELK canvas만 scrollable overflow를 가집니다. 이 규칙이 깨지면 사용자는 white frame과 purple frame이 서로 다른 기준 폭을 가진 것처럼 보게 됩니다.

## Boundary

`tft-visual`은 canonical source가 아닙니다. 구조 결정은 여전히 `frame.json`, `decisions[]`, `verifications[]`, 코드 diff, migration, runbook 같은 canonical artifact에 저장되어야 합니다. Visual은 사용자가 그 구조를 이해하고 검토할 수 있게 하는 provenance/learning surface입니다.
