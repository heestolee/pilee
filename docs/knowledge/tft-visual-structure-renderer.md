---
title: TFT visual은 구조 변화를 학습 가능한 그림으로 보여준다
tags:
  - tft-studio
  - tft-visual
  - elkjs
  - schema-diff
  - database
  - diagram
  - backend-layer-map
  - architecture-flow
  - data-flow
category: workflow
status: active
confidence: high
applies_to:
  - extensions/frame-studio
  - skills/tft-guidelines
source:
  - user-direction:2026-05-10-tft-visual-db-structure
  - user-direction:2026-06-04-tft-visual-render-healing
  - user-direction:2026-07-17-schema-diff-column-lifecycle
reviewed_at: 2026-07-17
reviewed_commit: e8a5212fb8212e0ebd97a9baa6b6da0791e630ff
related:
  - frame-studio-interactive-decision-ui
  - frame-verify-contract
  - evidence-first-verification-gate
  - backend-layer-map-frame-gate
---

## Judgment

DB schema, API shape, backend layer call-flow, state ownership, source-of-truth처럼 구조 이해가 작업의 핵심이면 텍스트 표만으로 충분하지 않습니다. 사용자가 “기존에는 어떤 형태였고 어떻게 변하는지”, “대안마다 테이블/컬럼이 어떻게 달라지는지”, “어느 컬럼이 어느 컬럼을 참조하는지”, “resolver/usecase/repository/VO/loader가 어떻게 이어지는지”를 물으면 TFT Studio는 `tft-visual` fenced block이나 call-flow diagram을 구조 그림으로 렌더링해야 합니다.

특히 backend layer map은 Markdown 표나 Mermaid fallback만으로 끝내지 않습니다. `kind: "backend-layer-map"` visual을 사용해 SVG rail + 카드형 레이어 설명을 보여주고, 각 카드에 쉬운 역할 비유(`요청 접수창`, `업무 총괄자`, `DB·외부 저장소 창구`), 요구사항 ID, 구현 후보, 검증 포인트를 같이 둡니다. 이 visual은 “레이어를 이미 아는 사람용 다이어그램”이 아니라, 부트캠프 수강생도 지금 작업이 어느 책임을 건드리는지 이해하게 만드는 학습 surface입니다.

레이어 책임 설명만으로 데이터/로직 흐름이 보이지 않으면 `kind: "architecture-flow"` 또는 `kind: "data-flow-map"` visual을 함께 사용합니다. 이 visual은 UI → API/Resolver → Usecase → Domain/VO/Service → Repository → DB → Ops/Review lane을 그리고, edge label로 “조회”, “payload 저장”, “승인 시 반영”, “legacy pending 반려”처럼 이동 의미를 표시합니다. DB table card에는 `PK`, `FK`, `UNIQUE`, `JSON`, `source-of-truth`, `legacy` badge를 붙여 구조와 데이터 흐름을 한 화면에서 보게 합니다.

이 visual은 `/frame`이나 `/decide`에만 묶인 stage 기능이 아닙니다. Frame, Decide, Verify, 일반 구현 대화 어디서든 맥락상 구조 그림이 이해·선택·검증을 돕는다면 사용할 수 있는 시각화 primitive입니다.

## Contract-first Learning Rule

TFT visual map은 학습 보조가 될 수 있지만, 강의 자료가 되면 안 됩니다. 항상 **contract layer**가 먼저입니다.

- contract layer: requirement ID, 이번 책임, 보존/변경 boundary, PASS evidence
- learning layer: 프론트 관점 비유, 왜 이 레이어인지, 잘못 두면 생기는 증상
- detail layer: glossary, PK/FK/source-of-truth 같은 용어 설명

learning layer는 contract를 읽기 쉽게 만드는 짧은 보조 설명입니다. “Resolver란?” 같은 일반 튜토리얼을 길게 붙이지 않고, “이번 요구사항에서 이 레이어를 어떻게 이해하면 되는가”만 한두 줄로 붙입니다.

## Renderer Rule

TFT Studio는 `elkjs` 기반 top-down renderer를 기본으로 사용합니다. Graphviz처럼 빠른 SVG renderer도 가능하지만, pilee의 목표는 학습용 설명 카드, 접기, badge, hover/highlight 같은 HTML/CSS 자유도가 높은 구조 리뷰 UI입니다. 따라서 ELK가 node layout과 edge routing을 계산하고, 테이블 카드·컬럼 상태·설명 패널은 deterministic HTML/CSS로 렌더링합니다.

`backend-layer-map` kind는 ELK 테이블 renderer 대신 deterministic SVG rail + HTML 카드 renderer를 사용합니다. 레이어 개수가 많아도 세로 스토리보드로 읽히게 하고, 가로 폭은 내부 diagram 영역에서만 scroll되도록 containment를 유지합니다.

`architecture-flow` kind는 lane-based renderer를 사용합니다. 각 node는 lane/row로 배치되고, SVG edge가 node 사이 데이터·로직 이동을 연결합니다. DB table node는 컬럼 목록과 constraint badge를 카드 안에 표시합니다. 복잡한 auto-layout보다 “전체 흐름을 한눈에 보는 안정적인 지도”를 우선합니다. lane이 많거나 가로 폭이 과도하면 renderer는 자동으로 세로 top-down 배치를 선택하고, 작은 그래프는 가로 배치를 유지합니다.

기본 방향은 `auto`입니다. `auto`는 lane 수, 예상 canvas 폭, lane당 node 수를 보고 `DOWN` 또는 `RIGHT`를 고릅니다. 좌→우(`RIGHT`)는 lane 수가 적고 설명이 짧을 때만 명시합니다. lane이 많거나 긴 title/body가 많으면 top-down으로 전환하고, diagram 내부에서만 scroll되게 합니다.

## Visual Healing Rule

`tft-visual`은 하나의 고정 schema를 강제하지 않습니다. 구조를 설명하는 사고 표면은 backend layer map, architecture flow, DB table map처럼 상황마다 자연스러운 shape가 다릅니다. 따라서 renderer는 author에게 `tables`만 강제하기보다 입력 shape를 먼저 진단합니다.

- `layers`가 있거나 `kind: "backend-layer-map"`이면 backend layer renderer로 보냅니다.
- `nodes`/`edges`가 있거나 `kind: "architecture-flow"` 계열이면 architecture flow renderer로 보냅니다.
- `tables`가 있으면 기존 table/ELK renderer로 보냅니다.
- `kind`가 없지만 `nodes`/`edges`가 있으면 의미를 바꾸지 않고 architecture flow로 자동 해석하며, 화면에는 “자동 보정됨” 기록을 남깁니다.
- 지원 shape를 찾지 못하거나 renderer 필수 필드가 비어 있으면 빨간 오류로 독자를 막지 않고 fallback card를 렌더링합니다. 원본 JSON은 접힌 영역에 보존합니다.

이 self-healing은 요구사항, 성공 기준, edge 의미를 고치는 루프가 아닙니다. **표현 포맷만 치유**하고, 의미는 원본 JSON과 canonical frame/decision/verification artifact에 남깁니다. renderer가 자동 보정했다면 사용자는 화면에서 그 사실을 볼 수 있어야 합니다.

## Visual Semantics

각 테이블과 컬럼은 상태를 가질 수 있습니다.

- `new` — 새 테이블/컬럼/source-of-truth
- `changed` / `semantic change` — 기존 구조의 의미나 제약이 바뀜
- `reused` / `repurposed` — 기존 컬럼을 다른 event/책임에서도 재사용함
- `removed` / `deleted` — 제거되는 컬럼, 하드코딩, assumption
- `same` — 유지되는 항목
- `fk` — 다른 테이블을 참조하는 관계
- `unique` — 중복을 막는 invariant
- `unique part` — 복합 unique의 일부

색만으로 상태를 전달하지 않습니다. 컬럼 행의 border/background와 함께 `신규`, `확장`, `재사용`, `삭제`, `유지` 같은 text badge를 표시합니다. `removed`는 빨강과 취소선을 함께 사용하고, 실제 변경에 삭제가 없으면 예시를 위해 삭제 행을 만들어내지 않습니다.

관계선은 긴 문장을 edge label에 직접 쓰지 않습니다. Edge에는 짧은 label을 두고, label은 흰 배경 pill로 렌더링합니다. Edge path는 카드 본문을 가로지르지 않고 lane gutter 또는 하단/right-side bus를 통해 우회해야 합니다. 자세한 `from → to`, 왜 필요한지, 검증 포인트는 relation card나 note에서 설명합니다. 이렇게 해야 label이 카드와 겹치지 않고, 사용자가 관계를 학습할 수 있습니다.

## Schema Diff Comparison Rule

Before/After schema diff는 “ERD를 그린다”는 이름보다 사용자가 비교를 읽는 방식이 중요합니다. 확정되지 않은 FK/cardinality를 억지 관계선으로 만들지 않고, 현재 구조와 변경 후 구조를 같은 table-card 문법으로 나란히 보여줍니다. 각 컬럼의 lifecycle 차이가 첫 시선에 들어와야 하며, 긴 prose나 중복 table card가 diff보다 먼저 보이면 실패입니다.

Study Hard처럼 이미 밝은 문서 surface 안에 들어가는 visual은 `schema-diff-light`를 기본 선택으로 사용합니다. 어두운 패널을 중첩하면 시각적으로 무거워지고 주변 노트와 정보 위계가 끊길 수 있습니다. dark variant는 사용자가 명시적으로 원하거나 독립 visual surface에서 대비가 필요한 경우에만 선택합니다.

`schema-diff-light`는 공용 architecture flow의 넓은 canvas 최소 폭을 그대로 강제하지 않습니다. 두 lane의 명시적 `nodeWidth`, `laneWidth`, `laneGap`으로 실제 consumer iframe에 맞추고, renderer는 schema diff canvas의 `min-width`를 해제합니다. 일반 architecture flow의 넓은 diagram containment/내부 scroll 규칙은 유지합니다. 구현 가능성만 보고 PASS하지 않고 Study Hard iframe 같은 실제 consumer width와 visual-only endpoint를 모두 캡처해 두 카드가 잘리지 않는지 확인합니다.

## Learning Rule

구조 그림은 반드시 설명과 함께 나와야 합니다. 특히 사용자가 해당 영역 지식이 많지 않다고 밝힌 경우, 설명은 다음 순서로 씁니다.

1. 무엇이 바뀌는가
2. 왜 이 구조가 필요한가
3. 어떤 실수를 막는가
4. 무엇을 검증해야 하는가

예를 들어 `UNIQUE`는 “중복 방지”라고만 쓰지 말고, “한 spot이 override campaign을 하나만 갖게 해서 조회 결과 모호성을 없애고 rollback 대상을 단순화한다”처럼 작업 맥락에 연결합니다. backend layer map에서는 “repository는 조회 조건만 소유하고, usecase는 기준 시간/권한/transaction을 조합하며, VO는 계산·불변식을 소유한다”처럼 레이어 책임을 작업 맥락에 연결합니다. 프론트 개발자용 비유를 붙일 때도 `프론트 비유 → 왜 여기 → 잘못 두면`을 짧게 쓰고, requirement/evidence보다 앞세우지 않습니다.

## Layout Containment Rule

`tft-visual`의 내부 diagram canvas는 내용에 따라 넓어질 수 있지만, timeline/stage run 같은 바깥 카드 자체를 고정 폭으로 밀어내면 안 됩니다. 바깥 카드와 timeline 계층은 `min-width: 0`과 `max-width: 100%`로 부모 폭에 맞게 줄어들고, 실제 넓은 diagram은 `.tft-visual-diagram` 내부 스크롤로만 처리합니다. 카드가 canvas 경계에서 잘리지 않도록 side padding/right gutter를 확보하고, edge label은 별도 pill layer로 보이게 합니다.

즉 “보라색 stage frame”은 흰 카드 폭에 맞춰 반응형으로 줄어들고, ELK canvas만 scrollable overflow를 가집니다. 이 규칙이 깨지면 사용자는 white frame과 purple frame이 서로 다른 기준 폭을 가진 것처럼 보게 됩니다.

## Boundary

`tft-visual`은 canonical source가 아닙니다. 구조 결정은 여전히 `frame.json`, `decisions[]`, `verifications[]`, 코드 diff, migration, runbook 같은 canonical artifact에 저장되어야 합니다. Visual은 사용자가 그 구조를 이해하고 검토할 수 있게 하는 provenance/learning surface입니다.
